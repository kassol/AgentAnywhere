import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SQL } from 'bun'
import { startServer } from './server'

const databaseUrl = process.env.AGENTANYWHERE_TEST_DATABASE_URL
if (!databaseUrl) throw new Error('AGENTANYWHERE_TEST_DATABASE_URL is required for the automatic title regression')

const chat = (model: string, content: string, usage = { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 }) => {
  const common = { id: crypto.randomUUID(), object: 'chat.completion.chunk', created: 1, model }
  return new Response([
    `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage })}`,
    'data: [DONE]', '',
  ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } })
}

const responses = (model: string, content: string) => {
  const item = { id: crypto.randomUUID(), type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: content, annotations: [] }] }
  return new Response([
    `data: ${JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } })}`,
    `data: ${JSON.stringify({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: content })}`,
    `data: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item })}`,
    `data: ${JSON.stringify({ type: 'response.completed', response: { id: crypto.randomUUID(), status: 'completed', output: [item], usage: { input_tokens: 9, output_tokens: 3, total_tokens: 12 } } })}`, '',
  ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } })
}

test('automatic titles are bounded, metered, idempotent, and cannot overwrite a manual title', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agentanywhere-auto-title-'))
  const schema = `auto_title_${crypto.randomUUID().replaceAll('-', '')}`
  const admin = new SQL(databaseUrl)
  await admin.unsafe(`CREATE SCHEMA ${schema}`)
  const isolatedUrl = new URL(databaseUrl)
  isolatedUrl.searchParams.set('options', `-csearch_path=${schema}`)
  let titleCalls = 0
  let releaseLate!: () => void
  const late = new Promise<void>(resolve => { releaseLate = resolve })
  const upstream = Bun.serve({ port: 0, async fetch(request) {
    const body = await request.json() as any
    const titleRequest = body.max_tokens === 64 || body.max_completion_tokens === 64 || body.max_output_tokens === 64
    if (!titleRequest) return responses(body.model, '普通回复')
    titleCalls++
    const source = JSON.stringify(body.messages ?? body.input)
    if (source.includes('MANUAL_RACE')) { await late; return chat(body.model, '迟到标题') }
    if (source.includes('FAIL_TITLE')) return new Response('unavailable', { status: 500 })
    if (source.includes('TIMEOUT_TITLE')) return new Promise(() => {})
    if (request.url.endsWith('/responses')) return responses(body.model, '自动对话标题')
    return chat(body.model, '自动工作标题')
  } })
  const password = 'test-password-12345'
  const app = await startServer({ password, port: 0, dataDir, databaseUrl: isolatedUrl.toString(), titleTimeoutMs: 100 })
  try {
    const login = await fetch(`${app.url.origin}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
    const cookie = login.headers.get('set-cookie')!
    const send = (path: string, method = 'GET', body?: unknown) => fetch(`${app.url.origin}${path}`, {
      method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    })
    await send('/api/model-connection', 'PUT', { endpoint: `${upstream.url.origin}/v1`, apiKey: 'title-key' })
    await send('/api/model-connection/models', 'PUT', {
      defaultModel: 'title-chat', stewardModel: { modelId: 'title-chat', protocol: 'chat-completions' }, researchModelPool: [],
      models: [{ id: 'title-chat', protocol: 'chat-completions', contextWindow: 128000, maxTokens: 4096, input: ['text'], reasoning: false, tools: true, inputPrice: 1, outputPrice: 2 }],
    })

    const requestId = crypto.randomUUID()
    const created = await send('/api/tasks', 'POST', { requestId, goal: 'SUCCESS_TITLE 调研', modelId: 'title-chat' })
    const task = await created.json()
    expect((await send('/api/tasks', 'POST', { requestId, goal: 'SUCCESS_TITLE 调研', modelId: 'title-chat' })).status).toBe(200)
    let detail: any
    for (let i = 0; i < 100; i++) {
      detail = await (await send(`/api/tasks/${task.id}`)).json()
      if (detail.titleGeneration?.status === 'succeeded') break
      await Bun.sleep(10)
    }
    expect(detail).toMatchObject({ title: '自动工作标题', titleEdited: false, goal: 'SUCCESS_TITLE 调研', run: {
      modelCalls: 0, modelCallLimit: 40,
    }, titleGeneration: {
      status: 'succeeded', attempts: 1, maxAttempts: 1, timeoutMs: 100, maxOutputTokens: 64,
      modelId: 'title-chat', protocol: 'chat-completions', inputTokens: 12, outputTokens: 4, totalTokens: 16,
    } })
    expect(detail.titleGeneration.estimatedCostUsd).toBeCloseTo(0.00002)
    expect(titleCalls).toBe(1)

    const race = await (await send('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: 'MANUAL_RACE 调研', modelId: 'title-chat' })).json()
    for (let i = 0; i < 100 && titleCalls < 2; i++) await Bun.sleep(10)
    expect((await send(`/api/tasks/${race.id}`, 'PATCH', { title: '人工标题' })).status).toBe(200)
    releaseLate()
    for (let i = 0; i < 100; i++) {
      detail = await (await send(`/api/tasks/${race.id}`)).json()
      if (detail.titleGeneration?.status === 'discarded') break
      await Bun.sleep(10)
    }
    expect(detail).toMatchObject({ title: '人工标题', titleEdited: true, titleGeneration: { status: 'discarded', attempts: 1 } })

    for (const goal of ['FAIL_TITLE 调研', 'TIMEOUT_TITLE 调研']) {
      const failed = await (await send('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal, modelId: 'title-chat' })).json()
      for (let i = 0; i < 100; i++) {
        detail = await (await send(`/api/tasks/${failed.id}`)).json()
        if (detail.titleGeneration?.status === 'failed') break
        await Bun.sleep(10)
      }
      expect(detail).toMatchObject({ title: goal, titleEdited: false, goal, titleGeneration: { status: 'failed', attempts: 1 } })
      expect(['provider', 'timeout']).toContain(detail.titleGeneration.failure)
    }

    await send('/api/model-connection/models', 'PUT', {
      defaultModel: 'title-responses', stewardModel: { modelId: 'title-responses', protocol: 'responses' }, researchModelPool: [],
      models: [{ id: 'title-responses', protocol: 'responses', contextWindow: 128000, maxTokens: 4096, input: ['text'], reasoning: false, tools: true }],
    })
    const thread = await (await send('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })).json()
    expect((await send(`/api/steward/threads/${thread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content: 'RESPONSES_TITLE 讨论' })).status).toBe(202)
    let conversation: any
    for (let i = 0; i < 150; i++) {
      conversation = await (await send(`/api/steward/threads/${thread.id}`)).json()
      if (conversation.titleGeneration?.status === 'succeeded') break
      await Bun.sleep(10)
    }
    expect(conversation).toMatchObject({ title: '自动对话标题', titleEdited: false, titleGeneration: {
      status: 'succeeded', modelId: 'title-responses', protocol: 'responses', inputTokens: 9, outputTokens: 3, totalTokens: 12,
    } })
    const manualThread = await (await send('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })).json()
    await send(`/api/steward/threads/${manualThread.id}`, 'PATCH', { title: '新对话' })
    expect((await send(`/api/steward/threads/${manualThread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content: '手工命名后开始讨论' })).status).toBe(202)
    expect(await (await send(`/api/steward/threads/${manualThread.id}`)).json()).toMatchObject({ title: '新对话', titleEdited: true })
  } finally {
    await app.stop(true)
    upstream.stop(true)
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`)
    await admin.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})
