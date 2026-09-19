import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SQL } from 'bun'
import { startServer } from './server'

const databaseUrl = process.env.AGENTANYWHERE_TEST_DATABASE_URL
if (!databaseUrl) throw new Error('AGENTANYWHERE_TEST_DATABASE_URL is required for the steward API regression')

test('owner creates and reopens an independent steward conversation', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agentanywhere-steward-'))
  const schema = `steward_test_${crypto.randomUUID().replaceAll('-', '')}`
  const admin = new SQL(databaseUrl)
  await admin.unsafe(`CREATE SCHEMA ${schema}`)
  const isolatedUrl = new URL(databaseUrl)
  isolatedUrl.searchParams.set('options', `-csearch_path=${schema}`)
  const password = 'test-password-12345'
  const app = await startServer({ password, port: 0, dataDir, databaseUrl: isolatedUrl.toString() })
  try {
    const login = await fetch(`${app.url.origin}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
    const cookie = login.headers.get('set-cookie')!
    const send = (path: string, method = 'GET', body?: unknown) => fetch(`${app.url.origin}${path}`, {
      method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    })
    expect((await fetch(`${app.url.origin}/api/steward/threads`)).status).toBe(401)
    expect((await send('/api/steward/threads', 'POST', { requestId: '-'.repeat(36) })).status).toBe(400)
    const requestId = crypto.randomUUID()
    const attempts = await Promise.all([send('/api/steward/threads', 'POST', { requestId }), send('/api/steward/threads', 'POST', { requestId })])
    expect(attempts.map(item => item.status).sort()).toEqual([200, 201])
    const thread = await attempts[0].json()
    expect(thread).toMatchObject({ title: '新对话', messages: [], turns: [], relatedTasks: [] })
    expect((await send(`/api/steward/threads/${thread.id}`)).json()).resolves.toMatchObject({ id: thread.id, messages: [], turns: [] })
    expect((await send('/api/steward/threads')).json()).resolves.toMatchObject([{ id: thread.id, title: '新对话' }])
  } finally {
    await app.stop(true)
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`)
    await admin.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('steward streams both protocols through one global turn slot', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agentanywhere-steward-run-'))
  const schema = `steward_run_${crypto.randomUUID().replaceAll('-', '')}`
  const admin = new SQL(databaseUrl)
  await admin.unsafe(`CREATE SCHEMA ${schema}`)
  const isolatedUrl = new URL(databaseUrl)
  isolatedUrl.searchParams.set('options', `-csearch_path=${schema}`)
  let releaseChat!: () => void
  const chatReleased = new Promise<void>(resolve => { releaseChat = resolve })
  let releaseHold!: () => void
  const holdReleased = new Promise<void>(resolve => { releaseHold = resolve })
  let releaseQueue!: () => void
  const queueReleased = new Promise<void>(resolve => { releaseQueue = resolve })
  let activeRequests = 0
  let maxActiveRequests = 0
  const calls: string[] = []
  const chatContexts: string[][] = []
  const responseRequests: any[] = []
  const upstream = Bun.serve({ port: 0, async fetch(request) {
    activeRequests++
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
    try {
      const body = await request.json() as any
      calls.push(`${new URL(request.url).pathname}:${body.model}`)
      if (request.url.endsWith('/chat/completions')) {
        await chatReleased
        const rawUser = body.messages.filter((message: any) => message.role === 'user').at(-1)?.content
        const userText = typeof rawUser === 'string' ? rawUser : rawUser?.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('')
        chatContexts.push(body.messages.filter((message: any) => message.role === 'user' || message.role === 'assistant').map((message: any) => {
          const text = typeof message.content === 'string' ? message.content : message.content?.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('')
          return `${message.role}:${text}`
        }))
        if (userText === '等待停止') await holdReleased
        if (userText === '队列一') await queueReleased
        const common = { id: 'chat_1', object: 'chat.completion.chunk', created: 1, model: body.model }
        return new Response([
          `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: 'assistant', content: '聊天协议完成。' }, finish_reason: null }] })}`,
          `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}`,
          'data: [DONE]', '',
        ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } })
      }
      responseRequests.push(body)
      const responseId = 'resp_1'
      const item = { id: 'msg_1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '响应协议完成。', annotations: [] }] }
      return new Response([
        `data: ${JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } })}`,
        `data: ${JSON.stringify({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: '响应协议完成。' })}`,
        `data: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item })}`,
        `data: ${JSON.stringify({ type: 'response.completed', response: { id: responseId, status: 'completed', output: [item], usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } } })}`, '',
      ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } })
    } finally { activeRequests-- }
  } })
  const password = 'test-password-12345'
  const app = await startServer({ password, port: 0, dataDir, databaseUrl: isolatedUrl.toString() })
  try {
    const login = await fetch(`${app.url.origin}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
    const cookie = login.headers.get('set-cookie')!
    const send = (path: string, method = 'GET', body?: unknown) => fetch(`${app.url.origin}${path}`, {
      method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    })
    expect((await send('/api/model-connection', 'PUT', { endpoint: `${upstream.url.origin}/v1`, apiKey: 'fixture-key' })).status).toBe(200)
    const configure = (modelId: string, protocol: 'chat-completions' | 'responses', reasoning = false) => send('/api/model-connection/models', 'PUT', {
      defaultModel: modelId, stewardModel: { modelId, protocol }, researchModelPool: [],
      models: [{ id: modelId, protocol, contextWindow: 128000, maxTokens: 4096, input: ['text'], reasoning, tools: true }],
    })
    expect((await configure('steward-chat', 'chat-completions')).status).toBe(200)
    const first = await (await send('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })).json()
    const firstTurnBody = { requestId: crypto.randomUUID(), content: '第一轮' }
    const firstTurnResponse = await send(`/api/steward/threads/${first.id}/turns`, 'POST', firstTurnBody)
    expect(firstTurnResponse.status).toBe(202)
    const firstTurn = await firstTurnResponse.json()
    expect((await send('/api/model-connection/models', 'PUT', {
      defaultModel: 'steward-chat', stewardModel: null, researchModelPool: [],
      models: [{ id: 'steward-chat', protocol: 'chat-completions', contextWindow: 128000, maxTokens: 4096, input: ['text'], reasoning: false, tools: true }],
    })).status).toBe(200)
    const repeated = await send(`/api/steward/threads/${first.id}/turns`, 'POST', firstTurnBody)
    expect(repeated.status).toBe(200)
    expect(await repeated.json()).toMatchObject({ id: firstTurn.id })
    expect((await send(`/api/steward/threads/${first.id}/turns`, 'POST', { ...firstTurnBody, content: '不同内容' })).status).toBe(409)
    expect((await configure('steward-chat', 'chat-completions')).status).toBe(200)
    for (let i = 0; i < 50 && calls.length === 0; i++) await Bun.sleep(20)
    expect(calls).toEqual(['/v1/chat/completions:steward-chat'])
    const withdrawnThread = await (await send('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })).json()
    const withdrawnTurn = await (await send(`/api/steward/threads/${withdrawnThread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content: '撤回排队轮次' })).json()
    expect((await send(`/api/steward/turns/${withdrawnTurn.id}/stop`, 'POST')).status).toBe(202)
    expect((await send(`/api/steward/threads/${withdrawnThread.id}`)).json()).resolves.toMatchObject({ turns: [{ status: 'stopped' }] })

    expect((await configure('steward-responses', 'responses', true)).status).toBe(200)
    const second = await (await send('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })).json()
    await send(`/api/steward/threads/${second.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content: '第二轮' })
    expect((await send(`/api/steward/threads/${second.id}`)).json()).resolves.toMatchObject({ turns: [{ status: 'queued' }] })
    releaseChat()
    let firstDetail: any
    let secondDetail: any
    for (let i = 0; i < 100; i++) {
      firstDetail = await (await send(`/api/steward/threads/${first.id}`)).json()
      secondDetail = await (await send(`/api/steward/threads/${second.id}`)).json()
      if (firstDetail.turns[0]?.status === 'completed' && secondDetail.turns[0]?.status === 'completed') break
      await Bun.sleep(20)
    }
    expect(firstDetail).toMatchObject({ messages: [{ role: 'user', content: '第一轮' }, { role: 'assistant', content: '聊天协议完成。', status: 'completed' }], turns: [{ status: 'completed', modelCalls: 2 }] })
    expect(secondDetail).toMatchObject({ messages: [{ role: 'user', content: '第二轮' }, { role: 'assistant', content: '响应协议完成。', status: 'completed' }], turns: [{ status: 'completed', modelCalls: 2 }] })
    expect(calls).toEqual(['/v1/chat/completions:steward-chat', '/v1/chat/completions:steward-chat', '/v1/responses:steward-responses', '/v1/responses:steward-responses'])
    expect(responseRequests[0].reasoning).toMatchObject({ effort: 'medium' })
    expect(maxActiveRequests).toBe(1)
    const streamed = await (await send(`/api/steward/threads/${second.id}/events`)).json()
    expect(streamed.some((event: any) => event.type === 'assistant.delta')).toBe(true)

    expect((await configure('steward-chat', 'chat-completions')).status).toBe(200)
    const stoppedThread = await (await send('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })).json()
    const stopping = await (await send(`/api/steward/threads/${stoppedThread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content: '等待停止' })).json()
    for (let i = 0; i < 50 && !chatContexts.some(context => context.at(-1) === 'user:等待停止'); i++) await Bun.sleep(20)
    expect((await send(`/api/steward/turns/${stopping.id}/stop`, 'POST')).status).toBe(202)
    releaseHold()
    let stopped: any
    for (let i = 0; i < 100; i++) {
      stopped = await (await send(`/api/steward/threads/${stoppedThread.id}`)).json()
      if (stopped.turns[0]?.status === 'stopped') break
      await Bun.sleep(20)
    }
    expect(stopped).toMatchObject({ messages: [{ role: 'user', content: '等待停止' }, { role: 'assistant', status: 'stopped' }], turns: [{ status: 'stopped' }] })
    await send(`/api/steward/threads/${stoppedThread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content: '显式继续' })
    for (let i = 0; i < 100; i++) {
      stopped = await (await send(`/api/steward/threads/${stoppedThread.id}`)).json()
      if (stopped.turns[1]?.status === 'completed') break
      await Bun.sleep(20)
    }
    expect(stopped.turns.map((turn: any) => turn.status)).toEqual(['stopped', 'completed'])

    const queuedThread = await (await send('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })).json()
    for (const content of ['队列一', '队列二', '队列三']) {
      expect((await send(`/api/steward/threads/${queuedThread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content })).status).toBe(202)
    }
    for (let i = 0; i < 50 && !chatContexts.some(context => context.at(-1) === 'user:队列一'); i++) await Bun.sleep(20)
    releaseQueue()
    let queued: any
    for (let i = 0; i < 150; i++) {
      queued = await (await send(`/api/steward/threads/${queuedThread.id}`)).json()
      if (queued.turns[2]?.status === 'completed') break
      await Bun.sleep(20)
    }
    expect(queued.messages.map((message: any) => `${message.role}:${message.content}`)).toEqual([
      'user:队列一', 'assistant:聊天协议完成。', 'user:队列二', 'assistant:聊天协议完成。', 'user:队列三', 'assistant:聊天协议完成。',
    ])
    expect(chatContexts.slice(-6)).toEqual([
      ['user:队列一'], ['user:队列一'],
      ['user:队列二'], ['user:队列一', 'assistant:聊天协议完成。', 'user:队列二'],
      ['user:队列三'], ['user:队列一', 'assistant:聊天协议完成。', 'user:队列二', 'assistant:聊天协议完成。', 'user:队列三'],
    ])
  } finally {
    await app.stop(true)
    upstream.stop(true)
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`)
    await admin.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('startup interrupts the active turn and a new explicit turn continues', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agentanywhere-steward-restart-'))
  const schema = `steward_restart_${crypto.randomUUID().replaceAll('-', '')}`
  const admin = new SQL(databaseUrl)
  await admin.unsafe(`CREATE SCHEMA ${schema}`)
  const isolatedUrl = new URL(databaseUrl)
  isolatedUrl.searchParams.set('options', `-csearch_path=${schema}`)
  let calls = 0
  const upstream = Bun.serve({ port: 0, async fetch(request) {
    const body = await request.json() as any
    calls++
    const common = { id: `restart_${calls}`, object: 'chat.completion.chunk', created: 1, model: body.model }
    if (calls === 1) return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: 'assistant', content: '部分回复' }, finish_reason: null }] })}\n\n`)) },
    }), { headers: { 'content-type': 'text/event-stream' } })
    return new Response([
      `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: 'assistant', content: '恢复后的新轮次。' }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}`,
      'data: [DONE]', '',
    ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } })
  } })
  const password = 'test-password-12345'
  let app = await startServer({ password, port: 0, dataDir, databaseUrl: isolatedUrl.toString() })
  let base = app.url.origin
  async function login() {
    const response = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
    return response.headers.get('set-cookie')!
  }
  let cookie = await login()
  const send = (path: string, method = 'GET', body?: unknown) => fetch(`${base}${path}`, {
    method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  })
  try {
    await send('/api/model-connection', 'PUT', { endpoint: `${upstream.url.origin}/v1`, apiKey: 'restart-key' })
    await send('/api/model-connection/models', 'PUT', {
      defaultModel: 'restart-model', stewardModel: { modelId: 'restart-model', protocol: 'chat-completions' }, researchModelPool: [],
      models: [{ id: 'restart-model', protocol: 'chat-completions', contextWindow: 128000, maxTokens: 4096, input: ['text'], reasoning: false, tools: true }],
    })
    const thread = await (await send('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })).json()
    await send(`/api/steward/threads/${thread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content: '中断这一轮' })
    for (let i = 0; i < 50 && calls === 0; i++) await Bun.sleep(20)
    expect(calls).toBe(1)
    for (let i = 0; i < 50; i++) {
      const running = await (await send(`/api/steward/threads/${thread.id}`)).json()
      if (running.messages[1]?.content === '部分回复') break
      await Bun.sleep(20)
    }
    await app.stop(true)
    app = await startServer({ password, port: 0, dataDir, databaseUrl: isolatedUrl.toString() })
    base = app.url.origin
    cookie = await login()
    expect((await send(`/api/steward/threads/${thread.id}`)).json()).resolves.toMatchObject({
      messages: [{ role: 'user' }, { role: 'assistant', content: '', status: 'interrupted' }], turns: [{ status: 'interrupted' }],
    })
    await send(`/api/steward/threads/${thread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content: '重新开始普通轮次' })
    let detail: any
    for (let i = 0; i < 100; i++) {
      detail = await (await send(`/api/steward/threads/${thread.id}`)).json()
      if (detail.turns[1]?.status === 'completed') break
      await Bun.sleep(20)
    }
    expect(detail.turns.map((turn: any) => turn.status)).toEqual(['interrupted', 'completed'])
    expect(detail.messages.at(-1)).toMatchObject({ role: 'assistant', content: '恢复后的新轮次。', status: 'completed' })
  } finally {
    await app.stop(true)
    upstream.stop(true)
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`)
    await admin.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('five active minutes limits a turn before another model request', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agentanywhere-steward-time-'))
  const schema = `steward_time_${crypto.randomUUID().replaceAll('-', '')}`
  const admin = new SQL(databaseUrl)
  await admin.unsafe(`CREATE SCHEMA ${schema}`)
  const isolatedUrl = new URL(databaseUrl)
  isolatedUrl.searchParams.set('options', `-csearch_path=${schema}`)
  const baseTime = Date.now()
  let clockReads = 0
  let upstreamCalls = 0
  const upstream = Bun.serve({ port: 0, fetch() { upstreamCalls++; return new Response('unexpected', { status: 500 }) } })
  const password = 'test-password-12345'
  const app = await startServer({
    password, port: 0, dataDir, databaseUrl: isolatedUrl.toString(),
    testNow: () => baseTime + (clockReads++ === 0 ? 0 : 5 * 60_000),
  })
  try {
    const login = await fetch(`${app.url.origin}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
    const cookie = login.headers.get('set-cookie')!
    const send = (path: string, method = 'GET', body?: unknown) => fetch(`${app.url.origin}${path}`, {
      method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    })
    await send('/api/model-connection', 'PUT', { endpoint: `${upstream.url.origin}/v1`, apiKey: 'time-key' })
    await send('/api/model-connection/models', 'PUT', {
      defaultModel: 'time-model', stewardModel: { modelId: 'time-model', protocol: 'chat-completions' }, researchModelPool: [],
      models: [{ id: 'time-model', protocol: 'chat-completions', contextWindow: 128000, maxTokens: 4096, input: ['text'], reasoning: false, tools: true }],
    })
    const thread = await (await send('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })).json()
    await send(`/api/steward/threads/${thread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content: '时间边界' })
    let detail: any
    for (let i = 0; i < 100; i++) {
      detail = await (await send(`/api/steward/threads/${thread.id}`)).json()
      if (detail.turns[0]?.status === 'limited') break
      await Bun.sleep(20)
    }
    expect(detail).toMatchObject({ turns: [{ status: 'limited', budgetReason: 'time', modelCalls: 0, activeMs: 300000 }] })
    expect(upstreamCalls).toBe(0)
  } finally {
    await app.stop(true)
    upstream.stop(true)
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`)
    await admin.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('candidate browsing stays unlinked and an explicit work reference links without creating a run', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agentanywhere-steward-query-'))
  const schema = `steward_query_${crypto.randomUUID().replaceAll('-', '')}`
  const admin = new SQL(databaseUrl)
  await admin.unsafe(`CREATE SCHEMA ${schema}`)
  const isolatedUrl = new URL(databaseUrl)
  isolatedUrl.searchParams.set('options', `-csearch_path=${schema}`)
  let taskId = ''
  let pagedTaskId = ''
  let recentTaskId = ''
  const toolResponse = (model: string, name: string, args: unknown) => {
    const common = { id: crypto.randomUUID(), object: 'chat.completion.chunk', created: 1, model }
    return new Response([
      `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call_${name}`, type: 'function', function: { name, arguments: '' } }] }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}`,
      'data: [DONE]', '',
    ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } })
  }
  const textResponse = (model: string, content: string) => {
    const common = { id: crypto.randomUUID(), object: 'chat.completion.chunk', created: 1, model }
    return new Response([
      `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}`,
      'data: [DONE]', '',
    ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } })
  }
  const upstream = Bun.serve({ port: 0, async fetch(request) {
    const body = await request.json() as any
    const names = (body.tools ?? []).map((tool: any) => tool.function?.name)
    const results = body.messages.filter((message: any) => message.role === 'tool')
    const user = JSON.stringify(body.messages.filter((message: any) => message.role === 'user').at(-1)?.content ?? '')
    if (names.includes('find_work_candidates')) {
      const purpose = user.includes('比较') ? 'compare' : user.includes('浏览') ? 'browse' : 'read'
      if (user.includes('旧候选')) return results.length
        ? textResponse(body.model, '旧候选不能直接授权。')
        : toolResponse(body.model, 'freeze_work_selection', { purpose: 'read', taskIds: [recentTaskId], versionIds: [] })
      if (user.includes('分页歧义')) {
        if (!results.length) return toolResponse(body.model, 'find_work_candidates', { purpose: 'read', query: '分页歧义', cursor: 25 })
        return results.length === 1
          ? toolResponse(body.model, 'freeze_work_selection', { purpose: 'read', taskIds: [pagedTaskId], versionIds: [] })
          : textResponse(body.model, '分页候选不唯一。')
      }
      if (!results.length) return toolResponse(body.model, 'find_work_candidates', { purpose, query: purpose === 'browse' ? '' : taskId, cursor: 0 })
      if (user.includes('浏览后越权') && results.length === 1) return toolResponse(body.model, 'freeze_work_selection', { purpose: 'read', taskIds: [taskId], versionIds: [] })
      if (purpose === 'compare' && results.length === 1) return toolResponse(body.model, 'freeze_work_selection', { purpose: 'compare', taskIds: [taskId], versionIds: [] })
      if (purpose === 'browse' || purpose === 'compare') return textResponse(body.model, '候选需要用户澄清。')
      return toolResponse(body.model, 'freeze_work_selection', { purpose: 'read', taskIds: [taskId], versionIds: [] })
    }
    if (names.includes('read_frozen_work')) {
      if (user.includes('跳过读取')) return textResponse(body.model, '未读取就直接回答。')
      if (!results.length) return toolResponse(body.model, 'read_frozen_work', { operationId: body.tools[0].function.parameters.properties.operationId.const })
      return textResponse(body.model, `已读取[原工作](/tasks/${taskId})的真实状态。`)
    }
    return textResponse(body.model, `候选包含[原工作](/tasks/${taskId})。`)
  } })
  const password = 'test-password-12345'
  const app = await startServer({ password, port: 0, dataDir, databaseUrl: isolatedUrl.toString() })
  try {
    const login = await fetch(`${app.url.origin}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
    const cookie = login.headers.get('set-cookie')!
    const send = (path: string, method = 'GET', body?: unknown) => fetch(`${app.url.origin}${path}`, {
      method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    })
    await send('/api/model-connection', 'PUT', { endpoint: `${upstream.url.origin}/v1`, apiKey: 'fixture-key' })
    await send('/api/model-connection/models', 'PUT', {
      defaultModel: 'steward-query', stewardModel: { modelId: 'steward-query', protocol: 'chat-completions' }, researchModelPool: [],
      models: [{ id: 'steward-query', protocol: 'chat-completions', contextWindow: 128000, maxTokens: 4096, input: ['text'], reasoning: false, tools: true }],
    })
    const created = await send('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '历史报告查询样本', modelId: 'steward-query' })
    expect(created.status).toBe(201)
    const task = await created.json()
    taskId = task.id
    for (let index = 0; index < 26; index++) {
      const paged = await (await send('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: `分页歧义样本 ${index}`, modelId: 'steward-query' })).json()
      if (index === 0) pagedTaskId = paged.id
      recentTaskId = paged.id
    }
    const before = await (await send(`/api/tasks/${taskId}`)).json()
    const ask = async (content: string, expectedStatus = 'completed') => {
      const thread = await (await send('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })).json()
      await send(`/api/steward/threads/${thread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content })
      let detail: any
      for (let i = 0; i < 150; i++) {
        detail = await (await send(`/api/steward/threads/${thread.id}`)).json()
        if (['completed', 'failed', 'limited'].includes(detail.turns[0]?.status)) break
        await Bun.sleep(20)
      }
      expect(detail.turns[0]?.status).toBe(expectedStatus)
      return detail
    }
    const browsed = await ask('浏览最近的历史工作')
    expect(browsed.relatedTasks).toEqual([])
    expect(browsed.messages.at(-1).content).toContain(`/tasks/${taskId}`)
    const unauthorized = await ask('浏览后越权读取最近的历史工作')
    expect(unauthorized.relatedTasks).toEqual([])
    const incompleteCompare = await ask(`比较工作 ${taskId} 的报告版本`)
    expect(incompleteCompare.relatedTasks).toEqual([])
    const pagedAmbiguity = await ask('读取分页歧义工作')
    expect(pagedAmbiguity.relatedTasks).toEqual([])
    const skipped = await ask(`跳过读取直接解读工作 ${taskId}`, 'failed')
    expect(skipped.turns[0].failure).toBe('管家未读取已冻结的工作回执')
    const first = await ask(`解读工作 ${taskId} 的当前状态`)
    const second = await ask(`再读取工作 ${taskId} 的当前状态`)
    expect(first.relatedTasks).toMatchObject([{ id: taskId, status: 'queued', href: `/tasks/${taskId}` }])
    expect(second.relatedTasks).toMatchObject([{ id: taskId, status: 'queued', href: `/tasks/${taskId}` }])
    const oldCandidateThread = await (await send('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })).json()
    const submitExisting = async (content: string) => {
      await send(`/api/steward/threads/${oldCandidateThread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content })
      let detail: any
      for (let index = 0; index < 150; index++) {
        detail = await (await send(`/api/steward/threads/${oldCandidateThread.id}`)).json()
        if (!['queued', 'running'].includes(detail.turns.at(-1)?.status)) break
        await Bun.sleep(20)
      }
      return detail
    }
    await submitExisting('浏览最近的历史工作')
    const oldCandidate = await submitExisting('直接读取上一轮旧候选')
    expect(oldCandidate.relatedTasks).toEqual([])
    const after = await (await send(`/api/tasks/${taskId}`)).json()
    expect(after.runs.map((run: any) => run.id)).toEqual(before.runs.map((run: any) => run.id))
    expect(after.artifacts).toEqual(before.artifacts)
  } finally {
    await app.stop(true)
    upstream.stop(true)
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`)
    await admin.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})
