/**
 * SandboxAdapter 中立接口（ADR-0004）。
 *
 * 定义 queue-worker 所需的全部沙箱操作。R6 核心 8 方法：
 * create, inspect, startProcess, processStatus, stopProcess,
 * readFile, writeFile, destroy。
 *
 * 额外辅助方法覆盖 queue-worker 的 connect、端点解析、
 * 目录创建、文件元信息、批量清理和连接释放。
 *
 * @module sandbox-adapter
 */

// ──────────────────────────────────────────────
// JSDoc type definitions
// ──────────────────────────────────────────────

/**
 * @typedef {Object} CreateOptions
 * @property {string}   image
 * @property {string[]} entrypoint
 * @property {Record<string,string>} env
 * @property {Record<string,string>} metadata
 * @property {{cpu:string, memory:string}} resource
 * @property {number|null} timeoutSeconds
 * @property {number}   [readyTimeoutSeconds]
 */

/**
 * @typedef {Object} CreateResult
 * @property {string} sandboxId
 * @property {string} status
 */

/**
 * @typedef {Object} InspectResult
 * @property {string}  status
 * @property {string}  [createdAt]
 * @property {Record<string,string>} [metadata]
 */

/**
 * @typedef {Object} StartProcessOptions
 * @property {string}  command
 * @property {number}  [timeoutSeconds]
 */

/**
 * @typedef {Object} StartProcessResult
 * @property {number}  exitCode
 * @property {string}  [stdout]
 * @property {string}  [stderr]
 */

/**
 * @typedef {Object} ProcessStatusResult
 * @property {boolean} running
 * @property {number|null} exitCode
 * @property {string}  [stdout]
 * @property {string}  [stderr]
 */

/**
 * @typedef {Object} FileInfoResult
 * @property {string}  type
 * @property {number}  size
 */

/**
 * @typedef {Object} WriteFileEntry
 * @property {string} path
 * @property {Buffer|Uint8Array} data
 * @property {number} [mode]
 */

/**
 * @typedef {Object} DirectoryEntry
 * @property {string} path
 * @property {number} [mode]
 */

/**
 * @typedef {Object} EndpointInfo
 * @property {string} endpoint  — full base URL (e.g. "http://host:port")
 * @property {Record<string,string>} headers
 * @property {string} protocol  — "http" or "https"
 */

/**
 * @typedef {Object} SandboxInfo
 * @property {string} id
 * @property {string} state
 * @property {Record<string,string>} [metadata]
 */

// ──────────────────────────────────────────────
// Interface definition
// ──────────────────────────────────────────────

/**
 * Neutral sandbox operations interface.
 *
 * All methods throw on failure. Implementations must be stateless
 * per-call — the caller (queue-worker) manages lifecycle.
 *
 * @interface SandboxAdapter
 */

/**
 * Create a new sandbox.
 * @function
 * @name SandboxAdapter#create
 * @param {CreateOptions} options
 * @returns {Promise<CreateResult>}
 */

/**
 * Connect to an existing sandbox by ID (e.g. recovery path).
 * @function
 * @name SandboxAdapter#connect
 * @param {string} sandboxId
 * @returns {Promise<void>}
 */

/**
 * Inspect sandbox status.
 * @function
 * @name SandboxAdapter#inspect
 * @param {string} sandboxId
 * @returns {Promise<InspectResult>}
 */

/**
 * Resolve an in-sandbox port to a reachable endpoint.
 * @function
 * @name SandboxAdapter#getEndpoint
 * @param {string} sandboxId
 * @param {number} port
 * @returns {Promise<EndpointInfo>}
 */

/**
 * Run a command inside the sandbox (blocking).
 * @function
 * @name SandboxAdapter#startProcess
 * @param {string} sandboxId
 * @param {StartProcessOptions} options
 * @returns {Promise<StartProcessResult>}
 */

/**
 * Query a running process status.
 * @function
 * @name SandboxAdapter#processStatus
 * @param {string} sandboxId
 * @param {string} processId
 * @returns {Promise<ProcessStatusResult>}
 */

/**
 * Stop a running process.
 * @function
 * @name SandboxAdapter#stopProcess
 * @param {string} sandboxId
 * @param {string} processId
 * @returns {Promise<void>}
 */

/**
 * Get file metadata (type, size). Returns null if not found.
 * @function
 * @name SandboxAdapter#fileInfo
 * @param {string} sandboxId
 * @param {string} path
 * @returns {Promise<FileInfoResult|null>}
 */

/**
 * Read a file as a Buffer, with a size limit.
 * @function
 * @name SandboxAdapter#readFile
 * @param {string} sandboxId
 * @param {string} path
 * @param {number} limit — maximum bytes; throws if exceeded
 * @returns {Promise<Buffer>}
 */

/**
 * Read a file as an async byte stream.
 * @function
 * @name SandboxAdapter#readFileStream
 * @param {string} sandboxId
 * @param {string} path
 * @returns {AsyncIterable<Buffer>}
 */

/**
 * Batch-write files into the sandbox.
 * @function
 * @name SandboxAdapter#writeFile
 * @param {string} sandboxId
 * @param {WriteFileEntry[]} entries
 * @returns {Promise<void>}
 */

/**
 * Batch-create directories inside the sandbox.
 * @function
 * @name SandboxAdapter#createDirectories
 * @param {string} sandboxId
 * @param {DirectoryEntry[]} dirs
 * @returns {Promise<void>}
 */

/**
 * Destroy a sandbox (kill and delete).
 * @function
 * @name SandboxAdapter#destroy
 * @param {string} sandboxId
 * @returns {Promise<void>}
 */

/**
 * List sandboxes matching metadata filters.
 * @function
 * @name SandboxAdapter#listSandboxes
 * @param {Record<string,string>} metadata
 * @returns {Promise<SandboxInfo[]>}
 */

/**
 * Release local connection resources for a sandbox. No-op if
 * the sandbox was already released or never connected.
 * @function
 * @name SandboxAdapter#close
 * @param {string} sandboxId
 * @returns {Promise<void>}
 */
