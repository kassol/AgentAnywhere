// Run in the W0 image with --network none; no real provider or credentials.
import assert from 'node:assert/strict'
import { testBackendConnection } from '/app/packages/shared/src/agent/backend/factory.ts'
import { ensureConfigDir } from '/app/packages/shared/src/config/storage.ts'

ensureConfigDir()

let requests = 0
const server = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  async fetch(request) {
    assert.equal(new URL(request.url).pathname, '/v1/chat/completions')
    assert.equal(request.headers.get('authorization'), 'Bearer w0-offline-key')
    const body = await request.json() as { model: string; stream: boolean }
    assert.equal(body.model, 'gpt-6-astra')
    assert.equal(body.stream, true)
    requests++
    const chunk = (delta: object, finish_reason: string | null) => JSON.stringify({
      id: 'w0', object: 'chat.completion.chunk', created: 0, model: body.model,
      choices: [{ index: 0, delta, finish_reason }],
    })
    return new Response(`data: ${chunk({ role: 'assistant', content: 'ok' }, null)}\n\ndata: ${chunk({}, 'stop')}\n\ndata: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    })
  },
})
try {
  const result = await testBackendConnection({
    provider: 'pi', apiKey: 'w0-offline-key', model: 'gpt-6-astra',
    baseUrl: `http://127.0.0.1:${server.port}/v1`, timeoutMs: 15000,
    hostRuntime: { appRootPath: '/app', resourcesPath: '/app/resources', isPackaged: false },
    connection: { providerType: 'pi_compat', piAuthProvider: 'openai', customEndpoint: { api: 'openai-completions' } },
  })
  assert.deepEqual(result, { success: true })
  assert.equal(requests, 1)
  console.log('PASS: Node Pi bundle, init, credentials, OpenAI streaming response, mini completion')
} finally {
  server.stop(true)
}
// The upstream connection-test deadline remains scheduled after success.
process.exit(0)
