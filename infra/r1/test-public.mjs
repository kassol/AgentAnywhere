import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { connect } from 'node:tls'

const base = new URL('https://agent.riverflows.in')
const password = (await readFile(process.env.TEST_PASSWORD_FILE, 'utf8')).trim()
function handshake(cookie) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: base.hostname, port: 443, servername: base.hostname }, () => {
      socket.write(['GET /api/live HTTP/1.1', `Host: ${base.host}`, 'Connection: Upgrade', 'Upgrade: websocket',
        'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        `Origin: ${base.origin}`, ...(cookie ? [`Cookie: ${cookie}`] : []), '', ''].join('\r\n'))
    })
    socket.setTimeout(5000, () => socket.destroy(new Error('WSS handshake timed out')))
    socket.once('error', reject)
    socket.once('data', data => { socket.destroy(); resolve(Number(data.toString().match(/^HTTP\/1\.1 (\d+)/)?.[1])) })
  })
}
assert.equal((await fetch(new URL('/api/tasks', base))).status, 401)
for (const path of ['/api/steward/threads', '/api/interactions/pending']) assert.equal((await fetch(new URL(path, base))).status, 401)
assert.equal(await handshake(), 401)
const login = await fetch(new URL('/api/auth', base), { method: 'POST', headers: { 'content-type': 'application/json', origin: base.origin }, body: JSON.stringify({ password }) })
assert.equal(login.status, 204)
const setCookie = login.headers.get('set-cookie')
for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict']) assert.ok(setCookie.includes(attribute))
const cookie = setCookie.split(';')[0]
for (const path of ['/api/steward/threads', '/api/interactions/pending']) {
  const response = await fetch(new URL(path, base), { headers: { cookie } })
  assert.equal(response.status, 200)
  assert.ok(Array.isArray(await response.json()))
}
assert.equal((await fetch(new URL('/api/steward/threads', base), { method: 'POST',
  headers: { cookie, origin: 'https://other.example', 'content-type': 'application/json' },
  body: JSON.stringify({ requestId: crypto.randomUUID() }) })).status, 403)
assert.equal(await handshake(cookie), 101)
for (const path of ['/api/share', '/api/channels', '/api/subscriptions', '/api/rpc', '/api/oauth', '/share', '/desktop']) {
  for (const method of ['GET', 'POST']) {
    const response = await fetch(new URL(path, base), { method, headers: { cookie, origin: base.origin } })
    assert.equal(response.status, 404, `${method} ${path}`)
  }
}
const page = await fetch(base, { headers: { cookie } })
assert.equal(page.status, 200)
assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/)
assert.match(page.headers.get('content-security-policy'), /(?:^|; )font-src 'self'(?:;|$)/)
const html = await page.text()
const cssPath = html.match(/href="([^"]+\.css)"/)?.[1]
assert.ok(cssPath, 'Production page must load its stylesheet')
const stylesheet = await (await fetch(new URL(cssPath, base))).text()
const fontPath = stylesheet.match(/url\(["']?([^"')]+\.woff2)["']?\)/)?.[1]
assert.ok(fontPath, 'Production stylesheet must declare the self-hosted font')
const font = await fetch(new URL(fontPath, new URL(cssPath, base)))
assert.equal(font.status, 200)
assert.equal(new TextDecoder().decode((await font.arrayBuffer()).slice(0, 4)), 'wOF2')
assert.equal((await fetch(new URL('/api/logout', base), { method: 'POST', headers: { cookie, origin: 'https://other.example' } })).status, 403)
assert.equal((await fetch(new URL('/api/logout', base), { method: 'POST', headers: { cookie, origin: base.origin } })).status, 204)
assert.equal(await handshake(cookie), 401)
console.log('Public HTTPS, secure session, WSS, Origin guard and legacy route negatives passed')
