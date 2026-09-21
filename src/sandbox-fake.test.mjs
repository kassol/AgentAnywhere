import assert from 'node:assert/strict'
import test from 'node:test'
import { FakeSandboxAdapter } from './sandbox-fake.mjs'

test('FakeSandboxAdapter create and destroy lifecycle', async () => {
  const adapter = new FakeSandboxAdapter()
  const { sandboxId, status } = await adapter.create({ image: 'test', entrypoint: ['sh'], env: {}, metadata: { runId: 'r1' }, resource: { cpu: '1', memory: '512Mi' }, timeoutSeconds: null })
  assert.ok(sandboxId.startsWith('fake-'))
  assert.equal(status, 'running')
  const info = await adapter.inspect(sandboxId)
  assert.equal(info.status, 'running')
  assert.deepStrictEqual(info.metadata, { runId: 'r1' })
  await adapter.destroy(sandboxId)
  await assert.rejects(adapter.inspect(sandboxId), /not found/)
})

test('FakeSandboxAdapter connect to unknown sandbox throws', async () => {
  const adapter = new FakeSandboxAdapter()
  await assert.rejects(adapter.connect('nonexistent'), /not found/)
})

test('FakeSandboxAdapter listSandboxes returns created entries', async () => {
  const adapter = new FakeSandboxAdapter()
  await adapter.create({ image: 'a', entrypoint: [], env: {}, metadata: {}, resource: { cpu: '1', memory: '256Mi' }, timeoutSeconds: null })
  await adapter.create({ image: 'b', entrypoint: [], env: {}, metadata: {}, resource: { cpu: '1', memory: '256Mi' }, timeoutSeconds: null })
  const list = await adapter.listSandboxes({})
  assert.equal(list.length, 2)
})

test('FakeSandboxAdapter rejects capability-dependent methods (A23)', async () => {
  const adapter = new FakeSandboxAdapter()
  const { sandboxId } = await adapter.create({ image: 'test', entrypoint: ['sh'], env: {}, metadata: {}, resource: { cpu: '1', memory: '256Mi' }, timeoutSeconds: null })
  await assert.rejects(adapter.getEndpoint(sandboxId, 3001), /capability not supported/)
  await assert.rejects(adapter.startProcess(sandboxId, { command: 'echo hi' }), /capability not supported/)
  await assert.rejects(adapter.processStatus(sandboxId, 'p1'), /capability not supported/)
  await assert.rejects(adapter.stopProcess(sandboxId, 'p1'), /capability not supported/)
  await assert.rejects(adapter.fileInfo(sandboxId, '/tmp/x'), /capability not supported/)
  await assert.rejects(adapter.readFile(sandboxId, '/tmp/x', 1024), /capability not supported/)
  assert.throws(() => adapter.readFileStream(sandboxId, '/tmp/x'), /capability not supported/)
  await assert.rejects(adapter.writeFile(sandboxId, []), /capability not supported/)
  await assert.rejects(adapter.createDirectories(sandboxId, []), /capability not supported/)
})

test('SandboxAdapter interface shape matches 8 core + auxiliary methods', async () => {
  const adapter = new FakeSandboxAdapter()
  const expected = ['create', 'connect', 'inspect', 'getEndpoint', 'startProcess', 'processStatus', 'stopProcess', 'fileInfo', 'readFile', 'readFileStream', 'writeFile', 'createDirectories', 'destroy', 'listSandboxes', 'close']
  for (const method of expected) {
    assert.equal(typeof adapter[method], 'function', `${method} should be a function`)
  }
})
