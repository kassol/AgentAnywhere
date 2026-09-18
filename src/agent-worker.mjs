import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { createAgentSession, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

const token = process.env.RUN_TOKEN
if (!token) throw new Error('RUN_TOKEN is required')
const port = Number(process.env.AGENT_PORT || 3001)
const events = []
const listeners = new Set()
let started = false
let finished = false
let session

function authorized(request) {
  const supplied = request.headers['x-run-token'] || ''
  const left = Buffer.from(supplied)
  const right = Buffer.from(token)
  return left.length === right.length && timingSafeEqual(left, right)
}

function emit(type, payload = {}) {
  const event = { producerSeq: events.length + 1, eventId: crypto.randomUUID(), type, payload, occurredAt: new Date().toISOString() }
  events.push(event)
  for (const response of listeners) response.write(`data: ${JSON.stringify(event)}\n\n`)
  if (type === 'run.finished' || type === 'run.failed') {
    finished = true
    for (const response of listeners) response.end()
    listeners.clear()
  }
}

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

async function execute({ goal, model, proxyBase }) {
  let messageTimer
  try {
    if (typeof goal !== 'string' || !goal || !model || typeof model.id !== 'string' || !['chat-completions', 'responses'].includes(model.protocol) || !/^http:\/\/[a-z0-9.-]+(?::\d+)?\/internal\/runs\/[0-9a-f-]+\/\d+\/v1$/i.test(proxyBase)) throw new Error('Run 配置无效')
    const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false })
    runtime.registerProvider('agentanywhere', {
      baseUrl: proxyBase, api: model.protocol === 'responses' ? 'openai-responses' : 'openai-completions', authHeader: true,
      models: [{ id: model.id, name: model.id, reasoning: model.reasoning, input: model.input,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: model.contextWindow, maxTokens: model.maxTokens }],
    })
    await runtime.setRuntimeApiKey('agentanywhere', token)
    const selected = runtime.getModel('agentanywhere', model.id)
    if (!selected) throw new Error('Pi 模型注册失败')
    const created = await createAgentSession({
      model: selected, modelRuntime: runtime, sessionManager: SessionManager.inMemory(), tools: ['echo_observation'],
      customTools: [{
        name: 'echo_observation', label: 'Echo observation', description: 'Return a supplied test observation without external access.',
        parameters: Type.Object({ text: Type.String() }),
        execute: async (_id, params) => ({ content: [{ type: 'text', text: params.text }], details: {} }),
      }],
    })
    session = created.session
    const messageUrl = `${proxyBase.slice(0, -3)}/messages`
    const queued = new Map()
    const seen = new Set()
    const acknowledgements = []
    let polling = false
    let initialPromptSeen = false
    async function pollMessages() {
      if (polling || finished) return
      polling = true
      try {
        const response = await fetch(messageUrl, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) })
        if (!response.ok) return
        for (const message of await response.json()) {
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
    const execution = session.prompt(`${goal}\n\nFor this initial execution, use echo_observation once with a short observation before the final reply. Do not claim external sources or create files.`)
    messageTimer = setInterval(() => void pollMessages().catch(() => {}), 200)
    await pollMessages()
    await execution
    await session.waitForIdle()
    clearInterval(messageTimer)
    await Promise.all(acknowledgements)
    const last = [...session.messages].reverse().find(message => message.role === 'assistant')
    if (!last || last.stopReason === 'error' || last.stopReason === 'aborted') throw new Error(last?.errorMessage || '模型执行未完成')
    emit('run.finished')
  } catch (error) {
    emit('run.failed', { error: error instanceof Error ? error.message : '执行失败' })
  } finally {
    clearInterval(messageTimer)
    session?.dispose()
  }
}

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
    if (started) return send(response, 200, { started: true })
    let body = ''
    request.setEncoding('utf8')
    for await (const chunk of request) {
      body += chunk
      if (body.length > 16_384) return send(response, 413, { error: 'Run configuration too large' })
    }
    let parsed
    try { parsed = JSON.parse(body) } catch { return send(response, 400, { error: 'Invalid JSON' }) }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return send(response, 400, { error: 'Invalid run configuration' })
    started = true
    void execute(parsed)
    return send(response, 202, { started: true })
  }
  if (request.url === '/cancel' && request.method === 'POST') {
    await session?.abort()
    return send(response, 202, { cancelled: true })
  }
  send(response, 404, { error: 'Not found' })
}).listen(port, '0.0.0.0')
