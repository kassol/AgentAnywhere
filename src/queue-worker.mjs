import { createHash, randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { PgBoss } from 'pg-boss'
import pg from 'pg'
import { Sandbox, SandboxManager } from '@alibaba-group/opensandbox'

const databaseUrl = process.env.DATABASE_URL
const sandboxKey = process.env.OPEN_SANDBOX_API_KEY || process.env.OPENSANDBOX_SERVER_API_KEY
const image = process.env.AGENT_IMAGE
if (!databaseUrl || !sandboxKey || !image) throw new Error('DATABASE_URL, OPEN_SANDBOX_API_KEY and AGENT_IMAGE are required')
const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 })
const sandboxConnection = { domain: process.env.OPEN_SANDBOX_DOMAIN || 'opensandbox:8080', protocol: 'http', apiKey: sandboxKey, useServerProxy: true, disableMetrics: true }
const manager = SandboxManager.create({ connectionConfig: sandboxConnection })
const boss = new PgBoss({ connectionString: databaseUrl, schema: process.env.QUEUE_SCHEMA || 'pgboss' })
const active = new Set()
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

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
      resource: { cpu: '1', memory: '512Mi' }, timeoutSeconds: 3600, readyTimeoutSeconds: 60,
    })
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
    const base = `${sandbox.connectionConfig.protocol}://${endpoint.endpoint}`
    const started = await fetch(`${base}/run`, { method: 'POST', headers: { ...endpoint.headers, 'x-run-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ goal, model: run.model_snapshot, proxyBase }), signal: AbortSignal.timeout(10_000) })
    if (!started.ok) throw new Error('Pi 启动请求失败')
    result = await liveEvents({ ...endpoint, endpoint: base }, token, run)
  } catch { result = { status: 'failed', failure: 'Pi 启动或执行中断' } }
  finally {
    try { await finish(run, result, sandbox?.id) }
    finally {
      await sandbox?.close().catch(() => {})
      active.delete(run.id)
    }
  }
}

async function reconcile() {
  const rows = await pool.query('SELECT id, task_id, epoch, sandbox_id, status, failure FROM work_runs WHERE active')
  for (const run of rows.rows) {
    const result = ['succeeded', 'failed', 'lost'].includes(run.status)
      ? { status: run.status, failure: run.failure }
      : { status: 'lost', failure: '执行服务中断；请手动重试' }
    await finish(run, result, run.sandbox_id)
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
await dispatchPending()

process.once('SIGTERM', async () => {
  clearInterval(dispatchTimer)
  await boss.stop()
  await pool.end()
})
