import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
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
let reportSubmitted = false
const outputDir = '/tmp/agentanywhere-output'

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

async function execute({ goal, model, proxyBase, toolBase }) {
  try {
    if (typeof goal !== 'string' || !goal || !model || typeof model.id !== 'string' || !['chat-completions', 'responses'].includes(model.protocol) || !/^http:\/\/[a-z0-9.-]+(?::\d+)?\/internal\/runs\/[0-9a-f-]+\/\d+\/v1$/i.test(proxyBase) || !/^http:\/\/[a-z0-9.-]+(?::\d+)?\/internal\/research\/[0-9a-f-]+\/\d+$/i.test(toolBase)) throw new Error('Run 配置无效')
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
      model: selected, modelRuntime: runtime, sessionManager: SessionManager.inMemory(), tools: ['echo_observation', 'search_web', 'open_public_page', 'submit_report'],
      customTools: [{
        name: 'echo_observation', label: 'Echo observation', description: 'Return a supplied test observation without external access.',
        parameters: Type.Object({ text: Type.String() }),
        execute: async (_id, params) => ({ content: [{ type: 'text', text: params.text }], details: {} }),
      }, ...[['search_web', 'Search web', 'Search public pages through the private SearXNG service. Results are snippets, not verified page bodies.', 'search', Type.Object({ query: Type.String() })],
        ['open_public_page', 'Open public page', 'Read the HTTP text of a public URL. Login-only, non-text and JavaScript-only pages may fail.', 'open', Type.Object({ url: Type.String() })]].map(([name, label, description, path, parameters]) => ({
        name, label, description, parameters,
        execute: async (_id, params, signal) => {
          const response = await fetch(`${toolBase}/${path}`, { method: 'POST', headers: { 'x-run-token': token, 'content-type': 'application/json' }, body: JSON.stringify(params), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35_000)]) : AbortSignal.timeout(35_000) })
          const data = await response.json()
          if (!response.ok) throw new Error(data.error || '资料读取失败')
          return { content: [{ type: 'text', text: JSON.stringify(data) }], details: {} }
        },
      })), {
        name: 'submit_report', label: 'Submit report', description: 'Save the final Markdown report and optional plain text attachments.',
        parameters: Type.Object({ markdown: Type.String(), attachments: Type.Optional(Type.Array(Type.Object({ name: Type.String(), content: Type.String() }), { maxItems: 5 })) }),
        execute: async (_id, params) => {
          if (reportSubmitted) throw new Error('报告已提交')
          const report = Buffer.from(params.markdown, 'utf8')
          if (!report.length || report.length > 2_000_000) throw new Error('报告大小无效')
          const attachments = params.attachments ?? []
          const files = [{ path: 'report.md', name: 'report.md', type: 'text/markdown' }]
          for (const [index, item] of attachments.entries()) {
            if (!/^[^/\\\x00-\x1f]{1,100}\.(txt|csv|json|md)$/i.test(item.name) || Buffer.byteLength(item.content, 'utf8') > 10_000_000) throw new Error('附件类型、名称或大小无效')
            files.push({ path: `attachment-${index}.${item.name.split('.').at(-1).toLowerCase()}`, name: item.name, type: 'text/plain' })
          }
          const temporary = await mkdtemp(`${outputDir}-`)
          try {
            await writeFile(`${temporary}/report.md`, report, { mode: 0o600 })
            for (const [index, item] of attachments.entries()) await writeFile(`${temporary}/${files[index + 1].path}`, item.content, { mode: 0o600 })
            await writeFile(`${temporary}/manifest.json`, JSON.stringify(files), { mode: 0o600 })
            await rename(temporary, outputDir)
          } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error }
          reportSubmitted = true
          return { content: [{ type: 'text', text: '报告已保存，等待持久化校验' }], details: {} }
        },
      }],
    })
    session = created.session
    session.subscribe(event => {
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
    await session.prompt(`${goal}\n\n可以用 search_web 查询主题，用 open_public_page 读取指定公开链接或搜索结果。搜索摘要与网页正文是不同来源；报告引用实际 URL，注明搜索引擎部分失败、不可读页面和未核查推断。完成后调用 submit_report 保存 Markdown 报告，最后简短回复已提交。测试要求使用 echo_observation 时可以调用。`)
    await session.waitForIdle()
    const last = [...session.messages].reverse().find(message => message.role === 'assistant')
    if (!last || last.stopReason === 'error' || last.stopReason === 'aborted') throw new Error(last?.errorMessage || '模型执行未完成')
    if (!reportSubmitted) throw new Error('未提交报告')
    emit('run.finished')
  } catch (error) {
    emit('run.failed', { error: error instanceof Error ? error.message : '执行失败' })
  } finally {
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
