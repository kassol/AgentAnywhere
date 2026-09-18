import assert from 'node:assert/strict'

const base = 'http://127.0.0.1:3000'
const login = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: process.env.AGENTANYWHERE_PASSWORD }) })
assert.equal(login.status, 204)
const cookie = login.headers.get('set-cookie')?.split(';')[0]
assert.ok(cookie)
if (process.env.REFRESH_METADATA === 'true') {
  for (const path of ['/api/model-connection/refresh', '/api/model-connection/directory']) {
    const refreshed = await fetch(`${base}${path}`, { method: 'POST', headers: { cookie } })
    assert.equal(refreshed.status, 200, `${path} returned HTTP ${refreshed.status}`)
  }
}
const current = await fetch(`${base}/api/model-connection`, { headers: { cookie } })
assert.equal(current.status, 200)
const connection = await current.json()
const model = connection.models.find(item => item.id === 'gpt-6-astra') ?? connection.models.find(item => item.id === connection.defaultModel)
assert.ok(model, 'No saved model is available for the live connection test')
const response = await fetch(`${base}/api/model-connection/test`, {
  method: 'POST', headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ modelId: model.id, protocol: model.protocol }),
})
assert.equal(response.status, 200, `Live connection test returned HTTP ${response.status}`)
const result = await response.json()
assert.deepEqual(result, { ok: true, modelId: model.id, protocol: model.protocol })
console.log(JSON.stringify({ modelId: model.id, protocol: model.protocol, status: response.status }))
