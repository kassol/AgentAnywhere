import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const base = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19112'
const password = (await readFile(process.env.TEST_PASSWORD_FILE || '/opt/agentanywhere/runtime/test-password', 'utf8')).trim()
const login = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
assert.equal(login.status, 204)
const cookie = login.headers.get('set-cookie')?.split(';')[0]
assert.ok(cookie)

async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const value = await response.json()
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(value)}`)
  return value
}

await api('/api/model-connection', 'PUT', { endpoint: 'http://model-fixture:3002/v1', apiKey: 'fixture-only' })
await api('/api/model-connection/models', 'PUT', { defaultModel: 'fixture-empty-attachment', models: ['fixture-empty-attachment', 'fixture-duplicate-name'].map(id => ({ id, protocol: 'chat-completions', overrides: { contextWindow: 128000, maxTokens: 1024, input: ['text'], reasoning: false, tools: true } })) })

async function run(modelId) {
  const created = await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: 'Submit the fixture report.', modelId })
  let detail
  for (let i = 0; i < 120; i++) {
    detail = await api(`/api/tasks/${created.id}`)
    if (['succeeded', 'failed', 'save_failed', 'lost'].includes(detail.run.status) && detail.run.cleanupState !== 'pending') break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  assert.deepEqual([detail.run.status, detail.run.cleanupState], ['succeeded', 'cleaned'])
  return { detail, events: await api(`/api/tasks/${created.id}/events`) }
}

const empty = await run('fixture-empty-attachment')
assert.equal(empty.detail.artifacts.length, 2)
const emptyFile = empty.detail.artifacts.find(item => item.name === 'empty.txt')
assert.ok(emptyFile)
assert.equal(Number(emptyFile.sizeBytes), 0)
assert.equal(emptyFile.sha256, createHash('sha256').update('').digest('hex'))
const download = await fetch(`${base}/api/artifacts/${emptyFile.versionId}/download`, { headers: { cookie } })
assert.equal(download.status, 200)
assert.equal((await download.arrayBuffer()).byteLength, 0)

const duplicate = await run('fixture-duplicate-name')
const submissions = duplicate.events.filter(event => event.type === 'tool.completed' && event.payload.name === 'submit_report')
assert.equal(submissions.length, 2)
assert.ok(submissions[0].payload.isError)
assert.match(submissions[0].payload.result, /附件名称重复/)
assert.equal(submissions[1].payload.isError, false)
assert.equal(duplicate.detail.artifacts.length, 2)
assert.ok(duplicate.events.some(event => event.type === 'run.finished'))
console.log(JSON.stringify({ emptyAttachment: 'downloaded-0-bytes', duplicateName: 'rejected-then-corrected', runs: 2 }))
