import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const base = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19112'
const fixture = process.env.TEST_FIXTURE_ORIGIN || 'http://127.0.0.1:19113'
const password = (await readFile(process.env.TEST_PASSWORD_FILE || '/opt/agentanywhere/runtime/test-password', 'utf8')).trim()
const login = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
assert.equal(login.status, 204)
const cookie = login.headers.get('set-cookie')?.split(';')[0]
assert.ok(cookie)
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const value = await response.json()
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(value)}`)
  return { value, status: response.status }
}
const before = (await (await fetch(`${fixture}/calls`)).json()).length
await api('/api/model-connection', 'PUT', { endpoint: 'http://model-fixture:3002/v1', apiKey: 'fixture-only' })
await api('/api/model-connection/models', 'PUT', { defaultModel: 'fixture-slow', models: [{ id: 'fixture-slow', protocol: 'chat-completions', overrides: { contextWindow: 128000, maxTokens: 1024, input: ['text'], reasoning: false, tools: true } }] })
const { value: task } = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '提交简短报告。', modelId: 'fixture-slow' })
let cursor = 0
let sent = false
const addition = { commandId: crypto.randomUUID(), kind: 'steer', content: '追加：最终回复须包含 STEERING_MARKER_12。' }
for (let attempt = 0; attempt < 240; attempt++) {
  const { value: events } = await api(`/api/tasks/${task.id}/events?after=${cursor}`)
  if (events.length) cursor = events.at(-1).serverSeq
  if (!sent && events.some(event => event.type === 'message.delta')) {
    const created = await api(`/api/runs/${task.run.id}/messages`, 'POST', addition)
    assert.equal(created.status, 201)
    assert.equal((await api(`/api/runs/${task.run.id}/messages`, 'POST', addition)).status, 200)
    const { value: detail } = await api(`/api/tasks/${task.id}`)
    assert.equal(detail.thread.messages.filter(message => message.content === addition.content).length, 1)
    assert.equal(detail.thread.messages.at(-1).status, 'pending')
    sent = true
  }
  const { value: detail } = await api(`/api/tasks/${task.id}`)
  if (['succeeded', 'failed', 'lost', 'save_failed'].includes(detail.run.status)) {
    assert.ok(sent, 'streaming response did not start before Run ended')
    assert.equal(detail.run.status, 'succeeded')
    assert.equal(detail.thread.messages.at(-1).status, 'applied')
    const calls = (await (await fetch(`${fixture}/calls`)).json()).slice(before).filter(call => call.model === 'fixture-slow')
    assert.equal(calls.length, 5)
    assert.ok(calls.slice(0, 3).every(call => !call.userMessages.some(message => message.includes('STEERING_MARKER_12'))))
    assert.ok(calls[3].userMessages.some(message => message.includes('STEERING_MARKER_12')))
    const report = detail.artifacts.find(artifact => artifact.kind === 'report')
    assert.ok(report)
    assert.match((await api(`/api/artifacts/${report.versionId}/content`)).value.markdown, /STEERING_MARKER_12/)
    console.log(JSON.stringify({ taskId: task.id, runId: task.run.id, calls: calls.length, steerStatus: 'applied', reportRevised: true, cleanup: detail.run.cleanupState }))
    process.exit(0)
  }
  await new Promise(resolve => setTimeout(resolve, 500))
}
throw new Error('Run did not finish')
