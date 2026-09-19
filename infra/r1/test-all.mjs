import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

const mode = process.argv[2] || 'isolated'
assert.ok(['isolated', 'live', 'public'].includes(mode), 'Mode must be isolated, live or public')
if (mode !== 'isolated') {
  for (const name of mode === 'live' ? ['live-run', 'live-research'] : ['public']) {
    execFileSync(process.execPath, [fileURLToPath(new URL(`test-${name}.mjs`, import.meta.url))], { stdio: 'inherit' })
  }
  console.log(`All ${mode} R1 acceptance checks passed`)
  process.exit(0)
}

// These checks restart test services and change test model configuration.
const origin = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:19112'
assert.equal(origin, 'http://127.0.0.1:19112', 'Use the isolated R1 test stack')
assert.ok(process.env.TEST_CONTROL_PLANE_ORIGIN, 'Set TEST_CONTROL_PLANE_ORIGIN to the queue configuration')
execFileSync('docker', ['restart', 'agentanywhere-r1-test-model-fixture-1'], { stdio: 'inherit' })
const fixture = process.env.TEST_FIXTURE_ORIGIN || 'http://127.0.0.1:19113'
let ready = false
for (let attempt = 0; attempt < 30; attempt++) {
  try { ready = (await fetch(`${fixture}/calls`, { signal: AbortSignal.timeout(1000) })).ok } catch {}
  if (ready) break
  await new Promise(resolve => setTimeout(resolve, 500))
}
assert.ok(ready, 'The model/search HTTP fixture did not start')
const password = (await readFile(process.env.TEST_PASSWORD_FILE || '/opt/agentanywhere-r1/test-password', 'utf8')).trim()
const login = await fetch(`${origin}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
assert.equal(login.status, 204)
const cookie = login.headers.get('set-cookie').split(';')[0]
const connectionResponse = await fetch(`${origin}/api/model-connection`, { headers: { cookie } })
assert.ok(connectionResponse.ok)
const connection = await connectionResponse.json()
// R1 configuration checks begin without a selected steward or research pool.
const reset = await fetch(`${origin}/api/model-connection/models`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ models: connection.models, defaultModel: connection.defaultModel, stewardModel: null, researchModelPool: [] }) })
assert.ok(reset.ok, `Reset isolated model selection: ${reset.status}`)
console.log('Running model-settings public API regression')
execFileSync('docker', ['exec', 'agentanywhere-r1-test-web-1', 'sh', '-lc', 'AGENTANYWHERE_TEST_DATABASE_URL="$DATABASE_URL" bun test src/model-connection.test.ts src/work.test.ts src/steward.test.ts src/steward-summary.test.ts'], { stdio: 'inherit' })
for (const name of ['run', 'report-contract', 'research', 'steering', 'interaction', 'cancel', 'continuation', 'recovery', 'steward-query', 'steward-dispatch', 'steward-control', 'steward-status', 'steward-interaction', 'steward-summary', 'steward-retry']) {
  console.log(`Running ${name}`)
  execFileSync(process.execPath, [fileURLToPath(new URL(`test-${name}.mjs`, import.meta.url))], { stdio: 'inherit' })
}
console.log('All isolated R1 integration checks passed')
