import { afterAll, beforeAll, expect, test } from 'bun:test'
import { connect } from 'node:net'
import { startServer } from './server'

const password = 'test-password-12345'
let server: Awaited<ReturnType<typeof startServer>>
let base: string

beforeAll(async () => {
  server = await startServer({ password, port: 0 })
  base = server.url.origin
})
afterAll(() => server.stop(true))

function websocketStatus(cookie?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = new URL(base)
    const socket = connect(Number(url.port), url.hostname)
    socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('WebSocket handshake timed out')) })
    socket.on('connect', () => socket.write([
      'GET /api/live HTTP/1.1',
      `Host: ${url.host}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      ...(cookie ? [`Cookie: ${cookie}`] : []),
      '', '',
    ].join('\r\n')))
    socket.once('data', data => { resolve(Number(data.toString().match(/^HTTP\/1\.1 (\d+)/)?.[1])); socket.destroy() })
    socket.once('error', reject)
  })
}

test('anonymous, login, work list, live connection and logout use one session boundary', async () => {
  const anonymousPage = await fetch(base, { redirect: 'manual' })
  expect(anonymousPage.status).toBe(302)
  expect(anonymousPage.headers.get('location')).toBe('/login')
  expect((await fetch(`${base}/api/tasks`)).status).toBe(401)
  expect(await websocketStatus()).toBe(401)
  expect((await fetch(`${base}/login`)).status).toBe(200)

  const wrong = await fetch(`${base}/api/auth`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }),
  })
  expect(wrong.status).toBe(401)
  const login = await fetch(`${base}/api/auth`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }),
  })
  expect(login.status).toBe(204)
  const cookie = login.headers.get('set-cookie')!
  expect(cookie).toContain('HttpOnly')
  expect(cookie).toContain('SameSite=Strict')
  expect(cookie).not.toContain(password)
  const headers = { cookie }
  expect((await fetch(base, { headers })).status).toBe(200)
  expect((await fetch(`${base}/settings`, { headers })).status).toBe(200)
  expect((await fetch(`${base}/reports?task=11111111-1111-4111-8111-111111111111`, { headers })).status).toBe(200)
  expect((await fetch(`${base}/reports`, { redirect: 'manual' })).status).toBe(302)
  expect(await (await fetch(`${base}/api/tasks`, { headers })).json()).toEqual([])
  expect(await websocketStatus(cookie)).toBe(101)
  expect((await fetch(`${base}/api/unknown`, { headers })).status).toBe(404)
  expect((await fetch(`${base}/api/logout`, { method: 'POST', headers })).status).toBe(204)
  expect((await fetch(`${base}/api/tasks`, { headers })).status).toBe(401)
  expect(await websocketStatus(cookie)).toBe(401)
})

test('login rejects oversized and cross-origin requests', async () => {
  const crossOrigin = await fetch(`${base}/api/auth`, {
    method: 'POST', headers: { origin: 'https://other.example', 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  expect(crossOrigin.status).toBe(403)
  const oversized = await fetch(`${base}/api/auth`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'x'.repeat(2000) }),
  })
  expect(oversized.status).toBe(401)
})

test('login limits repeated guesses', async () => {
  const limited = await startServer({ password, port: 0 })
  const guess = () => fetch(`${limited.url.origin}/api/auth`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'incorrect' }),
  })
  try {
    for (let i = 0; i < 5; i++) expect((await guess()).status).toBe(401)
    expect((await guess()).status).toBe(429)
  } finally {
    limited.stop(true)
  }
})

test('proxy redirects retain the browser HTTPS origin', async () => {
  const proxied = await startServer({ password, port: 0, publicOrigin: 'https://agent.example', secureCookie: true })
  const proxyHeaders = { host: 'agent.example', 'x-forwarded-proto': 'https' }
  try {
    const anonymous = await fetch(proxied.url, { headers: proxyHeaders, redirect: 'manual' })
    expect(anonymous.headers.get('location')).toBe('/login')
    const login = await fetch(new URL('/api/auth', proxied.url), {
      method: 'POST', headers: { ...proxyHeaders, origin: 'https://agent.example', 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    expect(login.status).toBe(204)
    const cookie = login.headers.get('set-cookie')!
    expect(cookie).toContain('Secure')
    const signedIn = await fetch(new URL('/login', proxied.url), {
      headers: { ...proxyHeaders, cookie }, redirect: 'manual',
    })
    expect(signedIn.headers.get('location')).toBe('/')
  } finally {
    proxied.stop(true)
  }
})
