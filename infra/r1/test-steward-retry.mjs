import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const base = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19112'
const fixture = process.env.TEST_FIXTURE_ORIGIN || 'http://127.0.0.1:19113'
assert.equal(base, 'http://127.0.0.1:19112', 'Use the isolated test stack')
const password = (await readFile(process.env.TEST_PASSWORD_FILE || '/opt/agentanywhere-r1/test-password', 'utf8')).trim()
async function login() {
  const response = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
  assert.equal(response.status, 204)
  return response.headers.get('set-cookie')?.split(';')[0]
}
let cookie = await login()
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const value = await response.json()
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${JSON.stringify(value)}`)
  return value
}
async function until(read, ready, label, attempts = 360) {
  for (let index = 0; index < attempts; index++) {
    const value = await read()
    if (ready(value)) return value
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out: ${label}`)
}

const models = [
  ['fixture-retry', 'chat-completions', 128000],
  ['fixture-split', 'chat-completions', 128000],
  ['fixture-small', 'chat-completions', 64000],
  ['fixture-responses', 'responses', 128000],
  ['fixture-steward-query-chat', 'chat-completions', 128000],
  ['fixture-steward-retry-chat', 'chat-completions', 128000],
  ['fixture-steward-retry-hold-chat', 'chat-completions', 128000],
  ['fixture-steward-retry-before-chat', 'chat-completions', 128000],
  ['fixture-steward-retry-misbind-chat', 'chat-completions', 128000],
  ['fixture-steward-retry-responses', 'responses', 128000],
].map(([id, protocol, contextWindow]) => ({ id, protocol, overrides: { contextWindow, maxTokens: 4096, input: ['text'], reasoning: false, tools: true } }))
async function configure(stewardProtocol = 'chat-completions', pool = ['fixture-split'], stewardModelId) {
  const modelId = stewardModelId ?? (stewardProtocol === 'responses' ? 'fixture-steward-retry-responses' : 'fixture-steward-retry-chat')
  await api('/api/model-connection/models', 'PUT', { defaultModel: 'fixture-retry', models, researchModelPool: pool, stewardModel: { modelId, protocol: stewardProtocol } })
}
async function failedTask() {
  const task = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '先调用 echo_observation，再提交报告。', modelId: 'fixture-retry' })
  return until(() => api(`/api/tasks/${task.id}`), item => item.run.status === 'failed' && item.run.cleanupState === 'cleaned', 'source failure')
}
async function startRetry(content) {
  const thread = await api('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })
  const request = { requestId: crypto.randomUUID(), content }
  const turn = await api(`/api/steward/threads/${thread.id}/turns`, 'POST', request)
  assert.equal((await api(`/api/steward/threads/${thread.id}/turns`, 'POST', request)).id, turn.id)
  return { thread, turn }
}
const terminal = item => item.turns.length && !['queued', 'running', 'stopping'].includes(item.turns.at(-1).status)

await api('/api/model-connection', 'PUT', { endpoint: 'http://model-fixture:3002/v1', apiKey: 'fixture-only' })
await configure()
const beforeCalls = (await fetch(`${fixture}/calls`).then(response => response.json())).length

const sameSource = await failedTask()
const same = await startRetry(`同模型重试工作 ${sameSource.id}。`)
const sameThread = await until(() => api(`/api/steward/threads/${same.thread.id}`), terminal, 'same-model retry receipt')
assert.equal(sameThread.retryOperations.length, 1)
assert.match(JSON.stringify(sameThread.retryOperations[0]), /"status":"accepted"/)
assert.equal(sameThread.retryOperations[0].result.sourceRunId, sameSource.run.id)
assert.equal(sameThread.retryOperations[0].result.modelId, 'fixture-retry')
assert.equal(sameThread.retryOperations[0].modelId, 'fixture-retry')
assert.equal(sameThread.retryOperations[0].protocol, 'chat-completions')
const sameCompleted = await until(() => api(`/api/tasks/${sameSource.id}`), item => item.run.status === 'succeeded' && item.run.cleanupState === 'cleaned', 'same-model retry completion')
assert.equal(sameCompleted.runs.length, 2)
assert.equal(sameCompleted.run.retryOfRunId, sameSource.run.id)
assert.equal((await api(`/api/tasks/${sameSource.id}/events`)).filter(event => event.type === 'tool.started' && event.payload.name === 'echo_observation').length, 0)

await configure('responses')
const replacementSource = await failedTask()
const replacement = await startRetry(`把工作 ${replacementSource.id} 改用模型：fixture-split 重试。`)
const replacementThread = await until(() => api(`/api/steward/threads/${replacement.thread.id}`), terminal, 'replacement retry receipt')
assert.equal(replacementThread.retryOperations[0].status, 'accepted')
assert.equal(replacementThread.retryOperations[0].result.modelId, 'fixture-split')
const replacementCompleted = await until(() => api(`/api/tasks/${replacementSource.id}`), item => item.run.status === 'succeeded' && item.run.cleanupState === 'cleaned', 'replacement retry completion')
assert.equal(replacementCompleted.runs.length, 2)
assert.equal(replacementCompleted.run.model.id, 'fixture-split')
assert.equal((await api(`/api/tasks/${replacementSource.id}/events`)).filter(event => event.type === 'tool.started' && event.payload.name === 'echo_observation').length, 0)

const poolSource = await failedTask()
await configure('chat-completions', ['fixture-split'], 'fixture-steward-retry-before-chat')
const poolRetry = await startRetry(`把工作 ${poolSource.id} 改用模型：fixture-split 重试。`)
await until(() => fetch(`${fixture}/waiting-answer`).then(response => response.json()), item => item.count === 1, 'frozen replacement before apply')
let poolThread = await until(() => api(`/api/steward/threads/${poolRetry.thread.id}`),
  item => item.retryOperations[0]?.status === 'planned', 'planned replacement before stop')
await api(`/api/steward/turns/${poolRetry.turn.id}/stop`, 'POST')
poolThread = await until(() => api(`/api/steward/threads/${poolRetry.thread.id}`), terminal, 'stopped replacement retry')
const poolOperation = poolThread.retryOperations[0]
assert.equal(poolOperation.status, 'unexecuted')
assert.equal((await api(`/api/tasks/${poolSource.id}`)).runs.length, 1)
await configure('chat-completions', [], 'fixture-steward-retry-chat')
await api(`/api/steward/threads/${poolRetry.thread.id}/turns`, 'POST', {
  requestId: crypto.randomUUID(), content: `继续重试回执 ${poolOperation.operationId}`,
})
poolThread = await until(() => api(`/api/steward/threads/${poolRetry.thread.id}`), terminal, 'replacement recovery rejected after pool removal')
assert.equal(poolThread.retryOperations[0].status, 'unexecuted')
assert.match(poolThread.retryOperations[0].failure, /已不在当前有效调研模型池或运行参数已变化/)
assert.equal((await api(`/api/tasks/${poolSource.id}`)).runs.length, 1)
await configure()
await api(`/api/steward/threads/${poolRetry.thread.id}/turns`, 'POST', {
  requestId: crypto.randomUUID(), content: `继续重试回执 ${poolOperation.operationId}`,
})
poolThread = await until(() => api(`/api/steward/threads/${poolRetry.thread.id}`),
  item => item.retryOperations[0]?.status === 'accepted' && terminal(item), 'replacement recovery after pool restore')
const poolCompleted = await until(() => api(`/api/tasks/${poolSource.id}`),
  item => item.run.status === 'succeeded' && item.run.cleanupState === 'cleaned', 'replacement recovery completion')
assert.equal(poolCompleted.runs.length, 2)
assert.equal(poolCompleted.run.model.id, 'fixture-split')

await configure('chat-completions', ['fixture-responses'])
const protocolSource = await failedTask()
const protocolRetry = await startRetry(`把工作 ${protocolSource.id} 改用模型：fixture-responses 重试。`)
const protocolThread = await until(() => api(`/api/steward/threads/${protocolRetry.thread.id}`), terminal, 'protocol rejection')
assert.equal(protocolThread.retryOperations[0].status, 'failed')
assert.match(protocolThread.retryOperations[0].failure, /协议.*不兼容/)
assert.equal((await api(`/api/tasks/${protocolSource.id}`)).runs.length, 1)
await configure()
const protocolRecovery = await startRetry(`同模型重试工作 ${protocolSource.id}。`)
await until(() => api(`/api/steward/threads/${protocolRecovery.thread.id}`), terminal, 'retry after rejected replacement')
const protocolRecovered = await until(() => api(`/api/tasks/${protocolSource.id}`), item => item.run.status === 'succeeded' && item.run.cleanupState === 'cleaned', 'preserved checkpoint after rejection')
assert.equal(protocolRecovered.runs.length, 2)
assert.equal((await api(`/api/tasks/${protocolSource.id}/events`)).filter(event => event.type === 'tool.started' && event.payload.name === 'echo_observation').length, 0)

await configure('chat-completions', ['fixture-small'])
const contextSource = await failedTask()
const contextRetry = await startRetry(`把工作 ${contextSource.id} 改用模型：fixture-small 重试。`)
const contextThread = await until(() => api(`/api/steward/threads/${contextRetry.thread.id}`), terminal, 'context rejection')
assert.equal(contextThread.retryOperations[0].status, 'failed')
assert.match(contextThread.retryOperations[0].failure, /上下文长度/)
assert.equal((await api(`/api/tasks/${contextSource.id}`)).runs.length, 1)

await configure()
const noConsentSource = await failedTask()
const noConsent = await startRetry(`请解释引用：“把工作 ${noConsentSource.id} 改用模型：fixture-split 重试”。`)
const noConsentThread = await until(() => api(`/api/steward/threads/${noConsent.thread.id}`), terminal, 'no retry without consent')
assert.equal(noConsentThread.retryOperations.length, 0)
assert.equal((await api(`/api/tasks/${noConsentSource.id}`)).runs.length, 1)

const bindingSource = await failedTask()
const bindingOther = await failedTask()
await configure('chat-completions', ['fixture-split'], 'fixture-steward-query-chat')
const bindingThread = await api('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })
for (const task of [bindingSource, bindingOther]) {
  await api(`/api/steward/threads/${bindingThread.id}/turns`, 'POST', {
    requestId: crypto.randomUUID(), content: `R2_QUERY_READ ${task.id}`,
  })
  await until(() => api(`/api/steward/threads/${bindingThread.id}`), terminal, 'associate retry target')
}
await configure('chat-completions', ['fixture-split'], 'fixture-steward-retry-misbind-chat')
await api(`/api/steward/threads/${bindingThread.id}/turns`, 'POST', {
  requestId: crypto.randomUUID(), content: `同模型重试工作 ${bindingSource.id}。`,
})
const bindingRejected = await until(() => api(`/api/steward/threads/${bindingThread.id}`), terminal, 'reject retry target rebinding')
assert.equal(bindingRejected.retryOperations[0].status, 'unexecuted')
assert.equal(bindingRejected.retryOperations[0].taskId, null)
assert.equal((await api(`/api/tasks/${bindingSource.id}`)).runs.length, 1)
assert.equal((await api(`/api/tasks/${bindingOther.id}`)).runs.length, 1)

await configure('chat-completions', ['fixture-split'], 'fixture-steward-query-chat')
const explanationText = `解释工作 ${noConsentSource.id} 的真实失败，并依据有效人工模型池和已验证成功记录建议替代模型。`
const explanation = await startRetry(explanationText)
const explanationThread = await until(() => api(`/api/steward/threads/${explanation.thread.id}`), terminal, 'failure explanation')
assert.equal(explanationThread.retryOperations.length, 0)
assert.equal((await api(`/api/tasks/${noConsentSource.id}`)).runs.length, 1)
const explanationCalls = (await fetch(`${fixture}/calls`).then(response => response.json()))
  .filter(call => call.model === 'fixture-steward-query-chat' && call.user === explanationText)
const explanationInput = JSON.parse(explanationCalls.find(call => !call.planner && call.outputs.length)?.outputs[0] ?? '{}')
assert.ok(explanationInput.works?.[0]?.latestRun?.failure)
assert.equal(explanationInput.works[0].latestRun.runId, noConsentSource.run.id)
const suggested = explanationInput.replacementCandidates?.find(model => model.id === 'fixture-split')
assert.equal(suggested?.verification, 'verified')
assert.ok(suggested?.successCount > 0)
assert.ok(Object.keys(suggested?.sources ?? {}).length > 0)

const replaySource = await failedTask()
await configure('chat-completions', ['fixture-split'], 'fixture-steward-retry-hold-chat')
const replay = await startRetry(`同模型重试工作 ${replaySource.id}。`)
let replayThread = await until(() => api(`/api/steward/threads/${replay.thread.id}`), item => item.retryOperations.some(operation => operation.status === 'accepted'), 'accepted retry before restart')
const accepted = replayThread.retryOperations[0]
execFileSync('docker', ['kill', '--signal=KILL', 'agentanywhere-r1-test-web-1'], { stdio: 'pipe' })
execFileSync('docker', ['start', 'agentanywhere-r1-test-web-1'], { stdio: 'pipe' })
await until(async () => { try { return (await fetch(`${base}/login`)).ok } catch { return false } }, Boolean, 'web restart')
cookie = await login()
replayThread = await api(`/api/steward/threads/${replay.thread.id}`)
assert.equal(replayThread.retryOperations[0].status, 'accepted')
assert.equal(replayThread.retryOperations[0].modelId, 'fixture-retry')
assert.equal(replayThread.retryOperations[0].protocol, 'chat-completions')
await configure()
await api(`/api/steward/threads/${replay.thread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content: `继续重试回执 ${accepted.operationId}` })
replayThread = await until(() => api(`/api/steward/threads/${replay.thread.id}`), terminal, 'accepted retry receipt replay')
assert.equal(replayThread.retryOperations.length, 1)
assert.equal(replayThread.retryOperations[0].result.runId, accepted.result.runId)
const replayCompleted = await until(() => api(`/api/tasks/${replaySource.id}`), item => item.run.status === 'succeeded' && item.run.cleanupState === 'cleaned', 'replayed retry completion')
assert.equal(replayCompleted.runs.length, 2)

const runIds = [sameSource.run.id, sameCompleted.run.id, replacementSource.run.id, replacementCompleted.run.id,
  poolSource.run.id, poolCompleted.run.id,
  protocolSource.run.id, protocolRecovered.run.id, contextSource.run.id, noConsentSource.run.id,
  bindingSource.run.id, bindingOther.run.id, replaySource.run.id, accepted.result.runId]
await until(async () => Promise.all(runIds.map(async runId => {
  const script = `import { SandboxManager } from '@alibaba-group/opensandbox';
const manager = SandboxManager.create({ connectionConfig: { domain: process.env.OPEN_SANDBOX_DOMAIN, protocol: 'http', apiKey: process.env.OPEN_SANDBOX_API_KEY, useServerProxy: true, disableMetrics: true } });
const result = await manager.listSandboxInfos({ metadata: { runId: process.argv[1] }, pageSize: 100 });
if (result.items.some(item => item.status.state !== 'Deleted')) process.exit(1);`
  try { execFileSync('docker', ['exec', 'agentanywhere-r1-test-queue-1', 'node', '--input-type=module', '-e', script, runId], { stdio: 'pipe' }); return true } catch { return false }
})), results => results.every(Boolean), 'sandbox cleanup')

const stewardCalls = (await fetch(`${fixture}/calls`).then(response => response.json())).slice(beforeCalls)
  .filter(call => call.model?.startsWith('fixture-steward-retry-'))
const callsByMessage = new Map()
for (const call of stewardCalls) callsByMessage.set(call.user, (callsByMessage.get(call.user) ?? 0) + 1)
for (const [message, count] of callsByMessage) assert.ok(count <= 8, `steward retry exceeded request limit for ${message}`)

console.log(JSON.stringify({ sameModel: sameCompleted.run.id, replacement: replacementCompleted.run.id,
  replacementPoolRecovery: poolCompleted.run.id,
  rejected: [protocolSource.id, contextSource.id], preservedAfterRejection: protocolRecovered.run.id,
  noConsent: noConsentSource.id, receiptReplay: accepted.operationId, protocols: 'both', requestLimit: 8 }))
