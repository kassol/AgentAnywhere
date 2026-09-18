import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

const base = 'http://127.0.0.1:19114'
const password = (await readFile('/opt/agentanywhere-r1/test-password', 'utf8')).trim()
const login = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
assert.equal(login.status, 204)
const cookie = login.headers.get('set-cookie')?.split(';')[0]
assert.ok(cookie)
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const value = await response.json()
  assert.ok(response.ok, `${path}: ${response.status}`)
  return value
}
const created = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: 'Verify startup failure state.', modelId: 'gpt-6-astra' })
const startedAt = Date.now()
let detail
for (let attempt = 0; attempt < 60; attempt++) {
  detail = await api(`/api/tasks/${created.id}`)
  if (detail.run.status === 'failed' && detail.run.cleanupState === 'cleaned') break
  await new Promise(resolve => setTimeout(resolve, 1000))
}
assert.equal(detail.run.status, 'failed')
assert.equal(detail.run.cleanupState, 'cleaned')
assert.ok(Date.now() - startedAt < 60_000)
const events = await api(`/api/tasks/${created.id}/events`)
assert.ok(!events.some(event => event.type === 'worker.ready'))
const check = `import { SandboxManager } from '@alibaba-group/opensandbox';
const manager = SandboxManager.create({ connectionConfig: { domain: process.env.OPEN_SANDBOX_DOMAIN, protocol: 'http', apiKey: process.env.OPEN_SANDBOX_API_KEY, useServerProxy: true, disableMetrics: true } });
const result = await manager.listSandboxInfos({ metadata: { runId: process.argv[1] }, pageSize: 100 });
if (result.items.some(item => item.status.state !== 'Deleted')) throw new Error('Sandbox still active');`
execFileSync('docker', ['exec', 'agentanywhere-r1-live-test-queue-1', 'node', '--input-type=module', '-e', check, detail.run.id], { stdio: 'pipe' })
console.log(JSON.stringify({ status: detail.run.status, cleanup: detail.run.cleanupState, elapsedSeconds: Math.ceil((Date.now() - startedAt) / 1000), workerReady: false, sandboxes: 'none-active' }))
