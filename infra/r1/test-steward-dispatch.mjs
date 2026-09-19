import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const base = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19112'
const fixture = process.env.TEST_FIXTURE_ORIGIN || 'http://127.0.0.1:19113'
assert.equal(base, 'http://127.0.0.1:19112', 'Use the isolated test stack')
const password = (await readFile(process.env.TEST_PASSWORD_FILE || '/opt/agentanywhere-r1/test-password', 'utf8')).trim()
const login = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
assert.equal(login.status, 204)
const cookie = login.headers.get('set-cookie')?.split(';')[0]
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const value = await response.json()
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${JSON.stringify(value)}`)
  return value
}
async function until(read, ready, label) {
  for (let i = 0; i < 360; i++) {
    const result = await read()
    if (ready(result)) return result
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out: ${label}`)
}
const models = ['fixture-split', 'fixture-responses', 'fixture-outside-pool', 'fixture-steward-dispatch-chat', 'fixture-steward-dispatch-responses'].map(id => ({
  id, protocol: id.endsWith('responses') ? 'responses' : 'chat-completions',
  overrides: { contextWindow: 128000, maxTokens: 8192, input: ['text'], reasoning: false, tools: true },
}))
async function configure(protocol = 'chat-completions', pool = ['fixture-split', 'fixture-responses']) {
  await api('/api/model-connection/models', 'PUT', {
    defaultModel: models[0].id, models, researchModelPool: pool,
    stewardModel: { modelId: protocol === 'responses' ? models[4].id : models[3].id, protocol },
  })
}
await api('/api/model-connection', 'PUT', { endpoint: 'http://model-fixture:3002/v1', apiKey: 'fixture-only' })
await configure()
const accepted = item => item.researchOperations.filter(operation => operation.status === 'accepted')
const terminal = item => item.turns.length && !['queued', 'running', 'stopping'].includes(item.turns.at(-1).status)
async function start(content) {
  const thread = await api('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })
  const request = { requestId: crypto.randomUUID(), content }
  const turn = await api(`/api/steward/threads/${thread.id}/turns`, 'POST', request)
  assert.equal((await api(`/api/steward/threads/${thread.id}/turns`, 'POST', request)).id, turn.id)
  return { thread, turn }
}
async function finished(content) {
  const { thread } = await start(content)
  return until(() => api(`/api/steward/threads/${thread.id}`), terminal, content)
}
const initialCount = (await api('/api/tasks')).length
const repeated = await finished('R2_DISPATCH_REPEAT：分别调研两个主题，每项生成独立报告。')
assert.equal(repeated.turns.at(-1).status, 'completed')
assert.equal(accepted(repeated).length, 2)
assert.equal(repeated.relatedTasks.length, 2)
assert.equal((await api('/api/tasks')).length, initialCount + 2)
assert.deepEqual(accepted(repeated).map(item => item.modelId), ['fixture-split', 'fixture-responses'])
for (const operation of accepted(repeated)) {
  assert.ok(operation.taskId && operation.runId && operation.reason && operation.verification)
}
await configure('responses')
const dual = await finished('R2_DISPATCH：分别调研两个主题，每项生成独立报告。')
assert.equal(dual.turns.at(-1).status, 'completed')
assert.equal(accepted(dual).length, 2)
const limited = await finished('R2_DISPATCH_FOUR：分别创建四项独立调研，每项生成报告。')
assert.equal(accepted(limited).length, 3)
assert.equal(limited.turns.at(-1).status, 'limited')
assert.ok(limited.researchOperations.some(item => item.status !== 'accepted'))
await configure()
const stopping = await start('R2_DISPATCH_STOP：分别调研两个主题，每项生成独立报告。')
await until(() => fetch(`${fixture}/waiting-model`).then(response => response.json()), item => item.count > 0, 'first accepted before stop')
await api(`/api/steward/turns/${stopping.turn.id}/stop`, 'POST')
const stopped = await until(() => api(`/api/steward/threads/${stopping.thread.id}`), terminal, 'stopped turn')
assert.equal(stopped.turns.at(-1).status, 'stopped')
assert.equal(accepted(stopped).length, 1)
const beforeRejected = (await api('/api/tasks')).length
const outside = await finished('R2_DISPATCH_OUTSIDE：分别调研两个主题，每项生成独立报告。')
assert.equal(accepted(outside).length, 0)
await configure('chat-completions', [])
const empty = await finished('R2_DISPATCH：分别调研两个主题，每项生成独立报告。')
assert.equal(accepted(empty).length, 0)
assert.equal((await api('/api/tasks')).length, beforeRejected)
for (const operation of [...accepted(repeated), ...accepted(dual), ...accepted(limited), ...accepted(stopped)]) {
  const task = await until(() => api(`/api/tasks/${operation.taskId}`), item => ['succeeded', 'failed', 'lost', 'save_failed'].includes(item.run.status) && item.run.cleanupState === 'cleaned', 'research completion')
  assert.equal(task.run.id, operation.runId)
  assert.equal(task.run.status, 'succeeded')
  assert.equal(task.runs.length, 1)
  assert.equal(task.artifacts.filter(item => item.kind === 'report').length, 1)
}
console.log(JSON.stringify({ protocols: 'both', repeated: repeated.id, dual: dual.id, limited: limited.id, stopped: stopped.id, acceptedTasks: 8, emptyPool: empty.id, outsidePool: outside.id }))
