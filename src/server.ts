import { join } from 'node:path'
import type { ServerWebSocket } from 'bun'
import { createModelConnectionStore } from './model-connection'

type Config = { password: string; host?: string; port?: number; secureCookie?: boolean; publicOrigin?: string; dataDir?: string; modelTimeoutMs?: number; directoryUrl?: string }
type Session = { expires: number; sockets: Set<ServerWebSocket<{ token: string }>> }

const cookieName = 'agentanywhere_session'
const day = 86_400_000
const assets = join(import.meta.dir, '../dist')

async function readLimited(request: Request, limit = 1024): Promise<string | null> {
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

  return Bun.serve<{ token: string }>({
    hostname: config.host ?? '127.0.0.1',
    port: config.port ?? 3000,
    async fetch(request, server) {
      const url = new URL(request.url)
      const path = url.pathname
      const authenticated = session(request)

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
      if (path === '/api/tasks' && request.method === 'GET') return json([])
      if (path === '/api/model-connection' && request.method === 'GET') return json(modelConnection.visible())
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
          if (error instanceof Error && /^(请|更换|端点|无效|模型|默认|输入|contextWindow|maxTokens|inputPrice|outputPrice|reasoning|tools|人工|目录)/.test(error.message)) return json({ error: error.message }, 400)
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
      if ((path === '/' || path === '/settings') && request.method === 'GET') return html()
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
  const server = await startServer({
    password: process.env.AGENTANYWHERE_PASSWORD ?? '',
    host: process.env.AGENTANYWHERE_HOST ?? '127.0.0.1',
    port: Number(process.env.AGENTANYWHERE_PORT ?? 3000),
    secureCookie: process.env.AGENTANYWHERE_SECURE_COOKIE === 'true',
    publicOrigin: process.env.AGENTANYWHERE_PUBLIC_ORIGIN,
    dataDir: process.env.AGENTANYWHERE_DATA_DIR,
  })
  console.log(`AgentAnywhere listening on ${server.url.origin}`)
}
