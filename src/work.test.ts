import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SQL } from 'bun'
import { startServer } from './server'

const databaseUrl = process.env.AGENTANYWHERE_TEST_DATABASE_URL

test.skipIf(!databaseUrl)('owner creates one persisted queued work request through the public API', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agentanywhere-work-'))
  const db = new SQL(databaseUrl!)
  const password = 'test-password-12345'
  let app = await startServer({ password, port: 0, dataDir, databaseUrl })
  let base = app.url.origin
  const ids: string[] = []
  async function login() {
    const response = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
    return response.headers.get('set-cookie')!
  }
  let cookie = await login()
  const send = (path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}) => fetch(`${base}${path}`, {
    method, headers: { cookie, 'content-type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body),
  })
  try {
    expect((await fetch(`${base}/api/tasks`, { method: 'POST' })).status).toBe(401)
    expect((await send('/api/tasks', 'POST', {}, { origin: 'https://other.example' })).status).toBe(403)
    expect((await send('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '研究可解释性' })).status).toBe(400)
    const endpoint = 'https://models.example/v1'
    expect((await send('/api/model-connection', 'PUT', { endpoint, apiKey: 'private-secret' })).status).toBe(200)
    expect((await send('/api/model-connection/models', 'PUT', { defaultModel: 'test-model', models: [{ id: 'test-model', protocol: 'responses', contextWindow: 128000, maxTokens: 8192, input: ['text'], tools: true }] })).status).toBe(200)

    const requestId = crypto.randomUUID()
    const body = { requestId, goal: '研究可解释性', sourceUrl: 'https://example.com/paper', modelId: 'test-model', protocol: 'chat-completions' }
    const created = await send('/api/tasks', 'POST', body)
    expect(created.status).toBe(201)
    const task = await created.json()
    ids.push(task.id)
    expect(task).toMatchObject({ goal: body.goal, sourceUrl: body.sourceUrl, status: 'queued', run: { status: 'queued', model: { id: 'test-model', protocol: 'chat-completions', endpoint, contextWindow: 128000, maxTokens: 8192, input: ['text'], tools: true } }, thread: { messages: [{ role: 'user', content: body.goal }] } })
    expect(JSON.stringify(task)).not.toContain('private-secret')
    expect((await send('/api/tasks', 'POST', body)).status).toBe(200)
    expect((await send('/api/tasks', 'POST', { ...body, goal: 'different' })).status).toBe(409)
    expect((await send('/api/tasks', 'POST', { ...body, requestId: crypto.randomUUID(), modelId: 'unknown' })).status).toBe(400)
    expect((await send('/api/tasks', 'POST', { ...body, requestId: crypto.randomUUID(), sourceUrl: 'file:///etc/passwd' })).status).toBe(400)
    const linkOnly = await send('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '', sourceUrl: 'https://example.org/news', modelId: 'test-model' })
    expect(linkOnly.status).toBe(201)
    const linked = await linkOnly.json()
    ids.push(linked.id)
    expect(linked).toMatchObject({ sourceUrl: 'https://example.org/news', thread: { messages: [{ content: 'https://example.org/news' }] } })
    expect((await fetch(`${base}/api/tasks/${task.id}`)).status).toBe(401)
    expect((await send('/api/model-connection/models', 'PUT', { defaultModel: 'no-text', models: [{ id: 'no-text', protocol: 'responses', contextWindow: 128000, maxTokens: 8192, input: ['image'] }] })).status).toBe(200)
    expect((await send('/api/tasks', 'POST', { ...body, requestId: crypto.randomUUID(), modelId: 'no-text' })).status).toBe(400)

    expect((await send('/api/tasks')).json().then((list: unknown[]) => list.filter((item: any) => item.id === task.id).length)).resolves.toBe(1)
    expect((await send(`/api/tasks/${task.id}`)).json()).resolves.toMatchObject({ id: task.id, goal: body.goal, status: 'queued' })
    app.stop(true)
    app = await startServer({ password, port: 0, dataDir, databaseUrl })
    base = app.url.origin
    cookie = await login()
    expect((await send(`/api/tasks/${task.id}`)).json()).resolves.toMatchObject({ id: task.id, goal: body.goal, sourceUrl: body.sourceUrl, status: 'queued' })
    expect((await send('/api/model-connection', 'PUT', { endpoint: 'https://replacement.example/v1', apiKey: 'new-private-secret' })).status).toBe(200)
    expect((await send('/api/model-connection/models', 'PUT', { defaultModel: null, models: [] })).status).toBe(200)
    expect((await send(`/api/tasks/${task.id}`)).json()).resolves.toMatchObject({ run: { model: { id: 'test-model', protocol: 'chat-completions', endpoint, contextWindow: 128000, maxTokens: 8192, input: ['text'], tools: true } } })
  } finally {
    app.stop(true)
    for (const id of ids) {
      await db`DELETE FROM work_messages WHERE thread_id IN (SELECT id FROM work_threads WHERE task_id = ${id})`
      await db`DELETE FROM work_runs WHERE task_id = ${id}`
      await db`DELETE FROM work_threads WHERE task_id = ${id}`
      await db`DELETE FROM work_tasks WHERE id = ${id}`
    }
    await db.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})
