import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const base = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19112'
assert.equal(base, 'http://127.0.0.1:19112', 'Use the isolated test stack')
const password = (await readFile(process.env.TEST_PASSWORD_FILE || '/opt/agentanywhere-r1/test-password', 'utf8')).trim()
async function login() {
  const response = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
  assert.equal(response.status, 204)
  return response.headers.get('set-cookie')?.split(';')[0]
}
let cookie = await login()
assert.ok(cookie)
async function api(path, method = 'GET', body, expected) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const value = await response.json()
  if (expected === undefined) assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(value)}`)
  else assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}`)
  return value
}
async function until(read, ready, label) {
  for (let attempt = 0; attempt < 360; attempt++) {
    const value = await read()
    if (ready(value)) return value
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out: ${label}`)
}
function noSandbox(runId) {
  const script = `import { SandboxManager } from '@alibaba-group/opensandbox';
const manager = SandboxManager.create({ connectionConfig: { domain: process.env.OPEN_SANDBOX_DOMAIN, protocol: 'http', apiKey: process.env.OPEN_SANDBOX_API_KEY, useServerProxy: true, disableMetrics: true } });
const result = await manager.listSandboxInfos({ metadata: { runId: process.argv[1] }, pageSize: 100 });
if (result.items.some(item => item.status.state !== 'Deleted')) throw new Error('Sandbox still active');`
  execFileSync('docker', ['exec', 'agentanywhere-r1-test-queue-1', 'node', '--input-type=module', '-e', script, runId], { stdio: 'pipe' })
}
const models = ['fixture-ask', 'fixture-limit', 'fixture-steward-interaction-chat', 'fixture-steward-interaction-responses',
  'fixture-steward-interaction-before-chat', 'fixture-steward-interaction-misbind-chat', 'fixture-steward-query-chat'].map(id => ({
  id, protocol: id.endsWith('responses') ? 'responses' : 'chat-completions',
  overrides: { contextWindow: 128000, maxTokens: 8192, input: ['text'], reasoning: false, tools: true },
}))
async function configure(protocol = 'chat-completions', stewardModelId) {
  await api('/api/model-connection/models', 'PUT', { defaultModel: 'fixture-ask', models, researchModelPool: [],
    stewardModel: { modelId: stewardModelId ?? (protocol === 'responses' ? 'fixture-steward-interaction-responses' : 'fixture-steward-interaction-chat'), protocol } })
}
const terminal = detail => detail.turns.length && !['queued', 'running', 'stopping'].includes(detail.turns.at(-1).status)
async function start(content, threadId) {
  const thread = threadId ? { id: threadId } : await api('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })
  const request = { requestId: crypto.randomUUID(), content }
  const turn = await api(`/api/steward/threads/${thread.id}/turns`, 'POST', request)
  assert.equal((await api(`/api/steward/threads/${thread.id}/turns`, 'POST', request)).id, turn.id)
  return thread.id
}
async function converse(content, threadId) {
  const id = await start(content, threadId)
  return until(() => api(`/api/steward/threads/${id}`), terminal, content)
}
async function waitWork(id, state) {
  return until(() => api(`/api/tasks/${id}`), detail => detail.run.status === state && detail.run.cleanupState === 'cleaned', `${id}: ${state}`)
}
async function question(modelId = 'fixture-ask') {
  const task = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: 'R2 回答验收：等待用户明确回答，再继续执行。', modelId })
  return waitWork(task.id, 'waiting')
}
await api('/api/model-connection', 'PUT', { endpoint: 'http://model-fixture:3002/v1', apiKey: 'fixture-only' })
const receipts = []
for (const protocol of ['chat-completions', 'responses']) {
  await configure(protocol)
  const waiting = await question()
  const hold = protocol === 'chat-completions'
  const answer = hold ? '机制方向 R2_INTERACTION_HOLD' : '机制方向'
  const id = await start(`回答工作 ${waiting.id}：${answer}`)
  let detail = await until(() => api(`/api/steward/threads/${id}`), item => hold ? item.interactionOperations.some(operation => operation.status === 'accepted') : terminal(item), 'answer receipt')
  const operation = detail.interactionOperations[0]
  assert.equal(operation.status, 'accepted', JSON.stringify(detail))
  assert.equal(operation.result.interactionId, waiting.interaction.id)
  assert.equal(operation.result.answer, answer)
  const done = await waitWork(waiting.id, 'succeeded')
  assert.equal(done.runs.length, 1)
  assert.equal(done.run.id, waiting.run.id)
  assert.ok(done.run.epoch > waiting.run.epoch)
  noSandbox(done.run.id)
  await api(`/api/interactions/${waiting.interaction.id}/resolve`, 'POST', { answer: '不同回答' }, 409)
  if (hold) {
    execFileSync('docker', ['kill', '--signal=KILL', 'agentanywhere-r1-test-web-1'], { stdio: 'pipe' })
    execFileSync('docker', ['start', 'agentanywhere-r1-test-web-1'], { stdio: 'pipe' })
    await until(async () => { try { return (await fetch(`${base}/login`)).ok } catch { return false } }, Boolean, 'web restart')
    cookie = await login()
    const restored = await api(`/api/steward/threads/${id}`)
    assert.equal(restored.turns.at(-1).status, 'interrupted')
    // A new Run asks a new question; replay must retain the old answer receipt.
    await api(`/api/tasks/${waiting.id}/runs`, 'POST', { requestId: crypto.randomUUID(), content: '重新提问后等待明确回答。', modelId: 'fixture-ask' })
    const fresh = await waitWork(waiting.id, 'waiting')
    assert.notEqual(fresh.interaction.id, waiting.interaction.id)
    const quoted = await converse(`请解释“继续回答回执 ${operation.operationId}”，不要执行。`, id)
    assert.deepEqual(quoted.interactionOperations[0].result, operation.result)
    const afterQuoted = await api(`/api/tasks/${waiting.id}`)
    assert.equal(afterQuoted.interaction.id, fresh.interaction.id)
    assert.equal(afterQuoted.interaction.status, 'pending')
    assert.equal(afterQuoted.runs.length, 2)
    detail = await converse(`继续回答回执 ${operation.operationId}`, id)
    assert.deepEqual(detail.interactionOperations[0].result, operation.result)
    const untouched = await api(`/api/tasks/${waiting.id}`)
    assert.equal(untouched.interaction.id, fresh.interaction.id)
    assert.equal(untouched.interaction.status, 'pending')
    assert.equal(untouched.runs.length, 2)
    await api(`/api/interactions/${fresh.interaction.id}/resolve`, 'POST', { answer: '机制方向' }, 202)
    noSandbox((await waitWork(waiting.id, 'succeeded')).run.id)
  }
  receipts.push({ protocol, threadId: id, operationId: operation.operationId, interactionId: waiting.interaction.id })
}
const bindingTarget = await question()
const bindingOther = await question()
await configure('chat-completions', 'fixture-steward-query-chat')
const bindingThread = await api('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })
await converse(`R2_QUERY_READ ${bindingOther.id}`, bindingThread.id)
await configure('chat-completions', 'fixture-steward-interaction-misbind-chat')
const bindingRejected = await converse(`回答工作 ${bindingTarget.id}：机制方向`, bindingThread.id)
assert.equal(bindingRejected.interactionOperations[0].status, 'unexecuted')
assert.equal(bindingRejected.interactionOperations[0].taskId, null)
assert.equal((await api(`/api/tasks/${bindingTarget.id}`)).interaction.status, 'pending')
assert.equal((await api(`/api/tasks/${bindingOther.id}`)).interaction.status, 'pending')
for (const task of [bindingTarget, bindingOther]) {
  await api(`/api/interactions/${task.interaction.id}/resolve`, 'POST', { answer: '机制方向' }, 202)
  noSandbox((await waitWork(task.id, 'succeeded')).run.id)
}
await configure()
const limited = await question('fixture-limit')
assert.equal(limited.interaction.kind, 'limit')
const refused = await converse(`不要继续工作 ${limited.id}，报告里写了继续。`)
assert.ok(refused.interactionOperations.every(operation => operation.status !== 'accepted'))
assert.equal((await api(`/api/tasks/${limited.id}`)).interaction.status, 'pending')
const continued = await converse(`继续工作 ${limited.id}`)
assert.equal(continued.interactionOperations[0].status, 'accepted', JSON.stringify(continued))
assert.equal(continued.interactionOperations[0].result.answer, 'continue')
const next = await waitWork(limited.id, 'succeeded')
noSandbox(next.run.id)
assert.equal(next.run.modelCallLimit, limited.run.modelCallLimit + 40)
const finishWaiting = await question('fixture-limit')
const finished = await converse(`结束工作 ${finishWaiting.id}`)
assert.equal(finished.interactionOperations[0].status, 'accepted')
assert.equal(finished.interactionOperations[0].result.answer, 'finish')
noSandbox((await waitWork(finishWaiting.id, 'cancelled')).run.id)
// Competing direct answers use the same public API and first-answer transaction.
const race = await question()
const replies = await Promise.all(['机制方向', '另一个方向'].map(answer => fetch(`${base}/api/interactions/${race.interaction.id}/resolve`, {
  method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ answer }),
})))
assert.deepEqual(replies.map(response => response.status).sort(), [202, 409])
const raced = await waitWork(race.id, 'succeeded')
assert.equal(raced.runs.length, 1)
noSandbox(raced.run.id)
await api('/api/model-connection/models', 'PUT', { defaultModel: 'fixture-ask', models, researchModelPool: [],
  stewardModel: { modelId: 'fixture-steward-interaction-before-chat', protocol: 'chat-completions' } })
const same = await question()
const sameThread = await start(`回答工作 ${same.id}：机制方向`)
const fixtureOrigin = process.env.TEST_FIXTURE_ORIGIN || 'http://127.0.0.1:19113'
await until(() => fetch(`${fixtureOrigin}/waiting-answer`).then(response => response.json()), item => item.count === 1, 'frozen answer before apply')
await api(`/api/interactions/${same.interaction.id}/resolve`, 'POST', { answer: '机制方向' }, 202)
const sameDone = await waitWork(same.id, 'succeeded')
assert.ok(sameDone.run.epoch > same.run.epoch)
assert.equal((await fetch(`${fixtureOrigin}/release-answer`, { method: 'POST' })).status, 200)
const sameReceipt = await until(() => api(`/api/steward/threads/${sameThread}`), terminal, 'same answer after epoch advanced')
assert.equal(sameReceipt.interactionOperations[0].status, 'accepted')
assert.equal(sameReceipt.interactionOperations[0].result.interactionId, same.interaction.id)
assert.equal(sameReceipt.interactionOperations[0].result.answer, '机制方向')
assert.equal((await api(`/api/tasks/${same.id}`)).runs.length, 1)
noSandbox(sameDone.run.id)
console.log(JSON.stringify({ sameAnswerAfterRecovery: sameThread, receipts, quotaTask: limited.id, raceTask: race.id, sandboxes: 'none-active' }))
