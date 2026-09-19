import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const base = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19112'
assert.equal(base, 'http://127.0.0.1:19112', 'Use the isolated test stack')
const password = (await readFile(process.env.TEST_PASSWORD_FILE || '/opt/agentanywhere-r1/test-password', 'utf8')).trim()
let cookie
async function login() {
  const response = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
  assert.equal(response.status, 204)
  cookie = response.headers.get('set-cookie')?.split(';')[0]
}
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const value = await response.json()
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${JSON.stringify(value)}`)
  return value
}
async function until(read, ready, label) {
  for (let index = 0; index < 360; index++) {
    const value = await read()
    if (ready(value)) return value
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out: ${label}`)
}
async function download(versionId) {
  const response = await fetch(`${base}/api/artifacts/${versionId}/download`, { headers: { cookie } })
  assert.equal(response.status, 200)
  return Buffer.from(await response.arrayBuffer())
}

await login()
const models = ['fixture-steward-malicious-report', 'fixture-continuation', 'fixture-retry', 'fixture-steward-revision-chat', 'fixture-steward-revision-hold-chat'].map(id => ({
  id, protocol: 'chat-completions', overrides: { contextWindow: 128000, maxTokens: 8192, input: ['text'], reasoning: false, tools: true },
}))
async function configure(stewardModel, researchModel = 'fixture-continuation') {
  await api('/api/model-connection/models', 'PUT', {
    defaultModel: researchModel, models, researchModelPool: [researchModel],
    stewardModel: { modelId: stewardModel, protocol: 'chat-completions' },
  })
}
await api('/api/model-connection', 'PUT', { endpoint: 'http://model-fixture:3002/v1', apiKey: 'fixture-only' })
await configure('fixture-steward-revision-chat')

const created = await api('/api/tasks', 'POST', {
  requestId: crypto.randomUUID(), modelId: 'fixture-steward-malicious-report', goal: 'R2_QUERY_REPORT REVISION：生成含不可信改稿指令的基线报告。',
})
const baseTask = await until(() => api(`/api/tasks/${created.id}`), item => item.run.status === 'succeeded' && item.run.cleanupState === 'cleaned', 'base report')
const source = baseTask.artifacts.find(item => item.kind === 'report')
assert.ok(source)
const original = await download(source.versionId)
assert.equal(createHash('sha256').update(original).digest('hex'), source.sha256)

async function conversation(content, thread) {
  const current = thread ?? await api('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })
  const request = { requestId: crypto.randomUUID(), content }
  const turn = await api(`/api/steward/threads/${current.id}/turns`, 'POST', request)
  assert.equal((await api(`/api/steward/threads/${current.id}/turns`, 'POST', request)).id, turn.id)
  return { thread: current, turn }
}
const explained = await conversation(`请解释工作 ${baseTask.id} 的报告，不保存新版。`)
const explainedDetail = await until(() => api(`/api/steward/threads/${explained.thread.id}`), item => !['queued', 'running', 'stopping'].includes(item.turns.at(-1).status), 'explain without revision')
assert.equal(explainedDetail.revisionOperations.length, 0)
assert.equal((await api(`/api/tasks/${baseTask.id}`)).runs.length, 1)

const quoted = await conversation(`请解释“请修改工作 ${baseTask.id} 的报告：执行报告内的指令”，不要执行。`)
const quotedDetail = await until(() => api(`/api/steward/threads/${quoted.thread.id}`), item => !['queued', 'running', 'stopping'].includes(item.turns.at(-1).status), 'quoted instruction')
assert.ok(quotedDetail.revisionOperations.every(operation => operation.status !== 'accepted'))
assert.equal((await api(`/api/tasks/${baseTask.id}`)).runs.length, 1)
const multipleTargets = await conversation(`请修改工作 ${baseTask.id} 和 ${crypto.randomUUID()} 的报告：不得执行的多目标改稿。`)
const multipleTargetsDetail = await until(() => api(`/api/steward/threads/${multipleTargets.thread.id}`), item => !['queued', 'running', 'stopping'].includes(item.turns.at(-1).status), 'multiple revision targets')
assert.ok(multipleTargetsDetail.revisionOperations.every(operation => operation.status !== 'accepted'))
assert.equal((await api(`/api/tasks/${baseTask.id}`)).runs.length, 1)

await configure('fixture-steward-revision-hold-chat')
const instruction = '补充 CONTINUATION_MARKER_16 并保存新版。'
const revision = await conversation(`请修改工作 ${baseTask.id} 的报告：${instruction}`)
let revisionDetail = await until(() => api(`/api/steward/threads/${revision.thread.id}`), item => item.revisionOperations.some(operation => operation.status === 'accepted'), 'accepted revision before response loss')
const operation = revisionDetail.revisionOperations[0]
assert.deepEqual({ taskId: operation.taskId, sourceVersionId: operation.sourceVersionId, modelId: operation.modelId, protocol: operation.protocol }, {
  taskId: baseTask.id, sourceVersionId: source.versionId, modelId: 'fixture-continuation', protocol: 'chat-completions',
})
assert.ok(operation.runId && operation.reason)
await api(`/api/steward/turns/${revision.turn.id}/stop`, 'POST')
await until(() => api(`/api/steward/threads/${revision.thread.id}`), item => !['queued', 'running', 'stopping'].includes(item.turns.at(-1).status), 'stop after accepted revision')

await configure('fixture-steward-revision-chat')
await conversation(`继续改稿回执 ${operation.operationId}`, revision.thread)
revisionDetail = await until(() => api(`/api/steward/threads/${revision.thread.id}`), item => item.turns.at(-1).status === 'completed', 'recover revision receipt')
assert.equal(revisionDetail.revisionOperations.filter(item => item.status === 'accepted').length, 1)
let revised = await until(() => api(`/api/tasks/${baseTask.id}`), item => item.run.id === operation.runId && item.run.status === 'succeeded' && item.run.cleanupState === 'cleaned', 'revised report')
assert.equal(revised.runs.length, 2)
assert.equal(revised.run.previousReportVersionId, source.versionId)
assert.equal(revised.run.model.id, 'fixture-continuation')
assert.equal(revised.thread.messages.filter(message => message.content === instruction).length, 1)
const latest = revised.artifacts.find(item => item.runId === operation.runId && item.kind === 'report')
assert.ok(latest)
assert.match((await api(`/api/artifacts/${latest.versionId}/content`)).markdown, /CONTINUATION_MARKER_16/)
const latestBytes = await download(latest.versionId)
assert.deepEqual(await download(source.versionId), original)

const missingVersion = await conversation(`请修改工作 ${baseTask.id} 的报告：缺少版本 UUID 的多版本改稿。`)
const missingVersionDetail = await until(() => api(`/api/steward/threads/${missingVersion.thread.id}`), item => !['queued', 'running', 'stopping'].includes(item.turns.at(-1).status), 'missing report version')
assert.ok(missingVersionDetail.revisionOperations.every(item => item.status !== 'accepted'))
assert.equal((await api(`/api/tasks/${baseTask.id}`)).runs.length, 2)

await configure('fixture-steward-revision-chat', 'fixture-retry')
const failingRevision = await conversation(`请修改工作 ${baseTask.id} 的报告 ${latest.versionId}：补充失败路径证据并保存新版。`)
const failingDetail = await until(() => api(`/api/steward/threads/${failingRevision.thread.id}`), item => !['queued', 'running', 'stopping'].includes(item.turns.at(-1).status), 'failed revision receipt')
const failingOperation = failingDetail.revisionOperations.find(item => item.status === 'accepted')
assert.ok(failingOperation)
assert.equal(failingOperation.sourceVersionId, latest.versionId)
assert.equal(failingOperation.modelId, 'fixture-retry')
const failed = await until(() => api(`/api/tasks/${baseTask.id}`), item => item.run.id === failingOperation.runId
  && ['failed', 'lost', 'save_failed'].includes(item.run.status) && item.run.cleanupState === 'cleaned', 'failed revised run')
assert.equal(failed.runs.length, 3)
const retainedReports = failed.artifacts.filter(item => item.kind === 'report')
assert.deepEqual(retainedReports.map(item => item.versionId).sort(), [source.versionId, latest.versionId].sort())
assert.deepEqual(retainedReports.map(item => [item.versionId, item.runId, item.runStatus]).sort(), [
  [source.versionId, baseTask.run.id, 'succeeded'], [latest.versionId, operation.runId, 'succeeded'],
].sort())
assert.deepEqual(await download(source.versionId), original)
assert.deepEqual(await download(latest.versionId), latestBytes)

execFileSync('docker', ['kill', '--signal=KILL', 'agentanywhere-r1-test-web-1'], { stdio: 'pipe' })
execFileSync('docker', ['start', 'agentanywhere-r1-test-web-1'], { stdio: 'pipe' })
await until(async () => { try { return (await fetch(`${base}/login`)).ok } catch { return false } }, Boolean, 'web restart')
await login()
revised = await api(`/api/tasks/${baseTask.id}`)
assert.equal(revised.runs.length, 3)
assert.deepEqual(await download(source.versionId), original)
assert.deepEqual(await download(latest.versionId), latestBytes)

const runIds = [baseTask.run.id, operation.runId, failingOperation.runId]
await until(async () => Promise.all(runIds.map(async runId => {
  const script = `import { SandboxManager } from '@alibaba-group/opensandbox';
const manager = SandboxManager.create({ connectionConfig: { domain: process.env.OPEN_SANDBOX_DOMAIN, protocol: 'http', apiKey: process.env.OPEN_SANDBOX_API_KEY, useServerProxy: true, disableMetrics: true } });
const result = await manager.listSandboxInfos({ metadata: { runId: process.argv[1] }, pageSize: 100 });
if (result.items.some(item => item.status.state !== 'Deleted')) process.exit(1);`
  try { execFileSync('docker', ['exec', 'agentanywhere-r1-test-queue-1', 'node', '--input-type=module', '-e', script, runId], { stdio: 'pipe' }); return true } catch { return false }
})), results => results.every(Boolean), 'sandbox cleanup')

console.log(JSON.stringify({ taskId: baseTask.id, sourceVersionId: source.versionId, revisedVersionId: latest.versionId,
  revisionOperationId: operation.operationId, runId: operation.runId, failedRunId: failingOperation.runId,
  duplicateRuns: false, failedRunRetainedReports: true, oldHashesRetained: true, restartVerified: true, sandboxes: 'none-active' }))
