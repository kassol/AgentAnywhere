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
  assert.ok(response.ok, `${path}: HTTP ${response.status}`)
  return response.json()
}
async function until(read, ready, label) {
  for (let i = 0; i < 240; i++) {
    const result = await read()
    if (ready(result)) return result
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out: ${label}`)
}
const models = ['fixture-steward-malicious-report', 'fixture-steward-query-chat', 'fixture-steward-query-responses'].map(id => ({
  id, protocol: id.endsWith('responses') ? 'responses' : 'chat-completions',
  overrides: { contextWindow: 128000, maxTokens: 8192, input: ['text'], reasoning: false, tools: true },
}))
async function configure(protocol) {
  await api('/api/model-connection/models', 'PUT', {
    defaultModel: models[0].id, models, researchModelPool: [models[0].id],
    stewardModel: { modelId: protocol === 'responses' ? models[2].id : models[1].id, protocol },
  })
}
await api('/api/model-connection', 'PUT', { endpoint: 'http://model-fixture:3002/v1', apiKey: 'fixture-only' })
await configure('chat-completions')
const tasks = []
for (const label of ['A', 'B']) {
  const task = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), modelId: models[0].id, goal: `R2_QUERY_REPORT ${label}: submit the report with its source.` })
  const detail = await until(() => api(`/api/tasks/${task.id}`), item => ['succeeded', 'failed', 'lost', 'save_failed'].includes(item.run.status) && item.run.cleanupState === 'cleaned', `report ${label}`)
  assert.equal(detail.run.status, 'succeeded')
  const report = detail.artifacts.find(item => item.kind === 'report')
  assert.ok(report)
  assert.match((await api(`/api/artifacts/${report.versionId}/content`)).markdown, /R2_REPORT_INJECTION/)
  tasks.push(detail)
}
const taskCount = (await api('/api/tasks')).length
const initialCalls = (await (await fetch(`${fixture}/calls`)).json()).length
async function conversation(content, existing) {
  const thread = existing ?? await api('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })
  const turn = await api(`/api/steward/threads/${thread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content })
  const detail = await until(() => api(`/api/steward/threads/${thread.id}`), item => item.turns.some(item => item.id === turn.id && ['completed', 'failed', 'limited', 'stopped', 'interrupted'].includes(item.status)), 'steward turn')
  return { detail, turn: detail.turns.find(item => item.id === turn.id) }
}
const browsed = await conversation('R2_QUERY_LIST：查找 R2_QUERY_REPORT 历史报告候选，暂不读取。')
assert.equal(browsed.turn.status, 'completed')
assert.deepEqual(browsed.detail.relatedTasks, [])
const first = await conversation(`R2_QUERY_READ：解读工作 ${tasks[0].id} 的最新报告。`, browsed.detail)
assert.equal(first.turn.status, 'completed')
assert.deepEqual(first.detail.relatedTasks.map(item => item.id), [tasks[0].id])
assert.match(first.detail.messages.at(-1).content, /已解读所选报告/)
await configure('responses')
const second = await conversation(`R2_QUERY_READ：解读工作 ${tasks[0].id} 的最新报告。`)
assert.equal(second.turn.status, 'completed')
assert.deepEqual(second.detail.relatedTasks.map(item => item.id), [tasks[0].id])
const compared = await conversation(`R2_QUERY_COMPARE：比较 R2_QUERY_REPORT 工作 ${tasks[0].id} 与 ${tasks[1].id} 的最新报告。`)
assert.equal(compared.turn.status, 'completed')
assert.deepEqual(compared.detail.relatedTasks.map(item => item.id).sort(), tasks.map(item => item.id).sort())
const ambiguous = await conversation('R2_QUERY_AMBIGUOUS：解读那个 R2_QUERY_REPORT 历史报告。')
assert.equal(ambiguous.turn.status, 'completed')
assert.deepEqual(ambiguous.detail.relatedTasks, [])
const limited = await conversation('R2_QUERY_LIMIT：持续查询 R2_QUERY_REPORT 历史报告候选。')
assert.equal(limited.turn.status, 'limited')
assert.equal(limited.turn.budgetReason, 'calls')
assert.equal(limited.turn.modelCalls, 8)
assert.equal((await api('/api/tasks')).length, taskCount)
for (const previous of tasks) {
  const current = await api(`/api/tasks/${previous.id}`)
  assert.equal(current.runs.length, 1)
  assert.equal(current.run.id, previous.run.id)
  assert.equal(current.run.status, 'succeeded')
  assert.deepEqual(current.artifacts.map(item => item.versionId), previous.artifacts.map(item => item.versionId))
}
const calls = (await (await fetch(`${fixture}/calls`)).json()).slice(initialCalls)
assert.ok(calls.some(item => item.protocol === 'chat-completions' && item.name === 'read_frozen_work'))
assert.ok(calls.some(item => item.protocol === 'responses' && item.name === 'read_frozen_work'))
assert.ok(calls.some(item => item.args?.operationId === '11111111-1111-4111-8111-111111111111'), 'The fixture must attempt an unauthorized read')
assert.ok(calls.filter(item => item.planner).every(item => !JSON.stringify(item.outputs).includes('R2_REPORT_INJECTION')), 'Report data entered the authorization planner')
assert.equal(calls.filter(item => item.user?.includes('R2_QUERY_LIMIT')).length, 8)
console.log(JSON.stringify({ protocols: 'both', tasks: tasks.map(item => item.id), linkedThreads: [first.detail.id, second.detail.id], compared: compared.detail.id, candidateOnly: browsed.detail.id, ambiguous: ambiguous.detail.id, budget: limited.turn.modelCalls, newRunsDuringReading: 0 }))
