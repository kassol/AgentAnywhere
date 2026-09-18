import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const base = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19112'
const fixture = process.env.TEST_FIXTURE_ORIGIN || 'http://127.0.0.1:19113'
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
await api('/api/model-connection/models', 'PUT', { defaultModel: 'fixture-research', models: ['fixture-research', 'fixture-url'].map(id => ({ id, protocol: 'chat-completions', overrides: { contextWindow: 128000, maxTokens: 1024, input: ['text'], reasoning: false, tools: true } })) })
const theme = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '研究 Example Domain，并标出搜索引擎失败', modelId: 'fixture-research' })
await waitFor(async () => (await (await fetch(`${fixture}/waiting-search`)).json()).count > 0)
const during = await api(`/api/tasks/${theme.id}/events`)
assert.ok(during.some(item => item.type === 'tool.started' && item.payload.name === 'search_web'))
assert.ok(!during.some(item => item.type === 'tool.completed' && item.payload.name === 'search_web'))
assert.equal((await fetch(`${fixture}/release-search`, { method: 'POST' })).status, 200)
const url = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '读取指定公开网页并交付引用报告', sourceUrl: 'https://example.com/', modelId: 'fixture-url' })
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
console.log(JSON.stringify({ theme: 'succeeded', sourceUrl: 'succeeded', searchPendingObserved: true, reportPersisted: true }))
