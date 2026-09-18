import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const base = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19112'
const fixture = process.env.TEST_FIXTURE_ORIGIN || 'http://127.0.0.1:19113'
const password = (await readFile(process.env.TEST_PASSWORD_FILE || '/opt/agentanywhere-r1/test-password', 'utf8')).trim()
const login = async () => {
  const response = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
  assert.equal(response.status, 204)
  return response.headers.get('set-cookie')?.split(';')[0]
}
let cookie = await login()
async function api(path, method = 'GET', body, expected) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const value = await response.json()
  if (expected === undefined) assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(value)}`)
  else assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}`)
  return value
}
async function until(taskId, wanted) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const detail = await api(`/api/tasks/${taskId}`)
    if (detail.run.status === wanted && detail.run.cleanupState === 'cleaned') return detail
    if (detail.run.status === 'save_failed') throw new Error(JSON.stringify(detail.run))
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`${taskId} did not reach ${wanted}`)
}
function noSandbox(runId) {
  const script = `import { SandboxManager } from '@alibaba-group/opensandbox';
const manager = SandboxManager.create({ connectionConfig: { domain: process.env.OPEN_SANDBOX_DOMAIN, protocol: 'http', apiKey: process.env.OPEN_SANDBOX_API_KEY, useServerProxy: true, disableMetrics: true } });
const result = await manager.listSandboxInfos({ metadata: { runId: process.argv[1] }, pageSize: 100 });
if (result.items.some(item => item.status.state !== 'Deleted')) throw new Error('Sandbox still active');`
  execFileSync('docker', ['exec', 'agentanywhere-r1-test-queue-1', 'node', '--input-type=module', '-e', script, runId], { stdio: 'pipe' })
}

await api('/api/model-connection', 'PUT', { endpoint: 'http://model-fixture:3002/v1', apiKey: 'fixture-only' })
await api('/api/model-connection/models', 'PUT', { defaultModel: 'fixture-transient', models: ['fixture-transient', 'fixture-retry', 'fixture-interrupt', 'fixture-limit'].map(id => ({
  id, protocol: 'chat-completions', overrides: { contextWindow: 128000, maxTokens: 1024, input: ['text'], reasoning: false, tools: true },
})) })
const create = modelId => api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '先观察再提交报告。', modelId })
const before = (await (await fetch(`${fixture}/calls`)).json()).length

const transient = await create('fixture-transient')
await until(transient.id, 'succeeded')
const transientEvents = await api(`/api/tasks/${transient.id}/events`)
assert.equal(transientEvents.filter(event => event.type === 'tool.started' && event.payload.name === 'echo_observation').length, 1)
noSandbox(transient.run.id)

const broken = await create('fixture-retry')
const failed = await until(broken.id, 'failed')
assert.match(failed.run.failure, /fixture persistent failure/)
assert.equal(failed.artifacts.length, 0)
noSandbox(broken.run.id)
const retried = await api(`/api/tasks/${broken.id}/retry`, 'POST', { requestId: crypto.randomUUID() })
assert.equal(retried.run.retryOfRunId, broken.run.id)
assert.notEqual(retried.run.id, broken.run.id)
await until(broken.id, 'succeeded')
const retryEvents = await api(`/api/tasks/${broken.id}/events`)
assert.equal(retryEvents.filter(event => event.type === 'tool.started' && event.payload.name === 'echo_observation').length, 0)
noSandbox(retried.run.id)

const interrupted = await create('fixture-interrupt')
let holding = false
for (let attempt = 0; attempt < 80; attempt++) {
  const detail = await api(`/api/tasks/${interrupted.id}`)
  const waitingModel = await (await fetch(`${fixture}/waiting-model`)).json()
  if (detail.run.status === 'running' && waitingModel.count > 0) { holding = true; break }
  await new Promise(resolve => setTimeout(resolve, 500))
}
assert.equal(holding, true)
execFileSync('docker', ['restart', 'agentanywhere-r1-test-queue-1'], { stdio: 'pipe' })
await until(interrupted.id, 'lost')
noSandbox(interrupted.run.id)
const recovered = await api(`/api/tasks/${interrupted.id}/retry`, 'POST', { requestId: crypto.randomUUID() })
assert.equal(recovered.run.retryOfRunId, interrupted.run.id)
await until(interrupted.id, 'succeeded')
noSandbox(recovered.run.id)

const limited = await create('fixture-limit')
const waiting = await until(limited.id, 'waiting')
assert.equal(waiting.interaction.kind, 'limit')
assert.equal(waiting.run.modelCalls, 40)
assert.equal(waiting.run.budgetReason, 'rounds')
noSandbox(limited.run.id)
await api(`/api/interactions/${waiting.interaction.id}/resolve`, 'POST', { answer: 'continue' }, 202)
const completed = await until(limited.id, 'succeeded')
assert.equal(completed.run.modelCallLimit, 80)
assert.equal(completed.run.epoch, 2)
const decisions = (await api(`/api/tasks/${limited.id}/events`)).filter(event => event.type === 'run.limit_decided')
assert.equal(decisions.length, 1)
assert.deepEqual([decisions[0].payload.previousModelCallLimit, decisions[0].payload.modelCallLimit], [40, 80])
noSandbox(limited.run.id)

const calls = (await (await fetch(`${fixture}/calls`)).json()).slice(before)
assert.equal(calls.filter(call => call.model === 'fixture-transient' && call.observation.some(item => item.includes('fixture observation'))).length >= 2, true)
assert.equal(calls.filter(call => call.model === 'fixture-retry' && call.observation.length === 0).length, 1)
console.log(JSON.stringify({ transient: 'retried-without-tool-replay', failure: 'checkpoint-retried', interrupted: 'manual-retry', modelLimit: '40-then-explicit-continue', sandboxes: 'none-active' }))
