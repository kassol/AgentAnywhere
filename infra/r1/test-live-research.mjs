import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const base = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19114'
const password = (await readFile(process.env.TEST_PASSWORD_FILE || '/opt/agentanywhere-r1/test-password', 'utf8')).trim()
const login = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
assert.equal(login.status, 204)
const cookie = login.headers.get('set-cookie')?.split(';')[0]
assert.ok(cookie)
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const value = await response.json()
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${value.error || ''}`)
  return value
}
const connection = await api('/api/model-connection')
assert.ok(connection.models.some(model => model.id === 'gpt-6-astra' && model.protocol === 'chat-completions'))
async function research(goal, sourceUrl, requiredTool) {
  const created = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal, ...(sourceUrl ? { sourceUrl } : {}), modelId: 'gpt-6-astra' })
  let detail
  for (let attempt = 0; attempt < 240; attempt++) {
    detail = await api(`/api/tasks/${created.id}`)
    if (['succeeded', 'failed', 'lost', 'save_failed'].includes(detail.run.status) && detail.run.cleanupState === 'cleaned') break
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  assert.equal(detail.run.status, 'succeeded', `Run ${created.run.id}: ${detail.run.failure || 'did not finish'}`)
  assert.equal(detail.run.cleanupState, 'cleaned')
  const events = await api(`/api/tasks/${created.id}/events`)
  const result = events.find(event => event.type === 'tool.completed' && event.payload.name === requiredTool && !event.payload.isError)
  assert.ok(result, `${requiredTool} did not complete`)
  const report = detail.artifacts.find(item => item.kind === 'report')
  assert.ok(report)
  const markdown = (await api(`/api/artifacts/${report.versionId}/content`)).markdown
  assert.match(markdown, /https?:\/\//)
  return { taskId: created.id, runId: created.run.id, events, result: JSON.parse(result.payload.result), markdown }
}
const theme = await research('请用 search_web 调研 SearXNG 的搜索 API。报告列出真实来源标题、URL、搜索摘要和可核查的事实，区分摘要与正文，并注明部分失败引擎。请保持简短。', null, 'search_web')
assert.ok(theme.result.results.length > 0)
const source = await research('请读取指定来源，用中文简述网页正文并在报告引用该 URL。', 'https://example.com/', 'open_public_page')
assert.equal(source.result.source, 'page_body')
assert.match(source.markdown, /https:\/\/example\.com\//)
const checkSandboxes = `import { SandboxManager } from '@alibaba-group/opensandbox';
const manager = SandboxManager.create({ connectionConfig: { domain: process.env.OPEN_SANDBOX_DOMAIN, protocol: 'http', apiKey: process.env.OPEN_SANDBOX_API_KEY, useServerProxy: true, disableMetrics: true } });
for (const runId of process.argv.slice(1)) {
  const result = await manager.listSandboxInfos({ metadata: { runId }, pageSize: 100 });
  if (result.items.some(item => item.status.state !== 'Deleted')) throw new Error('Sandbox still active for ' + runId);
}`
execFileSync('docker', ['exec', 'agentanywhere-r1-live-test-queue-1', 'node', '--input-type=module', '-e', checkSandboxes, theme.runId, source.runId], { stdio: 'pipe' })
console.log(JSON.stringify({ theme: { taskId: theme.taskId, runId: theme.runId, results: theme.result.results.length, failedEngines: theme.result.unresponsiveEngines.length }, sourceUrl: { taskId: source.taskId, runId: source.runId, characters: source.result.text.length }, reports: 'persisted', sandboxes: 'none-active' }))
