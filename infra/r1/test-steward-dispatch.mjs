import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const base = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19112'
const fixture = process.env.TEST_FIXTURE_ORIGIN || 'http://127.0.0.1:19113'
assert.equal(base, 'http://127.0.0.1:19112', 'Use the isolated test stack')
const password = (await readFile(process.env.TEST_PASSWORD_FILE || '/opt/agentanywhere/runtime/test-password', 'utf8')).trim()
const login = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
assert.equal(login.status, 204)
let cookie = login.headers.get('set-cookie')?.split(';')[0]
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
const repeated = await finished('分别调研两个主题，每项生成独立报告；R2_DISPATCH_REPEAT。')
assert.equal(repeated.turns.at(-1).status, 'completed')
assert.equal(accepted(repeated).length, 2)
assert.equal(repeated.relatedTasks.length, 2)
assert.equal((await api('/api/tasks')).length, initialCount + 2)
assert.deepEqual(accepted(repeated).map(item => item.modelId), ['fixture-split', 'fixture-responses'])
for (const operation of accepted(repeated)) {
  assert.ok(operation.taskId && operation.runId && operation.reason && operation.verification)
}
const acceptedOperation = repeated.researchOperations[0]
await api(`/api/steward/threads/${repeated.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content: `继续调研回执 ${acceptedOperation.operationId}` })
const replayed = await until(() => api(`/api/steward/threads/${repeated.id}`), terminal, 'accepted research receipt replay')
assert.equal(replayed.researchOperations.length, 2)
assert.equal(replayed.relatedTasks.length, 2)
await configure('responses')
const dual = await finished('分别调研两个主题，每项生成独立报告；R2_DISPATCH。')
assert.equal(dual.turns.at(-1).status, 'completed')
assert.equal(accepted(dual).length, 2)
const limited = await finished('分别创建四项独立调研，每项生成报告；R2_DISPATCH_FOUR。')
assert.equal(accepted(limited).length, 3)
assert.equal(limited.turns.at(-1).status, 'limited')
assert.ok(limited.researchOperations.some(item => item.status !== 'accepted'))
await configure()
const stopping = await start('分别调研两个主题，每项生成独立报告；R2_DISPATCH_STOP。')
await until(() => fetch(`${fixture}/waiting-model`).then(response => response.json()), item => item.count > 0, 'first accepted before stop')
await api(`/api/steward/turns/${stopping.turn.id}/stop`, 'POST')
const stopped = await until(() => api(`/api/steward/threads/${stopping.thread.id}`), terminal, 'stopped turn')
assert.equal(stopped.turns.at(-1).status, 'stopped')
assert.equal(accepted(stopped).length, 1)
for (const operation of [...accepted(repeated), ...accepted(dual), ...accepted(limited), ...accepted(stopped)]) {
  await until(() => api(`/api/tasks/${operation.taskId}`), item => ['succeeded', 'failed', 'lost', 'save_failed'].includes(item.run.status) && item.run.cleanupState === 'cleaned', 'settle research before web crash')
}
const pendingOperationId = stopped.researchOperations.find(item => item.status === 'unexecuted').operationId
await api(`/api/steward/threads/${stopping.thread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content: `请解释“继续调研回执 ${pendingOperationId}”，不要执行。` })
const rejectedResume = await until(() => api(`/api/steward/threads/${stopping.thread.id}`), terminal, 'quoted research receipt rejection')
assert.equal(accepted(rejectedResume).length, 1)
assert.equal(rejectedResume.researchOperations.find(item => item.operationId === pendingOperationId).status, 'unexecuted')
await api(`/api/steward/threads/${stopping.thread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content: `继续调研回执 ${pendingOperationId}` })
await until(() => api(`/api/steward/threads/${stopping.thread.id}`), item => item.researchOperations.some(operation => operation.operationId === pendingOperationId && operation.status === 'planned'), 'resume plan before crash')
execFileSync('docker', ['kill', '--signal=KILL', 'agentanywhere-r1-test-web-1'], { stdio: 'pipe' })
execFileSync('docker', ['start', 'agentanywhere-r1-test-web-1'], { stdio: 'pipe' })
await until(async () => { try { return (await fetch(`${base}/login`)).ok } catch { return false } }, Boolean, 'web restart')
const relogin = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
assert.equal(relogin.status, 204)
cookie = relogin.headers.get('set-cookie')?.split(';')[0]
const interrupted = await api(`/api/steward/threads/${stopping.thread.id}`)
assert.equal(interrupted.turns.at(-1).status, 'interrupted')
assert.equal(interrupted.researchOperations.find(item => item.operationId === pendingOperationId).status, 'unexecuted')
await api(`/api/steward/threads/${stopping.thread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content: `继续调研回执 ${pendingOperationId}` })
const resumed = await until(() => api(`/api/steward/threads/${stopping.thread.id}`), terminal, 'resume after crash')
assert.equal(accepted(resumed).length, 2)
assert.equal(resumed.researchOperations.find(item => item.operationId === pendingOperationId).status, 'accepted')
const beforeRejected = (await api('/api/tasks')).length
const outside = await finished('分别调研两个主题，每项生成独立报告；R2_DISPATCH_OUTSIDE。')
assert.equal(accepted(outside).length, 0)
await configure('chat-completions', [])
const empty = await finished('分别调研两个主题，每项生成独立报告；R2_DISPATCH。')
assert.equal(accepted(empty).length, 0)
assert.equal((await api('/api/tasks')).length, beforeRejected)
for (const operation of [...accepted(repeated), ...accepted(dual), ...accepted(limited), ...accepted(resumed)]) {
  const task = await until(() => api(`/api/tasks/${operation.taskId}`), item => ['succeeded', 'failed', 'lost', 'save_failed'].includes(item.run.status) && item.run.cleanupState === 'cleaned', 'research completion')
  assert.equal(task.run.id, operation.runId)
  assert.equal(task.run.status, 'succeeded')
  assert.equal(task.runs.length, 1)
  assert.equal(task.artifacts.filter(item => item.kind === 'report').length, 1)
}
console.log(JSON.stringify({ protocols: 'both', repeated: repeated.id, dual: dual.id, limited: limited.id, stopped: stopped.id, resumed: resumed.id, acceptedTasks: 9, emptyPool: empty.id, outsidePool: outside.id }))
