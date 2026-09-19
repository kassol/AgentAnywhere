import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const base = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19112'
const fixture = process.env.TEST_FIXTURE_ORIGIN || 'http://127.0.0.1:19113'
assert.equal(base, 'http://127.0.0.1:19112', 'Use the isolated test stack')
const password = (await readFile(process.env.TEST_PASSWORD_FILE || '/opt/agentanywhere-r1/test-password', 'utf8')).trim()
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
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out: ${label}`)
}
const models = ['fixture-slow', 'fixture-cancel-chat', 'fixture-cancel-responses', 'fixture-steward-control-chat', 'fixture-steward-control-responses', 'fixture-ask'].map(id => ({
  id, protocol: id.endsWith('responses') ? 'responses' : 'chat-completions',
  overrides: { contextWindow: 128000, maxTokens: 8192, input: ['text'], reasoning: false, tools: true },
}))
async function configure(protocol = 'chat-completions') {
  await api('/api/model-connection/models', 'PUT', { defaultModel: models[0].id, models, researchModelPool: [],
    stewardModel: { modelId: protocol === 'responses' ? models[4].id : models[3].id, protocol } })
}
await api('/api/model-connection', 'PUT', { endpoint: 'http://model-fixture:3002/v1', apiKey: 'fixture-only' })
await configure()
async function startControl(content) {
  const thread = await api('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })
  const request = { requestId: crypto.randomUUID(), content }
  const turn = await api(`/api/steward/threads/${thread.id}/turns`, 'POST', request)
  assert.equal((await api(`/api/steward/threads/${thread.id}/turns`, 'POST', request)).id, turn.id)
  return { thread, turn }
}
const terminal = item => item.turns.length && !['queued', 'running', 'stopping'].includes(item.turns.at(-1).status)
async function control(content) {
  const { thread } = await startControl(content)
  return until(() => api(`/api/steward/threads/${thread.id}`), terminal, 'control round')
}
const beforeCalls = (await fetch(`${fixture}/calls`).then(response => response.json())).length
const steered = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: 'R2_CONTROL_STEER：提交简短报告。', modelId: 'fixture-slow' })
await until(() => api(`/api/tasks/${steered.id}/events`), events => events.some(event => event.type === 'message.delta'), 'stream before steering')
const requirement = 'R2_CONTROL_STEER 最终报告包含 STEERING_MARKER_12。'
const addition = `向工作 ${steered.id} 追加要求：${requirement}`
const steering = await control(addition)
assert.equal(steering.turns.at(-1).status, 'completed')
assert.equal(steering.controlOperations.length, 1)
assert.equal(steering.controlOperations[0].status, 'accepted')
assert.equal(steering.controlOperations[0].result.messageStatus, 'pending')
const completed = await until(() => api(`/api/tasks/${steered.id}`), item => item.run.status === 'succeeded' && item.run.cleanupState === 'cleaned', 'steered report and cleanup')
assert.equal(completed.thread.messages.filter(message => message.content === requirement).length, 1)
assert.equal(completed.thread.messages.find(message => message.content === requirement).status, 'applied')
assert.equal((await api(`/api/steward/threads/${steering.id}`)).controlOperations[0].messageStatus, 'applied')
const report = completed.artifacts.find(item => item.kind === 'report')
assert.match((await api(`/api/artifacts/${report.versionId}/content`)).markdown, /STEERING_MARKER_12/)
const researchCalls = (await fetch(`${fixture}/calls`).then(response => response.json())).slice(beforeCalls).filter(call => call.model === 'fixture-slow')
assert.ok(researchCalls.slice(0, 3).every(call => !call.userMessages.some(message => message.includes('STEERING_MARKER_12'))))
assert.ok(researchCalls[3].userMessages.some(message => message.includes('STEERING_MARKER_12')))
const waiting = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '先询问一个问题，再等待用户回答。', modelId: 'fixture-ask' })
await until(() => api(`/api/tasks/${waiting.id}`), item => item.run.status === 'waiting' && item.run.cleanupState === 'cleaned', 'waiting work')
const rejectedSteer = await control(`向工作 ${waiting.id} 追加要求：R2_CONTROL_STEER 保持等待。`)
assert.equal(rejectedSteer.controlOperations[0].status, 'failed')
assert.equal(rejectedSteer.controlOperations[0].failure, '当前 Run 不在执行中')
await api(`/api/tasks/${waiting.id}/cancel`, 'POST')
await until(() => api(`/api/tasks/${waiting.id}`), item => item.run.status === 'cancelled' && item.run.cleanupState === 'cleaned', 'rejected steer target cleanup')
const cancelled = []
const replacementRuns = []
for (const protocol of ['chat-completions', 'responses']) {
  await configure(protocol)
  const task = protocol === 'chat-completions'
    ? await api(`/api/tasks/${steered.id}/runs`, 'POST', { requestId: crypto.randomUUID(), content: 'R2_CONTROL_CANCEL：继续研究，等待取消。', modelId: models[1].id, protocol })
    : await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: 'R2_CONTROL_CANCEL：保持执行直至收到取消。', modelId: models[2].id, protocol })
  await until(() => fetch(`${fixture}/waiting-model`).then(response => response.json()), item => item.count > 0, 'long research executing')
  const hold = protocol === 'chat-completions'
  const started = await startControl(`取消工作 ${task.id}。`)
  let result = await until(() => api(`/api/steward/threads/${started.thread.id}`), item => hold ? item.controlOperations.some(operation => operation.status === 'accepted') : terminal(item), 'cancel receipt')
  if (!hold) assert.equal(result.turns.at(-1).status, 'completed')
  assert.equal(result.controlOperations[0].status, 'accepted')
  assert.equal(result.controlOperations[0].taskId, task.id)
  assert.equal(result.controlOperations[0].runId, task.run.id)
  assert.ok(result.relatedTasks.some(item => item.id === task.id))
  await until(() => api(`/api/tasks/${task.id}`), item => item.run.status === 'cancelled' && item.run.cleanupState === 'cleaned', 'cancel and cleanup')
  if (hold) {
    const operationId = result.controlOperations[0].operationId
    execFileSync('docker', ['kill', '--signal=KILL', 'agentanywhere-r1-test-web-1'], { stdio: 'pipe' })
    execFileSync('docker', ['start', 'agentanywhere-r1-test-web-1'], { stdio: 'pipe' })
    await until(async () => { try { return (await fetch(`${base}/login`)).ok } catch { return false } }, Boolean, 'web restart')
    const relogin = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
    assert.equal(relogin.status, 204)
    cookie = relogin.headers.get('set-cookie')?.split(';')[0]
    result = await api(`/api/steward/threads/${started.thread.id}`)
    assert.equal(result.turns.at(-1).status, 'interrupted')
    const oldEvents = await api(`/api/tasks/${task.id}/events`)
    assert.equal(oldEvents.filter(event => event.type === 'run.cancel_requested').length, 1)
    const replacement = await api(`/api/tasks/${task.id}/runs`, 'POST', { requestId: crypto.randomUUID(), content: '新一轮独立修改，保持执行。', modelId: models[1].id, protocol })
    await until(() => api(`/api/tasks/${task.id}`), item => item.run.id === replacement.run.id && item.run.status === 'running', 'replacement Run')
    await api(`/api/steward/threads/${started.thread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content: `继续取消回执 ${operationId}` })
    result = await until(() => api(`/api/steward/threads/${started.thread.id}`), terminal, 'control receipt replay')
    assert.equal(result.turns.at(-1).status, 'completed')
    assert.equal(result.controlOperations.length, 1)
    assert.equal(result.controlOperations[0].operationId, operationId)
    assert.equal(result.controlOperations[0].status, 'accepted')
    const current = await api(`/api/tasks/${task.id}`)
    assert.equal(current.run.id, replacement.run.id)
    assert.equal(current.run.status, 'running')
    assert.equal(current.runs.length, 3)
    assert.equal(result.controlOperations[0].result.runId, task.run.id)
    assert.equal((await api(`/api/tasks/${task.id}/events`)).filter(event => event.type === 'run.cancel_requested').length, 0)
    await api(`/api/tasks/${task.id}/cancel`, 'POST')
    await until(() => api(`/api/tasks/${task.id}`), item => item.run.status === 'cancelled' && item.run.cleanupState === 'cleaned', 'replacement cleanup')
    replacementRuns.push(replacement.run.id)
  }
  await until(() => fetch(`${fixture}/waiting-model`).then(response => response.json()), item => item.count === 0, 'upstream abort')
  cancelled.push({ taskId: task.id, runId: task.run.id, threadId: result.id })
}
await configure()
const ambiguousTasks = []
for (let index = 0; index < 2; index++) ambiguousTasks.push(await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: 'R2_CONTROL_AMBIGUOUS：同名控制目标。', modelId: models[1].id }))
const ambiguous = await control('取消工作 R2_CONTROL_AMBIGUOUS。')
assert.equal(ambiguous.relatedTasks.length, 0)
assert.ok(ambiguous.controlOperations.every(operation => operation.status !== 'accepted'))
for (const task of ambiguousTasks) {
  assert.ok(['queued', 'provisioning', 'running'].includes((await api(`/api/tasks/${task.id}`)).run.status))
  await api(`/api/tasks/${task.id}/cancel`, 'POST')
  await until(() => api(`/api/tasks/${task.id}`), item => item.run.status === 'cancelled' && ['none', 'cleaned'].includes(item.run.cleanupState), 'ambiguous target cleanup')
}
const checkSandboxes = `import { SandboxManager } from '@alibaba-group/opensandbox';
const manager = SandboxManager.create({ connectionConfig: { domain: process.env.OPEN_SANDBOX_DOMAIN, protocol: 'http', apiKey: process.env.OPEN_SANDBOX_API_KEY, useServerProxy: true, disableMetrics: true } });
for (const runId of process.argv.slice(1)) {
  const result = await manager.listSandboxInfos({ metadata: { runId }, pageSize: 100 });
  if (result.items.some(item => item.status.state !== 'Deleted')) throw new Error('Sandbox still active for ' + runId);
}`
execFileSync('docker', ['exec', 'agentanywhere-r1-test-queue-1', 'node', '--input-type=module', '-e', checkSandboxes, steered.run.id, waiting.run.id, ...cancelled.map(item => item.runId), ...replacementRuns, ...ambiguousTasks.map(task => task.run.id)], { stdio: 'pipe' })
console.log(JSON.stringify({ steering: steering.id, applied: true, cancelled, ambiguous: ambiguous.id, receiptReplay: true, protocols: 'both', sandboxes: 'none-active' }))
