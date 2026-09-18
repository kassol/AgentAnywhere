import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const base = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19112'
const fixture = process.env.TEST_FIXTURE_ORIGIN || 'http://127.0.0.1:19113'
const password = (await readFile(process.env.TEST_PASSWORD_FILE || '/opt/agentanywhere-r1/test-password', 'utf8')).trim()
const login = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
assert.equal(login.status, 204)
const cookie = login.headers.get('set-cookie')?.split(';')[0]
assert.ok(cookie)
async function api(path, method = 'GET', body, expected) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const value = await response.json()
  if (expected === undefined) assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(value)}`)
  else assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}`)
  return value
}
async function until(taskId, wanted) {
  for (let attempt = 0; attempt < 180; attempt++) {
    const detail = await api(`/api/tasks/${taskId}`)
    if (detail.run.status === wanted && (wanted !== 'waiting' || detail.run.cleanupState === 'cleaned')) return detail
    assert.ok(!['failed', 'lost', 'save_failed'].includes(detail.run.status), JSON.stringify(detail.run))
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`${taskId} did not reach ${wanted}`)
}
const before = (await (await fetch(`${fixture}/calls`)).json()).length
await api('/api/model-connection', 'PUT', { endpoint: 'http://model-fixture:3002/v1', apiKey: 'fixture-only' })
await api('/api/model-connection/models', 'PUT', { defaultModel: 'fixture-ask', models: [
  { id: 'fixture-ask', protocol: 'chat-completions', overrides: { contextWindow: 128000, maxTokens: 1024, input: ['text'], reasoning: false, tools: true } },
  { id: 'fixture-chat', protocol: 'chat-completions', overrides: { contextWindow: 128000, maxTokens: 1024, input: ['text'], reasoning: false, tools: true } },
] })
const first = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '先观察，再提问，按回答提交报告。', modelId: 'fixture-ask' })
const waiting = await until(first.id, 'waiting')
assert.equal(waiting.interaction.question, '请确认研究方向？')
assert.equal(waiting.interaction.status, 'pending')
assert.equal(waiting.run.epoch, 1)
const waitingEvents = await api(`/api/tasks/${first.id}/events`)
assert.ok(waitingEvents.some(event => event.type === 'tool.completed' && event.payload.name === 'submit_report' && !event.payload.isError), 'zero-byte attachment checkpoint was not saved')
await new Promise(resolve => setTimeout(resolve, 1500))
assert.equal((await api(`/api/tasks/${first.id}`)).run.status, 'waiting')
await api(`/api/interactions/${waiting.interaction.id}/resolve`, 'POST', { answer: ' ' }, 400)
const second = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '提交另一份简短报告。', modelId: 'fixture-chat' })
await until(second.id, 'succeeded')
assert.equal((await api(`/api/tasks/${first.id}`)).run.status, 'waiting')
await api(`/api/interactions/${waiting.interaction.id}/resolve`, 'POST', { answer: 'ANSWER_MARKER_13：研究机制' }, 202)
await api(`/api/interactions/${waiting.interaction.id}/resolve`, 'POST', { answer: 'ANSWER_MARKER_13：研究机制' }, 200)
await api(`/api/interactions/${waiting.interaction.id}/resolve`, 'POST', { answer: '另一答案' }, 409)
const completed = await until(first.id, 'succeeded')
assert.equal(completed.run.epoch, 2)
assert.equal(completed.run.cleanupState, 'cleaned')
const report = completed.artifacts.find(item => item.kind === 'report')
assert.ok(report)
const content = await api(`/api/artifacts/${report.versionId}/content`)
assert.match(content.markdown, /ANSWER_MARKER_13/)
assert.match(content.markdown, /fixture observation/)
const events = await api(`/api/tasks/${first.id}/events`)
assert.equal(events.filter(event => event.type === 'tool.started' && event.payload.name === 'echo_observation').length, 1)
assert.equal(events.filter(event => event.type === 'interaction.requested').length, 1)
const calls = (await (await fetch(`${fixture}/calls`)).json()).slice(before).filter(call => call.model === 'fixture-ask')
assert.equal(calls.filter(call => call.observation.some(item => item.includes('fixture observation'))).length >= 1, true)
console.log(JSON.stringify({ taskId: first.id, runId: first.run.id, waitingEpoch: 1, finalEpoch: completed.run.epoch, otherWorkSucceeded: true, report: report.versionId }))
