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

test('owner sees field sources, can revoke overrides and explicit alias mapping, and keeps the last directory cache', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agentanywhere-metadata-'))
  let directoryStatus = 200
  const directory = Bun.serve({ port: 0, fetch() {
    return Response.json({
      openai: { models: {
        'gpt-6-astra': { limit: { context: 1050000, output: 128000 }, modalities: { input: ['text', 'image', 'pdf'] }, reasoning: true, tool_call: true, cost: { input: 10, output: 50 } },
      } },
      other: { models: { 'gpt-6-astra': { limit: { context: 2000 } } } },
    }, { status: directoryStatus })
  } })
  let gatewayContext: number | undefined = 300000
  const gateway = Bun.serve({ port: 0, fetch() {
    return Response.json({ data: [
      { id: 'gpt-6-astra', owned_by: 'openai', context_window: gatewayContext, tool_call: false, input_price: 0 },
      { id: 'astra-alias', owned_by: 'openai' },
      { id: 'gpt-6-astr', owned_by: 'openai' },
      { id: 'unknown-owner', owned_by: 'other' },
    ] })
  } })
  const password = 'test-password-12345'
  let app = await startServer({ password, port: 0, dataDir, directoryUrl: directory.url.origin })
  let base = app.url.origin
  async function login() {
    const response = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
    return response.headers.get('set-cookie')!
  }
  let cookie = await login()
  const request = (path: string, method = 'GET', body?: unknown) => fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const get = async () => await (await request('/api/model-connection')).json() as { models: Record<string, any>[]; directory: { status: string; cachedModels: number; successAt?: string } }
  const selections = async (overrides: Record<string, unknown> = {}, alias = true) => request('/api/model-connection/models', 'PUT', { defaultModel: 'gpt-6-astra', models: [
    { id: 'gpt-6-astra', protocol: 'responses', overrides },
    { id: 'astra-alias', protocol: 'chat-completions', ...(alias ? { catalogId: 'openai/gpt-6-astra' } : {}), overrides: {} },
    { id: 'gpt-6-astr', protocol: 'chat-completions', overrides: {} },
    { id: 'unknown-owner', protocol: 'chat-completions', overrides: {} },
  ] })
  try {
    expect((await request('/api/model-connection', 'PUT', { endpoint: gateway.url.origin + '/v1', apiKey: 'secret' })).status).toBe(200)
    expect((await request('/api/model-connection/refresh', 'POST')).status).toBe(200)
    expect((await request('/api/model-connection/directory', 'POST')).status).toBe(200)
    expect((await selections({ contextWindow: 9000, tools: false, inputPrice: 0 })).status).toBe(200)
    let current = await get()
    const main = current.models[0]!
    expect(main.contextWindow).toBe(9000)
    expect(main.sources.contextWindow.source).toBe('manual')
    expect(main.maxTokens).toBe(128000)
    expect(main.sources.maxTokens.source).toBe('models.dev')
    expect(main.input).toEqual(['text', 'image'])
    expect(main.inputModalities).toEqual(['text', 'image', 'pdf'])
    expect(main.tools).toBe(false)
    expect(main.sources.tools.source).toBe('manual')
    expect(main.inputPrice).toBe(0)
    expect(main.outputPrice).toBe(50)
    expect(main.catalogMatch).toBe('openai/gpt-6-astra')
    expect(main.sources.outputPrice.updatedAt).toBeTruthy()
    expect(current.models[1]?.contextWindow).toBe(1050000)
    expect(current.models[1]?.catalogMatch).toBe('openai/gpt-6-astra')
    expect(current.models[2]?.contextWindow).toBeUndefined()
    expect(current.models[3]?.contextWindow).toBeUndefined()
    expect((await selections({}, false)).status).toBe(200)
    current = await get()
    expect(current.models[0]?.contextWindow).toBe(300000)
    expect(current.models[0]?.sources.contextWindow.source).toBe('gateway')
    expect(current.models[0]?.tools).toBe(false)
    expect(current.models[0]?.sources.tools.source).toBe('gateway')
    expect(current.models[0]?.inputPrice).toBe(0)
    expect(current.models[0]?.sources.inputPrice.source).toBe('gateway')
    expect(current.models[1]?.contextWindow).toBeUndefined()
    gatewayContext = undefined
    expect((await request('/api/model-connection/refresh', 'POST')).status).toBe(200)
    current = await get()
    expect(current.models[0]?.contextWindow).toBe(1050000)
    expect(current.models[0]?.sources.contextWindow.source).toBe('models.dev')
    directoryStatus = 503
    expect((await request('/api/model-connection/directory', 'POST')).status).toBe(502)
    current = await get()
    expect(current.directory.status).toBe('error')
    expect(current.directory.cachedModels).toBe(2)
    expect(current.models[0]?.maxTokens).toBe(128000)
    app.stop(true)
    app = await startServer({ password, port: 0, dataDir, directoryUrl: directory.url.origin })
    base = app.url.origin
    cookie = await login()
    current = await get()
    expect(current.models[0]?.maxTokens).toBe(128000)
    expect(current.directory.successAt).toBeTruthy()
    expect((await request('/api/model-connection', 'PUT', { endpoint: gateway.url.origin + '/v1', apiKey: 'replacement' })).status).toBe(200)
    current = await get()
    expect(current.models[0]?.contextWindow).toBeUndefined()
    expect(current.models[0]?.maxTokens).toBeUndefined()
    expect(current.models[1]?.contextWindow).toBeUndefined()
  } finally {
    app.stop(true)
    gateway.stop(true)
    directory.stop(true)
    await rm(dataDir, { recursive: true, force: true })
  }
})
