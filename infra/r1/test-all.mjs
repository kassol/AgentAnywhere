import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

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
for (const name of ['run', 'report-contract', 'research', 'steering', 'interaction', 'cancel', 'continuation', 'recovery']) {
  console.log(`Running ${name}`)
  execFileSync(process.execPath, [fileURLToPath(new URL(`test-${name}.mjs`, import.meta.url))], { stdio: 'inherit' })
}
console.log('All isolated R1 integration checks passed')
