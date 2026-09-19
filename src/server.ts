import { join } from 'node:path'
import type { ServerWebSocket } from 'bun'
import { createModelConnectionStore } from './model-connection'
import { createWorkStore, WorkArtifactError, WorkConflictError, WorkInputError } from './work'
import { createStewardService, StewardConflictError, StewardInputError } from './steward'

function modelPath(protocol: 'chat-completions' | 'responses') {
  return protocol === 'chat-completions' ? 'chat/completions' : 'responses'
}

function observeUsage(body: ReadableStream<Uint8Array>, save: (usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }) => Promise<void>) {
  const decoder = new TextDecoder()
  let pending = ''
  let usage: Record<string, unknown> | undefined
  function inspect(frame: string) {
    const data = frame.split('\n').find(line => line.startsWith('data: '))?.slice(6)
    if (!data || data === '[DONE]') return
    try {
      const item = JSON.parse(data) as { usage?: Record<string, unknown>; response?: { usage?: Record<string, unknown> } }
      usage = item.usage ?? item.response?.usage ?? usage
    } catch { /* the provider response remains untouched */ }
  }
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk)
      pending = (pending + decoder.decode(chunk, { stream: true })).replaceAll('\r\n', '\n')
      let boundary: number
      while ((boundary = pending.indexOf('\n\n')) !== -1) {
        inspect(pending.slice(0, boundary))
        pending = pending.slice(boundary + 2)
      }
      if (pending.length > 1_000_000) pending = pending.slice(-1024)
    },
    async flush() {
      if (pending) inspect(pending)
      const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
      const inputTokens = number(usage?.prompt_tokens ?? usage?.input_tokens)
      const outputTokens = number(usage?.completion_tokens ?? usage?.output_tokens)
      const totalTokens = number(usage?.total_tokens)
      await save({ inputTokens, outputTokens, totalTokens })
    },
  }))
}

function closeWith(body: ReadableStream<Uint8Array>, cleanup: () => void) {
  const reader = body.getReader()
  let closed = false
  const finish = () => {
    if (closed) return
    closed = true
    cleanup()
    reader.releaseLock()
  }
  return new ReadableStream<Uint8Array>({
    async pull(output) {
      try {
        const chunk = await reader.read()
        if (chunk.done) { finish(); output.close() }
        else output.enqueue(chunk.value)
      } catch (error) { finish(); output.error(error) }
    },
    async cancel(reason) {
      try { await reader.cancel(reason) } finally { finish() }
    },
  })
}

type Config = { password: string; host?: string; port?: number; secureCookie?: boolean; publicOrigin?: string; dataDir?: string; artifactDir?: string; modelTimeoutMs?: number; directoryUrl?: string; databaseUrl?: string; testNow?: () => number }
type Session = { expires: number; sockets: Set<ServerWebSocket<{ token: string }>> }

const cookieName = 'agentanywhere_session'
const day = 86_400_000
const assets = join(import.meta.dir, '../dist')
const uuidValue = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function readLimited(request: Request | Response, limit = 1024): Promise<string | null> {
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) { await reader.cancel(); return null }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

export async function startServer(config: Config) {
  if (!config.password || config.password.length < 12) throw new Error('AGENTANYWHERE_PASSWORD must contain at least 12 characters')
  const passwordHash = await Bun.password.hash(config.password, { algorithm: 'argon2id' })
  const modelConnection = createModelConnectionStore(config.dataDir ?? join(process.cwd(), 'data'), config.modelTimeoutMs, config.directoryUrl)
  await modelConnection.load()
  const artifactDir = config.artifactDir ?? join(config.dataDir ?? join(process.cwd(), 'data'), 'artifacts')
  const work = config.databaseUrl ? await createWorkStore(config.databaseUrl) : null
  const steward = config.databaseUrl ? await createStewardService(config.databaseUrl, modelConnection.resolveCredential, config.testNow,
    work ? { catalog: work.stewardCatalog, metadata: work.stewardMetadata,
      read: (taskIds: string[], versionIds: string[]) => work.stewardRead(taskIds, versionIds, artifactDir),
      modelStats: work.stewardModelStats, createFromSteward: work.createFromSteward } : undefined) : null
  const sessions = new Map<string, Session>()
  const attempts = new Map<string, { count: number; until: number }>()
  const secure = config.secureCookie ?? false

  function endSession(token: string) {
    const value = sessions.get(token)
    if (!value) return
    for (const socket of value.sockets) socket.close(1000, 'Session ended')
    sessions.delete(token)
  }

  function sessionToken(request: Request): string | undefined {
    return request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
  }

  function session(request: Request): Session | null {
    const token = sessionToken(request)
    const value = token ? sessions.get(token) : undefined
    if (!value || value.expires <= Date.now()) { if (token) endSession(token); return null }
    return value
  }

  function sameOrigin(request: Request): boolean {
    const origin = request.headers.get('origin')
    if (!origin) return true
    return origin === (config.publicOrigin ?? new URL(request.url).origin)
  }

  function cookie(value: string, maxAge: number) {
    return `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
  }

  const common = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: common })
  const redirect = (path: '/' | '/login') => new Response(null, { status: 302, headers: { ...common, location: path } })

  const app = Bun.serve<{ token: string }>({
    hostname: config.host ?? '127.0.0.1',
    port: config.port ?? 3000,
    async fetch(request, server) {
      const url = new URL(request.url)
      const path = url.pathname
      const authenticated = session(request)

      const messageMatch = /^\/internal\/runs\/([0-9a-f-]{36})\/(\d+)\/messages$/i.exec(path)
      if (messageMatch && work) {
        const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
        const runId = messageMatch[1]
        const epoch = Number(messageMatch[2])
        if (request.method === 'GET') return json(await work.pendingRunMessages(runId, epoch, token))
        if (request.method === 'POST') {
          const body = await readLimited(request, 1024)
          let id: unknown
          try { id = body ? JSON.parse(body).id : undefined } catch { /* invalid input */ }
          if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Invalid message ID' }, 400)
          return await work.acknowledgeRunMessage(runId, epoch, token, id) ? json({ applied: true }) : json({ error: 'Run epoch or message unavailable' }, 409)
        }
      }

      const proxyMatch = /^\/internal\/runs\/([0-9a-f-]{36})\/(\d+)\/v1\/(chat\/completions|responses)$/i.exec(path)
      if (proxyMatch && request.method === 'POST') {
        if (!work) return json({ error: 'Unavailable' }, 503)
        const body = await readLimited(request, 12_000_000)
        if (body === null) return json({ error: 'Request too large' }, 413)
        let parsed: { model?: unknown }
        try { parsed = JSON.parse(body) } catch { return json({ error: 'Invalid JSON' }, 400) }
        if (!parsed || typeof parsed !== 'object') return json({ error: 'Invalid JSON' }, 400)
        const protocol = proxyMatch[3] === 'chat/completions' ? 'chat-completions' : 'responses'
        const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
        const credential = await work.authorizeModelProxy(proxyMatch[1], Number(proxyMatch[2]), token, parsed.model as string, protocol, modelConnection.resolveCredential)
        if (!credential) return json({ error: 'Unauthorized' }, 401)
        const reservation = await work.reserveModelAttempt(proxyMatch[1], Number(proxyMatch[2]), token, config.testNow?.() ?? Date.now())
        if (reservation !== 'allowed') return json({ error: reservation === 'limit' ? 'Run limit reached' : 'Run stopped' }, 409)
        const controller = new AbortController()
        const runId = proxyMatch[1]
        const epoch = Number(proxyMatch[2])
        if (await work.isRunStopped(runId, epoch)) return json({ error: 'Run stopped' }, 409)
        const timer = setInterval(() => void work.isRunStopped(runId, epoch).then(stopped => {
          if (stopped) { controller.abort(); stopWatching() }
        }).catch(() => { controller.abort(); stopWatching() }), 200)
        const stopWatching = () => {
          clearInterval(timer)
          request.signal.removeEventListener('abort', stopWatching)
        }
        request.signal.addEventListener('abort', stopWatching, { once: true })
        const callId = crypto.randomUUID()
        try {
          await work.recordModelUsage(runId, epoch, { callId, inputTokens: null, outputTokens: null, totalTokens: null })
          const upstream = await fetch(`${credential.endpoint}/${modelPath(protocol)}`, {
            method: 'POST', headers: { authorization: `Bearer ${credential.apiKey}`, 'content-type': 'application/json' },
            body, redirect: 'manual', signal: AbortSignal.any([request.signal, controller.signal]),
          })
          const contentType = upstream.headers.get('content-type') ?? 'application/json'
          const metered = upstream.body && upstream.ok && contentType.includes('text/event-stream')
          const stream = metered
            ? observeUsage(upstream.body!, usage => usage.inputTokens !== null || usage.outputTokens !== null || usage.totalTokens !== null
              ? work.recordModelUsage(proxyMatch[1], Number(proxyMatch[2]), { callId, ...usage }) : Promise.resolve()) : upstream.body
          if (!stream) stopWatching()
          return new Response(stream ? closeWith(stream, stopWatching) : null, { status: upstream.status, headers: { ...common, 'content-type': contentType } })
        } catch { stopWatching(); return json({ error: 'Model gateway unavailable' }, 502) }
      }

      if (path === '/api/auth' && request.method === 'POST') {
        if (!sameOrigin(request)) return json({ error: 'Forbidden' }, 403)
        const ip = server.requestIP(request)?.address ?? 'unknown'
        const previous = attempts.get(ip)
        if (previous && previous.until > Date.now() && previous.count >= 5) return json({ error: 'Too many attempts' }, 429)
        const body = await readLimited(request)
        let password: unknown
        try { password = body ? JSON.parse(body).password : undefined } catch { /* invalid input */ }
        if (typeof password !== 'string' || !await Bun.password.verify(password, passwordHash)) {
          attempts.set(ip, { count: (previous?.until ?? 0) > Date.now() ? previous!.count + 1 : 1, until: Date.now() + 60_000 })
          return json({ error: 'Invalid credentials' }, 401)
        }
        attempts.delete(ip)
        const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
        sessions.set(token, { expires: Date.now() + day, sockets: new Set() })
        setTimeout(() => endSession(token), day)
        return new Response(null, { status: 204, headers: { ...common, 'set-cookie': cookie(token, day / 1000) } })
      }

      if (path === '/login' && request.method === 'GET') {
        if (authenticated) return redirect('/')
        return html()
      }
      if (path.startsWith('/assets/') && request.method === 'GET' && /^\/assets\/[a-zA-Z0-9._-]+$/.test(path)) {
        const file = Bun.file(join(assets, path.slice(1)))
        return await file.exists() ? new Response(file, { headers: { 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } }) : new Response('Not found', { status: 404 })
      }
      if (!authenticated) {
        if (path.startsWith('/api/')) return json({ error: 'Unauthorized' }, 401)
        return redirect('/login')
      }
      if (path === '/api/session' && request.method === 'GET') return json({ authenticated: true })
      if (path === '/api/steward/threads' && request.method === 'GET') return json(steward ? await steward.list() : [])
      if (path === '/api/steward/threads' && request.method === 'POST') {
        if (!sameOrigin(request)) return json({ error: 'Forbidden' }, 403)
        if (!steward) return json({ error: '管家存储未配置' }, 503)
        const body = await readLimited(request, 1024)
        if (body === null) return json({ error: '请求内容过大' }, 413)
        try {
          const result = await steward.create(JSON.parse(body))
          return json(result.thread, result.created ? 201 : 200)
        } catch (error) {
          if (error instanceof SyntaxError) return json({ error: 'JSON 格式无效' }, 400)
          if (error instanceof StewardInputError) return json({ error: error.message }, 400)
          if (error instanceof StewardConflictError) return json({ error: error.message }, 409)
          return json({ error: '创建对话失败' }, 500)
        }
      }
      const stewardDetailMatch = /^\/api\/steward\/threads\/([0-9a-f-]{36})$/i.exec(path)
      if (stewardDetailMatch && request.method === 'GET') {
        if (!uuidValue.test(stewardDetailMatch[1])) return json({ error: 'Not found' }, 404)
        const thread = await steward?.detail(stewardDetailMatch[1])
        return thread ? json(thread) : json({ error: 'Not found' }, 404)
      }
      const stewardEventsMatch = /^\/api\/steward\/threads\/([0-9a-f-]{36})\/events$/i.exec(path)
      if (stewardEventsMatch && request.method === 'GET') {
        if (!uuidValue.test(stewardEventsMatch[1])) return json({ error: 'Not found' }, 404)
        const after = Number(url.searchParams.get('after') ?? 0)
        if (!Number.isSafeInteger(after) || after < 0) return json({ error: 'after 无效' }, 400)
        return json(steward ? await steward.events(stewardEventsMatch[1], after) : [])
      }
      const stewardTurnMatch = /^\/api\/steward\/threads\/([0-9a-f-]{36})\/turns$/i.exec(path)
      if (stewardTurnMatch && request.method === 'POST') {
        if (!uuidValue.test(stewardTurnMatch[1])) return json({ error: 'Not found' }, 404)
        if (!sameOrigin(request)) return json({ error: 'Forbidden' }, 403)
        if (!steward) return json({ error: '管家存储未配置' }, 503)
        const body = await readLimited(request, 20 * 1024)
        if (body === null) return json({ error: '请求内容过大' }, 413)
        try {
          const result = await steward.submit(stewardTurnMatch[1], JSON.parse(body), modelConnection.forRun())
          return result ? json(result.turn, result.created ? 202 : 200) : json({ error: 'Not found' }, 404)
        } catch (error) {
          if (error instanceof SyntaxError) return json({ error: 'JSON 格式无效' }, 400)
          if (error instanceof StewardInputError) return json({ error: error.message }, 400)
          if (error instanceof StewardConflictError) return json({ error: error.message }, 409)
          return json({ error: '发送消息失败' }, 500)
        }
      }
      const stewardStopMatch = /^\/api\/steward\/turns\/([0-9a-f-]{36})\/stop$/i.exec(path)
      if (stewardStopMatch && request.method === 'POST') {
        if (!uuidValue.test(stewardStopMatch[1])) return json({ error: 'Not found' }, 404)
        if (!sameOrigin(request)) return json({ error: 'Forbidden' }, 403)
        const result = await steward?.stop(stewardStopMatch[1])
        return result ? json(result, result.accepted ? 202 : 200) : json({ error: 'Not found' }, 404)
      }
      const artifactMatch = /^\/api\/artifacts\/([0-9a-f-]{36})\/(content|download)$/i.exec(path)
      if (artifactMatch && request.method === 'GET') {
        try {
          if (!work) return json({ error: 'Not found' }, 404)
          const { artifact, bytes } = await work.readArtifact(artifactMatch[1], artifactDir, artifactMatch[2] === 'content' ? 'report' : undefined)
          if (artifactMatch[2] === 'content') return json({ markdown: new TextDecoder('utf-8', { fatal: true }).decode(bytes) })
          const name = artifact.kind === 'report' ? 'report.md' : artifact.name
          return new Response(new Uint8Array(bytes), { headers: { ...common, 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'content-security-policy': "default-src 'none'; sandbox" } })
        } catch (error) {
          if (error instanceof WorkArtifactError) return error.kind === 'invalid' ? json({ error: '成果校验失败' }, 409)
            : error.kind === 'unavailable' ? json({ error: '成果文件不可读取' }, 503) : json({ error: 'Not found' }, 404)
          return json({ error: '成果文件不可读取' }, 503)
        }
      }
      if (path === '/api/tasks' && request.method === 'GET') return json(work ? await work.list() : [])
      if (/^\/api\/tasks\/[0-9a-f-]{36}\/cancel$/i.test(path) && request.method === 'POST') {
        if (!sameOrigin(request)) return json({ error: 'Forbidden' }, 403)
        const result = await work?.cancel(path.split('/')[3])
        return result ? json({ accepted: result.accepted }, result.accepted ? 202 : 200) : json({ error: 'Not found' }, 404)
      }
      if (/^\/api\/tasks\/[0-9a-f-]{36}\/cleanup-retry$/i.test(path) && request.method === 'POST') {
        if (!sameOrigin(request)) return json({ error: 'Forbidden' }, 403)
        return await work?.requestCleanupRetry(path.split('/')[3]) ? json({ retrying: true }, 202) : json({ error: 'Not found' }, 404)
      }
      const resolveMatch = /^\/api\/interactions\/([0-9a-f-]{36})\/resolve$/i.exec(path)
      if (resolveMatch && request.method === 'POST') {
        if (!sameOrigin(request)) return json({ error: 'Forbidden' }, 403)
        if (!work) return json({ error: '工作存储未配置' }, 503)
        const body = await readLimited(request, 8 * 1024)
        if (body === null) return json({ error: '请求内容过大' }, 413)
        try {
          const result = await work.resolveInteraction(resolveMatch[1], JSON.parse(body))
          return result ? json({ accepted: true }, result.created ? 202 : 200) : json({ error: 'Not found' }, 404)
        } catch (error) {
          if (error instanceof SyntaxError) return json({ error: 'JSON 格式无效' }, 400)
          if (error instanceof WorkInputError) return json({ error: error.message }, 400)
          if (error instanceof WorkConflictError) return json({ error: error.message }, 409)
          return json({ error: '回答失败' }, 500)
        }
      }
      if (path === '/api/tasks' && request.method === 'POST') {
        if (!sameOrigin(request)) return json({ error: 'Forbidden' }, 403)
        if (!work) return json({ error: '工作存储未配置' }, 503)
        const body = await readLimited(request, 8 * 1024)
        if (body === null) return json({ error: '请求内容过大' }, 413)
        try {
          const result = await work.create(JSON.parse(body), modelConnection.forRun())
          return json(result.task, result.created ? 201 : 200)
        } catch (error) {
          if (error instanceof SyntaxError) return json({ error: 'JSON 格式无效' }, 400)
          if (error instanceof WorkInputError) return json({ error: error.message }, 400)
          if (error instanceof WorkConflictError) return json({ error: error.message }, 409)
          return json({ error: '创建工作失败' }, 500)
        }
      }
      const continueMatch = /^\/api\/tasks\/([0-9a-f-]{36})\/runs$/i.exec(path)
      if (continueMatch && request.method === 'POST') {
        if (!sameOrigin(request)) return json({ error: 'Forbidden' }, 403)
        if (!work) return json({ error: '工作存储未配置' }, 503)
        const body = await readLimited(request, 8 * 1024)
        if (body === null) return json({ error: '请求内容过大' }, 413)
        try {
          const result = await work.continueTask(continueMatch[1], JSON.parse(body), modelConnection.forRun())
          return result ? json(result.task, result.created ? 201 : 200) : json({ error: 'Not found' }, 404)
        } catch (error) {
          if (error instanceof SyntaxError) return json({ error: 'JSON 格式无效' }, 400)
          if (error instanceof WorkInputError) return json({ error: error.message }, 400)
          if (error instanceof WorkConflictError) return json({ error: error.message }, 409)
          return json({ error: '继续工作失败' }, 500)
        }
      }
      const retryMatch = /^\/api\/tasks\/([0-9a-f-]{36})\/retry$/i.exec(path)
      if (retryMatch && request.method === 'POST') {
        if (!sameOrigin(request)) return json({ error: 'Forbidden' }, 403)
        if (!work) return json({ error: '工作存储未配置' }, 503)
        const body = await readLimited(request, 1024)
        if (body === null) return json({ error: '请求内容过大' }, 413)
        try {
          const result = await work.retryTask(retryMatch[1], JSON.parse(body))
          return result ? json(result.task, result.created ? 201 : 200) : json({ error: 'Not found' }, 404)
        } catch (error) {
          if (error instanceof SyntaxError) return json({ error: 'JSON 格式无效' }, 400)
          if (error instanceof WorkInputError) return json({ error: error.message }, 400)
          if (error instanceof WorkConflictError) return json({ error: error.message }, 409)
          return json({ error: '重试失败' }, 500)
        }
      }
      const appendMatch = /^\/api\/runs\/([0-9a-f-]{36})\/messages$/i.exec(path)
      if (appendMatch && request.method === 'POST') {
        if (!sameOrigin(request)) return json({ error: 'Forbidden' }, 403)
        if (!work) return json({ error: '工作存储未配置' }, 503)
        const body = await readLimited(request, 8 * 1024)
        if (body === null) return json({ error: '请求内容过大' }, 413)
        try {
          const result = await work.appendRunMessage(appendMatch[1], JSON.parse(body))
          return result ? json(result.message, result.created ? 201 : 200) : json({ error: 'Not found' }, 404)
        } catch (error) {
          if (error instanceof SyntaxError) return json({ error: 'JSON 格式无效' }, 400)
          if (error instanceof WorkInputError) return json({ error: error.message }, 400)
          if (error instanceof WorkConflictError) return json({ error: error.message }, 409)
          return json({ error: '追加要求失败' }, 500)
        }
      }
      if (/^\/api\/tasks\/[0-9a-f-]{36}\/events$/i.test(path) && request.method === 'GET') {
        const after = Number(url.searchParams.get('after') ?? 0)
        if (!Number.isSafeInteger(after) || after < 0) return json({ error: '事件游标无效' }, 400)
        const events = await work?.events(path.split('/')[3], after)
        return events ? json(events) : json({ error: 'Not found' }, 404)
      }
      if (path.startsWith('/api/tasks/') && request.method === 'GET') {
        const id = path.slice('/api/tasks/'.length)
        if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Not found' }, 404)
        const task = await work?.detail(id)
        return task ? json(task) : json({ error: 'Not found' }, 404)
      }
      if (path === '/api/model-connection' && request.method === 'GET') return json(modelConnection.visible())
      if (path === '/api/model-connection/test' && request.method === 'POST') {
        if (!sameOrigin(request)) return json({ error: 'Forbidden' }, 403)
        const body = await readLimited(request, 4096)
        if (body === null) return json({ error: '请求内容过大' }, 413)
        let input: { modelId?: unknown; protocol?: unknown }
        try { input = JSON.parse(body) } catch { return json({ error: 'JSON 格式无效' }, 400) }
        if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ error: '模型或协议无效' }, 400)
        const connection = modelConnection.forRun()
        const selected = connection.models.find(model => model.id === input.modelId)
        const protocol = selected?.protocol
        if (input.protocol !== undefined && input.protocol !== protocol) return json({ error: '模型或协议无效' }, 400)
        if (!selected || (protocol !== 'chat-completions' && protocol !== 'responses') || !connection.credentialRef) return json({ error: '模型或协议无效' }, 400)
        const credential = modelConnection.resolveCredential(connection.credentialRef)
        const requestBody = protocol === 'chat-completions'
          ? { model: selected.id, messages: [{ role: 'user', content: 'Reply with OK.' }], stream: false }
          : { model: selected.id, input: 'Reply with OK.', stream: false }
        try {
          const upstream = await fetch(`${credential.endpoint}/${modelPath(protocol)}`, {
            method: 'POST', headers: { authorization: `Bearer ${credential.apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify(requestBody), redirect: 'manual', signal: AbortSignal.timeout(30_000),
          })
          if (upstream.ok) return json({ ok: true, modelId: selected.id, protocol })
          let reason = ''
          try {
            const details = JSON.parse(await readLimited(upstream, 16_384) ?? '{}')
            reason = [details?.error?.code, details?.error?.message].filter(value => typeof value === 'string').join(': ')
              .replaceAll(credential.apiKey, '[已隐藏]').slice(0, 500)
          } catch { /* non-JSON errors retain the upstream status */ }
          return json({ error: `连接测试失败（HTTP ${upstream.status}）${reason ? `：${reason}` : ''}`, status: upstream.status }, 502)
        } catch { return json({ error: '模型网关不可用' }, 502) }
      }
      if ((path === '/api/model-connection' || path === '/api/model-connection/models' || path === '/api/model-connection/refresh' || path === '/api/model-connection/directory') && request.method !== 'GET') {
        if (!sameOrigin(request)) return json({ error: 'Forbidden' }, 403)
        try {
          if (path === '/api/model-connection/directory' && request.method === 'POST') {
            const status = await modelConnection.refreshDirectory()
            return json(modelConnection.visible(), status === 'ok' ? 200 : status === 'timeout' ? 504 : 502)
          }
          if (path === '/api/model-connection/refresh' && request.method === 'POST') {
            const status = await modelConnection.refresh()
            return json(modelConnection.visible(), status === 'ok' ? 200 : status === 'unauthorized' ? 502 : status === 'timeout' ? 504 : status === 'empty' ? 422 : 502)
          }
          if (request.method !== 'PUT') return json({ error: 'Not found' }, 404)
          const body = await readLimited(request, 64 * 1024)
          if (body === null) return json({ error: '请求内容过大' }, 413)
          const parsed = JSON.parse(body)
          if (path === '/api/model-connection') await modelConnection.connection(parsed)
          else await modelConnection.selections(parsed)
          return json(modelConnection.visible())
        } catch (error) {
          if (error instanceof SyntaxError) return json({ error: 'JSON 格式无效' }, 400)
          if (error instanceof Error && /^(请|更换|端点|无效|模型|默认|输入|contextWindow|maxTokens|inputPrice|outputPrice|reasoning|tools|人工|目录|管家|调研)/.test(error.message)) return json({ error: error.message }, 400)
          return json({ error: '设置保存失败' }, 500)
        }
      }
      if (path === '/api/logout' && request.method === 'POST') {
        if (!sameOrigin(request)) return json({ error: 'Forbidden' }, 403)
        const token = sessionToken(request)
        if (token) {
          endSession(token)
        }
        return new Response(null, { status: 204, headers: { ...common, 'set-cookie': cookie('', 0) } })
      }
      if (path === '/api/live' && request.method === 'GET') {
        if (!sameOrigin(request)) return json({ error: 'Forbidden' }, 403)
        const token = sessionToken(request)
        if (token && server.upgrade(request, { data: { token } })) return undefined
        return json({ error: 'WebSocket upgrade required' }, 426)
      }
      if ((path === '/' || path === '/tasks' || path === '/settings' || /^\/tasks\/[0-9a-f-]{36}$/i.test(path) || /^\/steward\/[0-9a-f-]{36}$/i.test(path)) && request.method === 'GET') return html()
      return json({ error: 'Not found' }, 404)
    },
    websocket: {
      open(socket) {
        const value = sessions.get(socket.data.token)
        if (!value || value.expires <= Date.now()) return socket.close(1008, 'Unauthorized')
        value.sockets.add(socket)
        socket.send(JSON.stringify({ type: 'ready' }))
      },
      message(socket) { socket.close(1003, 'Unsupported') },
      close(socket) { sessions.get(socket.data.token)?.sockets.delete(socket) },
    },
  })
  const stop = app.stop.bind(app)
  app.stop = async force => { await stop(force); await steward?.close(); await work?.close() }
  steward?.start()
  return app
}

async function html() {
  const file = Bun.file(join(assets, 'index.html'))
  if (!await file.exists()) return new Response('Build the Web app first', { status: 503 })
  return new Response(file, { headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  } })
}

if (import.meta.main) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const server = await startServer({
    password: process.env.AGENTANYWHERE_PASSWORD ?? '',
    host: process.env.AGENTANYWHERE_HOST ?? '127.0.0.1',
    port: Number(process.env.AGENTANYWHERE_PORT ?? 3000),
    secureCookie: process.env.AGENTANYWHERE_SECURE_COOKIE === 'true',
    publicOrigin: process.env.AGENTANYWHERE_PUBLIC_ORIGIN,
    dataDir: process.env.AGENTANYWHERE_DATA_DIR,
    artifactDir: process.env.AGENTANYWHERE_ARTIFACT_DIR,
    databaseUrl: process.env.DATABASE_URL,
  })
  console.log(`AgentAnywhere listening on ${server.url.origin}`)
}
