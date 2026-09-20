import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SQL } from 'bun'
import { startServer } from './server'

const databaseUrl = process.env.AGENTANYWHERE_TEST_DATABASE_URL
if (!databaseUrl) throw new Error('AGENTANYWHERE_TEST_DATABASE_URL is required for the title API regression')

test('owner renames steward conversations and work through their public resources', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agentanywhere-title-'))
  const schema = `title_test_${crypto.randomUUID().replaceAll('-', '')}`
  const admin = new SQL(databaseUrl)
  await admin.unsafe(`CREATE SCHEMA ${schema}`)
  const isolatedUrl = new URL(databaseUrl)
  isolatedUrl.searchParams.set('options', `-csearch_path=${schema}`)
  const testDatabaseUrl = isolatedUrl.toString()
  const password = 'test-password-12345'
  const app = await startServer({ password, port: 0, dataDir, databaseUrl: testDatabaseUrl })
  const db = new SQL(testDatabaseUrl)
  try {
    const login = await fetch(`${app.url.origin}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
    const cookie = login.headers.get('set-cookie')!
    const send = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(`${app.url.origin}${path}`, {
      method, headers: { cookie, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
    })

    await send('/api/model-connection', 'PUT', { endpoint: 'https://models.example/v1', apiKey: 'private-secret' })
    await send('/api/model-connection/models', 'PUT', {
      defaultModel: 'title-model',
      models: [{ id: 'title-model', protocol: 'responses', contextWindow: 128000, maxTokens: 4096, input: ['text'], reasoning: false, tools: true }],
    })
    const originalGoal = `  调研标题持久化\n${'长目标'.repeat(40)}  `
    const task = await (await send('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: originalGoal, modelId: 'title-model' })).json()
    const thread = await (await send('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })).json()

    expect(task.title).toBe(`调研标题持久化 ${'长目标'.repeat(24)}`)
    expect(Array.from(task.title)).toHaveLength(80)
    expect(task).toMatchObject({ goal: originalGoal.trim(), titleEdited: false })
    expect(thread).toMatchObject({ title: '新对话', titleEdited: false })

    expect((await fetch(`${app.url.origin}/api/tasks/${task.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '未认证' }) })).status).toBe(401)
    expect((await send(`/api/tasks/${task.id}`, 'PATCH', { title: '错误来源' }, { origin: 'https://other.example' })).status).toBe(403)
    for (const title of ['', ' \t ', '两行\n标题', 'x'.repeat(81)]) {
      expect((await send(`/api/tasks/${task.id}`, 'PATCH', { title })).status).toBe(400)
    }
    const unicodeTitle = '研'.repeat(79) + '😀'
    const renamedTask = await (await send(`/api/tasks/${task.id}`, 'PATCH', { title: ` ${unicodeTitle} ` })).json()
    expect(renamedTask).toMatchObject({ id: task.id, title: unicodeTitle, titleEdited: true, goal: originalGoal.trim() })

    const renamedThread = await (await send(`/api/steward/threads/${thread.id}`, 'PATCH', { title: '  模型选择讨论  ' })).json()
    expect(renamedThread).toMatchObject({ id: thread.id, title: '模型选择讨论', titleEdited: true })
    expect((await send(`/api/tasks/${crypto.randomUUID()}`, 'PATCH', { title: '不可见' })).status).toBe(404)
    expect((await send(`/api/steward/threads/${crypto.randomUUID()}`, 'PATCH', { title: '不可见' })).status).toBe(404)

    await db`INSERT INTO steward_thread_tasks (thread_id, task_id) VALUES (${thread.id}, ${task.id})`
    expect((await send('/api/tasks')).json()).resolves.toMatchObject([{ id: task.id, title: unicodeTitle, titleEdited: true }])
    expect((await send(`/api/tasks/${task.id}`)).json()).resolves.toMatchObject({ id: task.id, title: unicodeTitle, titleEdited: true, goal: originalGoal.trim() })
    expect((await send('/api/steward/threads')).json()).resolves.toMatchObject([{ id: thread.id, title: '模型选择讨论', titleEdited: true }])
    expect((await send(`/api/steward/threads/${thread.id}`)).json()).resolves.toMatchObject({
      id: thread.id, title: '模型选择讨论', titleEdited: true,
      relatedTasks: [{ id: task.id, title: unicodeTitle, titleEdited: true, goal: originalGoal.trim() }],
    })
  } finally {
    await app.stop(true)
    await db.close()
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`)
    await admin.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})
