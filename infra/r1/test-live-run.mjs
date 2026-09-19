import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'
import { dirname } from 'node:path'

const base = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19114'
assert.equal(base, 'http://127.0.0.1:19114', 'Use the isolated 19114 live-test stack')
const configFile = process.env.TEST_ISOLATED_MODEL_CONFIG_FILE
assert.ok(configFile, 'Set TEST_ISOLATED_MODEL_CONFIG_FILE to a writable copy of the model configuration')
const configPath = await realpath(configFile)
const formalConfigPaths = await Promise.all([
  '/opt/agentanywhere/runtime/data/model-connection.json',
  '/opt/agentanywhere-r1/data/model-connection.json',
].map(path => realpath(path).catch(() => path)))
assert.ok(!formalConfigPaths.includes(configPath), 'Refusing to change the formal model configuration')
const webContainer = 'agentanywhere-r1-live-test-web-1'
const queueContainer = 'agentanywhere-r1-live-test-queue-1'
const mounts = JSON.parse(execFileSync('docker', ['inspect', '--format', '{{json .Mounts}}', webContainer], { encoding: 'utf8' }))
const mounted = mounts.find(mount => mount.Destination === '/data')
assert.ok(mounted?.RW && await realpath(mounted.Source) === dirname(configPath), 'Mount the isolated model directory writable at /data in the live-test Web container')
assert.ok(!mounts.some(mount => mount.Destination === '/data/model-connection.json'), 'A file bind mount prevents atomic model configuration updates')

const password = (await readFile(process.env.TEST_PASSWORD_FILE || '/opt/agentanywhere/runtime/test-password', 'utf8')).trim()
const login = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
assert.equal(login.status, 204)
const cookie = login.headers.get('set-cookie')?.split(';')[0]
assert.ok(cookie)
async function request(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, value: await response.json() }
}
async function api(path, method = 'GET', body) {
  const result = await request(path, method, body)
  assert.ok(result.status >= 200 && result.status < 300, `${path}: HTTP ${result.status}`)
  return result.value
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(read, accept, label, attempts = 240, interval = 500) {
  for (let i = 0; i < attempts; i++) {
    const value = await read()
    if (accept(value)) return value
    await sleep(interval)
  }
  throw new Error(`Timed out waiting for ${label}`)
}
const detail = task => api(`/api/tasks/${task.id}`)
const events = task => api(`/api/tasks/${task.id}/events`)
const terminal = task => until(() => detail(task), value => ['succeeded', 'failed', 'lost', 'cancelled', 'save_failed'].includes(value.run.status) && value.run.cleanupState === 'cleaned', `Run ${task.run.id} cleanup`)
const create = (modelId, protocol, goal) => api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), modelId, protocol, goal })
const modelId = process.env.TEST_LIVE_MODEL_ID || 'gpt-6-astra'
const missingModelId = `agentanywhere-test-missing-${crypto.randomUUID()}`
const connection = await api('/api/model-connection')
const selected = connection.models.find(model => model.id === modelId)
assert.ok(selected, 'The real gateway model must be selected in the isolated copy')
assert.ok(selected.contextWindow && selected.maxTokens && selected.input?.includes('text') && typeof selected.reasoning === 'boolean', 'The selected model needs complete runtime metadata')
const runtimeOverrides = { contextWindow: selected.contextWindow, maxTokens: selected.maxTokens, input: selected.input, reasoning: selected.reasoning, ...(typeof selected.tools === 'boolean' ? { tools: selected.tools } : {}) }
const originalModels = connection.models.map(model => ({ id: model.id, protocol: model.protocol, ...(model.catalogId ? { catalogId: model.catalogId } : {}), overrides: model.overrides ?? {} }))
const touchedRuns = []
const results = []
try {
  for (const protocol of ['chat-completions', 'responses']) {
    const models = originalModels.map(model => model.id === modelId ? { ...model, protocol } : model)
    models.push({ id: missingModelId, protocol, overrides: runtimeOverrides })
    await api('/api/model-connection/models', 'PUT', { defaultModel: connection.defaultModel, models })
    assert.deepEqual(await api('/api/model-connection/test', 'POST', { modelId, protocol }), { ok: true, modelId, protocol })

    const success = await create(modelId, protocol, 'Call echo_observation once with the text "real gateway observation". Submit a short Markdown report about the observation. Then briefly confirm completion.')
    touchedRuns.push(success.run.id)
    const completed = await terminal(success)
    assert.equal(completed.run.model.protocol, protocol)
    assert.equal(completed.run.status, 'succeeded', `The ${protocol} tool Run failed`)
    const history = await events(success)
    assert.ok(history.filter(event => event.type === 'message.delta' && event.payload.delta).length >= 2, `${protocol}: fewer than two streamed text deltas`)
    assert.ok(history.some(event => event.type === 'tool.started' && event.payload.name === 'echo_observation' && event.payload.args.text === 'real gateway observation'))
    assert.ok(history.some(event => event.type === 'tool.completed' && event.payload.name === 'echo_observation' && event.payload.result.includes('real gateway observation') && !event.payload.isError))
    assert.ok(history.some(event => event.type === 'run.finished'))
    assert.ok(completed.artifacts.some(artifact => artifact.kind === 'report'))

    const cancelling = await create(modelId, protocol, 'Before using any tools, write a detailed 20-section analysis of the history of public web research, with several paragraphs per section. Then submit a Markdown report. Do not summarize the analysis.')
    touchedRuns.push(cancelling.run.id)
    await until(async () => ({ detail: await detail(cancelling), events: await events(cancelling) }), value => value.events.some(event => event.type === 'message.delta') || ['succeeded', 'failed', 'lost'].includes(value.detail.run.status), `${protocol} streaming start`, 600, 100)
    const beforeCancel = await detail(cancelling)
    const streamed = (await events(cancelling)).some(event => event.type === 'message.delta')
    assert.ok(streamed && !['succeeded', 'failed', 'lost'].includes(beforeCancel.run.status), `${protocol}: Run ended before streaming cancellation`)
    assert.equal((await request(`/api/tasks/${cancelling.id}/cancel`, 'POST')).status, 202)
    const cancelled = await terminal(cancelling)
    assert.equal(cancelled.run.status, 'cancelled')
    const cancelledEvents = await events(cancelling)
    assert.ok(cancelledEvents.some(event => event.type === 'run.cancel_requested'))
    assert.ok(!cancelledEvents.some(event => event.type === 'run.finished'))

    const badTest = await request('/api/model-connection/test', 'POST', { modelId: missingModelId, protocol })
    assert.equal(badTest.status, 502, `${protocol}: the deliberately missing model unexpectedly passed connection test`)
    assert.ok(Number.isInteger(badTest.value.status), `${protocol}: missing upstream error status`)
    const failing = await create(missingModelId, protocol, 'Submit a short report.')
    touchedRuns.push(failing.run.id)
    const failed = await terminal(failing)
    assert.equal(failed.run.model.protocol, protocol)
    assert.equal(failed.run.status, 'failed', `${protocol}: missing model did not fail visibly`)
    const failedEvents = await events(failing)
    assert.ok(failedEvents.some(event => event.type === 'run.failed'))
    assert.ok(!failedEvents.some(event => event.type === 'run.finished'))

    const usage = [...new Map(history.filter(event => event.type === 'usage').map(event => [event.payload.callId, event.payload])).values()]
    results.push({ protocol, toolRun: success.run.id, streamedDeltas: history.filter(event => event.type === 'message.delta').length,
      usage: usage.length ? { calls: usage.length, inputTokens: usage.every(item => typeof item.inputTokens === 'number') ? usage.reduce((sum, item) => sum + item.inputTokens, 0) : 'unknown',
        outputTokens: usage.every(item => typeof item.outputTokens === 'number') ? usage.reduce((sum, item) => sum + item.outputTokens, 0) : 'unknown' } : 'unknown',
      cancelledRun: cancelling.run.id, errorRun: failing.run.id, gatewayErrorStatus: badTest.value.status })
  }
} finally {
  await api('/api/model-connection/models', 'PUT', { defaultModel: connection.defaultModel, models: originalModels })
}

const checkSandboxes = `import { SandboxManager } from '@alibaba-group/opensandbox';
const manager = SandboxManager.create({ connectionConfig: { domain: process.env.OPEN_SANDBOX_DOMAIN, protocol: 'http', apiKey: process.env.OPEN_SANDBOX_API_KEY, useServerProxy: true, disableMetrics: true } });
for (const runId of process.argv.slice(1)) {
  const result = await manager.listSandboxInfos({ metadata: { runId }, pageSize: 100 });
  if (result.items.some(item => item.status.state !== 'Deleted')) throw new Error('Sandbox still active for ' + runId);
}`
execFileSync('docker', ['exec', queueContainer, 'node', '--input-type=module', '-e', checkSandboxes, ...touchedRuns], { stdio: 'pipe' })
console.log(JSON.stringify({ results, sandboxes: 'none-active' }))
