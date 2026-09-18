import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const base = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19112'
const fixture = process.env.TEST_FIXTURE_ORIGIN || 'http://127.0.0.1:19113'
const password = (await readFile(process.env.TEST_PASSWORD_FILE || '/opt/agentanywhere-r1/test-password', 'utf8')).trim()
async function login() {
  const response = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
  assert.equal(response.status, 204)
  return response.headers.get('set-cookie')?.split(';')[0]
}
let cookie = await login()
assert.ok(cookie)
function checkSandbox(runId) {
  const script = `import { SandboxManager } from '@alibaba-group/opensandbox';
const manager = SandboxManager.create({ connectionConfig: { domain: process.env.OPEN_SANDBOX_DOMAIN, protocol: 'http', apiKey: process.env.OPEN_SANDBOX_API_KEY, useServerProxy: true, disableMetrics: true } });
const result = await manager.listSandboxInfos({ metadata: { runId: process.argv[1] }, pageSize: 100 });
if (result.items.some(item => item.status.state !== 'Deleted')) throw new Error('Sandbox still active');`
  execFileSync('docker', ['exec', 'agentanywhere-r1-test-queue-1', 'node', '--input-type=module', '-e', script, runId], { stdio: 'pipe' })
}
async function api(path, method = 'GET', body, expected) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const value = await response.json()
  if (expected === undefined) assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(value)}`)
  else assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}`)
  return value
}
async function until(taskId, wanted) {
  for (let attempt = 0; attempt < 180; attempt++) {
    const detail = await api(`/api/tasks/${taskId}`)
    if (detail.run.status === wanted && (wanted !== 'waiting' || detail.run.cleanupState === 'cleaned')) return detail
    assert.ok(!['failed', 'lost', 'save_failed'].includes(detail.run.status), JSON.stringify(detail.run))
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`${taskId} did not reach ${wanted}`)
}
const before = (await (await fetch(`${fixture}/calls`)).json()).length
await api('/api/model-connection', 'PUT', { endpoint: 'http://model-fixture:3002/v1', apiKey: 'fixture-only' })
await api('/api/model-connection/models', 'PUT', { defaultModel: 'fixture-ask', models: [
  { id: 'fixture-ask', protocol: 'chat-completions', overrides: { contextWindow: 128000, maxTokens: 1024, input: ['text'], reasoning: false, tools: true } },
  { id: 'fixture-chat', protocol: 'chat-completions', overrides: { contextWindow: 128000, maxTokens: 1024, input: ['text'], reasoning: false, tools: true } },
  { id: 'fixture-double-ask', protocol: 'chat-completions', overrides: { contextWindow: 128000, maxTokens: 1024, input: ['text'], reasoning: false, tools: true } },
] })
const first = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '先观察，再提问，按回答提交报告。', modelId: 'fixture-ask' })
const waiting = await until(first.id, 'waiting')
assert.equal(waiting.interaction.question, '请确认研究方向？')
assert.equal(waiting.interaction.status, 'pending')
assert.equal(waiting.run.epoch, 1)
assert.equal(waiting.run.cleanupState, 'cleaned')
checkSandbox(first.run.id)
const waitingEvents = await api(`/api/tasks/${first.id}/events`)
assert.ok(waitingEvents.some(event => event.type === 'tool.completed' && event.payload.name === 'submit_report' && !event.payload.isError), 'zero-byte attachment checkpoint was not saved')
execFileSync('docker', ['restart', 'agentanywhere-r1-test-web-1'], { stdio: 'pipe' })
for (let attempt = 0; attempt < 40; attempt++) {
  try { if ((await fetch(`${base}/login`)).ok) break } catch { /* restarting */ }
  await new Promise(resolve => setTimeout(resolve, 500))
}
cookie = await login()
const persisted = await api(`/api/tasks/${first.id}`)
assert.equal(persisted.run.status, 'waiting')
assert.equal(persisted.interaction.id, waiting.interaction.id)
assert.equal(persisted.interaction.status, 'pending')
await api(`/api/interactions/${waiting.interaction.id}/resolve`, 'POST', { answer: ' ' }, 400)
assert.equal((await api(`/api/tasks/${first.id}`)).run.status, 'waiting')
const second = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '提交另一份简短报告。', modelId: 'fixture-chat' })
await until(second.id, 'succeeded')
assert.equal((await api(`/api/tasks/${first.id}`)).run.status, 'waiting')
await api(`/api/interactions/${waiting.interaction.id}/resolve`, 'POST', { answer: 'ANSWER_MARKER_13：研究机制' }, 202)
await api(`/api/interactions/${waiting.interaction.id}/resolve`, 'POST', { answer: 'ANSWER_MARKER_13：研究机制' }, 200)
await api(`/api/interactions/${waiting.interaction.id}/resolve`, 'POST', { answer: '另一答案' }, 409)
const completed = await until(first.id, 'succeeded')
assert.equal(completed.run.epoch, 2)
assert.equal(completed.run.cleanupState, 'cleaned')
checkSandbox(first.run.id)
const report = completed.artifacts.find(item => item.kind === 'report')
assert.ok(report)
const content = await api(`/api/artifacts/${report.versionId}/content`)
assert.match(content.markdown, /ANSWER_MARKER_13/)
assert.match(content.markdown, /fixture observation/)
const events = await api(`/api/tasks/${first.id}/events`)
assert.deepEqual(events.filter(event => event.type === 'worker.ready').map(event => event.epoch), [1, 2])
assert.equal(events.filter(event => event.type === 'tool.started' && event.payload.name === 'echo_observation').length, 1)
assert.equal(events.filter(event => event.type === 'interaction.requested').length, 1)
const calls = (await (await fetch(`${fixture}/calls`)).json()).slice(before).filter(call => call.model === 'fixture-ask')
assert.equal(calls.filter(call => call.observation.some(item => item.includes('fixture observation'))).length >= 1, true)
const double = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '提问一次。', modelId: 'fixture-double-ask' })
const doubleWaiting = await until(double.id, 'waiting')
assert.equal(doubleWaiting.interaction.question, '请确认第一项？')
const doubleEvents = (await api(`/api/tasks/${double.id}/events`)).filter(event => event.type === 'tool.completed' && event.payload.name === 'ask_user')
assert.equal(doubleEvents.length, 2)
assert.equal(doubleEvents.filter(event => !event.payload.isError).length, 1)
assert.match(doubleEvents.find(event => event.payload.isError).payload.result, /已有待回答问题/)
checkSandbox(double.run.id)
await api(`/api/tasks/${double.id}/cancel`, 'POST', undefined, 202)
console.log(JSON.stringify({ taskId: first.id, runId: first.run.id, waitingEpoch: 1, finalEpoch: completed.run.epoch, otherWorkSucceeded: true, report: report.versionId, waitingSandbox: 'none-active', restartPersisted: true, doubleAsk: 'first-kept-second-rejected' }))
