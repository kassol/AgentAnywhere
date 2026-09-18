import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startServer } from './server'

test('model settings survive restart; failed refresh retains selected model and never reveals the key', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agentanywhere-model-'))
  let gatewayStatus = 200
  let gatewayBody: unknown = { data: [{ id: 'gpt-6-astra', display_name: 'GPT 6 Astra', owned_by: 'openai', type: 'model', created: 1788480000 }] }
  let gatewayDelay = 0
  const gateway = Bun.serve({ port: 0, async fetch(request) {
    expect(new URL(request.url).pathname).toBe('/v1/models')
    expect(request.headers.get('authorization')).toBe('Bearer secret-key')
    if (gatewayDelay) await Bun.sleep(gatewayDelay)
    return Response.json(gatewayBody, { status: gatewayStatus })
  } })
  const password = 'test-password-12345'
  let app = await startServer({ password, port: 0, dataDir, modelTimeoutMs: 40 })
  let base = app.url.origin
  async function signIn() {
    const response = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
    return response.headers.get('set-cookie')!
  }
  let cookie = await signIn()
  const request = (path: string, method = 'GET', body?: unknown) => fetch(`${base}${path}`, {
    method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  })
  try {
    expect((await fetch(`${base}/api/model-connection`)).status).toBe(401)
    expect((await request('/api/model-connection', 'PUT', { endpoint: gateway.url.origin + '/v1', apiKey: 'secret-key' })).status).toBe(200)
    let visible = await (await request('/api/model-connection')).text()
    expect(visible).not.toContain('secret-key')
    expect(visible).toContain('"hasCredential":true')
    expect((await request('/api/model-connection/refresh', 'POST')).status).toBe(200)
    expect((await request('/api/model-connection')).text().then(text => text.includes('"ownedBy":"openai"'))).resolves.toBe(true)
    expect((await request('/api/model-connection/models', 'PUT', { defaultModel: 'gpt-6-astra', models: [{ id: 'gpt-6-astra', protocol: 'responses', contextWindow: 128000, maxTokens: 8192, input: ['text'], reasoning: true }] })).status).toBe(200)
    expect((await request('/api/model-connection', 'PUT', { endpoint: gateway.url.origin + '/v1', apiKey: 'replacement-key' })).status).toBe(200)
    let changed = await (await request('/api/model-connection')).json() as { discovery: { status: string }; catalogSourceEndpoint: string; models: { id: string }[]; defaultModel: string }
    expect(changed.discovery.status).toBe('stale')
    expect(changed.catalogSourceEndpoint).toBe(gateway.url.origin + '/v1')
    expect(changed.models[0]?.id).toBe('gpt-6-astra')
    expect(changed.defaultModel).toBe('gpt-6-astra')
    expect((await request('/api/model-connection', 'PUT', { endpoint: gateway.url.origin + '/v1', apiKey: 'secret-key' })).status).toBe(200)
    expect((await request('/api/model-connection')).json().then(value => value.discovery.status)).resolves.toBe('stale')
    expect((await request('/api/model-connection/refresh', 'POST')).status).toBe(200)
    gatewayStatus = 401
    expect((await request('/api/model-connection/refresh', 'POST')).status).toBe(502)
    visible = await (await request('/api/model-connection')).text()
    expect(visible).toContain('gpt-6-astra')
    expect(visible).toContain('"defaultModel":"gpt-6-astra"')
    expect(visible).toContain('"status":"unauthorized"')
    expect(visible).not.toContain('secret-key')
    gatewayStatus = 200
    gatewayBody = { data: [] }
    expect((await request('/api/model-connection/refresh', 'POST')).status).toBe(422)
    expect((await request('/api/model-connection')).text().then(text => text.includes('"status":"empty"'))).resolves.toBe(true)
    gatewayDelay = 120
    expect((await request('/api/model-connection/refresh', 'POST')).status).toBe(504)
    visible = await (await request('/api/model-connection')).text()
    expect(visible).toContain('"status":"timeout"')
    expect(visible).toContain('gpt-6-astra')
    expect((await request('/api/model-connection', 'PUT', { endpoint: 'http://127.0.0.1:12345/v1', apiKey: '' })).status).toBe(400)
    expect((await request('/api/model-connection')).text().then(text => text.includes(gateway.url.origin))).resolves.toBe(true)
    app.stop(true)
    app = await startServer({ password, port: 0, dataDir, modelTimeoutMs: 40 })
    base = app.url.origin
    cookie = await signIn()
    visible = await (await request('/api/model-connection')).text()
    expect(visible).toContain('"protocol":"responses"')
    expect(visible).toContain('"hasCredential":true')
    expect((await readFile(join(dataDir, 'model-connection.json'), 'utf8')).includes('secret-key')).toBe(true)
    expect((await stat(join(dataDir, 'model-connection.json'))).mode & 0o777).toBe(0o600)
  } finally {
    app.stop(true)
    gateway.stop(true)
    await rm(dataDir, { recursive: true, force: true })
  }
})
