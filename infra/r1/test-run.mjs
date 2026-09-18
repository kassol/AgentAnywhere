import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

const base = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19112'
const fixture = process.env.TEST_FIXTURE_ORIGIN || 'http://127.0.0.1:19113'
const previousCalls = (await (await fetch(`${fixture}/calls`)).json()).length
const password = (await readFile(process.env.TEST_PASSWORD_FILE || '/opt/agentanywhere-r1/test-password', 'utf8')).trim()
const login = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
assert.equal(login.status, 204)
const cookie = login.headers.get('set-cookie')?.split(';')[0]
assert.ok(cookie)
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const value = await response.json()
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(value)}`)
  return value
}

await api('/api/model-connection', 'PUT', { endpoint: 'http://model-fixture:3002/v1', apiKey: 'fixture-only' })
await api('/api/model-connection/models', 'PUT', { defaultModel: 'fixture-slow', models: ['fixture-slow', 'fixture-mixed', 'fixture-split'].map(id => ({ id, protocol: 'chat-completions', overrides: { contextWindow: 128000, maxTokens: 1024, input: ['text'], reasoning: false, tools: true } })) })
assert.equal((await fetch(`${base}/api/model-connection/test`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: 'null' })).status, 400)

async function task(modelId) {
  return api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: 'Call echo_observation with fixture observation, then describe the observation.', modelId })
}
const first = await task('fixture-slow')
const second = await task('fixture-mixed')
const third = await task('fixture-split')
const submitted = [first, second, third]
let statuses = []
for (let i = 0; i < 100; i++) {
  const rows = await Promise.all(submitted.map(item => api(`/api/tasks/${item.id}`)))
  statuses.push(rows.map(item => item.run.status))
  if (rows.every(item => ['succeeded', 'failed', 'lost'].includes(item.run.status) && item.run.cleanupState === 'cleaned')) break
  await new Promise(resolve => setTimeout(resolve, 500))
}
const details = await Promise.all(submitted.map(item => api(`/api/tasks/${item.id}`)))
assert.deepEqual(details.map(item => [item.run.status, item.run.cleanupState]), Array(3).fill(['succeeded', 'cleaned']))
assert.ok(statuses.every(row => row.filter(status => ['provisioning', 'running'].includes(status)).length <= 1))
for (const [index, item] of submitted.entries()) {
  const events = await api(`/api/tasks/${item.id}/events`)
  assert.ok(events.some(event => event.type === 'tool.started' && event.payload.args.text === 'fixture observation'))
  assert.ok(events.some(event => event.type === 'tool.completed' && event.payload.result === 'fixture observation' && !event.payload.isError))
  assert.ok(events.some(event => event.type === 'message.completed' && event.payload.content === 'The fixture observation was returned.'))
  assert.ok(events.some(event => event.type === 'run.finished'))
  assert.equal(new Set(events.map(event => event.eventId)).size, events.length)
  assert.deepEqual(await api(`/api/tasks/${item.id}/events?after=${events.at(-1).serverSeq}`), [])
  const usage = new Map(events.filter(event => event.type === 'usage').map(event => [event.payload.callId, event.payload]))
  assert.equal(usage.size, 2)
  assert.equal(index === 1 ? [...usage.values()].some(item => item.inputTokens === null) : [...usage.values()].every(item => item.inputTokens === 10), true)
}
const calls = (await (await fetch(`${fixture}/calls`)).json()).slice(previousCalls)
for (const model of ['fixture-slow', 'fixture-mixed', 'fixture-split']) {
  const pair = calls.filter(call => call.model === model)
  assert.equal(pair.length, 2)
  assert.deepEqual(pair.find(call => call.toolResult)?.observation, ['fixture observation'])
}
const checkSandboxes = `import { SandboxManager } from '@alibaba-group/opensandbox';
const manager = SandboxManager.create({ connectionConfig: { domain: process.env.OPEN_SANDBOX_DOMAIN, protocol: 'http', apiKey: process.env.OPEN_SANDBOX_API_KEY, useServerProxy: true, disableMetrics: true } });
for (const runId of process.argv.slice(1)) {
  const result = await manager.listSandboxInfos({ metadata: { runId }, pageSize: 100 });
  if (result.items.some(item => item.status.state !== 'Deleted')) throw new Error('Sandbox still active for ' + runId);
}`
execFileSync('docker', ['exec', 'agentanywhere-r1-test-queue-1', 'node', '--input-type=module', '-e', checkSandboxes, ...details.map(item => item.run.id)], { stdio: 'pipe' })
console.log(JSON.stringify({ tasks: details.map(item => ({ status: item.run.status, cleanup: item.run.cleanupState })), serial: true, persistedEvents: true, usage: 'known-and-unknown', sandboxes: 'none-active' }))
