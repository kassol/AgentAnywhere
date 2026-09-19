import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const base = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19112'
const fixture = process.env.TEST_FIXTURE_ORIGIN || 'http://127.0.0.1:19113'
const password = (await readFile(process.env.TEST_PASSWORD_FILE || '/opt/agentanywhere/runtime/test-password', 'utf8')).trim()
const auth = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
assert.equal(auth.status, 204)
const cookie = auth.headers.get('set-cookie')?.split(';')[0]
assert.ok(cookie)
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json()
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(data)}`)
  return { status: response.status, data }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(read, predicate) {
  for (let i = 0; i < 180; i++) {
    const value = await read()
    if (predicate(value)) return value
    await sleep(500)
  }
  throw new Error('Timed out waiting for cancellation fixture')
}
const detail = async task => (await api(`/api/tasks/${task.id}`)).data
const events = async task => (await api(`/api/tasks/${task.id}/events`)).data
const create = async (modelId, protocol) => (await api('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: 'Use the fixture and submit a report.', modelId, protocol })).data
const cancel = async task => api(`/api/tasks/${task.id}/cancel`, 'POST')
const waiting = async () => (await (await fetch(`${fixture}/waiting-model`)).json()).count
const waitingSearch = async () => (await (await fetch(`${fixture}/waiting-search`)).json()).count
const researchCalls = async () => (await (await fetch(`${fixture}/calls`)).json()).filter(call => call.model === 'fixture-research').length

await api('/api/model-connection', 'PUT', { endpoint: 'http://model-fixture:3002/v1', apiKey: 'fixture-only' })
await api('/api/model-connection/models', 'PUT', { defaultModel: 'fixture-cancel-chat', models: [
  { id: 'fixture-cancel-chat', protocol: 'chat-completions' },
  { id: 'fixture-cancel-responses', protocol: 'responses' },
  { id: 'fixture-cancel-after-report', protocol: 'chat-completions' },
  { id: 'fixture-slow', protocol: 'chat-completions' },
  { id: 'fixture-research', protocol: 'chat-completions' },
  { id: 'fixture-double-ask', protocol: 'chat-completions' },
].map(model => ({ ...model, overrides: { contextWindow: 128000, maxTokens: 1024, input: ['text'], reasoning: false, tools: true } })) })

const streamed = await create('fixture-cancel-chat', 'chat-completions')
await until(waiting, count => count > 0)
const queued = await create('fixture-cancel-responses', 'responses')
assert.equal((await cancel(queued)).status, 202)
assert.equal((await cancel(queued)).status, 200)
assert.equal((await detail(queued)).run.status, 'cancelled')
assert.equal((await cancel(streamed)).status, 202)
assert.equal((await cancel(streamed)).status, 200)
assert.equal((await detail(streamed)).run.status, 'cancelling')
await until(() => detail(streamed), value => value.run.status === 'cancelled' && value.run.cleanupState === 'cleaned')
await until(waiting, count => count === 0)
assert.ok(!(await events(streamed)).some(event => event.type === 'run.finished'))

const responseRun = await create('fixture-cancel-responses', 'responses')
await until(waiting, count => count > 0)
assert.equal((await cancel(responseRun)).status, 202)
await until(() => detail(responseRun), value => value.run.status === 'cancelled' && value.run.cleanupState === 'cleaned')
await until(waiting, count => count === 0)

const partial = await create('fixture-cancel-after-report', 'chat-completions')
await until(waiting, count => count > 0)
assert.equal((await cancel(partial)).status, 202)
const saved = await until(() => detail(partial), value => value.run.status === 'cancelled' && value.run.cleanupState === 'cleaned')
assert.ok(saved.artifacts.some(item => item.kind === 'report'))
const report = saved.artifacts.find(item => item.kind === 'report')
assert.match((await api(`/api/artifacts/${report.versionId}/content`)).data.markdown, /Fixture report/)
await until(waiting, count => count === 0)

const research = await create('fixture-research', 'chat-completions')
await until(waitingSearch, count => count > 0)
const researchEvents = await events(research)
assert.ok(researchEvents.some(event => event.type === 'tool.started' && event.payload.name === 'search_web'))
assert.ok(!researchEvents.some(event => event.type === 'tool.completed' && event.payload.name === 'search_web'))
const callsDuringSearch = await researchCalls()
assert.equal((await cancel(research)).status, 202)
await until(() => detail(research), value => value.run.status === 'cancelled' && value.run.cleanupState === 'cleaned')
await until(waitingSearch, count => count === 0)
assert.equal(await researchCalls(), callsDuringSearch)

const asking = await create('fixture-double-ask', 'chat-completions')
let asked = false
for (let attempt = 0; attempt < 900; attempt++) {
  if ((await events(asking)).some(event => event.type === 'interaction.requested')) { asked = true; break }
  await sleep(50)
}
assert.ok(asked, 'ask_user did not reach checkpoint handoff')
assert.equal((await cancel(asking)).status, 202)
await until(() => detail(asking), value => value.run.status === 'cancelled' && value.run.cleanupState === 'cleaned')

const complete = await create('fixture-slow', 'chat-completions')
await until(() => detail(complete), value => value.run.status === 'succeeded' && value.run.cleanupState === 'cleaned')
assert.equal((await cancel(complete)).status, 200)
assert.equal((await detail(complete)).run.status, 'succeeded')

const checkSandboxes = `import { SandboxManager } from '@alibaba-group/opensandbox';
const manager = SandboxManager.create({ connectionConfig: { domain: process.env.OPEN_SANDBOX_DOMAIN, protocol: 'http', apiKey: process.env.OPEN_SANDBOX_API_KEY, useServerProxy: true, disableMetrics: true } });
for (const runId of process.argv.slice(1)) {
  const result = await manager.listSandboxInfos({ metadata: { runId }, pageSize: 100 });
  if (result.items.some(item => item.status.state !== 'Deleted')) throw new Error('Sandbox still active for ' + runId);
}`
execFileSync('docker', ['exec', 'agentanywhere-r1-test-queue-1', 'node', '--input-type=module', '-e', checkSandboxes, ...[streamed, queued, responseRun, partial, research, asking, complete].map(task => task.run.id)], { stdio: 'pipe' })
console.log(JSON.stringify({ queued: 'cancelled', chat: 'cancelled', responses: 'cancelled', savedReport: true, searchRequestAborted: true, askCancellation: 'cleaned', completedRace: 'succeeded', sandboxes: 'none-active' }))
