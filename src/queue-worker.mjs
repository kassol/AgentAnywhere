import { createHash, randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import http from 'node:http'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { PgBoss } from 'pg-boss'
import pg from 'pg'
import { Sandbox, SandboxManager } from '@alibaba-group/opensandbox'
import { openPublicPage, searchWeb } from './research-tools.mjs'

const databaseUrl = process.env.DATABASE_URL
const sandboxKey = process.env.OPEN_SANDBOX_API_KEY || process.env.OPENSANDBOX_SERVER_API_KEY
const image = process.env.AGENT_IMAGE
if (!databaseUrl || !sandboxKey || !image) throw new Error('DATABASE_URL, OPEN_SANDBOX_API_KEY and AGENT_IMAGE are required')
const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 })
const sandboxConnection = { domain: process.env.OPEN_SANDBOX_DOMAIN || 'opensandbox:8080', protocol: 'http', apiKey: sandboxKey, useServerProxy: true, disableMetrics: true }
const manager = SandboxManager.create({ connectionConfig: sandboxConnection })
const boss = new PgBoss({ connectionString: databaseUrl, schema: process.env.QUEUE_SCHEMA || 'pgboss' })
const active = new Set()
const recovering = new Set()
const artifactDir = process.env.AGENTANYWHERE_ARTIFACT_DIR || '/artifacts'
const outputDir = '/tmp/agentanywhere-output'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const searchOrigin = process.env.SEARCH_ORIGIN || 'http://agentanywhere-r1-searxng:8080'
const publicHost = process.env.AGENTANYWHERE_PUBLIC_ORIGIN && new URL(process.env.AGENTANYWHERE_PUBLIC_ORIGIN).hostname.replace(/^\[|\]$/g, '')
if (!publicHost) throw new Error('AGENTANYWHERE_PUBLIC_ORIGIN is required for public page protection')

const researchServer = http.createServer(async (request, response) => {
  const match = /^\/internal\/research\/([0-9a-f-]+)\/(\d+)\/(search|open)$/.exec(request.url || '')
  if (request.method !== 'POST' || !match) { response.writeHead(404); response.end(); return }
  const controller = new AbortController()
  response.on('close', () => controller.abort())
  try {
    const supplied = request.headers['x-run-token']
    if (typeof supplied !== 'string' || supplied.length > 128) throw new Error('Unauthorized')
    const valid = await pool.query('SELECT 1 FROM work_runs WHERE id=$1 AND epoch=$2 AND active AND run_token_hash=$3', [match[1], Number(match[2]), createHash('sha256').update(supplied).digest('hex')])
    if (!valid.rowCount) throw new Error('Unauthorized')
    let body = ''
    request.setEncoding('utf8')
    for await (const chunk of request) {
      body += chunk
      if (body.length > 4096) throw new Error('工具参数超过大小限制')
    }
    const input = JSON.parse(body)
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input[match[3] === 'search' ? 'query' : 'url'] !== 'string') throw new Error('工具参数无效')
    const result = match[3] === 'search' ? await searchWeb(input.query, searchOrigin, controller.signal) : await openPublicPage(input.url, publicHost, controller.signal)
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify(result))
  } catch (error) {
    if (response.destroyed) return
    response.writeHead(error.message === 'Unauthorized' ? 401 : 400, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify({ error: error.message || '工具执行失败' }))
  }
})
researchServer.requestTimeout = 40_000

async function optionalFileInfo(sandbox, path) {
  try { return (await sandbox.files.getFileInfo([path]))[path] ?? null }
  catch (error) { if (error.statusCode === 404 && error.error?.code === 'FILE_NOT_FOUND') return null; throw error }
}

async function claim(runId, token) {
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    const result = await db.query(`UPDATE work_runs SET status='provisioning', active=true, epoch=epoch+1,
      run_token_hash=$2, started_at=now(), cleanup_state='pending'
      WHERE id=$1 AND status='queued' AND NOT active RETURNING id, task_id, epoch, model_snapshot`,
      [runId, createHash('sha256').update(token).digest('hex')])
    if (!result.rowCount) { await db.query('ROLLBACK'); return null }
    await db.query("UPDATE work_tasks SET status='provisioning' WHERE id=$1", [result.rows[0].task_id])
    await db.query('DELETE FROM work_outbox WHERE run_id=$1', [runId])
    await db.query('COMMIT')
    return { ...result.rows[0], model_snapshot: typeof result.rows[0].model_snapshot === 'string' ? JSON.parse(result.rows[0].model_snapshot) : result.rows[0].model_snapshot }
  } catch (error) {
    await db.query('ROLLBACK')
    if (error.code === '23505') return null
    throw error
  } finally { db.release() }
}

async function record(run, event) {
  if (!Number.isSafeInteger(event.producerSeq) || event.producerSeq < 1 || typeof event.eventId !== 'string' || typeof event.type !== 'string') throw new Error('Invalid worker event')
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    const current = await db.query('SELECT active FROM work_runs WHERE id=$1 AND epoch=$2 FOR UPDATE', [run.id, run.epoch])
    if (!current.rows[0]?.active) { await db.query('ROLLBACK'); return false }
    await db.query(`INSERT INTO work_events (run_id, epoch, producer_seq, event_id, type, payload, occurred_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [run.id, run.epoch, event.producerSeq, event.eventId, event.type, event.payload || {}, event.occurredAt])
    if (event.type === 'worker.ready') {
      await db.query("UPDATE work_runs SET status='running' WHERE id=$1 AND epoch=$2 AND status='provisioning'", [run.id, run.epoch])
      await db.query("UPDATE work_tasks SET status='running' WHERE id=$1", [run.task_id])
    }
    await db.query('COMMIT')
    return true
  } catch (error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
}

async function liveEvents(endpoint, token, run) {
  let after = 0
  for (;;) {
    const response = await fetch(`${endpoint.endpoint}/events?after=${after}`, { headers: { ...endpoint.headers, 'x-run-token': token }, signal: AbortSignal.timeout(50 * 60_000) })
    if (!response.ok || !response.body) throw new Error('Pi 事件连接失败')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        pending += decoder.decode(value, { stream: true })
        let boundary
        while ((boundary = pending.indexOf('\n\n')) !== -1) {
          const frame = pending.slice(0, boundary)
          pending = pending.slice(boundary + 2)
          const data = frame.split('\n').find(line => line.startsWith('data: '))?.slice(6)
          if (!data) continue
          const event = JSON.parse(data)
          if (event.producerSeq <= after) continue
          if (!await record(run, event)) throw new Error('Run 执行代次已失效')
          after = event.producerSeq
          if (event.type === 'run.finished') return { status: 'succeeded', failure: null }
          if (event.type === 'run.failed') return { status: 'failed', failure: event.payload?.error || '模型执行失败' }
        }
      }
    } finally { reader.releaseLock() }
    await pause(500)
  }
}

async function persistArtifacts(run, sandbox) {
  const manifestPath = `${outputDir}/manifest.json`
  const manifestInfo = await optionalFileInfo(sandbox, manifestPath)
  if (manifestInfo?.type !== 'file' || !Number.isSafeInteger(manifestInfo.size) || manifestInfo.size < 2 || manifestInfo.size > 4096) throw new Error('报告清单不存在或无效')
  const bytes = await sandbox.files.readBytes(manifestPath, { limit: 4097 })
  if (bytes.length !== manifestInfo.size) throw new Error('报告清单已变化')
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  const generation = Array.isArray(manifest) ? null : manifest?.generation
  if (generation !== null && (typeof generation !== 'string' || !/^generation-[0-9a-f-]{36}$/.test(generation))) throw new Error('报告代次无效')
  const entries = generation === null ? manifest : manifest.files
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 6 || entries[0]?.path !== 'report.md') throw new Error('报告清单无效')
  if (new Set(entries.map(item => item?.name)).size !== entries.length) throw new Error('附件名称重复')
  const saved = []
  const destination = join(artifactDir, run.id)
  await mkdir(destination, { recursive: true, mode: 0o700 })
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry !== 'object' || entry.path !== (index === 0 ? 'report.md' : `attachment-${index - 1}.${entry.path?.split('.').at(-1)}`)
      || (index > 0 && !/^attachment-[0-4]\.(txt|csv|json|md)$/.test(entry.path))
      || typeof entry.name !== 'string' || !/^[^/\\\x00-\x1f]{1,100}\.(txt|csv|json|md)$/i.test(entry.name)
      || entry.type !== (index === 0 ? 'text/markdown' : 'text/plain')) throw new Error('成果类型或路径无效')
    const source = `${outputDir}/${generation ? `${generation}/` : ''}${entry.path}`
    const info = await optionalFileInfo(sandbox, source)
    const limit = index === 0 ? 2_000_000 : 10_000_000
    if (info?.type !== 'file' || !Number.isSafeInteger(info.size) || info.size < (index === 0 ? 1 : 0) || info.size > limit) throw new Error('成果文件类型或大小无效')
    const temporary = join(destination, `${entry.path}.${randomBytes(8).toString('hex')}.tmp`)
    const file = await open(temporary, 'wx', 0o600)
    let size = 0
    const hash = createHash('sha256')
    try {
      for await (const chunk of sandbox.files.readBytesStream(source)) {
        size += chunk.length
        if (size > limit) throw new Error('成果文件超过大小限制')
        hash.update(chunk)
        let offset = 0
        while (offset < chunk.length) offset += (await file.write(chunk, offset)).bytesWritten
      }
      await file.sync()
    } catch (error) { await file.close(); await rm(temporary, { force: true }); throw error }
    await file.close()
    if (size !== info.size || (await optionalFileInfo(sandbox, source))?.type !== 'file') { await rm(temporary, { force: true }); throw new Error('成果文件复制时发生变化') }
    const storageKey = `${run.id}/${entry.path}`
    await rename(temporary, join(artifactDir, storageKey))
    saved.push({ ...entry, storageKey, size, sha256: hash.digest('hex'), kind: index === 0 ? 'report' : 'attachment' })
  }
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    const current = await db.query('SELECT active FROM work_runs WHERE id=$1 AND epoch=$2 FOR UPDATE', [run.id, run.epoch])
    if (!current.rows[0]?.active) throw new Error('Run 执行代次已失效')
    for (const item of saved) {
      const artifact = await db.query(`INSERT INTO work_artifacts (id, task_id, kind, name) VALUES ($1,$2,$3,$4)
        ON CONFLICT (task_id, kind, name) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [crypto.randomUUID(), run.task_id, item.kind, item.name])
      await db.query(`INSERT INTO work_artifact_versions (id, artifact_id, run_id, storage_key, sha256, size_bytes, mime_type)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (artifact_id, run_id) DO NOTHING`,
        [crypto.randomUUID(), artifact.rows[0].id, run.id, item.storageKey, item.sha256, item.size, item.type])
    }
    await db.query('COMMIT')
  } catch (error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
}

async function markSaveBlocked(run, error, result) {
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    const updated = await db.query(`UPDATE work_runs SET status='save_failed', failure=$3, cleanup_state='blocked',
      pending_status=$4, pending_failure=$5, run_token_hash=NULL WHERE id=$1 AND epoch=$2 AND active RETURNING task_id`,
      [run.id, run.epoch, `成果保存失败：${error.message}`, result.status, result.failure])
    if (updated.rowCount) await db.query("UPDATE work_tasks SET status='save_failed' WHERE id=$1", [updated.rows[0].task_id])
    await db.query('COMMIT')
  } catch (failure) { await db.query('ROLLBACK'); throw failure } finally { db.release() }
}

async function cleanup(run, sandboxId) {
  try {
    const infos = await manager.listSandboxInfos({ metadata: { runId: run.id }, pageSize: 100 })
    const ids = new Set(infos.items.filter(item => item.metadata?.epoch === String(run.epoch) && item.status.state !== 'Deleted').map(item => item.id))
    if (sandboxId) ids.add(sandboxId)
    for (const id of ids) {
      try { await manager.killSandbox(id) } catch (error) { if (error.statusCode !== 404) throw error }
    }
    const remaining = await manager.listSandboxInfos({ metadata: { runId: run.id }, pageSize: 100 })
    if (remaining.items.some(item => item.metadata?.epoch === String(run.epoch) && item.status.state !== 'Deleted')) throw new Error('沙箱仍存在')
    return 'cleaned'
  } catch { return 'failed' }
}

async function finish(run, result, sandboxId) {
  const cleanupState = await cleanup(run, sandboxId)
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    const updated = await db.query(`UPDATE work_runs SET status=$3, failure=$4, cleanup_state=$5, active=$6,
      run_token_hash=NULL, finished_at=COALESCE(finished_at, now()) WHERE id=$1 AND epoch=$2 AND active RETURNING task_id`,
      [run.id, run.epoch, result.status, result.failure, cleanupState, cleanupState !== 'cleaned'])
    if (updated.rowCount) await db.query('UPDATE work_tasks SET status=$2 WHERE id=$1', [updated.rows[0].task_id, result.status])
    await db.query('COMMIT')
  } catch (error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
}

async function execute(run, token) {
  let sandbox
  let result = { status: 'failed', failure: 'Pi 启动失败' }
  try {
    sandbox = await Sandbox.create({
      connectionConfig: sandboxConnection, image, entrypoint: ['node', '/app/agent-worker.mjs'],
      env: { RUN_TOKEN: token }, metadata: { runId: run.id, epoch: String(run.epoch) },
      resource: { cpu: '1', memory: '512Mi' }, timeoutSeconds: null, readyTimeoutSeconds: 60,
    })
    run.sandbox_id = sandbox.id
    await pool.query('UPDATE work_runs SET sandbox_id=$3 WHERE id=$1 AND epoch=$2 AND active', [run.id, run.epoch, sandbox.id])
    const endpoint = await sandbox.getEndpoint(3001)
    let ready = false
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const health = await fetch(`${sandbox.connectionConfig.protocol}://${endpoint.endpoint}/health`, { headers: endpoint.headers, signal: AbortSignal.timeout(1000) })
        if (health.ok) { ready = true; break }
      } catch { /* process can still be starting */ }
      await pause(500)
    }
    if (!ready) throw new Error('Pi 进程未能启动')
    const row = await pool.query('SELECT goal, source_url FROM work_tasks WHERE id=$1', [run.task_id])
    const goal = [row.rows[0].goal, row.rows[0].source_url && `指定来源：${row.rows[0].source_url}`].filter(Boolean).join('\n\n')
    const proxyOrigin = new URL(process.env.MODEL_PROXY_ORIGIN || 'http://web:3000')
    proxyOrigin.hostname = (await lookup(proxyOrigin.hostname, { family: 4 })).address
    const proxyBase = `${proxyOrigin.origin}/internal/runs/${run.id}/${run.epoch}/v1`
    const toolOrigin = new URL(process.env.TOOL_GATEWAY_ORIGIN || 'http://queue:3003')
    toolOrigin.hostname = (await lookup(toolOrigin.hostname, { family: 4 })).address
    const base = `${sandbox.connectionConfig.protocol}://${endpoint.endpoint}`
    const started = await fetch(`${base}/run`, { method: 'POST', headers: { ...endpoint.headers, 'x-run-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ goal, model: run.model_snapshot, proxyBase, toolBase: `${toolOrigin.origin}/internal/research/${run.id}/${run.epoch}` }), signal: AbortSignal.timeout(10_000) })
    if (!started.ok) throw new Error('Pi 启动请求失败')
    result = await liveEvents({ ...endpoint, endpoint: base }, token, run)
  } catch { result = { status: 'failed', failure: 'Pi 启动或执行中断' } }
  finally {
    try {
      if (sandbox) {
        const manifestPath = `${outputDir}/manifest.json`
        const reportPath = `${outputDir}/report.md`
        let manifest, report
        try { [manifest, report] = await Promise.all([optionalFileInfo(sandbox, manifestPath), optionalFileInfo(sandbox, reportPath)]) }
        catch (error) { await markSaveBlocked(run, error, result); return }
        if (result.status === 'succeeded' || manifest || report) {
          try { await persistArtifacts(run, sandbox) }
          catch (error) { await markSaveBlocked(run, error, result); return }
        }
      }
      await finish(run, result, sandbox?.id)
    }
    finally {
      await sandbox?.close().catch(() => {})
      active.delete(run.id)
    }
  }
}

async function reconcile() {
  const rows = await pool.query('SELECT id, task_id, epoch, sandbox_id, status, failure, cleanup_state FROM work_runs WHERE active')
  for (const run of rows.rows) {
    if (run.cleanup_state === 'blocked' || run.cleanup_state === 'failed' || run.cleanup_state === 'retry_requested') continue
    let sandbox
    try {
      const persisted = await pool.query('SELECT 1 FROM work_artifact_versions WHERE run_id=$1 LIMIT 1', [run.id])
      if (persisted.rowCount) {
        const terminal = await pool.query("SELECT type, payload FROM work_events WHERE run_id=$1 AND type IN ('run.finished', 'run.failed') ORDER BY server_seq DESC LIMIT 1", [run.id])
        const last = terminal.rows[0]
        await finish(run, { status: last?.type === 'run.finished' ? 'succeeded' : last?.type === 'run.failed' ? 'failed' : 'lost', failure: last?.type === 'run.failed' ? last.payload?.error : last?.type === 'run.finished' ? null : '执行服务中断；请手动重试' }, run.sandbox_id)
        continue
      }
      if (run.sandbox_id) sandbox = await Sandbox.connect({ connectionConfig: sandboxConnection, sandboxId: run.sandbox_id })
      const manifest = sandbox && await optionalFileInfo(sandbox, `${outputDir}/manifest.json`)
      const report = sandbox && await optionalFileInfo(sandbox, `${outputDir}/report.md`)
      if (manifest || report) await markSaveBlocked(run, new Error('执行服务中断，需重试保存已有报告'), { status: 'lost', failure: '执行服务中断；请手动重试' })
      else await finish(run, { status: 'lost', failure: '执行服务中断；请手动重试' }, run.sandbox_id)
    } catch (error) {
      if (error.statusCode === 404) await finish(run, { status: 'lost', failure: '执行中断且沙箱已失效；请手动重试' }, run.sandbox_id)
      else await markSaveBlocked(run, error, { status: 'lost', failure: '执行服务中断；请手动重试' })
    }
    finally { await sandbox?.close().catch(() => {}) }
  }
}

async function recoverPending() {
  const rows = await pool.query("SELECT id, task_id, epoch, sandbox_id, status, failure, pending_status, pending_failure FROM work_runs WHERE active AND cleanup_state='retry_requested'")
  for (const run of rows.rows) {
    if (recovering.has(run.id)) continue
    recovering.add(run.id)
    void (async () => {
      let sandbox
      try {
        if (run.status === 'save_failed') {
          sandbox = await Sandbox.connect({ connectionConfig: sandboxConnection, sandboxId: run.sandbox_id })
          await persistArtifacts(run, sandbox)
        }
        await finish(run, { status: run.pending_status || run.status, failure: run.pending_failure || (run.status === 'save_failed' ? null : run.failure) }, run.sandbox_id)
      } catch (error) { await markSaveBlocked(run, error, { status: run.pending_status || run.status, failure: run.pending_failure || run.failure }) }
      finally { await sandbox?.close().catch(() => {}); recovering.delete(run.id) }
    })()
  }
}

async function dispatchPending() {
  const busy = await pool.query('SELECT 1 FROM work_runs WHERE active LIMIT 1')
  if (busy.rowCount) return
  const next = await pool.query(`SELECT o.run_id FROM work_outbox o JOIN work_runs r ON r.id=o.run_id
    WHERE r.status='queued' ORDER BY o.created_at, o.run_id LIMIT 1`)
  if (next.rowCount) await boss.send('work-dispatch', { runId: next.rows[0].run_id }, { singletonKey: next.rows[0].run_id, singletonSeconds: 5 })
}

await reconcile()
researchServer.listen(3003, '0.0.0.0')
await boss.start()
await boss.createQueue('work-dispatch', { retryLimit: 0 })
await boss.work('work-dispatch', { batchSize: 1 }, async ([job]) => {
  const token = randomBytes(32).toString('base64url')
  const run = await claim(job.data.runId, token)
  if (!run) return
  active.add(run.id)
  void execute(run, token)
})
const dispatchTimer = setInterval(() => void dispatchPending().catch(() => {}), 1000)
const recoveryTimer = setInterval(() => void recoverPending().catch(() => {}), 2000)
await dispatchPending()

process.once('SIGTERM', async () => {
  researchServer.close()
  clearInterval(dispatchTimer)
  clearInterval(recoveryTimer)
  await boss.stop()
  await pool.end()
})
