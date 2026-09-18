import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

const base = 'http://127.0.0.1:19114'
const protocol = process.env.TEST_PROTOCOL || 'chat-completions'
const password = (await readFile('/opt/agentanywhere-r1/test-password', 'utf8')).trim()
const login = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
assert.equal(login.status, 204)
const cookie = login.headers.get('set-cookie')?.split(';')[0]
assert.ok(cookie)
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const value = await response.json()
  assert.ok(response.ok, `${path}: ${response.status} ${value.error ?? ''}`)
  return value
}

const connection = await api('/api/model-connection')
assert.ok(connection.models.some(model => model.id === 'gpt-6-astra' && model.protocol === protocol))
assert.deepEqual(await api('/api/model-connection/test', 'POST', { modelId: 'gpt-6-astra', protocol }), { ok: true, modelId: 'gpt-6-astra', protocol })
const created = await api('/api/tasks', 'POST', {
  requestId: crypto.randomUUID(), modelId: 'gpt-6-astra',
  goal: 'Use echo_observation once with the text "real gateway observation". Then give one concise sentence about the returned observation.',
})
let detail
for (let attempt = 0; attempt < 150; attempt++) {
  detail = await api(`/api/tasks/${created.id}`)
  if (['succeeded', 'failed', 'lost'].includes(detail.run.status) && detail.run.cleanupState === 'cleaned') break
  await new Promise(resolve => setTimeout(resolve, 1000))
}
assert.equal(detail.run.cleanupState, 'cleaned')
assert.equal(detail.run.model.protocol, protocol)
const events = await api(`/api/tasks/${created.id}/events`)
assert.equal(detail.run.status, 'succeeded', `Run failed: ${detail.run.failure ?? 'unknown'}`)
assert.ok(events.some(event => event.type === 'tool.started' && event.payload.name === 'echo_observation'))
assert.ok(events.some(event => event.type === 'tool.completed' && event.payload.result.includes('real gateway observation') && !event.payload.isError))
assert.ok(events.some(event => event.type === 'message.completed' && event.payload.content.trim()))
assert.ok(events.some(event => event.type === 'run.finished'))
const check = `import { SandboxManager } from '@alibaba-group/opensandbox';
const manager = SandboxManager.create({ connectionConfig: { domain: process.env.OPEN_SANDBOX_DOMAIN, protocol: 'http', apiKey: process.env.OPEN_SANDBOX_API_KEY, useServerProxy: true, disableMetrics: true } });
const result = await manager.listSandboxInfos({ metadata: { runId: process.argv[1] }, pageSize: 100 });
if (result.items.some(item => item.status.state !== 'Deleted')) throw new Error('Sandbox still active');`
execFileSync('docker', ['exec', 'agentanywhere-r1-live-test-queue-1', 'node', '--input-type=module', '-e', check, detail.run.id], { stdio: 'pipe' })
console.log(JSON.stringify({ modelId: 'gpt-6-astra', protocol, status: detail.run.status, cleanup: detail.run.cleanupState, toolRoundTrip: true, persistedEvents: events.length }))
