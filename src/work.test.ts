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
if (!databaseUrl) throw new Error('AGENTANYWHERE_TEST_DATABASE_URL is required for the public work API regression')

test('owner creates one persisted queued work request through the public API', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agentanywhere-work-'))
  const schema = `work_test_${crypto.randomUUID().replaceAll('-', '')}`
  const admin = new SQL(databaseUrl!)
  await admin.unsafe(`CREATE SCHEMA ${schema}`)
  const isolatedUrl = new URL(databaseUrl!)
  isolatedUrl.searchParams.set('options', `-csearch_path=${schema}`)
  const testDatabaseUrl = isolatedUrl.toString()
  const password = 'test-password-12345'
  let clock = Date.now()
  let app = await startServer({ password, port: 0, dataDir, databaseUrl: testDatabaseUrl, testNow: () => clock })
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
    app = await startServer({ password, port: 0, dataDir, databaseUrl: testDatabaseUrl, testNow: () => clock })
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
      await proxyDb`UPDATE work_runs SET active=false, status='cancelled' WHERE id=${broken.run.id}`
      const limited = await (await send('/api/tasks', 'POST', { ...body, requestId: crypto.randomUUID() })).json()
      await proxyDb`UPDATE work_runs SET status='running', active=true, epoch=1, model_calls=39,
        run_token_hash=${createHash('sha256').update(token).digest('hex')} WHERE id=${limited.run.id}`
      const limitedProxy = `/internal/runs/${limited.run.id}/1/v1/chat/completions`
      const modelRequest = () => fetch(`${base}${limitedProxy}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'test-model', stream: true }) })
      const fortieth = await modelRequest()
      expect(fortieth.status).toBe(200)
      await expect(fortieth.text()).rejects.toThrow()
      expect((await modelRequest()).status).toBe(409)
      expect((await send(`/api/tasks/${limited.id}`)).json()).resolves.toMatchObject({ run: { modelCalls: 40, modelCallLimit: 40, budgetReason: 'rounds' } })
      await proxyDb`UPDATE work_runs SET active=false, status='failed' WHERE id=${limited.run.id}`
      const timed = await (await send('/api/tasks', 'POST', { ...body, requestId: crypto.randomUUID() })).json()
      await proxyDb`UPDATE work_runs SET status='running', active=true, epoch=1, active_since=${new Date(clock)},
        run_token_hash=${createHash('sha256').update(token).digest('hex')} WHERE id=${timed.run.id}`
      clock += 45 * 60_000
      const timedProxy = `/internal/runs/${timed.run.id}/1/v1/chat/completions`
      expect((await fetch(`${base}${timedProxy}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'test-model', stream: true }) })).status).toBe(409)
      expect((await send(`/api/tasks/${timed.id}`)).json()).resolves.toMatchObject({ run: { modelCalls: 0, budgetReason: 'time' } })
      await proxyDb`UPDATE work_runs SET active=false, status='failed' WHERE id=${timed.run.id}`
      const large = await (await send('/api/tasks', 'POST', { ...body, requestId: crypto.randomUUID() })).json()
      await proxyDb`UPDATE work_runs SET status='running', active=true, epoch=1,
        run_token_hash=${createHash('sha256').update(token).digest('hex')} WHERE id=${large.run.id}`
      const largeResponse = await fetch(`${base}/internal/runs/${large.run.id}/1/v1/chat/completions`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'test-model', stream: true, messages: [{ role: 'user', content: 'a'.repeat(1_300_000) }] }),
      })
      expect(largeResponse.status).toBe(200)
      await largeResponse.body?.cancel()
      await proxyDb`UPDATE work_runs SET active=false, status='failed' WHERE id=${large.run.id}`
    } finally { upstream.stop(true); await proxyDb.close() }
    expect((await send('/api/model-connection', 'PUT', { endpoint: 'https://replacement.example/v1', apiKey: 'new-private-secret' })).status).toBe(200)
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
    const failed = await (await send('/api/tasks', 'POST', { ...body, requestId: crypto.randomUUID() })).json()
    const retryCommandId = crypto.randomUUID()
    await versionDb`UPDATE work_runs SET status='running', active=true, epoch=1 WHERE id=${failed.run.id}`
    expect((await send(`/api/runs/${failed.run.id}/messages`, 'POST', { commandId: retryCommandId, kind: 'steer', content: '失败前追加的要求' })).status).toBe(201)
    const savedCheckpoint = { epoch: 1, files: [{ name: 'session.jsonl', size: 7, sha256: 'saved' }] }
    const savedContext = { messages: ['已有资料'], instruction: '修改报告' }
    await versionDb`UPDATE work_runs SET status='failed', active=false, cleanup_state='cleaned', checkpoint_ref=${JSON.stringify(savedCheckpoint)}::jsonb,
      context_snapshot=${JSON.stringify(savedContext)}::text::jsonb WHERE id=${failed.run.id}`
    await versionDb`UPDATE work_tasks SET status='failed' WHERE id=${failed.id}`
    await send('/api/model-connection', 'PUT', { endpoint: 'https://later.example/v1', apiKey: 'later-private-secret' })
    const retryBody = { requestId: crypto.randomUUID() }
    const retried = await send(`/api/tasks/${failed.id}/retry`, 'POST', retryBody)
    expect(retried.status).toBe(201)
    const retryTask = await retried.json()
    expect(retryTask).toMatchObject({ id: failed.id, status: 'queued', run: { status: 'queued', retryOfRunId: failed.run.id, model: { endpoint: 'https://replacement.example/v1' } }, runs: [{ id: failed.run.id }, { id: retryTask.run.id }] })
    expect(retryTask.run.id).not.toBe(failed.run.id)
    expect((await versionDb`SELECT jsonb_typeof(model_snapshot) AS model_type,
      jsonb_typeof(context_snapshot) AS context_type, jsonb_typeof(checkpoint_ref) AS checkpoint_type
      FROM work_runs WHERE id=${retryTask.run.id}`)[0]).toMatchObject({ model_type: 'object', context_type: 'object', checkpoint_type: 'object' })
    expect((await send(`/api/tasks/${failed.id}/retry`, 'POST', retryBody)).status).toBe(200)
    expect((await send(`/api/tasks/${failed.id}/retry`, 'POST', { requestId: crypto.randomUUID() })).status).toBe(409)
    await versionDb`UPDATE work_runs SET status='running', active=true, epoch=1,
      run_token_hash=${createHash('sha256').update('retry-token').digest('hex')} WHERE id=${retryTask.run.id}`
    const carried = await fetch(`${base}/internal/runs/${retryTask.run.id}/1/messages`, { headers: { authorization: 'Bearer retry-token' } })
    expect(await carried.json()).toMatchObject([{ content: '失败前追加的要求' }])
    expect((await versionDb`SELECT run_id AS "runId", command_id AS "commandId" FROM work_messages WHERE command_id=${retryCommandId}`)[0])
      .toMatchObject({ runId: retryTask.run.id, commandId: retryCommandId })
    await versionDb`UPDATE work_runs SET status='failed', active=false WHERE id=${retryTask.run.id}`
    const atLimit = await (await send('/api/tasks', 'POST', { ...body, requestId: crypto.randomUUID() })).json()
    const limitId = crypto.randomUUID()
    await versionDb`UPDATE work_runs SET status='waiting', epoch=1, cleanup_state='cleaned', checkpoint_ref=${JSON.stringify(savedCheckpoint)}::jsonb,
      model_calls=40, active_ms=2700000, budget_reason='rounds' WHERE id=${atLimit.run.id}`
    await versionDb`UPDATE work_tasks SET status='waiting' WHERE id=${atLimit.id}`
    await versionDb`INSERT INTO work_interactions (id, run_id, epoch, question, status, kind)
      VALUES (${limitId}, ${atLimit.run.id}, 1, '继续或结束？', 'pending', 'limit')`
    expect((await send(`/api/interactions/${limitId}/resolve`, 'POST', { answer: 'other' })).status).toBe(400)
    expect((await send(`/api/interactions/${limitId}/resolve`, 'POST', { answer: 'continue' })).status).toBe(202)
    expect((await send(`/api/tasks/${atLimit.id}`)).json()).resolves.toMatchObject({ run: { status: 'queued', modelCalls: 40, modelCallLimit: 80, activeMs: 2700000, activeLimitMs: 5400000, budgetReason: null }, interaction: { status: 'answered', kind: 'limit', answer: 'continue' } })
    expect((await send(`/api/interactions/${limitId}/resolve`, 'POST', { answer: 'continue' })).status).toBe(200)
    const toFinish = await (await send('/api/tasks', 'POST', { ...body, requestId: crypto.randomUUID() })).json()
    const finishId = crypto.randomUUID()
    await versionDb`UPDATE work_runs SET status='waiting', epoch=1, cleanup_state='cleaned', checkpoint_ref=${JSON.stringify(savedCheckpoint)}::jsonb,
      model_calls=40, budget_reason='rounds' WHERE id=${toFinish.run.id}`
    await versionDb`UPDATE work_tasks SET status='waiting' WHERE id=${toFinish.id}`
    await versionDb`INSERT INTO work_interactions (id, run_id, epoch, question, status, kind)
      VALUES (${finishId}, ${toFinish.run.id}, 1, '继续或结束？', 'pending', 'limit')`
    expect((await send(`/api/interactions/${finishId}/resolve`, 'POST', { answer: 'finish' })).status).toBe(202)
    expect((await send(`/api/tasks/${toFinish.id}`)).json()).resolves.toMatchObject({ run: { status: 'cancelled', modelCallLimit: 40 }, interaction: { status: 'answered', answer: 'finish' } })
    await versionDb.close()
  } finally {
    app.stop(true)
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`)
    await admin.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})
