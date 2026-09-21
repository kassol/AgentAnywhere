/**
 * OpenSandboxAdapter — maps SandboxAdapter interface to
 * @alibaba-group/opensandbox SDK calls.
 *
 * @module sandbox-opensandbox
 */

import { Sandbox, SandboxManager } from '@alibaba-group/opensandbox'

export class OpenSandboxAdapter {
  /** @type {import('@alibaba-group/opensandbox').SandboxConnectionConfig} */
  #connectionConfig
  /** @type {import('@alibaba-group/opensandbox').SandboxManager} */
  #manager
  /** @type {Map<string, import('@alibaba-group/opensandbox').Sandbox>} */
  #instances = new Map()

  /**
   * @param {{domain:string, protocol:string, apiKey:string, useServerProxy?:boolean, disableMetrics?:boolean}} connectionConfig
   */
  constructor(connectionConfig) {
    this.#connectionConfig = connectionConfig
    this.#manager = SandboxManager.create({ connectionConfig })
  }

  /** @param {import('./sandbox-adapter.mjs').CreateOptions} options */
  async create(options) {
    const sandbox = await Sandbox.create({
      connectionConfig: this.#connectionConfig,
      image: options.image,
      entrypoint: options.entrypoint,
      env: options.env,
      metadata: options.metadata,
      resource: options.resource,
      timeoutSeconds: options.timeoutSeconds,
      readyTimeoutSeconds: options.readyTimeoutSeconds,
    })
    this.#instances.set(sandbox.id, sandbox)
    return { sandboxId: sandbox.id, status: 'running' }
  }

  /** @param {string} sandboxId */
  async connect(sandboxId) {
    if (this.#instances.has(sandboxId)) return
    const sandbox = await Sandbox.connect({ connectionConfig: this.#connectionConfig, sandboxId })
    this.#instances.set(sandboxId, sandbox)
  }

  /** @param {string} sandboxId */
  async inspect(sandboxId) {
    const infos = await this.#manager.listSandboxInfos({ metadata: {}, pageSize: 100 })
    const info = infos.items.find(item => item.id === sandboxId)
    return { status: info?.status?.state ?? 'Unknown', createdAt: info?.createdAt, metadata: info?.metadata }
  }

  /**
   * @param {string} sandboxId
   * @param {number} port
   * @returns {Promise<import('./sandbox-adapter.mjs').EndpointInfo>}
   */
  async getEndpoint(sandboxId, port) {
    const sandbox = this.#get(sandboxId)
    const endpoint = await sandbox.getEndpoint(port)
    const protocol = sandbox.connectionConfig.protocol
    const base = endpoint.endpoint.startsWith('http') ? endpoint.endpoint : `${protocol}://${endpoint.endpoint}`
    return { endpoint: base, headers: endpoint.headers, protocol }
  }

  /**
   * @param {string} sandboxId
   * @param {import('./sandbox-adapter.mjs').StartProcessOptions} options
   * @returns {Promise<import('./sandbox-adapter.mjs').StartProcessResult>}
   */
  async startProcess(sandboxId, options) {
    const sandbox = this.#get(sandboxId)
    const result = await sandbox.commands.run(options.command, {
      timeoutSeconds: options.timeoutSeconds,
    })
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  }

  /**
   * @param {string} _sandboxId
   * @param {string} _processId
   */
  async processStatus(_sandboxId, _processId) {
    throw new Error('processStatus not implemented for OpenSandbox — commands.run is synchronous')
  }

  /**
   * @param {string} _sandboxId
   * @param {string} _processId
   */
  async stopProcess(_sandboxId, _processId) {
    throw new Error('stopProcess not implemented for OpenSandbox — commands.run is synchronous')
  }

  /**
   * @param {string} sandboxId
   * @param {string} path
   * @returns {Promise<import('./sandbox-adapter.mjs').FileInfoResult|null>}
   */
  async fileInfo(sandboxId, path) {
    const sandbox = this.#get(sandboxId)
    try {
      const result = (await sandbox.files.getFileInfo([path]))[path] ?? null
      return result
    } catch (error) {
      if (error.statusCode === 404 && error.error?.code === 'FILE_NOT_FOUND') return null
      throw error
    }
  }

  /**
   * @param {string} sandboxId
   * @param {string} path
   * @param {number} limit
   * @returns {Promise<Buffer>}
   */
  async readFile(sandboxId, path, limit) {
    const sandbox = this.#get(sandboxId)
    const chunks = []
    let size = 0
    for await (const chunk of sandbox.files.readBytesStream(path)) {
      size += chunk.length
      if (size > limit) throw new Error('沙箱文件超过大小限制')
      chunks.push(chunk)
    }
    return Buffer.concat(chunks, size)
  }

  /**
   * @param {string} sandboxId
   * @param {string} path
   * @returns {AsyncIterable<Buffer>}
   */
  readFileStream(sandboxId, path) {
    const sandbox = this.#get(sandboxId)
    return sandbox.files.readBytesStream(path)
  }

  /**
   * @param {string} sandboxId
   * @param {import('./sandbox-adapter.mjs').WriteFileEntry[]} entries
   */
  async writeFile(sandboxId, entries) {
    const sandbox = this.#get(sandboxId)
    await sandbox.files.writeFiles(entries)
  }

  /**
   * @param {string} sandboxId
   * @param {import('./sandbox-adapter.mjs').DirectoryEntry[]} dirs
   */
  async createDirectories(sandboxId, dirs) {
    const sandbox = this.#get(sandboxId)
    await sandbox.files.createDirectories(dirs)
  }

  /** @param {string} sandboxId */
  async destroy(sandboxId) {
    try { await this.#manager.killSandbox(sandboxId) } catch (error) { if (error.statusCode !== 404) throw error }
    this.#instances.delete(sandboxId)
  }

  /**
   * @param {Record<string,string>} metadata
   * @returns {Promise<import('./sandbox-adapter.mjs').SandboxInfo[]>}
   */
  async listSandboxes(metadata) {
    const infos = await this.#manager.listSandboxInfos({ metadata, pageSize: 100 })
    return infos.items.map(item => ({ id: item.id, state: item.status.state, metadata: item.metadata }))
  }

  /** @param {string} sandboxId */
  async close(sandboxId) {
    const sandbox = this.#instances.get(sandboxId)
    if (sandbox) {
      await sandbox.close().catch(() => {})
      this.#instances.delete(sandboxId)
    }
  }

  /**
   * @param {string} sandboxId
   * @returns {import('@alibaba-group/opensandbox').Sandbox}
   */
  #get(sandboxId) {
    const sandbox = this.#instances.get(sandboxId)
    if (!sandbox) throw new Error(`Sandbox ${sandboxId} not connected`)
    return sandbox
  }
}
