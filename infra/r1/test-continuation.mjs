import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const base = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19112'
const fixture = process.env.TEST_FIXTURE_ORIGIN || 'http://127.0.0.1:19113'
const password = (await readFile(process.env.TEST_PASSWORD_FILE || '/opt/agentanywhere/runtime/test-password', 'utf8')).trim()
const before = (await (await fetch(`${fixture}/calls`)).json()).length
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
  return { value, status: response.status }
}
async function settled(id) {
  for (let attempt = 0; attempt < 240; attempt++) {
    const { value } = await api(`/api/tasks/${id}`)
    if (['succeeded', 'failed', 'lost', 'cancelled'].includes(value.run.status) && value.run.cleanupState === 'cleaned') return value
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`Run did not settle: ${id}`)
}
async function bytes(versionId) {
  const response = await fetch(`${base}/api/artifacts/${versionId}/download`, { headers: { cookie } })
  assert.equal(response.status, 200)
  return Buffer.from(await response.arrayBuffer())
}

await api('/api/model-connection', 'PUT', { endpoint: 'http://model-fixture:3002/v1', apiKey: 'fixture-only' })
await api('/api/model-connection/models', 'PUT', { defaultModel: 'fixture-continuation', models: [
  { id: 'fixture-continuation', protocol: 'chat-completions', overrides: { contextWindow: 128000, maxTokens: 1024, input: ['text'], reasoning: false, tools: true } },
  { id: 'fixture-responses-error', protocol: 'responses', overrides: { contextWindow: 128000, maxTokens: 1024, input: ['text'], reasoning: false, tools: true } },
] })
const { value: created } = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: 'Call echo_observation with fixture observation, then submit a report.', modelId: 'fixture-continuation' })
const first = await settled(created.id)
assert.equal(first.run.status, 'succeeded')
const initial = first.artifacts.find(item => item.kind === 'report')
assert.ok(initial)
const initialBytes = await bytes(initial.versionId)
const initialHash = createHash('sha256').update(initialBytes).digest('hex')
assert.equal(initialHash, initial.sha256)
assert.ok(!initialBytes.toString('utf8').includes('CONTINUATION_MARKER_16'))

const request = { requestId: crypto.randomUUID(), content: '请修改上一版报告，加入 CONTINUATION_MARKER_16。', modelId: 'fixture-continuation' }
const { value: continued, status } = await api(`/api/tasks/${created.id}/runs`, 'POST', request)
assert.equal(status, 201)
assert.equal(continued.thread.id, first.thread.id)
assert.notEqual(continued.run.id, first.run.id)
assert.equal(continued.run.previousReportVersionId, initial.versionId)
assert.equal(continued.run.model.id, 'fixture-continuation')
assert.equal((await api(`/api/tasks/${created.id}/runs`, 'POST', request)).status, 200)
const second = await settled(created.id)
assert.equal(second.run.status, 'succeeded')
const reports = second.artifacts.filter(item => item.kind === 'report')
assert.equal(reports.length, 2)
assert.equal(second.runs.length, 2)
const revised = reports.find(item => item.runId === second.run.id)
assert.ok(revised)
assert.match((await api(`/api/artifacts/${revised.versionId}/content`)).value.markdown, /CONTINUATION_MARKER_16/)
assert.deepEqual(await bytes(initial.versionId), initialBytes)
const calls = (await (await fetch(`${fixture}/calls`)).json()).slice(before).filter(item => item.model === 'fixture-continuation')
assert.equal(calls.length, 6)
assert.ok(calls.slice(0, 3).every(item => !item.userMessages.some(message => message.includes('CONTINUATION_MARKER_16'))))
assert.ok(calls.slice(3).every(item => item.userMessages.some(message => message.includes('上一版报告') && message.includes('本次修改要求') && message.includes('CONTINUATION_MARKER_16'))))

const failedRequest = { requestId: crypto.randomUUID(), content: '再次修改报告。', modelId: 'fixture-responses-error' }
const { value: failing } = await api(`/api/tasks/${created.id}/runs`, 'POST', failedRequest)
assert.equal(failing.run.previousReportVersionId, revised.versionId)
const failed = await settled(created.id)
assert.equal(failed.run.status, 'failed')
assert.equal(failed.artifacts.filter(item => item.kind === 'report').length, 2)
assert.deepEqual(await bytes(initial.versionId), initialBytes)
assert.equal(createHash('sha256').update(await bytes(revised.versionId)).digest('hex'), revised.sha256)

execFileSync('docker', ['restart', 'agentanywhere-r1-test-web-1'], { stdio: 'pipe' })
for (let attempt = 0; attempt < 40; attempt++) {
  try { if ((await fetch(`${base}/login`)).ok) break } catch { /* restarting */ }
  await new Promise(resolve => setTimeout(resolve, 500))
}
cookie = await login()
const { value: persisted } = await api(`/api/tasks/${created.id}`)
assert.equal(persisted.runs.length, 3)
assert.equal(persisted.thread.id, first.thread.id)
assert.deepEqual(await bytes(initial.versionId), initialBytes)
assert.equal(createHash('sha256').update(await bytes(revised.versionId)).digest('hex'), revised.sha256)
const checkSandboxes = `import { SandboxManager } from '@alibaba-group/opensandbox';
const manager = SandboxManager.create({ connectionConfig: { domain: process.env.OPEN_SANDBOX_DOMAIN, protocol: 'http', apiKey: process.env.OPEN_SANDBOX_API_KEY, useServerProxy: true, disableMetrics: true } });
for (const runId of process.argv.slice(1)) {
  const result = await manager.listSandboxInfos({ metadata: { runId }, pageSize: 100 });
  if (result.items.some(item => item.status.state !== 'Deleted')) throw new Error('Sandbox still active for ' + runId);
}`
execFileSync('docker', ['exec', 'agentanywhere-r1-test-queue-1', 'node', '--input-type=module', '-e', checkSandboxes, first.run.id, second.run.id, failed.run.id], { stdio: 'pipe' })
console.log(JSON.stringify({ taskId: created.id, threadId: first.thread.id, runs: persisted.runs.length, reportVersions: 2, failedRunRetainedReports: true, restartVerified: true, sandboxes: 'none-active' }))
