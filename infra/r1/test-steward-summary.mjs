import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const base = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19112'
assert.equal(base, 'http://127.0.0.1:19112', 'Use the isolated test stack')
const password = (await readFile(process.env.TEST_PASSWORD_FILE || '/opt/agentanywhere/runtime/test-password', 'utf8')).trim()
async function login() {
  const response = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
  assert.equal(response.status, 204)
  return response.headers.get('set-cookie')?.split(';')[0]
}
let cookie = await login()
assert.ok(cookie)
async function api(path, method = 'GET', body, expected) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const value = await response.json()
  if (expected === undefined) assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(value)}`)
  else assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}`)
  return value
}
async function until(read, ready, label) {
  for (let attempt = 0; attempt < 360; attempt++) {
    const value = await read()
    if (ready(value)) return value
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out: ${label}`)
}
await api('/api/model-connection', 'PUT', { endpoint: 'http://model-fixture:3002/v1', apiKey: 'fixture-only' })
const threads = []
for (const protocol of ['chat-completions', 'responses']) {
  const modelId = `fixture-steward-summary-${protocol === 'responses' ? 'responses' : 'chat'}`
  await api('/api/model-connection/models', 'PUT', { defaultModel: modelId, researchModelPool: [], stewardModel: { modelId, protocol },
    models: [{ id: modelId, protocol, overrides: { contextWindow: 6000, maxTokens: 1000, input: ['text'], reasoning: false, tools: true } }] })
  const thread = await api('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })
  const originals = ['SUMMARY_GOAL ', 'SUMMARY_CONSTRAINT ', 'SUMMARY_PENDING '].map((prefix, index) => prefix + String.fromCharCode(97 + index).repeat(14000))
  let detail
  for (const content of originals) {
    const turn = await api(`/api/steward/threads/${thread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content })
    detail = await until(() => api(`/api/steward/threads/${thread.id}`), item => item.turns.some(row => row.id === turn.id && !['queued','running','stopping'].includes(row.status)), 'summary round')
    assert.equal(detail.turns.at(-1).status, 'completed', JSON.stringify(detail.turns.at(-1)))
  }
  assert.equal(detail.summaries.length, 1)
  assert.equal(detail.summaries[0].fromTurnNumber, 1)
  assert.equal(detail.summaries[0].throughTurnNumber, 2)
  assert.equal(detail.summaries[0].coveredTurns, 2)
  assert.match(detail.summaries[0].content, /SUMMARY_GOAL/)
  assert.equal(detail.turns.at(-1).modelCalls, 3)
  assert.deepEqual(detail.messages.filter(message => message.role === 'user').map(message => message.content), originals)
  assert.equal(detail.relatedTasks.length, 0)
  threads.push({ id: thread.id, protocol, summaryId: detail.summaries[0].id })
}
execFileSync('docker', ['restart', 'agentanywhere-r1-test-web-1'], { stdio: 'pipe' })
await until(async () => { try { return (await fetch(`${base}/login`)).ok } catch { return false } }, Boolean, 'web restart')
cookie = await login()
for (const thread of threads) {
  const restored = await api(`/api/steward/threads/${thread.id}`)
  assert.equal(restored.summaries[0].id, thread.summaryId)
  assert.equal(restored.messages.filter(message => message.role === 'user').length, 3)
  assert.equal(restored.turns.at(-1).modelCalls, 3)
}
console.log(JSON.stringify({ threads, originalMessagesRetained: true, summaryCallsBudgeted: true }))
