import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const base = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19112'
const fixture = process.env.TEST_FIXTURE_ORIGIN || 'http://127.0.0.1:19113'
const previousCalls = (await (await fetch(`${fixture}/calls`)).json()).length
const password = (await readFile(process.env.TEST_PASSWORD_FILE || '/opt/agentanywhere-r1/test-password', 'utf8')).trim()
async function login() {
  const response = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
  assert.equal(response.status, 204)
  return response.headers.get('set-cookie')?.split(';')[0]
}
let cookie = await login()
assert.ok(cookie)
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const value = await response.json()
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(value)}`)
  return value
}

await api('/api/model-connection', 'PUT', { endpoint: 'http://model-fixture:3002/v1', apiKey: 'fixture-only' })
await api('/api/model-connection/models', 'PUT', { defaultModel: 'fixture-slow', models: [...['fixture-slow', 'fixture-mixed', 'fixture-split'].map(id => ({ id, protocol: 'chat-completions' })), ...['fixture-responses', 'fixture-responses-missing', 'fixture-responses-error', 'fixture-responses-stream-error'].map(id => ({ id, protocol: 'responses' }))].map(model => ({ ...model, overrides: { contextWindow: 128000, maxTokens: 1024, input: ['text'], reasoning: false, tools: true } })) })
assert.equal((await fetch(`${base}/api/model-connection/test`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: 'null' })).status, 400)
assert.deepEqual(await api('/api/model-connection/test', 'POST', { modelId: 'fixture-responses', protocol: 'responses' }), { ok: true, modelId: 'fixture-responses', protocol: 'responses' })

async function task(modelId) {
  return api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: 'Call echo_observation with fixture observation, then describe the observation.', modelId })
}
const first = await task('fixture-slow')
const second = await task('fixture-mixed')
const third = await task('fixture-split')
const responseRun = await task('fixture-responses')
const missingRun = await task('fixture-responses-missing')
const errorRun = await task('fixture-responses-error')
const streamErrorRun = await task('fixture-responses-stream-error')
const submitted = [first, second, third, responseRun, missingRun, errorRun, streamErrorRun]
let statuses = []
for (let i = 0; i < 280; i++) {
  const rows = await Promise.all(submitted.map(item => api(`/api/tasks/${item.id}`)))
  statuses.push(rows.map(item => item.run.status))
  if (rows.every(item => ['succeeded', 'failed', 'lost'].includes(item.run.status) && item.run.cleanupState === 'cleaned')) break
  await new Promise(resolve => setTimeout(resolve, 500))
}
const details = await Promise.all(submitted.map(item => api(`/api/tasks/${item.id}`)))
assert.deepEqual(details.map(item => [item.run.status, item.run.cleanupState]), [...Array(5).fill(['succeeded', 'cleaned']), ...Array(2).fill(['failed', 'cleaned'])])
assert.ok(details.slice(3).every(item => item.run.model.protocol === 'responses'))
assert.match(details[5].run.failure, /fixture protocol rejected/)
assert.match(details[6].run.failure, /fixture streamed failure/)
assert.ok(statuses.every(row => row.filter(status => ['provisioning', 'running'].includes(status)).length <= 1))
for (const [index, item] of submitted.entries()) {
  const events = await api(`/api/tasks/${item.id}/events`)
  if (index >= 5) {
    assert.ok(events.some(event => event.type === 'run.failed' && new RegExp(index === 5 ? 'fixture protocol rejected' : 'fixture streamed failure').test(event.payload.error)))
    assert.ok(!events.some(event => event.type === 'run.finished'))
    continue
  }
  assert.ok(events.some(event => event.type === 'tool.started' && event.payload.args.text === 'fixture observation'))
  assert.ok(events.some(event => event.type === 'tool.completed' && event.payload.result === 'fixture observation' && !event.payload.isError))
  assert.ok(events.some(event => event.type === 'tool.started' && event.payload.name === 'submit_report'))
  assert.ok(events.some(event => event.type === 'tool.completed' && event.payload.name === 'submit_report' && !event.payload.isError))
  assert.ok(events.some(event => event.type === 'message.completed' && event.payload.content === 'The fixture observation was returned.'))
  assert.ok(events.some(event => event.type === 'run.finished'))
  assert.equal(new Set(events.map(event => event.eventId)).size, events.length)
  assert.deepEqual(await api(`/api/tasks/${item.id}/events?after=${events.at(-1).serverSeq}`), [])
  const usage = new Map(events.filter(event => event.type === 'usage').map(event => [event.payload.callId, event.payload]))
  assert.equal(usage.size, 3)
  assert.equal(index === 1 || index === 4 ? [...usage.values()].some(item => item.inputTokens === null) : [...usage.values()].every(item => item.inputTokens === 10), true)
}
const calls = (await (await fetch(`${fixture}/calls`)).json()).slice(previousCalls)
for (const model of ['fixture-slow', 'fixture-mixed', 'fixture-split']) {
  const sequence = calls.filter(call => call.model === model)
  assert.equal(sequence.length, 3)
  assert.ok(sequence.some(call => call.observation.includes('fixture observation')))
  assert.ok(sequence.some(call => call.observation.some(item => item.includes('报告已保存'))))
}
for (const model of ['fixture-responses', 'fixture-responses-missing']) {
  const sequence = calls.filter(call => call.model === model && call.stream)
  assert.equal(sequence.length, 3)
  assert.ok(sequence.every(call => call.protocol === 'responses' && call.stream && !call.chatMessages))
  assert.ok(sequence.some(call => call.observation.includes('fixture observation')))
  assert.ok(sequence.some(call => call.observation.some(item => item.includes('报告已保存'))))
}
assert.equal(calls.filter(call => call.model === 'fixture-responses-error').length, 1)
assert.equal(calls.filter(call => call.model === 'fixture-responses-stream-error').length, 1)
const reportHashes = []
for (const item of details.slice(0, 5)) {
  const report = item.artifacts.find(artifact => artifact.kind === 'report')
  const attachment = item.artifacts.find(artifact => artifact.kind === 'attachment')
  assert.ok(report && attachment)
  assert.equal((await fetch(`${base}/api/artifacts/${report.versionId}/content`)).status, 401)
  const content = await api(`/api/artifacts/${report.versionId}/content`)
  assert.match(content.markdown, /https:\/\/example.com\/source/)
  assert.match(content.markdown, /<script>/)
  for (const artifact of [report, attachment]) {
    const download = await fetch(`${base}/api/artifacts/${artifact.versionId}/download`, { headers: { cookie } })
    assert.equal(download.status, 200)
    assert.match(download.headers.get('content-disposition'), /attachment/)
    const bytes = Buffer.from(await download.arrayBuffer())
    assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256)
    reportHashes.push([artifact.versionId, artifact.sha256])
  }
}
assert.ok(details.slice(5).every(item => item.artifacts.length === 0))

execFileSync('docker', ['exec', '-u', 'root', 'agentanywhere-r1-test-queue-1', 'chmod', '500', '/artifacts'])
let blocked
try {
  blocked = await task('fixture-slow')
  for (let i = 0; i < 100; i++) {
    blocked = await api(`/api/tasks/${blocked.id}`)
    if (blocked.run.status === 'save_failed') break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  assert.equal(blocked.run.status, 'save_failed')
  assert.equal(blocked.run.cleanupState, 'blocked')
  assert.equal(blocked.artifacts.length, 0)
  const inspectBlocked = `import { SandboxManager } from '@alibaba-group/opensandbox';
const manager = SandboxManager.create({ connectionConfig: { domain: process.env.OPEN_SANDBOX_DOMAIN, protocol: 'http', apiKey: process.env.OPEN_SANDBOX_API_KEY, useServerProxy: true, disableMetrics: true } });
const result = await manager.listSandboxInfos({ metadata: { runId: process.argv[1] }, pageSize: 100 });
const sandbox = result.items.find(item => item.status.state !== 'Deleted');
if (!sandbox || sandbox.expiresAt != null) throw new Error('Blocked report sandbox has expiration or is missing');
process.stdout.write(JSON.stringify({ sandboxId: sandbox.id }));`
  assert.ok(JSON.parse(execFileSync('docker', ['exec', 'agentanywhere-r1-test-queue-1', 'node', '--input-type=module', '-e', inspectBlocked, blocked.run.id], { encoding: 'utf8' })).sandboxId)
} finally {
  execFileSync('docker', ['exec', '-u', 'root', 'agentanywhere-r1-test-queue-1', 'chmod', '700', '/artifacts'])
}
assert.deepEqual(await api(`/api/tasks/${blocked.id}/cleanup-retry`, 'POST'), { retrying: true })
for (let i = 0; i < 100; i++) {
  blocked = await api(`/api/tasks/${blocked.id}`)
  if (blocked.run.status === 'succeeded' && blocked.run.cleanupState === 'cleaned') break
  await new Promise(resolve => setTimeout(resolve, 500))
}
assert.equal(blocked.run.status, 'succeeded')
assert.equal(blocked.artifacts.length, 2)
reportHashes.push(...blocked.artifacts.map(artifact => [artifact.versionId, artifact.sha256]))
const checkSandboxes = `import { SandboxManager } from '@alibaba-group/opensandbox';
const manager = SandboxManager.create({ connectionConfig: { domain: process.env.OPEN_SANDBOX_DOMAIN, protocol: 'http', apiKey: process.env.OPEN_SANDBOX_API_KEY, useServerProxy: true, disableMetrics: true } });
for (const runId of process.argv.slice(1)) {
  const result = await manager.listSandboxInfos({ metadata: { runId }, pageSize: 100 });
  if (result.items.some(item => item.status.state !== 'Deleted')) throw new Error('Sandbox still active for ' + runId);
}`
execFileSync('docker', ['exec', 'agentanywhere-r1-test-queue-1', 'node', '--input-type=module', '-e', checkSandboxes, ...details.map(item => item.run.id), blocked.run.id], { stdio: 'pipe' })
execFileSync('docker', ['restart', 'agentanywhere-r1-test-web-1'], { stdio: 'pipe' })
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${base}/login`)).ok) break } catch { /* restarting */ }
  await new Promise(resolve => setTimeout(resolve, 500))
}
cookie = await login()
for (const [versionId, expectedHash] of reportHashes) {
  const download = await fetch(`${base}/api/artifacts/${versionId}/download`, { headers: { cookie } })
  assert.equal(download.status, 200)
  assert.equal(createHash('sha256').update(Buffer.from(await download.arrayBuffer())).digest('hex'), expectedHash)
}
console.log(JSON.stringify({ tasks: details.map(item => ({ status: item.run.status, cleanup: item.run.cleanupState })), serial: true, persistedEvents: true, artifacts: reportHashes.length, saveRetry: true, restartVerified: true, sandboxes: 'none-active' }))
