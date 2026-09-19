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
const models = ['fixture-ask', 'fixture-limit', 'fixture-retry', 'fixture-split', 'fixture-responses', 'fixture-steward-query-chat', 'fixture-steward-dispatch-chat'].map(id => ({
  id, protocol: id === 'fixture-responses' ? 'responses' : 'chat-completions',
  overrides: { contextWindow: 128000, maxTokens: 8192, input: ['text'], reasoning: false, tools: true },
}))
async function configure(stewardModel) {
  await api('/api/model-connection/models', 'PUT', {
    defaultModel: 'fixture-ask', models, researchModelPool: ['fixture-split', 'fixture-responses'],
    stewardModel: { modelId: stewardModel, protocol: 'chat-completions' },
  })
}
async function work(taskId, statuses) {
  return until(() => api(`/api/tasks/${taskId}`), detail => statuses.includes(detail.run.status) && detail.run.cleanupState === 'cleaned', `${taskId} ${statuses.join('/')}`)
}
async function conversation(content) {
  const thread = await api('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })
  const turn = await api(`/api/steward/threads/${thread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content })
  return until(() => api(`/api/steward/threads/${thread.id}`), detail => detail.turns.some(item => item.id === turn.id && !['queued', 'running', 'stopping'].includes(item.status)), content)
}
function onlyCard(detail, id) {
  const cards = detail.statusCards.filter(card => card.id === id)
  assert.equal(cards.length, 1, `${id}: ${JSON.stringify(detail.statusCards)}`)
  return cards[0]
}

await api('/api/model-connection', 'PUT', { endpoint: 'http://model-fixture:3002/v1', apiKey: 'fixture-only' })
await configure('fixture-steward-query-chat')
const initialPending = new Set((await api('/api/interactions/pending')).map(item => item.id))

const asked = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '先观察，再提问，按回答提交报告。', modelId: 'fixture-ask' })
const waiting = await work(asked.id, ['waiting'])
assert.equal(waiting.interaction.kind, 'question')
assert.equal((await api('/api/interactions/pending')).filter(item => item.id === waiting.interaction.id).length, 1)
const first = await conversation(`R2_QUERY_READ：解读工作 ${asked.id} 的当前状态。`)
const second = await conversation(`R2_QUERY_READ：再次解读工作 ${asked.id} 的当前状态。`)
const interactionCardId = `interaction:${waiting.interaction.id}`
for (const detail of [first, second]) {
  const card = onlyCard(detail, interactionCardId)
  assert.equal(card.interaction.status, 'pending')
  assert.equal(card.taskId, asked.id)
  assert.equal(card.runId, asked.run.id)
}
const unrelated = await api('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })
assert.deepEqual((await api(`/api/steward/threads/${unrelated.id}`)).statusCards, [])

execFileSync('docker', ['restart', 'agentanywhere-r1-test-web-1'], { stdio: 'pipe' })
await until(async () => { try { return (await fetch(`${base}/login`)).ok } catch { return false } }, Boolean, 'web restart')
cookie = await login()
assert.equal(onlyCard(await api(`/api/steward/threads/${first.id}`), interactionCardId).interaction.status, 'pending')
assert.equal((await api('/api/interactions/pending')).filter(item => item.id === waiting.interaction.id).length, 1)

await api(`/api/interactions/${waiting.interaction.id}/resolve`, 'POST', { answer: '机制方向' }, 202)
assert.ok(!(await api('/api/interactions/pending')).some(item => item.id === waiting.interaction.id))
assert.equal(onlyCard(await api(`/api/steward/threads/${second.id}`), interactionCardId).interaction.status, 'answered')
const completed = await work(asked.id, ['succeeded'])
noSandbox(completed.run.id)
for (const threadId of [first.id, second.id]) {
  const detail = await api(`/api/steward/threads/${threadId}`)
  const card = onlyCard(detail, `run:${completed.run.id}`)
  assert.equal(card.kind, 'completed')
  assert.equal(card.reports.length, 1)
  assert.equal(onlyCard(detail, interactionCardId).interaction.status, 'answered')
  assert.ok(detail.statusCards.findIndex(item => item.id === interactionCardId) < detail.statusCards.findIndex(item => item.id === `run:${completed.run.id}`), 'completion follows the earlier question')
}

const limitedTask = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '持续观察直到额度等待。', modelId: 'fixture-limit' })
const limitWaiting = await work(limitedTask.id, ['waiting'])
assert.equal(limitWaiting.interaction.kind, 'limit')
const limitThread = await conversation(`R2_QUERY_READ：解读工作 ${limitedTask.id} 的当前状态。`)
const limitCardId = `interaction:${limitWaiting.interaction.id}`
assert.equal(onlyCard(limitThread, limitCardId).interaction.kind, 'limit')
await api(`/api/interactions/${limitWaiting.interaction.id}/resolve`, 'POST', { answer: 'finish' }, 202)
const limitFinished = await work(limitedTask.id, ['cancelled'])
assert.equal(onlyCard(await api(`/api/steward/threads/${limitThread.id}`), limitCardId).interaction.status, 'answered')
assert.ok(!(await api('/api/interactions/pending')).some(item => item.id === limitWaiting.interaction.id))
noSandbox(limitFinished.run.id)

const broken = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '观察后触发可见失败。', modelId: 'fixture-retry' })
const failed = await work(broken.id, ['failed'])
const failedThread = await conversation(`R2_QUERY_READ：解读工作 ${broken.id} 的当前状态。`)
const failedCard = onlyCard(failedThread, `run:${failed.run.id}`)
assert.equal(failedCard.kind, 'failed')
assert.match(failedCard.failure, /fixture persistent failure/)
noSandbox(failed.run.id)

await configure('fixture-steward-dispatch-chat')
const dispatched = await conversation('R2_DISPATCH：分别调研两个主题，每项生成独立报告。')
const accepted = dispatched.researchOperations.filter(operation => operation.status === 'accepted')
assert.equal(accepted.length, 2)
assert.deepEqual(dispatched.relatedTasks.map(task => task.id).sort(), accepted.map(operation => operation.taskId).sort())
for (const operation of accepted) {
  const settled = await work(operation.taskId, ['succeeded'])
  noSandbox(settled.run.id)
}
const delivered = await api(`/api/steward/threads/${dispatched.id}`)
for (const operation of accepted) assert.equal(onlyCard(delivered, `run:${operation.runId}`).kind, 'completed')

console.log(JSON.stringify({ linkedThreads: [first.id, second.id], interaction: waiting.interaction.id, limit: limitWaiting.interaction.id,
  failed: failed.run.id, dispatched: accepted.map(operation => operation.taskId), preexistingPending: initialPending.size, sandboxes: 'none-active' }))
