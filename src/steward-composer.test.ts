import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SQL } from 'bun'
import { startServer } from './server'

const databaseUrl = process.env.AGENTANYWHERE_TEST_DATABASE_URL
if (!databaseUrl) throw new Error('AGENTANYWHERE_TEST_DATABASE_URL is required for the composer API regression')

test('accepted steward submission can be checked and retried without another turn', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agentanywhere-composer-'))
  const schema = `composer_test_${crypto.randomUUID().replaceAll('-', '')}`
  const admin = new SQL(databaseUrl)
  await admin.unsafe(`CREATE SCHEMA ${schema}`)
  const isolatedUrl = new URL(databaseUrl)
  isolatedUrl.searchParams.set('options', `-csearch_path=${schema}`)
  let calls = 0
  const upstream = Bun.serve({ port: 0, fetch() {
    calls++
    return new Response([
      `data: ${JSON.stringify({ id: 'composer', object: 'chat.completion.chunk', created: 1, model: 'composer-model', choices: [{ index: 0, delta: { role: 'assistant', content: '收到。' }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: 'composer', object: 'chat.completion.chunk', created: 1, model: 'composer-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}`,
      'data: [DONE]', '',
    ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } })
  } })
  const password = 'test-password-12345'
  const app = await startServer({ password, port: 0, dataDir, databaseUrl: isolatedUrl.toString() })
  try {
    const login = await fetch(`${app.url.origin}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
    const cookie = login.headers.get('set-cookie')!
    const send = (path: string, method = 'GET', body?: unknown) => fetch(`${app.url.origin}${path}`, {
      method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    })
    await send('/api/model-connection', 'PUT', { endpoint: `${upstream.url.origin}/v1`, apiKey: 'composer-key' })
    await send('/api/model-connection/models', 'PUT', {
      defaultModel: 'composer-model', stewardModel: { modelId: 'composer-model', protocol: 'chat-completions' }, researchModelPool: [],
      models: [{ id: 'composer-model', protocol: 'chat-completions', contextWindow: 128000, maxTokens: 4096, input: ['text'], reasoning: false, tools: true }],
    })

    const threadRequestId = crypto.randomUUID()
    const firstThread = await send('/api/steward/threads', 'POST', { requestId: threadRequestId })
    const thread = await firstThread.json()
    expect(firstThread.status).toBe(201)
    expect((await send('/api/steward/threads', 'POST', { requestId: threadRequestId })).status).toBe(200)

    const turnRequestId = crypto.randomUUID()
    expect((await send(`/api/steward/threads/${thread.id}/turns`, 'POST', { requestId: turnRequestId, content: '只提交一次' })).status).toBe(202)
    const refreshed = await (await send(`/api/steward/threads/${thread.id}`)).json()
    expect(refreshed.turns).toHaveLength(1)
    expect(refreshed.turns[0].requestId).toBe(turnRequestId)
    expect(refreshed.messages.filter((message: any) => message.role === 'user')).toHaveLength(1)

    expect((await send(`/api/steward/threads/${thread.id}/turns`, 'POST', { requestId: turnRequestId, content: '只提交一次' })).status).toBe(200)
    expect((await send(`/api/steward/threads/${thread.id}/turns`, 'POST', { requestId: turnRequestId, content: '冲突内容' })).status).toBe(409)
    const retried = await (await send(`/api/steward/threads/${thread.id}`)).json()
    expect(retried.turns).toHaveLength(1)
    expect(retried.messages.filter((message: any) => message.role === 'user')).toHaveLength(1)
    for (let i = 0; i < 100 && calls === 0; i++) await Bun.sleep(10)
    expect(calls).toBe(1)
  } finally {
    await app.stop(true)
    upstream.stop(true)
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`)
    await admin.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})
