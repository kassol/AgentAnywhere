import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SQL } from 'bun'
import { createHash } from 'node:crypto'
import { startServer } from './server'
import { createWorkStore } from './work'
import { createModelConnectionStore } from './model-connection'

const databaseUrl = process.env.AGENTANYWHERE_TEST_DATABASE_URL

test.skipIf(!databaseUrl)('owner creates one persisted queued work request through the public API', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agentanywhere-work-'))
  const schema = `work_test_${crypto.randomUUID().replaceAll('-', '')}`
  const admin = new SQL(databaseUrl!)
  await admin.unsafe(`CREATE SCHEMA ${schema}`)
  const isolatedUrl = new URL(databaseUrl!)
  isolatedUrl.searchParams.set('options', `-csearch_path=${schema}`)
  const testDatabaseUrl = isolatedUrl.toString()
  const password = 'test-password-12345'
  let app = await startServer({ password, port: 0, dataDir, databaseUrl: testDatabaseUrl })
  let base = app.url.origin
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
    expect((await send('/api/model-connection/models', 'PUT', { defaultModel: 'test-model', models: [{ id: 'test-model', protocol: 'responses', contextWindow: 128000, maxTokens: 8192, input: ['text'], reasoning: false, tools: true }] })).status).toBe(200)

    const requestId = crypto.randomUUID()
    const body = { requestId, goal: '研究可解释性', sourceUrl: 'https://example.com/paper', modelId: 'test-model', protocol: 'chat-completions' }
    const created = await send('/api/tasks', 'POST', body)
    expect(created.status).toBe(201)
    const task = await created.json()
    expect(task).toMatchObject({ goal: body.goal, sourceUrl: body.sourceUrl, status: 'queued', run: { status: 'queued', model: { id: 'test-model', protocol: 'chat-completions', endpoint, contextWindow: 128000, maxTokens: 8192, input: ['text'], reasoning: false, tools: true } }, thread: { messages: [{ role: 'user', content: body.goal }] } })
    expect(JSON.stringify(task)).not.toContain('private-secret')
    expect((await send('/api/tasks', 'POST', body)).status).toBe(200)
    expect((await send('/api/tasks', 'POST', { ...body, goal: 'different' })).status).toBe(409)
    const waiting = await (await send('/api/tasks', 'POST', { ...body, requestId: crypto.randomUUID() })).json()
    const waitingDb = new SQL(testDatabaseUrl)
    const interactionId = crypto.randomUUID()
    await waitingDb`UPDATE work_runs SET status='waiting', epoch=1, cleanup_state='cleaned', checkpoint_ref=${JSON.stringify({ epoch: 1, files: [] })}::jsonb WHERE id=${waiting.run.id}`
    await waitingDb`UPDATE work_tasks SET status='waiting' WHERE id=${waiting.id}`
    await waitingDb`DELETE FROM work_outbox WHERE run_id=${waiting.run.id}`
    await waitingDb`INSERT INTO work_interactions (id, run_id, epoch, question, status) VALUES (${interactionId}, ${waiting.run.id}, 1, '研究哪个方向？', 'pending')`
    expect((await send(`/api/tasks/${waiting.id}`)).json()).resolves.toMatchObject({ run: { status: 'waiting' }, interaction: { id: interactionId, question: '研究哪个方向？', status: 'pending' } })
    expect((await send(`/api/interactions/${interactionId}/resolve`, 'POST', { answer: ' ' })).status).toBe(400)
    expect((await send(`/api/interactions/${interactionId}/resolve`, 'POST', { answer: '机制方向' })).status).toBe(202)
    expect((await send(`/api/interactions/${interactionId}/resolve`, 'POST', { answer: '机制方向' })).status).toBe(200)
    expect((await send(`/api/interactions/${interactionId}/resolve`, 'POST', { answer: '另一方向' })).status).toBe(409)
    expect((await send(`/api/tasks/${waiting.id}`)).json()).resolves.toMatchObject({ run: { status: 'queued', epoch: 1 }, interaction: { status: 'answered', answer: '机制方向' } })
    expect((await waitingDb`SELECT count(*)::int AS count FROM work_outbox WHERE run_id=${waiting.run.id}`)[0].count).toBe(1)
    await waitingDb.close()
    const runToken = 'test-run-token'
    const stateDb = new SQL(testDatabaseUrl)
    await stateDb`UPDATE work_runs SET status = 'running', active = true, epoch = 1,
      run_token_hash = ${createHash('sha256').update(runToken).digest('hex')} WHERE id = ${task.run.id}`
    const commandId = crypto.randomUUID()
    const addition = { commandId, kind: 'steer', content: '改为对照两篇论文' }
    expect((await fetch(`${base}/api/runs/${task.run.id}/messages`, { method: 'POST' })).status).toBe(401)
    expect((await send(`/api/runs/${task.run.id}/messages`, 'POST', addition, { origin: 'https://other.example' })).status).toBe(403)
    const appended = await send(`/api/runs/${task.run.id}/messages`, 'POST', addition)
    expect(appended.status).toBe(201)
    const message = await appended.json()
    expect(message).toMatchObject({ content: addition.content, status: 'pending' })
    expect((await send(`/api/runs/${task.run.id}/messages`, 'POST', addition)).status).toBe(200)
    expect((await send(`/api/runs/${task.run.id}/messages`, 'POST', { ...addition, content: '不同内容' })).status).toBe(409)
    expect((await send(`/api/tasks/${task.id}`)).json()).resolves.toMatchObject({ thread: { messages: [{ content: body.goal, status: 'applied' }, { content: addition.content, status: 'pending' }] } })
    const internal = `/internal/runs/${task.run.id}/1/messages`
    const pending = await fetch(`${base}${internal}`, { headers: { authorization: `Bearer ${runToken}` } })
    expect(await pending.json()).toEqual([{ id: message.id, content: addition.content }])
    expect((await fetch(`${base}${internal}`, { method: 'POST', headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' }, body: JSON.stringify({ id: message.id }) })).status).toBe(409)
    expect((await fetch(`${base}${internal}`, { method: 'POST', headers: { authorization: `Bearer ${runToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: message.id }) })).status).toBe(200)
    expect((await fetch(`${base}${internal}`, { method: 'POST', headers: { authorization: `Bearer ${runToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: message.id }) })).status).toBe(200)
    expect((await send(`/api/tasks/${task.id}`)).json()).resolves.toMatchObject({ thread: { messages: [{ status: 'applied' }, { status: 'applied' }] } })
    const deferredInput = { commandId: crypto.randomUUID(), kind: 'steer', content: '保留待续' }
    const deferredAttempts = await Promise.all([send(`/api/runs/${task.run.id}/messages`, 'POST', deferredInput), send(`/api/runs/${task.run.id}/messages`, 'POST', deferredInput)])
    expect(deferredAttempts.map(item => item.status).sort()).toEqual([200, 201])
    const deferred = await deferredAttempts[0].json()
    await stateDb`UPDATE work_runs SET epoch = 2, status = 'succeeded', active = false WHERE id = ${task.run.id}`
    expect((await fetch(`${base}${internal}`, { method: 'POST', headers: { authorization: `Bearer ${runToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: deferred.id }) })).status).toBe(409)
    expect((await send(`/api/tasks/${task.id}`)).json()).resolves.toMatchObject({ thread: { messages: [{ status: 'applied' }, { status: 'applied' }, { status: 'pending' }] } })
    expect((await send(`/api/runs/${task.run.id}/messages`, 'POST', { commandId: crypto.randomUUID(), kind: 'steer', content: '新要求' })).status).toBe(409)
    await stateDb.close()
    expect((await send('/api/tasks', 'POST', { ...body, requestId: crypto.randomUUID(), modelId: 'unknown' })).status).toBe(400)
    expect((await send('/api/tasks', 'POST', { ...body, requestId: crypto.randomUUID(), sourceUrl: 'file:///etc/passwd' })).status).toBe(400)
    const linkOnly = await send('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '', sourceUrl: 'https://example.org/news', modelId: 'test-model' })
    expect(linkOnly.status).toBe(201)
    const linked = await linkOnly.json()
    expect(linked).toMatchObject({ sourceUrl: 'https://example.org/news', thread: { messages: [{ content: 'https://example.org/news' }] } })
    expect((await fetch(`${base}/api/tasks/${task.id}`)).status).toBe(401)
    expect((await send('/api/model-connection/models', 'PUT', { defaultModel: 'no-text', models: [{ id: 'no-text', protocol: 'responses', contextWindow: 128000, maxTokens: 8192, input: ['image'], reasoning: false }] })).status).toBe(200)
    expect((await send('/api/tasks', 'POST', { ...body, requestId: crypto.randomUUID(), modelId: 'no-text' })).status).toBe(400)
    expect((await send('/api/model-connection/models', 'PUT', { defaultModel: 'unknown-reasoning', models: [{ id: 'unknown-reasoning', protocol: 'responses', contextWindow: 128000, maxTokens: 8192, input: ['text'] }] })).status).toBe(200)
    expect((await send('/api/tasks', 'POST', { ...body, requestId: crypto.randomUUID(), modelId: 'unknown-reasoning' })).status).toBe(400)

    expect((await send('/api/tasks')).json().then((list: unknown[]) => list.filter((item: any) => item.id === task.id).length)).resolves.toBe(1)
    expect((await send(`/api/tasks/${task.id}`)).json()).resolves.toMatchObject({ id: task.id, goal: body.goal, status: 'queued' })
    expect((await send(`/api/tasks/${task.id}/events`)).json()).resolves.toEqual([])
    expect((await fetch(`${base}/api/tasks/${linked.id}/cancel`, { method: 'POST' })).status).toBe(401)
    expect((await send(`/api/tasks/${linked.id}/cancel`, 'POST', {}, { origin: 'https://other.example' })).status).toBe(403)
    expect((await send(`/api/tasks/${linked.id}/cancel`, 'POST')).status).toBe(202)
    expect((await send(`/api/tasks/${linked.id}/cancel`, 'POST')).status).toBe(200)
    expect((await send(`/api/tasks/${linked.id}`)).json()).resolves.toMatchObject({ status: 'cancelled', run: { status: 'cancelled' } })
    expect((await send(`/api/tasks/${linked.id}/events`)).json()).resolves.toMatchObject([{ type: 'run.cancelled' }])
    app.stop(true)
    app = await startServer({ password, port: 0, dataDir, databaseUrl: testDatabaseUrl })
    base = app.url.origin
    cookie = await login()
    expect((await send(`/api/tasks/${linked.id}`)).json()).resolves.toMatchObject({ id: linked.id, status: 'cancelled' })
    expect((await send('/api/model-connection/models', 'PUT', { defaultModel: 'test-model', models: [{ id: 'test-model', protocol: 'responses', contextWindow: 128000, maxTokens: 8192, input: ['text'], reasoning: false, tools: true }] })).status).toBe(200)
    expect((await send('/api/model-connection', 'PUT', { endpoint: 'https://replacement.example/v1', apiKey: 'new-private-secret' })).status).toBe(200)
    const next = await send('/api/tasks', 'POST', { ...body, requestId: crypto.randomUUID() })
    expect(next.status).toBe(201)
    const newTask = await next.json()
    const privateConnection = createModelConnectionStore(dataDir)
    await privateConnection.load()
    const work = await createWorkStore(testDatabaseUrl)
    expect(await work.resolveRunModelConnection(task.run.id, privateConnection.resolveCredential)).toEqual({ endpoint, apiKey: 'private-secret' })
    expect(await work.resolveRunModelConnection(newTask.run.id, privateConnection.resolveCredential)).toEqual({ endpoint: 'https://replacement.example/v1', apiKey: 'new-private-secret' })
    const publicConnection = await (await send('/api/model-connection')).text()
    expect(publicConnection).not.toContain('private-secret')
    expect(publicConnection).not.toContain('credentialVersions')
    expect(await (await send(`/api/tasks/${task.id}`)).text()).not.toContain('private-secret')
    expect(await (await send(`/api/tasks/${newTask.id}`)).text()).not.toContain('new-private-secret')
    const upstream = Bun.serve({ port: 0, fetch: () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n'))
        setTimeout(() => controller.error(new Error('upstream stream failed')), 20)
      },
    }), { headers: { 'content-type': 'text/event-stream' } }) })
    const proxyDb = new SQL(testDatabaseUrl)
    try {
      expect((await send('/api/model-connection', 'PUT', { endpoint: `${upstream.url.origin}/v1`, apiKey: 'stream-secret' })).status).toBe(200)
      expect((await send('/api/model-connection/models', 'PUT', { defaultModel: 'test-model', models: [{ id: 'test-model', protocol: 'chat-completions', contextWindow: 128000, maxTokens: 8192, input: ['text'], reasoning: false, tools: true }] })).status).toBe(200)
      const broken = await (await send('/api/tasks', 'POST', { ...body, requestId: crypto.randomUUID() })).json()
      const token = 'stream-test-token'
      await proxyDb`UPDATE work_runs SET status='running', active=true, epoch=1,
        run_token_hash=${createHash('sha256').update(token).digest('hex')} WHERE id=${broken.run.id}`
      const proxy = `/internal/runs/${broken.run.id}/1/v1/chat/completions`
      const streamed = await fetch(`${base}${proxy}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'test-model', stream: true }) })
      expect(streamed.status).toBe(200)
      await expect(streamed.text()).rejects.toThrow()
      expect((await send(`/api/tasks/${broken.id}/cancel`, 'POST')).status).toBe(202)
      expect((await fetch(`${base}${proxy}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'test-model', stream: true }) })).status).toBe(401)
    } finally { upstream.stop(true); await proxyDb.close() }
    expect((await send('/api/model-connection/models', 'PUT', { defaultModel: null, models: [] })).status).toBe(200)
    expect((await send(`/api/tasks/${task.id}`)).json()).resolves.toMatchObject({ run: { model: { id: 'test-model', protocol: 'chat-completions', endpoint, contextWindow: 128000, maxTokens: 8192, input: ['text'], reasoning: false, tools: true } } })
    const versionDb = new SQL(testDatabaseUrl)
    const artifactId = crypto.randomUUID()
    const versionId = crypto.randomUUID()
    const previousReport = '# 初版报告\n\n结论 A。\n'
    const storageKey = `${task.run.id}/report.md`
    await mkdir(join(dataDir, 'artifacts', task.run.id), { recursive: true })
    await writeFile(join(dataDir, 'artifacts', storageKey), previousReport)
    await versionDb`UPDATE work_runs SET status='succeeded', cleanup_state='cleaned', active=false WHERE id=${task.run.id}`
    await versionDb`UPDATE work_tasks SET status='succeeded' WHERE id=${task.id}`
    await versionDb`INSERT INTO work_artifacts (id, task_id, kind, name) VALUES (${artifactId}, ${task.id}, 'report', 'report.md')`
    await versionDb`INSERT INTO work_artifact_versions (id, artifact_id, run_id, storage_key, sha256, size_bytes, mime_type)
      VALUES (${versionId}, ${artifactId}, ${task.run.id}, ${storageKey}, ${createHash('sha256').update(previousReport).digest('hex')}, ${Buffer.byteLength(previousReport)}, 'text/markdown')`
    await send('/api/model-connection/models', 'PUT', { defaultModel: 'test-model', models: [{ id: 'test-model', protocol: 'responses', contextWindow: 128000, maxTokens: 8192, input: ['text'], reasoning: false, tools: true }] })
    const continueBody = { requestId: crypto.randomUUID(), content: '补充结论 B 与 A 的对比', modelId: 'test-model' }
    const continued = await send(`/api/tasks/${task.id}/runs`, 'POST', continueBody)
    expect(continued.status).toBe(201)
    const continuedTask = await continued.json()
    expect(continuedTask).toMatchObject({ id: task.id, status: 'queued', run: { status: 'queued', model: { protocol: 'responses', endpoint: 'https://replacement.example/v1' }, previousReportVersionId: versionId }, thread: { id: task.thread.id } })
    expect(continuedTask.run.id).not.toBe(task.run.id)
    expect(continuedTask.runs).toHaveLength(2)
    expect(continuedTask.artifacts).toMatchObject([{ versionId, runId: task.run.id }])
    expect(continuedTask.thread.messages.find((item: { content: string }) => item.content === deferredInput.content)).toMatchObject({ status: 'carried' })
    expect(continuedTask.thread.messages.at(-1)).toMatchObject({ content: continueBody.content })
    expect((await send(`/api/tasks/${task.id}/runs`, 'POST', continueBody)).status).toBe(200)
    expect((await send(`/api/tasks/${task.id}/runs`, 'POST', { ...continueBody, content: '另一要求' })).status).toBe(409)
    expect((await (await send(`/api/artifacts/${versionId}/content`)).json()).markdown).toBe(previousReport)
    await versionDb`UPDATE work_runs SET status='failed', cleanup_state='cleaned', active=false WHERE id=${continuedTask.run.id}`
    await versionDb`UPDATE work_tasks SET status='failed' WHERE id=${task.id}`
    expect((await (await send(`/api/artifacts/${versionId}/content`)).json()).markdown).toBe(previousReport)
    const another = await Promise.all([
      send(`/api/tasks/${task.id}/runs`, 'POST', { ...continueBody, requestId: crypto.randomUUID(), content: '第二次修改 A' }),
      send(`/api/tasks/${task.id}/runs`, 'POST', { ...continueBody, requestId: crypto.randomUUID(), content: '第二次修改 B' }),
    ])
    expect(another.map(item => item.status).sort()).toEqual([201, 409])
    expect((await (await send(`/api/tasks/${task.id}`)).json()).runs).toHaveLength(3)
    await versionDb.close()
  } finally {
    app.stop(true)
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`)
    await admin.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})
