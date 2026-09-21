import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createAgentSession, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { createCodingTools } from './coding-tools.mjs'

const token = process.env.RUN_TOKEN
if (!token) throw new Error('RUN_TOKEN is required')
const port = Number(process.env.AGENT_PORT || 3001)
const events = []
const listeners = new Set()
let started = false
let finished = false
let session
let artifactSubmitted = false
const submittedFiles = []
let cancelRequested = false
let recoveryRequested = false
let stopPolling = () => {}
let executionDone
const outputDir = '/tmp/agentanywhere-output'
const sessionDir = '/tmp/agentanywhere-session'
const recoveryStopPath = '/tmp/agentanywhere-recovery-stop'
const recoveryIdlePath = '/tmp/agentanywhere-recovery-idle'

async function recoveryStopped() {
  try { await stat(recoveryStopPath); return true }
  catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

function authorized(request) {
  const supplied = request.headers['x-run-token'] || ''
  const left = Buffer.from(supplied)
  const right = Buffer.from(token)
  return left.length === right.length && timingSafeEqual(left, right)
}

function emit(type, payload = {}) {
  if (finished) return
  const event = { producerSeq: events.length + 1, eventId: crypto.randomUUID(), type, payload, occurredAt: new Date().toISOString() }
  events.push(event)
  for (const response of listeners) response.write(`data: ${JSON.stringify(event)}\n\n`)
  if (type === 'run.finished' || type === 'run.failed' || type === 'run.cancelled') {
    finished = true
    for (const response of listeners) response.end()
    listeners.clear()
  }
}

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

async function execute({ goal, model, proxyBase, toolBase, resume = false, answer, agentType }) {
  let messageTimer
  let acceptingMessages = false
  stopPolling = () => { acceptingMessages = false }
  let question = null
  try {
    if (await recoveryStopped()) throw new Error('Run interrupted')
    if (typeof goal !== 'string' || !goal || !model || typeof model.id !== 'string' || !['chat-completions', 'responses'].includes(model.protocol) || !/^http:\/\/[a-z0-9.-]+(?::\d+)?\/internal\/runs\/[0-9a-f-]+\/\d+\/v1$/i.test(proxyBase)
      || !/^http:\/\/[a-z0-9.-]+(?::\d+)?\/internal\/research\/[0-9a-f-]+\/\d+$/i.test(toolBase)
      || (resume && answer !== null && (typeof answer !== 'string' || !answer.trim() || answer.length > 4000))) throw new Error('Run 配置无效')
    const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false })
    runtime.registerProvider('agentanywhere', {
      baseUrl: proxyBase, api: model.protocol === 'responses' ? 'openai-responses' : 'openai-completions', authHeader: true,
      models: [{ id: model.id, name: model.id, reasoning: model.reasoning, input: model.input,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: model.contextWindow, maxTokens: model.maxTokens }],
    })
    await runtime.setRuntimeApiKey('agentanywhere', token)
    const selected = runtime.getModel('agentanywhere', model.id)
    if (!selected) throw new Error('Pi 模型注册失败')
    await mkdir(sessionDir, { recursive: true, mode: 0o700 })
    if (!resume) await writeFile(`${sessionDir}/checkpoint.jsonl`, '', { flag: 'wx', mode: 0o600 })
    const sessionManager = SessionManager.open(`${sessionDir}/checkpoint.jsonl`, sessionDir, '/tmp/agentanywhere-work')
    const baseCustomTools = [{
        name: 'ask_user', label: 'Ask user', description: 'Ask the user one question when their decision is needed. Execution stops until they answer.',
        parameters: Type.Object({ question: Type.String() }),
        execute: async (_id, params, signal) => {
          if (cancelRequested || signal?.aborted) throw new Error('Run cancelled')
          const value = params.question.trim()
          if (!value || value.length > 4000) throw new Error('问题内容无效')
          if (question !== null) throw new Error('已有待回答问题')
          question = value
          acceptingMessages = false
          session.agent.clearAllQueues()
          return { content: [{ type: 'text', text: '问题已交给用户；等待回答。' }], details: {} }
        },
      }, {
        name: 'echo_observation', label: 'Echo observation', description: 'Return a supplied test observation without external access.',
        parameters: Type.Object({ text: Type.String() }),
        execute: async (_id, params, signal) => {
          if (cancelRequested || signal?.aborted) throw new Error('Run cancelled')
          return { content: [{ type: 'text', text: params.text }], details: {} }
        },
      }, ...[['search_web', 'Search web', 'Search public pages through the private SearXNG service. Results are snippets, not verified page bodies.', 'search', Type.Object({ query: Type.String() })],
        ['open_public_page', 'Open public page', 'Read the HTTP text of a public URL. Login-only, non-text and JavaScript-only pages may fail.', 'open', Type.Object({ url: Type.String() })]].map(([name, label, description, path, parameters]) => ({
        name, label, description, parameters,
        execute: async (_id, params, signal) => {
          if (cancelRequested || signal?.aborted) throw new Error('Run cancelled')
          const response = await fetch(`${toolBase}/${path}`, { method: 'POST', headers: { 'x-run-token': token, 'content-type': 'application/json' }, body: JSON.stringify(params), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35_000)]) : AbortSignal.timeout(35_000) })
          const data = await response.json()
          if (!response.ok) throw new Error(data.error || '资料读取失败')
          return { content: [{ type: 'text', text: JSON.stringify(data) }], details: {} }
        },
      })), {
        name: 'submit_artifact', label: 'Submit artifact', description: 'Save a work artifact. kind=report: Markdown report with optional attachments; kind=patch: unified diff; kind=test_log: test result JSON. Can be called multiple times with different kinds.',
        parameters: Type.Object({
          kind: Type.Optional(Type.Union([Type.Literal('report'), Type.Literal('patch'), Type.Literal('test_log')])),
          content: Type.String(),
          attachments: Type.Optional(Type.Array(Type.Object({ name: Type.String(), content: Type.String() }), { maxItems: 5 })),
        }),
        execute: async (_id, params, signal) => {
          if (cancelRequested || signal?.aborted) throw new Error('Run cancelled')
          const kind = params.kind || 'report'
          const data = Buffer.from(params.content, 'utf8')
          if (!data.length || data.length > 10_000_000) throw new Error('成果内容大小无效')
          await mkdir(outputDir, { recursive: true, mode: 0o700 })
          const generation = submittedFiles.length ? submittedFiles[0]._generation : `generation-${crypto.randomUUID()}`
          const temporary = `${outputDir}/${generation}`
          await mkdir(temporary, { recursive: true, mode: 0o700 })
          if (kind === 'report') {
            if (data.length > 2_000_000) throw new Error('报告大小无效')
            const attachments = params.attachments ?? []
            const files = [{ path: 'report.md', name: 'report.md', type: 'text/markdown', kind: 'report' }]
            for (const [index, item] of attachments.entries()) {
              if (!/^[^/\\\x00-\x1f]{1,100}\.(txt|csv|json|md)$/i.test(item.name) || Buffer.byteLength(item.content, 'utf8') > 10_000_000) throw new Error('附件类型、名称或大小无效')
              files.push({ path: `attachment-${index}.${item.name.split('.').at(-1).toLowerCase()}`, name: item.name, type: 'text/plain', kind: 'attachment' })
            }
            if (new Set(files.map(item => item.name)).size !== files.length) throw new Error('附件名称重复')
            await writeFile(`${temporary}/report.md`, data, { mode: 0o600 })
            for (const [index, item] of attachments.entries()) await writeFile(`${temporary}/${files[index + 1].path}`, item.content, { mode: 0o600 })
            submittedFiles.push(...files.filter(f => !submittedFiles.some(s => s.path === f.path)).map(f => ({ ...f, _generation: generation })))
          } else if (kind === 'patch') {
            const entry = { path: 'patch.diff', name: 'patch.diff', type: 'text/plain', kind: 'patch' }
            await writeFile(`${temporary}/patch.diff`, data, { mode: 0o600 })
            const existing = submittedFiles.findIndex(f => f.path === 'patch.diff')
            if (existing >= 0) submittedFiles[existing] = { ...entry, _generation: generation }
            else submittedFiles.push({ ...entry, _generation: generation })
          } else if (kind === 'test_log') {
            const entry = { path: 'test-log.json', name: 'test-log.json', type: 'application/json', kind: 'test_log' }
            await writeFile(`${temporary}/test-log.json`, data, { mode: 0o600 })
            const existing = submittedFiles.findIndex(f => f.path === 'test-log.json')
            if (existing >= 0) submittedFiles[existing] = { ...entry, _generation: generation }
            else submittedFiles.push({ ...entry, _generation: generation })
          }
          if (cancelRequested || signal?.aborted) throw new Error('Run cancelled')
          const manifestFiles = submittedFiles.map(({ _generation, ...rest }) => rest)
          const pointer = `${outputDir}/manifest-${generation}.tmp`
          try {
            await writeFile(pointer, JSON.stringify({ generation, files: manifestFiles }), { mode: 0o600, flush: true })
            await rename(pointer, `${outputDir}/manifest.json`)
          } catch (error) { await rm(pointer, { force: true }); throw error }
          artifactSubmitted = true
          const label = kind === 'report' ? '报告' : kind === 'patch' ? '补丁' : '测试日志'
          return { content: [{ type: 'text', text: `${label}已保存，等待持久化校验` }], details: {} }
        },
      }]
    const baseToolNames = ['echo_observation', 'search_web', 'open_public_page', 'submit_artifact', 'ask_user']
    if (agentType === 'coding') {
      const codingTools = createCodingTools('/home/node/workspace')
      baseCustomTools.push(...codingTools)
      baseToolNames.push(...codingTools.map(t => t.name))
    }
    const created = await createAgentSession({
      model: selected, modelRuntime: runtime, sessionManager, tools: baseToolNames,
      customTools: baseCustomTools,
    })
    session = created.session
    if (resume) artifactSubmitted = await stat(`${outputDir}/manifest.json`).then(info => info.isFile(), () => false)
    session.agent.shouldStopAfterTurn = () => question !== null
    if (cancelRequested || recoveryRequested || await recoveryStopped()) throw new Error('Run interrupted')
    const messageUrl = `${proxyBase.slice(0, -3)}/messages`
    const queued = new Map()
    const seen = new Set()
    const acknowledgements = []
    let polling = false
    acceptingMessages = true
    let initialPromptSeen = false
    async function pollMessages() {
      if (polling || !acceptingMessages || finished) return
      polling = true
      try {
        const response = await fetch(messageUrl, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) })
        if (!response.ok) return
        for (const message of await response.json()) {
          if (!acceptingMessages) break
          if (seen.has(message.id)) continue
          seen.add(message.id)
          queued.set(message.id, message)
          session.agent.steer({ role: 'user', content: [{ type: 'text', text: message.content }], timestamp: Date.now() })
        }
      } finally { polling = false }
    }
    session.subscribe(event => {
      if (event.type === 'message_end' && event.message.role === 'user') {
        if (!initialPromptSeen) initialPromptSeen = true
        else {
          const content = event.message.content.filter(part => part.type === 'text').map(part => part.text).join('')
          const entry = [...queued].find(([, item]) => item.content === content)
          if (entry) {
            queued.delete(entry[0])
            const acknowledgement = fetch(messageUrl, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
              body: JSON.stringify({ id: entry[0] }), signal: AbortSignal.timeout(5000) }).then(response => {
              if (!response.ok) throw new Error('追加要求确认失败')
            })
            acknowledgements.push(acknowledgement)
            acknowledgement.catch(() => {})
          }
        }
      }
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') emit('message.delta', { delta: event.assistantMessageEvent.delta })
      if (event.type === 'message_end' && event.message.role === 'assistant') emit('message.completed', {
        content: event.message.content.filter(part => part.type === 'text').map(part => part.text).join(''),
        stopReason: event.message.stopReason, errorMessage: event.message.errorMessage || null,
      })
      if (event.type === 'tool_execution_start') emit('tool.started', { toolCallId: event.toolCallId, name: event.toolName, args: event.args })
      if (event.type === 'tool_execution_end') emit('tool.completed', { toolCallId: event.toolCallId, name: event.toolName,
        result: event.result?.content?.filter(part => part.type === 'text').map(part => part.text).join('') ?? '', isError: event.isError })
    })
    emit('worker.ready')
    const execution = session.prompt(resume ? answer || '请根据已保存的对话与工具结果继续完成任务；不要重复已经完成的工具调用。' : `${goal}\n\n可以用 search_web 查询主题；目标含指定来源时，先用 open_public_page 读取该 URL。需要核对搜索结果正文时，也用 open_public_page。搜索摘要与网页正文是不同来源；报告引用实际 URL，注明搜索引擎部分失败、不可读页面和未核查推断。需要用户决定时调用 ask_user 提问，等待回答。完成后调用 submit_artifact 保存成果（kind=report 为 Markdown 报告，kind=patch 为补丁，kind=test_log 为测试日志），最后简短回复已提交。测试要求使用 echo_observation 时可以调用。`)
    messageTimer = setInterval(() => void pollMessages().catch(() => {}), 200)
    await pollMessages()
    await execution
    acceptingMessages = false
    await session.waitForIdle()
    clearInterval(messageTimer)
    await Promise.all(acknowledgements)
    if (cancelRequested) throw new Error('Run cancelled')
    if (question !== null) {
      emit('interaction.requested', { question })
      return
    }
    const last = [...session.messages].reverse().find(message => message.role === 'assistant')
    if (!last || last.stopReason === 'error' || last.stopReason === 'aborted') throw new Error(last?.errorMessage || '模型执行未完成')
    if (!artifactSubmitted) throw new Error('未提交报告')
    emit('run.finished')
  } catch (error) {
    acceptingMessages = false
    await session?.waitForIdle().catch(() => {})
    if (cancelRequested) emit('run.cancelled')
    else emit('run.failed', { error: error instanceof Error ? error.message : '执行失败' })
  } finally {
    clearInterval(messageTimer)
    session?.dispose()
    stopPolling = () => {}
  }
}

process.on('SIGTERM', () => {
  if (recoveryRequested) return
  recoveryRequested = true
  stopPolling()
  void (async () => {
    await session?.abort().catch(() => {})
    await executionDone?.catch(() => {})
    await writeFile(`${recoveryIdlePath}.tmp`, 'idle', { mode: 0o600, flush: true })
    await rename(`${recoveryIdlePath}.tmp`, recoveryIdlePath)
  })().catch(error => console.error('Recovery stop failed', error?.message))
})

http.createServer(async (request, response) => {
  if (request.url === '/health') return send(response, 200, { ready: true })
  if (!authorized(request)) return send(response, 401, { error: 'Unauthorized' })
  if (request.url?.startsWith('/events?') && request.method === 'GET') {
    const after = Number(new URL(request.url, 'http://localhost').searchParams.get('after') || 0)
    if (!Number.isSafeInteger(after) || after < 0) return send(response, 400, { error: 'Invalid cursor' })
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    for (const event of events) if (event.producerSeq > after) response.write(`data: ${JSON.stringify(event)}\n\n`)
    if (finished) response.end()
    else { listeners.add(response); request.on('close', () => listeners.delete(response)) }
    return
  }
  if (request.url === '/run' && request.method === 'POST') {
    if (cancelRequested || recoveryRequested) return send(response, 409, { error: 'Run interrupted' })
    if (started) return send(response, 200, { started: true })
    let body = ''
    request.setEncoding('utf8')
    for await (const chunk of request) {
      body += chunk
      if (body.length > 4_500_000) return send(response, 413, { error: 'Run configuration too large' })
    }
    let parsed
    try { parsed = JSON.parse(body) } catch { return send(response, 400, { error: 'Invalid JSON' }) }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return send(response, 400, { error: 'Invalid run configuration' })
    started = true
    executionDone = execute(parsed)
    return send(response, 202, { started: true })
  }
  if (request.url === '/cancel' && request.method === 'POST') {
    if (finished) return send(response, 200, { cancelled: false })
    cancelRequested = true
    void session?.abort().catch(() => {})
    if (!started) emit('run.cancelled')
    return send(response, 202, { cancelled: true })
  }
  send(response, 404, { error: 'Not found' })
}).listen(port, '0.0.0.0')
