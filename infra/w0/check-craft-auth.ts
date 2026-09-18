// Run inside the Craft container: bun /tmp/check-craft-auth.ts
// Credentials stay in the container; output includes only check names.
import assert from 'node:assert/strict'
const url = 'http://127.0.0.1:9100'
for (const path of ['/api/config', '/api/config/workspaces']) {
  assert.equal((await fetch(url + path)).status, 401)
}
assert.equal((await fetch(url, { redirect: 'manual' })).status, 302)
assert.equal((await fetch(url + '/login')).status, 200)
assert.equal((await fetch(url + '/api/auth', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'w0-deliberately-invalid-password' }),
})).status, 401)
const login = await fetch(url + '/api/auth', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: process.env.CRAFT_WEBUI_PASSWORD }),
})
assert.equal(login.status, 200)
const setCookie = login.headers.get('set-cookie')!
for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure']) assert.ok(setCookie.includes(flag))
const cookie = setCookie.split(';')[0]
assert.equal((await fetch(url + '/api/config', { headers: { cookie } })).status, 200)
async function handshake(authenticated: boolean) {
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:9100', authenticated ? { headers: { Cookie: cookie } } : {})
    const timer = setTimeout(() => { ws.close(); reject(new Error('Handshake timeout')) }, 7000)
    let ack = false
    ws.onopen = () => ws.send(JSON.stringify({ id: 'w0-auth-check', type: 'handshake', protocolVersion: '1.0' }))
    ws.onmessage = event => {
      const message = JSON.parse(String(event.data))
      if (message.type === 'handshake_ack') { ack = true; ws.close() }
    }
    ws.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket error')) }
    ws.onclose = event => {
      clearTimeout(timer)
      try {
        assert.equal(ack, authenticated)
        if (!authenticated) assert.equal(event.code, 4005)
        resolve()
      } catch (error) { reject(error) }
    }
  })
}
await handshake(false)
await handshake(true)
console.log('PASS: unauthenticated HTTP rejected; login and secure cookie; WebSocket handshake requires credentials')
