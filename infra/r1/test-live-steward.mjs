import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'
import { dirname } from 'node:path'

const base = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19114'
assert.equal(base, 'http://127.0.0.1:19114', 'Use the isolated 19114 live-test stack')
const configFile = process.env.TEST_ISOLATED_MODEL_CONFIG_FILE
assert.ok(configFile, 'Set TEST_ISOLATED_MODEL_CONFIG_FILE to the isolated writable model configuration')
const configPath = await realpath(configFile)
const formalConfigPath = await realpath('/opt/agentanywhere-r1/data/model-connection.json').catch(() => '/opt/agentanywhere-r1/data/model-connection.json')
assert.notEqual(configPath, formalConfigPath, 'Refusing to change the formal model configuration')
const webContainer = 'agentanywhere-r1-live-test-web-1'
const queueContainer = 'agentanywhere-r1-live-test-queue-1'
const mounts = JSON.parse(execFileSync('docker', ['inspect', '--format', '{{json .Mounts}}', webContainer], { encoding: 'utf8' }))
const mounted = mounts.find(mount => mount.Destination === '/data')
assert.ok(mounted?.RW && await realpath(mounted.Source) === dirname(configPath), 'Mount the isolated model directory writable at /data')
assert.ok(!mounts.some(mount => mount.Destination === '/data/model-connection.json'), 'A file bind mount prevents atomic model configuration updates')

const password = process.env.TEST_PASSWORD?.trim() || process.env.AGENTANYWHERE_PASSWORD?.trim()
  || (await readFile(process.env.TEST_PASSWORD_FILE || '/opt/agentanywhere-r1/test-password', 'utf8')).trim()
const login = await fetch(`${base}/api/auth`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }),
})
assert.equal(login.status, 204)
const cookie = login.headers.get('set-cookie')?.split(';')[0]
assert.ok(cookie)

async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { cookie, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const value = await response.json()
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${value.error || ''}`)
  return value
}

const terminalTurn = turn => !['queued', 'running', 'stopping'].includes(turn?.status)
const terminalRun = run => ['succeeded', 'failed', 'lost', 'cancelled', 'save_failed'].includes(run?.status)
async function until(read, ready, label, attempts = 900) {
  let value
  for (let attempt = 0; attempt < attempts; attempt++) {
    value = await read()
    if (ready(value)) return value
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function startTurn(content, threadId) {
  const thread = threadId ? { id: threadId } : await api('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })
  const turn = await api(`/api/steward/threads/${thread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content })
  return { threadId: thread.id, turnId: turn.id }
}

function turn(detail, turnId) {
  return detail.turns.find(item => item.id === turnId)
}

function statusCard(detail, id) {
  const matches = detail.statusCards.filter(card => card.id === id)
  assert.equal(matches.length, 1, `${id}: expected one status card`)
  return matches[0]
}

async function download(versionId) {
  const response = await fetch(`${base}/api/artifacts/${versionId}/download`, { headers: { cookie } })
  assert.equal(response.status, 200, `Download ${versionId}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

const connection = await api('/api/model-connection')
assert.ok(!Object.hasOwn(connection, 'apiKey'), 'The model API exposed its credential')
const modelId = process.env.TEST_LIVE_MODEL_ID || 'gpt-6-astra'
const selected = connection.models.find(model => model.id === modelId)
assert.ok(selected, `${modelId} is not selected in the isolated model configuration`)
assert.ok(selected.contextWindow && selected.maxTokens && selected.input?.includes('text')
  && typeof selected.reasoning === 'boolean' && selected.tools === true, `${modelId} needs complete tool-capable metadata`)
const originalModels = connection.models.map(model => ({
  id: model.id, protocol: model.protocol, ...(model.catalogId ? { catalogId: model.catalogId } : {}), overrides: model.overrides ?? {},
}))
const testModels = originalModels.map(model => model.id === modelId ? { ...model, protocol: 'chat-completions' } : model)
const originalSelections = {
  defaultModel: connection.defaultModel, models: originalModels,
  researchModelPool: connection.researchModelPool ?? [], stewardModel: connection.stewardModel ?? null,
}
const runtimeMetadata = model => ({
  contextWindow: model.contextWindow, maxTokens: model.maxTokens, input: model.input,
  reasoning: model.reasoning, tools: model.tools,
})
async function configure(protocol) {
  await api('/api/model-connection/models', 'PUT', {
    defaultModel: connection.defaultModel, models: testModels, researchModelPool: [modelId],
    stewardModel: { modelId, protocol },
  })
  const configured = await api('/api/model-connection')
  assert.deepEqual(configured.stewardModel, { modelId, protocol })
  const configuredModel = configured.models.find(model => model.id === modelId)
  assert.ok(configuredModel)
  assert.deepEqual(runtimeMetadata(configuredModel), runtimeMetadata(selected), 'Model metadata changed during steward configuration')
}

const touchedRuns = []
let result
try {
  await configure('chat-completions')
  const initialTasks = await api('/api/tasks')
  const dispatch = await startTurn(`请创建一项独立调研工作，并立即开始。调研目标必须完整保留以下要求：先调用 ask_user 询问并确认研究方向；收到回答后，用 search_web 调研 SearXNG 搜索 API 的工作机制，再从搜索结果中选择一个公开来源并调用 open_public_page 读取正文；最后提交简短中文报告，列出来源标题和 URL。调研模型只用 ${modelId}。`)
  let dispatchDetail = await until(
    () => api(`/api/steward/threads/${dispatch.threadId}`),
    detail => detail.researchOperations.some(operation => operation.status === 'accepted') || terminalTurn(turn(detail, dispatch.turnId)),
    'real Chat Completions steward dispatch receipt',
  )
  const researchOperation = dispatchDetail.researchOperations.find(operation => operation.status === 'accepted')
  assert.ok(researchOperation, `Chat steward did not dispatch research: ${turn(dispatchDetail, dispatch.turnId)?.failure || 'no accepted receipt'}`)
  assert.equal(dispatchDetail.researchOperations.length, 1, 'The steward dispatched more than one research task')
  assert.equal(researchOperation.modelId, modelId)
  assert.equal(researchOperation.protocol, 'chat-completions')
  assert.match(researchOperation.goal, /ask_user/)
  assert.match(researchOperation.goal, /search_web/)
  assert.match(researchOperation.goal, /open_public_page/)
  assert.ok(dispatchDetail.relatedTasks.some(task => task.id === researchOperation.taskId))
  assert.equal((await api('/api/tasks')).length, initialTasks.length + 1, 'The steward did not create exactly one Task')
  dispatchDetail = await until(() => api(`/api/steward/threads/${dispatch.threadId}`), detail => terminalTurn(turn(detail, dispatch.turnId)), 'Chat steward turn')
  const dispatchTurn = turn(dispatchDetail, dispatch.turnId)
  assert.equal(dispatchTurn.status, 'completed', dispatchTurn.failure || 'Chat steward turn failed')
  assert.ok(dispatchTurn.modelCalls >= 2, 'Chat steward did not complete a real tool round trip')

  touchedRuns.push(researchOperation.runId)
  let waiting = await until(
    () => api(`/api/tasks/${researchOperation.taskId}`),
    detail => (detail.run.status === 'waiting' && detail.run.cleanupState === 'cleaned') || terminalRun(detail.run),
    'research ask_user interaction',
  )
  if (waiting.run.status !== 'waiting') {
    throw new Error(`Research Run ${waiting.run.id} did not call ask_user: ${waiting.run.status}${waiting.run.failure ? ` (${waiting.run.failure})` : ''}`)
  }
  assert.equal(waiting.run.id, researchOperation.runId)
  assert.equal(waiting.run.cleanupState, 'cleaned')
  assert.equal(waiting.interaction?.kind, 'question')
  assert.equal(waiting.interaction?.status, 'pending')
  assert.equal((await api('/api/interactions/pending')).filter(item => item.id === waiting.interaction.id).length, 1)
  const waitingThread = await api(`/api/steward/threads/${dispatch.threadId}`)
  const waitingCard = statusCard(waitingThread, `interaction:${waiting.interaction.id}`)
  assert.equal(waitingCard.taskId, waiting.id)
  assert.equal(waitingCard.runId, waiting.run.id)
  assert.equal(waitingCard.interaction.status, 'pending')
  const waitingEvents = await api(`/api/tasks/${waiting.id}/events`)
  assert.ok(waitingEvents.some(event => event.type === 'tool.completed' && event.payload.name === 'ask_user' && !event.payload.isError), 'ask_user did not complete')

  const answer = await startTurn(`回答工作 ${waiting.id}：机制方向`, dispatch.threadId)
  let answerDetail = await until(
    () => api(`/api/steward/threads/${answer.threadId}`),
    detail => detail.interactionOperations.some(operation => operation.status === 'accepted') || terminalTurn(turn(detail, answer.turnId)),
    'steward interaction answer receipt',
  )
  const answerOperation = answerDetail.interactionOperations.find(operation => operation.status === 'accepted')
  assert.ok(answerOperation, `Steward did not answer the Interaction: ${turn(answerDetail, answer.turnId)?.failure || 'no accepted receipt'}`)
  assert.equal(answerOperation.taskId, waiting.id)
  assert.equal(answerOperation.interactionId, waiting.interaction.id)
  assert.equal(answerOperation.result?.answer, '机制方向')
  assert.ok(!(await api('/api/interactions/pending')).some(item => item.id === waiting.interaction.id))
  const running = await until(
    () => api(`/api/tasks/${waiting.id}`),
    detail => detail.run.status === 'running' || terminalRun(detail.run),
    'resumed Run to enter running before steward steering',
  )
  if (running.run.status !== 'running') throw new Error(`Run ${running.run.id} ended before steward steering: ${running.run.status}`)
  const addition = `向工作 ${waiting.id} 追加要求：报告增加“验收摘要”一节，并包含标记 LIVE_STEWARD_APPEND_MARKER。`
  const steering = await startTurn(addition, dispatch.threadId)
  answerDetail = await until(() => api(`/api/steward/threads/${answer.threadId}`), detail => terminalTurn(turn(detail, answer.turnId)), 'answer turn')
  assert.equal(turn(answerDetail, answer.turnId).status, 'completed', turn(answerDetail, answer.turnId).failure || 'Answer turn failed')
  assert.equal(statusCard(answerDetail, `interaction:${waiting.interaction.id}`).interaction.status, 'answered')
  let steeringDetail = await until(
    () => api(`/api/steward/threads/${steering.threadId}`),
    detail => detail.controlOperations.some(operation => operation.kind === 'steer' && operation.status === 'accepted')
      || terminalTurn(turn(detail, steering.turnId)),
    'real steward steering receipt',
  )
  const steeringOperation = steeringDetail.controlOperations.find(operation => operation.kind === 'steer' && operation.status === 'accepted')
  const steeringFailure = steeringDetail.controlOperations.find(operation => operation.kind === 'steer')?.failure
  assert.ok(steeringOperation, `Steward did not append to the running Run: ${steeringFailure || turn(steeringDetail, steering.turnId)?.failure || 'no accepted receipt'}`)
  assert.equal(steeringOperation.taskId, waiting.id)
  assert.equal(steeringOperation.runId, waiting.run.id)
  assert.equal(steeringOperation.result?.messageStatus, 'pending')
  steeringDetail = await until(() => api(`/api/steward/threads/${steering.threadId}`), detail => terminalTurn(turn(detail, steering.turnId)), 'steering turn')
  assert.equal(turn(steeringDetail, steering.turnId).status, 'completed', turn(steeringDetail, steering.turnId).failure || 'Steering turn failed')

  const completed = await until(
    () => api(`/api/tasks/${waiting.id}`),
    detail => terminalRun(detail.run) && detail.run.cleanupState === 'cleaned',
    'resumed research completion',
  )
  assert.equal(completed.run.id, waiting.run.id)
  assert.ok(completed.run.epoch > waiting.run.epoch)
  assert.equal(completed.run.status, 'succeeded', completed.run.failure || 'Research failed')
  assert.equal(completed.runs.length, 1, 'Steering created another Run')
  const appliedMessage = completed.thread.messages.find(message => message.content === steeringOperation.content)
  assert.equal(appliedMessage?.status, 'applied', 'The appended requirement was not applied')
  assert.equal((await api(`/api/steward/threads/${steering.threadId}`)).controlOperations
    .find(operation => operation.operationId === steeringOperation.operationId)?.messageStatus, 'applied')
  const events = await api(`/api/tasks/${completed.id}/events`)
  for (const name of ['search_web', 'open_public_page']) {
    assert.ok(events.some(event => event.type === 'tool.completed' && event.payload.name === name && !event.payload.isError), `${name} did not complete`)
  }
  const search = events.find(event => event.type === 'tool.completed' && event.payload.name === 'search_web' && !event.payload.isError)
  const page = events.find(event => event.type === 'tool.completed' && event.payload.name === 'open_public_page' && !event.payload.isError)
  assert.ok(JSON.parse(search.payload.result).results.length > 0, 'search_web returned no real results')
  assert.equal(JSON.parse(page.payload.result).source, 'page_body')
  const source = completed.artifacts.find(artifact => artifact.kind === 'report' && artifact.runId === completed.run.id)
  assert.ok(source)
  const sourceContent = await api(`/api/artifacts/${source.versionId}/content`)
  assert.match(sourceContent.markdown, /https?:\/\//)
  assert.match(sourceContent.markdown, /LIVE_STEWARD_APPEND_MARKER/)
  const sourceBytes = await download(source.versionId)
  assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), source.sha256)
  const completedThread = await api(`/api/steward/threads/${dispatch.threadId}`)
  assert.equal(statusCard(completedThread, `interaction:${waiting.interaction.id}`).interaction.status, 'answered')
  const completedCard = statusCard(completedThread, `run:${completed.run.id}`)
  assert.equal(completedCard.kind, 'completed')
  assert.equal(completedCard.reports.length, 1)

  await configure('responses')
  const beforeReadTasks = await api('/api/tasks')
  const beforeReadRuns = completed.runs.map(run => run.id)
  const reading = await startTurn(`请解读工作 ${completed.id} 的报告 ${source.versionId}，只依据已有报告回答，不创建新工作。`)
  const readDetail = await until(() => api(`/api/steward/threads/${reading.threadId}`), detail => terminalTurn(turn(detail, reading.turnId)), 'real Responses steward report read')
  const readTurn = turn(readDetail, reading.turnId)
  assert.equal(readTurn.status, 'completed', readTurn.failure || 'Responses steward read failed')
  assert.ok(readTurn.modelCalls >= 2, 'Responses steward did not complete a real tool round trip')
  assert.deepEqual(readDetail.relatedTasks.map(task => task.id), [completed.id])
  assert.ok(readDetail.messages.find(message => message.turnId === reading.turnId && message.role === 'assistant')?.content.trim())
  assert.equal((await api('/api/tasks')).length, beforeReadTasks.length, 'Reading created a new Task')
  const afterRead = await api(`/api/tasks/${completed.id}`)
  assert.deepEqual(afterRead.runs.map(run => run.id), beforeReadRuns, 'Reading created a new Run')
  assert.deepEqual(afterRead.artifacts.map(artifact => artifact.versionId), completed.artifacts.map(artifact => artifact.versionId))

  const revision = await startTurn(`请修改工作 ${completed.id} 的报告 ${source.versionId}：新增一段验收摘要，保留来源。直接基于已有报告完成修改，无需重复首次调研的提问步骤。`, reading.threadId)
  let revisionDetail = await until(
    () => api(`/api/steward/threads/${revision.threadId}`),
    detail => detail.revisionOperations.some(operation => operation.status === 'accepted') || terminalTurn(turn(detail, revision.turnId)),
    'Responses steward revision receipt',
  )
  const revisionOperation = revisionDetail.revisionOperations.find(operation => operation.status === 'accepted')
  assert.ok(revisionOperation, `Responses steward did not start the revision: ${turn(revisionDetail, revision.turnId)?.failure || 'no accepted receipt'}`)
  assert.equal(revisionOperation.taskId, completed.id)
  assert.equal(revisionOperation.sourceVersionId, source.versionId)
  assert.equal(revisionOperation.modelId, modelId)
  assert.equal(revisionOperation.protocol, 'chat-completions')
  assert.ok(revisionOperation.runId)
  touchedRuns.push(revisionOperation.runId)
  revisionDetail = await until(() => api(`/api/steward/threads/${revision.threadId}`), detail => terminalTurn(turn(detail, revision.turnId)), 'Responses revision turn')
  const revisionTurn = turn(revisionDetail, revision.turnId)
  assert.equal(revisionTurn.status, 'completed', revisionTurn.failure || 'Responses revision turn failed')
  assert.ok(revisionTurn.modelCalls >= 2, 'Responses revision did not complete a real tool round trip')

  const revised = await until(
    () => api(`/api/tasks/${completed.id}`),
    detail => detail.run.id === revisionOperation.runId && terminalRun(detail.run) && detail.run.cleanupState === 'cleaned',
    'revised report completion',
  )
  assert.equal(revised.run.status, 'succeeded', revised.run.failure || 'Revision Run failed')
  assert.equal(revised.run.model.id, modelId)
  assert.equal(revised.run.previousReportVersionId, source.versionId)
  assert.equal(revised.runs.length, completed.runs.length + 1)
  const latest = revised.artifacts.find(artifact => artifact.kind === 'report' && artifact.runId === revisionOperation.runId)
  assert.ok(latest)
  assert.notEqual(latest.versionId, source.versionId)
  const latestContent = await api(`/api/artifacts/${latest.versionId}/content`)
  assert.match(latestContent.markdown, /验收摘要/)
  assert.match(latestContent.markdown, /https?:\/\//)
  const latestBytes = await download(latest.versionId)
  assert.equal(createHash('sha256').update(latestBytes).digest('hex'), latest.sha256)
  assert.deepEqual(await download(source.versionId), sourceBytes, 'The original report changed after revision')

  const cancelling = await api(`/api/tasks/${revised.id}/runs`, 'POST', {
    requestId: crypto.randomUUID(), modelId, protocol: 'chat-completions',
    content: '取消验收：先调用 ask_user 询问“是否继续取消验收？”，调用后等待回答，不执行其他操作。',
  })
  touchedRuns.push(cancelling.run.id)
  const cancelWaiting = await until(
    () => api(`/api/tasks/${revised.id}`),
    detail => detail.run.id === cancelling.run.id
      && ((detail.run.status === 'waiting' && detail.run.cleanupState === 'cleaned') || terminalRun(detail.run)),
    'cancellation Run ask_user interaction',
  )
  if (cancelWaiting.run.status !== 'waiting') {
    throw new Error(`Cancellation Run ${cancelWaiting.run.id} did not call ask_user: ${cancelWaiting.run.status}${cancelWaiting.run.failure ? ` (${cancelWaiting.run.failure})` : ''}`)
  }
  assert.equal(cancelWaiting.interaction?.kind, 'question')
  assert.equal((await api('/api/interactions/pending')).filter(item => item.id === cancelWaiting.interaction.id).length, 1)
  const cancelWaitingThread = await api(`/api/steward/threads/${reading.threadId}`)
  assert.equal(statusCard(cancelWaitingThread, `interaction:${cancelWaiting.interaction.id}`).interaction.status, 'pending')

  const cancellation = await startTurn(`取消工作 ${revised.id}。`, reading.threadId)
  let cancellationDetail = await until(
    () => api(`/api/steward/threads/${cancellation.threadId}`),
    detail => detail.controlOperations.some(operation => operation.kind === 'cancel' && operation.runId === cancelling.run.id && operation.status === 'accepted')
      || terminalTurn(turn(detail, cancellation.turnId)),
    'real steward cancellation receipt',
  )
  const cancellationOperation = cancellationDetail.controlOperations.find(operation => operation.kind === 'cancel'
    && operation.runId === cancelling.run.id && operation.status === 'accepted')
  const cancellationFailure = cancellationDetail.controlOperations.find(operation => operation.kind === 'cancel' && operation.runId === cancelling.run.id)?.failure
  assert.ok(cancellationOperation, `Steward did not cancel the waiting Run: ${cancellationFailure || turn(cancellationDetail, cancellation.turnId)?.failure || 'no accepted receipt'}`)
  assert.equal(cancellationOperation.taskId, revised.id)
  assert.equal(cancellationOperation.result?.runStatus, 'cancelled')
  cancellationDetail = await until(() => api(`/api/steward/threads/${cancellation.threadId}`), detail => terminalTurn(turn(detail, cancellation.turnId)), 'cancellation turn')
  assert.equal(turn(cancellationDetail, cancellation.turnId).status, 'completed', turn(cancellationDetail, cancellation.turnId).failure || 'Cancellation turn failed')
  const cancelled = await until(
    () => api(`/api/tasks/${revised.id}`),
    detail => detail.run.id === cancelling.run.id && detail.run.status === 'cancelled' && detail.run.cleanupState === 'cleaned',
    'cancelled Run cleanup',
  )
  assert.equal(cancelled.runs.length, revised.runs.length + 1)
  assert.ok(!(await api('/api/interactions/pending')).some(item => item.id === cancelWaiting.interaction.id))
  const cancelledThread = await api(`/api/steward/threads/${reading.threadId}`)
  assert.equal(cancelledThread.relatedTasks.find(task => task.id === revised.id)?.status, 'cancelled')
  assert.equal(statusCard(cancelledThread, `interaction:${cancelWaiting.interaction.id}`).interaction.status, 'cancelled')
  assert.deepEqual(await download(source.versionId), sourceBytes, 'Cancellation changed the original report')
  assert.deepEqual(await download(latest.versionId), latestBytes, 'Cancellation changed the revised report')

  const checkSandboxes = `import { SandboxManager } from '@alibaba-group/opensandbox';
const manager = SandboxManager.create({ connectionConfig: { domain: process.env.OPEN_SANDBOX_DOMAIN, protocol: 'http', apiKey: process.env.OPEN_SANDBOX_API_KEY, useServerProxy: true, disableMetrics: true } });
for (const runId of process.argv.slice(1)) {
  const result = await manager.listSandboxInfos({ metadata: { runId }, pageSize: 100 });
  if (result.items.some(item => item.status.state !== 'Deleted')) throw new Error('Sandbox still active for ' + runId);
}`
  execFileSync('docker', ['exec', queueContainer, 'node', '--input-type=module', '-e', checkSandboxes, ...new Set(touchedRuns)], { stdio: 'pipe' })
  result = {
    modelId,
    chat: { threadId: dispatch.threadId, dispatchTurnId: dispatch.turnId, answerTurnId: answer.turnId,
      steeringTurnId: steering.turnId, steeringOperationId: steeringOperation.operationId,
      taskId: completed.id, runId: completed.run.id, interactionId: waiting.interaction.id },
    responses: { threadId: reading.threadId, readTurnId: reading.turnId, revisionTurnId: revision.turnId,
      revisionOperationId: revisionOperation.operationId, revisedRunId: revisionOperation.runId,
      cancellationTurnId: cancellation.turnId, cancellationOperationId: cancellationOperation.operationId,
      cancelledRunId: cancelling.run.id },
    reports: { sourceVersionId: source.versionId, revisedVersionId: latest.versionId },
    tools: ['ask_user', 'search_web', 'open_public_page'], sandboxes: 'none-active',
  }
} finally {
  await api('/api/model-connection/models', 'PUT', originalSelections)
}

console.log(JSON.stringify(result))
