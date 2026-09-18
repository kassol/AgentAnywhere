import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { lookup } from 'node:dns/promises'
import { execFileSync } from 'node:child_process'

const base = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19112'
const fixture = process.env.TEST_FIXTURE_ORIGIN || 'http://127.0.0.1:19113'
const controlOrigin = process.env.TEST_CONTROL_PLANE_ORIGIN
assert.ok(controlOrigin, 'TEST_CONTROL_PLANE_ORIGIN must match the queue configuration')
const password = (await readFile(process.env.TEST_PASSWORD_FILE || '/opt/agentanywhere-r1/test-password', 'utf8')).trim()
const login = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
assert.equal(login.status, 204)
const cookie = login.headers.get('set-cookie')?.split(';')[0]
assert.ok(cookie)
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json()
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(data)}`)
  return data
}
async function waitFor(check) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const result = await check()
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('Research run timeout')
}
await api('/api/model-connection', 'PUT', { endpoint: 'http://model-fixture:3002/v1', apiKey: 'fixture-only' })
await api('/api/model-connection/models', 'PUT', { defaultModel: 'fixture-research', models: ['fixture-research', 'fixture-url', 'fixture-rejected', 'fixture-control-ip'].map(id => ({ id, protocol: 'chat-completions', overrides: { contextWindow: 128000, maxTokens: 1024, input: ['text'], reasoning: false, tools: true } })) })
const theme = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '研究 Example Domain，并标出搜索引擎失败', modelId: 'fixture-research' })
await waitFor(async () => (await (await fetch(`${fixture}/waiting-search`)).json()).count > 0)
const during = await api(`/api/tasks/${theme.id}/events`)
assert.ok(during.some(item => item.type === 'tool.started' && item.payload.name === 'search_web'))
assert.ok(!during.some(item => item.type === 'tool.completed' && item.payload.name === 'search_web'))
assert.equal((await fetch(`${fixture}/release-search`, { method: 'POST' })).status, 200)
const url = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '读取指定公开网页并交付引用报告', sourceUrl: 'https://example.com/', modelId: 'fixture-url' })
const rejected = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '验证私网链接被拒绝', modelId: 'fixture-rejected' })
const controlIp = (await lookup(new URL(controlOrigin).hostname, { family: 4 })).address
const control = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '验证控制面公网 IP 被拒绝', sourceUrl: `http://${controlIp}/`, modelId: 'fixture-control-ip' })
for (const item of [theme, url]) {
  const detail = await waitFor(async () => {
    const value = await api(`/api/tasks/${item.id}`)
    return value.run.status === 'succeeded' && value.run.cleanupState === 'cleaned' ? value : null
  })
  const events = await api(`/api/tasks/${item.id}/events`)
  assert.ok(events.some(event => event.type === 'tool.completed' && event.payload.name === 'open_public_page' && !event.payload.isError && event.payload.result.includes('page_body')))
  assert.ok(events.some(event => event.type === 'tool.completed' && event.payload.name === 'submit_report' && !event.payload.isError))
  if (item.id === theme.id) assert.ok(events.some(event => event.type === 'tool.completed' && event.payload.name === 'search_web' && event.payload.result.includes('CAPTCHA')))
  const report = detail.artifacts.find(artifact => artifact.kind === 'report')
  assert.ok(report)
  assert.match((await api(`/api/artifacts/${report.versionId}/content`)).markdown, /https:\/\/example.com\//)
}
await waitFor(async () => {
  const detail = await api(`/api/tasks/${rejected.id}`)
  return detail.run.status === 'succeeded' && detail.run.cleanupState === 'cleaned'
})
const rejectedEvents = await api(`/api/tasks/${rejected.id}/events`)
assert.ok(rejectedEvents.some(event => event.type === 'tool.completed' && event.payload.name === 'open_public_page' && event.payload.isError && /非公开地址/.test(event.payload.result)))
await waitFor(async () => {
  const detail = await api(`/api/tasks/${control.id}`)
  return detail.run.status === 'succeeded' && detail.run.cleanupState === 'cleaned'
})
const controlEvents = await api(`/api/tasks/${control.id}/events`)
assert.ok(controlEvents.some(event => event.type === 'tool.completed' && event.payload.name === 'open_public_page' && event.payload.isError && /控制面/.test(event.payload.result)))
const runs = [theme, url, rejected, control].map(item => item.run.id)
const checkSandboxes = `import { SandboxManager } from '@alibaba-group/opensandbox';
const manager = SandboxManager.create({ connectionConfig: { domain: process.env.OPEN_SANDBOX_DOMAIN, protocol: 'http', apiKey: process.env.OPEN_SANDBOX_API_KEY, useServerProxy: true, disableMetrics: true } });
for (const runId of process.argv.slice(1)) {
  const result = await manager.listSandboxInfos({ metadata: { runId }, pageSize: 100 });
  if (result.items.some(item => item.status.state !== 'Deleted')) throw new Error('Sandbox still active for ' + runId);
}`
execFileSync('docker', ['exec', 'agentanywhere-r1-test-queue-1', 'node', '--input-type=module', '-e', checkSandboxes, ...runs], { stdio: 'pipe' })
console.log(JSON.stringify({ tasks: [theme.id, url.id, rejected.id, control.id], runs, theme: 'succeeded', sourceUrl: 'succeeded', privateUrl: 'rejected', controlIp: 'rejected', searchPendingObserved: true, reportPersisted: true, sandboxes: 'none-active' }))
