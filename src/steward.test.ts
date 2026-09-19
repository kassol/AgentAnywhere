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
    expect(thread).toMatchObject({ title: '新对话', messages: [], turns: [] })
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
    expect(firstDetail).toMatchObject({ messages: [{ role: 'user', content: '第一轮' }, { role: 'assistant', content: '聊天协议完成。', status: 'completed' }], turns: [{ status: 'completed', modelCalls: 1 }] })
    expect(secondDetail).toMatchObject({ messages: [{ role: 'user', content: '第二轮' }, { role: 'assistant', content: '响应协议完成。', status: 'completed' }], turns: [{ status: 'completed', modelCalls: 1 }] })
    expect(calls).toEqual(['/v1/chat/completions:steward-chat', '/v1/responses:steward-responses'])
    expect(responseRequests[0].reasoning).toMatchObject({ effort: 'medium' })
    expect(maxActiveRequests).toBe(1)
    const streamed = await (await send(`/api/steward/threads/${second.id}/events`)).json()
    expect(streamed.some((event: any) => event.type === 'assistant.delta')).toBe(true)

    expect((await configure('steward-chat', 'chat-completions')).status).toBe(200)
    const stoppedThread = await (await send('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })).json()
    const stopping = await (await send(`/api/steward/threads/${stoppedThread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content: '等待停止' })).json()
    for (let i = 0; i < 50 && calls.length < 3; i++) await Bun.sleep(20)
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
    expect(chatContexts.slice(-3)).toEqual([
      ['user:队列一'],
      ['user:队列一', 'assistant:聊天协议完成。', 'user:队列二'],
      ['user:队列一', 'assistant:聊天协议完成。', 'user:队列二', 'assistant:聊天协议完成。', 'user:队列三'],
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
      messages: [{ role: 'user' }, { role: 'assistant', content: '部分回复', status: 'interrupted' }], turns: [{ status: 'interrupted' }],
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
