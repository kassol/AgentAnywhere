/**
 * FakeSandboxAdapter — test-only implementation of SandboxAdapter.
 *
 * Maintains in-memory state for create/destroy lifecycle;
 * capability-dependent methods throw "not supported" errors
 * for A23 contract testing.
 *
 * @module sandbox-fake
 */

import { randomUUID } from 'node:crypto'

export class FakeSandboxAdapter {
  /** @type {Map<string, {status:string, metadata:Record<string,string>}>} */
  #sandboxes = new Map()

  async create(options) {
    const sandboxId = `fake-${randomUUID()}`
    this.#sandboxes.set(sandboxId, { status: 'running', metadata: options.metadata || {} })
    return { sandboxId, status: 'running' }
  }

  async connect(sandboxId) {
    if (!this.#sandboxes.has(sandboxId)) throw new Error(`Sandbox ${sandboxId} not found`)
  }

  async inspect(sandboxId) {
    const entry = this.#sandboxes.get(sandboxId)
    if (!entry) throw new Error(`Sandbox ${sandboxId} not found`)
    return { status: entry.status, metadata: entry.metadata }
  }

  async getEndpoint(_sandboxId, _port) {
    throw new Error('capability not supported: getEndpoint')
  }

  async startProcess(_sandboxId, _options) {
    throw new Error('capability not supported: startProcess')
  }

  async processStatus(_sandboxId, _processId) {
    throw new Error('capability not supported: processStatus')
  }

  async stopProcess(_sandboxId, _processId) {
    throw new Error('capability not supported: stopProcess')
  }

  async fileInfo(_sandboxId, _path) {
    throw new Error('capability not supported: fileInfo')
  }

  async readFile(_sandboxId, _path, _limit) {
    throw new Error('capability not supported: readFile')
  }

  readFileStream(_sandboxId, _path) {
    throw new Error('capability not supported: readFileStream')
  }

  async writeFile(_sandboxId, _entries) {
    throw new Error('capability not supported: writeFile')
  }

  async createDirectories(_sandboxId, _dirs) {
    throw new Error('capability not supported: createDirectories')
  }

  async destroy(sandboxId) {
    this.#sandboxes.delete(sandboxId)
  }

  async listSandboxes(_metadata) {
    return [...this.#sandboxes.entries()].map(([id, entry]) => ({ id, state: entry.status, metadata: entry.metadata }))
  }

  async close(sandboxId) {
    this.#sandboxes.delete(sandboxId)
  }
}
