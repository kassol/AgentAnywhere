import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFile as execFileCb } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import http from 'node:http'
import { mkdir, mkdtemp, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import { PgBoss } from 'pg-boss'
import pg from 'pg'
import { OpenSandboxAdapter } from './sandbox-opensandbox.mjs'
import { openPublicPage, searchWeb } from './research-tools.mjs'

const databaseUrl = process.env.DATABASE_URL
const sandboxKey = process.env.OPEN_SANDBOX_API_KEY || process.env.OPENSANDBOX_SERVER_API_KEY
const image = process.env.AGENT_IMAGE
if (!databaseUrl || !sandboxKey || !image) throw new Error('DATABASE_URL, OPEN_SANDBOX_API_KEY and AGENT_IMAGE are required')

const PROFILES = {
  'worker-basic': {
    image: process.env.AGENT_IMAGE || 'agent-worker',
    cpu: '1',
    memory: '512Mi',
    entrypoint: ['node', '/app/agent-worker.mjs'],
  },
  'worker-coding': {
    image: process.env.AGENT_CODING_IMAGE || 'agent-coding',
    cpu: '2',
    memory: '2048Mi',
    entrypoint: ['node', '/app/agent-worker.mjs'],
  },
}
const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 })
const sandboxConnection = { domain: process.env.OPEN_SANDBOX_DOMAIN || 'opensandbox:8080', protocol: 'http', apiKey: sandboxKey, useServerProxy: true, disableMetrics: true }
const adapter = new OpenSandboxAdapter(sandboxConnection)
const boss = new PgBoss({ connectionString: databaseUrl, schema: process.env.QUEUE_SCHEMA || 'pgboss' })
const active = new Set()
const recovering = new Set()
const artifactDir = process.env.AGENTANYWHERE_ARTIFACT_DIR || '/artifacts'
const outputDir = '/tmp/agentanywhere-output'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const searchOrigin = process.env.SEARCH_ORIGIN || 'http://agentanywhere-r1-searxng:8080'
const publicHost = process.env.AGENTANYWHERE_PUBLIC_ORIGIN && new URL(process.env.AGENTANYWHERE_PUBLIC_ORIGIN).hostname.replace(/^\[|\]$/g, '')
if (!publicHost) throw new Error('AGENTANYWHERE_PUBLIC_ORIGIN is required for public page protection')

const execFileAsync = promisify(execFileCb)

async function* walkDir(dir, base = dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.name === '.git') continue
    if (entry.isDirectory()) {
      yield* walkDir(full, base)
    } else if (entry.isFile()) {
      const rel = relative(base, full)
      const st = await stat(full)
      yield { path: rel, fullPath: full, size: st.size }
    }
  }
}

const REPO_MAX_TOTAL = 200 * 1024 * 1024
const REPO_MAX_FILE = 10 * 1024 * 1024
const REPO_BATCH_SIZE = 50

async function injectRepository(adapterInstance, sandboxId, repoUrl, workdir) {
  const tmpDir = await mkdtemp(join(tmpdir(), 'aa-clone-'))
  try {
    const env = { ...process.env }
    if (process.env.GIT_TOKEN) {
      const askpass = join(tmpDir, 'askpass.sh')
      await writeFile(askpass, `#!/bin/sh\necho "${process.env.GIT_TOKEN}"`, { mode: 0o700 })
      env.GIT_ASKPASS = askpass
    }
    const repoDir = join(tmpDir, 'repo')
    await execFileAsync('git', ['clone', '--depth', '1', repoUrl, repoDir], { env, timeout: 120_000 })

    const files = []
    let totalSize = 0
    for await (const file of walkDir(repoDir)) {
      if (file.size > REPO_MAX_FILE) {
        console.warn(`Skipping large file (${file.size} bytes): ${file.path}`)
        continue
      }
      totalSize += file.size
      if (totalSize > REPO_MAX_TOTAL) throw new Error(`Repository exceeds ${REPO_MAX_TOTAL} byte limit`)
      files.push(file)
    }

    for (let i = 0; i < files.length; i += REPO_BATCH_SIZE) {
      const batch = files.slice(i, i + REPO_BATCH_SIZE)
      const entries = await Promise.all(batch.map(async file => ({
        path: join(workdir, file.path),
        data: await readFile(file.fullPath),
        mode: 0o644,
      })))
      const dirs = [...new Set(entries.map(e => e.path.slice(0, e.path.lastIndexOf('/'))))]
        .map(p => ({ path: p, mode: 0o755 }))
      if (dirs.length) await adapterInstance.createDirectories(sandboxId, dirs)
      await adapterInstance.writeFile(sandboxId, entries)
    }

    await adapterInstance.startProcess(sandboxId, { command: `cd ${workdir} && git init && git add -A && git commit -m initial`, timeoutSeconds: 30 })
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

const researchServer = http.createServer(async (request, response) => {
  const match = /^\/internal\/research\/([0-9a-f-]+)\/(\d+)\/(search|open)$/.exec(request.url || '')
  if (request.method !== 'POST' || !match) { response.writeHead(404); response.end(); return }
  const controller = new AbortController()
  response.on('close', () => controller.abort())
  try {
    const supplied = request.headers['x-run-token']
    if (typeof supplied !== 'string' || supplied.length > 128) throw new Error('Unauthorized')
    let body = ''
    request.setEncoding('utf8')
    for await (const chunk of request) {
      body += chunk
      if (body.length > 4096) throw new Error('工具参数超过大小限制')
    }
    const input = JSON.parse(body)
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input[match[3] === 'search' ? 'query' : 'url'] !== 'string') throw new Error('工具参数无效')
    const valid = await pool.query('SELECT 1 FROM work_runs WHERE id=$1 AND epoch=$2 AND active AND run_token_hash=$3', [match[1], Number(match[2]), createHash('sha256').update(supplied).digest('hex')])
    if (!valid.rowCount) throw new Error('Unauthorized')
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

async function optionalFileInfo(sandboxId, path) {
  return adapter.fileInfo(sandboxId, path)
}

async function readSandboxBytes(sandboxId, path, limit) {
  return adapter.readFile(sandboxId, path, limit)
}

async function claim(runId, token) {
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    const result = await db.query(`UPDATE work_runs SET status='provisioning', active=true, epoch=epoch+1,
      run_token_hash=$2, started_at=COALESCE(started_at,now()), active_since=now(), active_heartbeat_at=now(), cleanup_state='pending', budget_reason=NULL
      WHERE id=$1 AND status='queued' AND NOT active RETURNING id, task_id, epoch, model_snapshot,
        previous_report_version_id, context_snapshot, checkpoint_ref, agent_version_id`,
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
    const current = await db.query('SELECT active, status FROM work_runs WHERE id=$1 AND epoch=$2 FOR UPDATE', [run.id, run.epoch])
    if (!current.rows[0]?.active) { await db.query('ROLLBACK'); return false }
    if (current.rows[0].status === 'cancelling' && ['run.finished', 'run.failed'].includes(event.type)) { await db.query('ROLLBACK'); return false }
    await db.query(`INSERT INTO work_events (run_id, epoch, producer_seq, event_id, type, payload, occurred_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [run.id, run.epoch, event.producerSeq, event.eventId, event.type, event.payload || {}, event.occurredAt])
    if (event.type === 'worker.ready') {
      const ready = await db.query("UPDATE work_runs SET status='running' WHERE id=$1 AND epoch=$2 AND status='provisioning'", [run.id, run.epoch])
      if (ready.rowCount) await db.query("UPDATE work_tasks SET status='running' WHERE id=$1", [run.task_id])
    }
    await db.query('COMMIT')
    return true
  } catch (error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
}

async function liveEvents(endpoint, token, run, signal) {
  let after = 0
  for (;;) {
    const response = await fetch(`${endpoint.endpoint}/events?after=${after}`, { headers: { ...endpoint.headers, 'x-run-token': token }, signal })
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
          if (event.type === 'interaction.requested') return { status: 'waiting', question: event.payload?.question }
          if (event.type === 'run.finished') return { status: 'succeeded', failure: null }
          if (event.type === 'run.failed') return { status: 'failed', failure: event.payload?.error || '模型执行失败' }
          if (event.type === 'run.cancelled') return { status: 'cancelled', failure: null }
        }
      }
    } finally { reader.releaseLock() }
    await pause(500)
  }
}

const ARTIFACT_VALID_PATHS = new Set(['report.md', 'patch.diff', 'test-log.json'])
const ARTIFACT_LIMITS = { 'report.md': 2_000_000, 'patch.diff': 10_000_000, 'test-log.json': 10_000_000 }

function validateManifestEntry(entry, index, entries) {
  if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || typeof entry.path !== 'string') return false
  const kind = entry.kind || (entry.path === 'report.md' ? 'report' : index > 0 ? 'attachment' : null)
  if (ARTIFACT_VALID_PATHS.has(entry.path)) return true
  if (/^attachment-[0-4]\.(txt|csv|json|md)$/.test(entry.path)
    && /^[^/\\\x00-\x1f]{1,100}\.(txt|csv|json|md)$/i.test(entry.name)
    && entry.type === 'text/plain') return true
  return false
}

async function persistArtifacts(run, sandboxId) {
  const manifestPath = `${outputDir}/manifest.json`
  const manifestInfo = await optionalFileInfo(sandboxId, manifestPath)
  if (manifestInfo?.type !== 'file' || !Number.isSafeInteger(manifestInfo.size) || manifestInfo.size < 2 || manifestInfo.size > 4096) throw new Error('报告清单不存在或无效')
  const bytes = await readSandboxBytes(sandboxId, manifestPath, 4097)
  if (bytes.length !== manifestInfo.size) throw new Error('报告清单已变化')
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  const generation = Array.isArray(manifest) ? null : manifest?.generation
  if (generation !== null && (typeof generation !== 'string' || !/^generation-[0-9a-f-]{36}$/.test(generation))) throw new Error('报告代次无效')
  const entries = generation === null ? manifest : manifest.files
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 10) throw new Error('报告清单无效')
  if (new Set(entries.map(item => item?.name)).size !== entries.length) throw new Error('附件名称重复')
  const saved = []
  const destination = join(artifactDir, run.id, `epoch-${run.epoch}`)
  await mkdir(destination, { recursive: true, mode: 0o700 })
  for (const [index, entry] of entries.entries()) {
    const isKnownArtifact = ARTIFACT_VALID_PATHS.has(entry?.path)
    const isAttachment = !isKnownArtifact && /^attachment-[0-4]\.(txt|csv|json|md)$/.test(entry?.path)
    if (!isKnownArtifact && !isAttachment) throw new Error('成果类型或路径无效')
    if (isAttachment) {
      if (typeof entry.name !== 'string' || !/^[^/\\\x00-\x1f]{1,100}\.(txt|csv|json|md)$/i.test(entry.name) || entry.type !== 'text/plain') throw new Error('成果类型或路径无效')
    }
    const entryKind = entry.kind || (entry.path === 'report.md' ? 'report' : isAttachment ? 'attachment' : entry.path === 'patch.diff' ? 'patch' : 'test_log')
    const limit = ARTIFACT_LIMITS[entry.path] || 10_000_000
    const source = `${outputDir}/${generation ? `${generation}/` : ''}${entry.path}`
    const info = await optionalFileInfo(sandboxId, source)
    if (info?.type !== 'file' || !Number.isSafeInteger(info.size) || info.size < (entry.path === 'report.md' ? 1 : 0) || info.size > limit) throw new Error('成果文件类型或大小无效')
    const temporary = join(destination, `${entry.path}.${randomBytes(8).toString('hex')}.tmp`)
    const file = await open(temporary, 'wx', 0o600)
    let size = 0
    const hash = createHash('sha256')
    try {
      for await (const chunk of adapter.readFileStream(sandboxId, source)) {
        size += chunk.length
        if (size > limit) throw new Error('成果文件超过大小限制')
        hash.update(chunk)
        let offset = 0
        while (offset < chunk.length) offset += (await file.write(chunk, offset)).bytesWritten
      }
      await file.sync()
    } catch (error) { await file.close(); await rm(temporary, { force: true }); throw error }
    await file.close()
    if (size !== info.size || (await optionalFileInfo(sandboxId, source))?.type !== 'file') { await rm(temporary, { force: true }); throw new Error('成果文件复制时发生变化') }
    const storageKey = `${run.id}/epoch-${run.epoch}/${entry.path}`
    await rename(temporary, join(artifactDir, storageKey))
    saved.push({ ...entry, storageKey, size, sha256: hash.digest('hex'), kind: entryKind })
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
        [crypto.randomUUID(), artifact.rows[0].id, run.id, item.storageKey, item.sha256, item.size, item.type || 'text/plain'])
    }
    await db.query('COMMIT')
  } catch (error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
}

async function saveCheckpoint(run, sandboxId, question = null, kind = 'question') {
  if (question !== null && (typeof question !== 'string' || !question.trim() || question.length > 4000)) throw new Error('问题无效')
  const paths = [{ source: '/tmp/agentanywhere-session/checkpoint.jsonl', name: 'session.jsonl', limit: 10_000_000 }]
  const artifacts = []
  const manifestPath = `${outputDir}/manifest.json`
  const manifestInfo = await optionalFileInfo(sandboxId, manifestPath)
  if (manifestInfo) {
    if (manifestInfo.type !== 'file' || manifestInfo.size > 4096) throw new Error('检查点成果清单无效')
    const bytes = await readSandboxBytes(sandboxId, manifestPath, 4097)
    const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!/^generation-[0-9a-f-]{36}$/.test(manifest?.generation) || !Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 6) throw new Error('检查点成果清单无效')
    if (new Set(manifest.files.map(file => file?.name)).size !== manifest.files.length) throw new Error('检查点附件名称重复')
    paths.push({ source: manifestPath, name: 'manifest.json', limit: 4096 })
    for (const [index, file] of manifest.files.entries()) {
      if (file.path !== (index === 0 ? 'report.md' : `attachment-${index - 1}.${file.path?.split('.').at(-1)}`)
        || (index > 0 && !/^attachment-[0-4]\.(txt|csv|json|md)$/.test(file.path))
        || typeof file.name !== 'string' || !/^[^/\\\x00-\x1f]{1,100}\.(txt|csv|json|md)$/i.test(file.name)
        || file.type !== (index === 0 ? 'text/markdown' : 'text/plain')) throw new Error('检查点成果路径无效')
      paths.push({ source: `${outputDir}/${manifest.generation}/${file.path}`, name: `${manifest.generation}/${file.path}`, limit: index === 0 ? 2_000_000 : 10_000_000 })
      artifacts.push({ path: `${manifest.generation}/${file.path}`, name: file.name, type: file.type, kind: index === 0 ? 'report' : 'attachment' })
    }
  }
  const root = join(artifactDir, run.id)
  const destination = join(root, `checkpoint-${run.epoch}`)
  const temporary = join(root, `checkpoint-${run.epoch}-${randomBytes(8).toString('hex')}.tmp`)
  await mkdir(temporary, { recursive: true, mode: 0o700 })
  const files = []
  try {
    for (const item of paths) {
      const info = await optionalFileInfo(sandboxId, item.source)
      if (info?.type !== 'file' || !Number.isSafeInteger(info.size) || info.size < (item.name.includes('/attachment-') ? 0 : 1) || info.size > item.limit) throw new Error('检查点文件缺失或过大')
      const bytes = await readSandboxBytes(sandboxId, item.source, item.limit + 1)
      if (bytes.length !== info.size || (await optionalFileInfo(sandboxId, item.source))?.size !== info.size) throw new Error('检查点文件复制时变化')
      const path = join(temporary, item.name)
      await mkdir(join(path, '..'), { recursive: true, mode: 0o700 })
      await writeFile(path, bytes, { mode: 0o600, flush: true })
      files.push({ name: item.name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
    }
    await rm(destination, { recursive: true, force: true })
    await rename(temporary, destination)
    const db = await pool.connect()
    try {
      await db.query('BEGIN')
      const current = await db.query("SELECT status FROM work_runs WHERE id=$1 AND epoch=$2 AND active FOR UPDATE", [run.id, run.epoch])
      if (current.rows[0]?.status === 'cancelling') { await db.query('ROLLBACK'); return false }
      if (!['provisioning', 'running', 'save_failed'].includes(current.rows[0]?.status)) throw new Error('Run 执行代次已失效')
      if (question !== null) {
        await db.query('INSERT INTO work_interactions (id, run_id, epoch, question, status, kind) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), run.id, run.epoch, question, 'pending', kind])
        await db.query(`UPDATE work_runs SET status='waiting', checkpoint_ref=$3, run_token_hash=NULL, failure=NULL, pending_status=NULL,
          active_ms=active_ms + COALESCE(GREATEST(0, EXTRACT(EPOCH FROM (now()-active_since))*1000)::bigint,0), active_since=NULL
          WHERE id=$1 AND epoch=$2`, [run.id, run.epoch, JSON.stringify({ epoch: run.epoch, files, artifacts })])
        await db.query("UPDATE work_tasks SET status='waiting' WHERE id=$1", [run.task_id])
      } else await db.query('UPDATE work_runs SET checkpoint_ref=$3 WHERE id=$1 AND epoch=$2', [run.id, run.epoch, JSON.stringify({ epoch: run.epoch, files, artifacts })])
      await db.query('COMMIT')
      return true
    } catch (error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
  } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error }
}

async function restoreCheckpoint(run, sandboxId) {
  const checkpoint = run.checkpoint_ref
  if (!checkpoint) return null
  const sourceRunId = checkpoint.sourceRunId || run.id
  if (!/^[0-9a-f-]{36}$/i.test(sourceRunId) || !Number.isSafeInteger(checkpoint.epoch)
    || (sourceRunId === run.id && checkpoint.epoch >= run.epoch) || !Array.isArray(checkpoint.files)) throw new Error('检查点引用无效')
  const root = join(artifactDir, sourceRunId, `checkpoint-${checkpoint.epoch}`)
  const entries = []
  for (const file of checkpoint.files) {
    if (file.name !== 'session.jsonl' && file.name !== 'manifest.json' && !/^generation-[0-9a-f-]{36}\/(report\.md|attachment-[0-4]\.(txt|csv|json|md))$/.test(file.name)) throw new Error('检查点路径无效')
    const bytes = await readFile(join(root, file.name))
    if (bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('检查点校验失败')
    entries.push({ path: file.name === 'session.jsonl' ? '/tmp/agentanywhere-session/checkpoint.jsonl' : `${outputDir}/${file.name}`, data: bytes, mode: 600 })
  }
  if (!entries.some(item => item.path.endsWith('/checkpoint.jsonl'))) throw new Error('检查点会话缺失')
  const generationDirs = [...new Set(entries.filter(item => item.path.startsWith(`${outputDir}/generation-`)).map(item => item.path.slice(0, item.path.lastIndexOf('/'))))]
  await adapter.createDirectories(sandboxId, [{ path: '/tmp/agentanywhere-session', mode: 700 }, { path: outputDir, mode: 700 },
    ...generationDirs.map(path => ({ path, mode: 700 }))])
  await adapter.writeFile(sandboxId, entries)
  if (sourceRunId !== run.id) return { resume: true, answer: null }
  const [interaction] = (await pool.query("SELECT answer, kind FROM work_interactions WHERE run_id=$1 AND epoch=$2 AND status='answered'", [run.id, checkpoint.epoch])).rows
  if (!interaction) throw new Error('检查点回答缺失')
  return { resume: true, answer: interaction.kind === 'limit' ? null : interaction.answer }
}

async function releaseWaiting(run, sandboxId) {
  const state = await cleanup(run, sandboxId)
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    const current = await db.query('SELECT status FROM work_runs WHERE id=$1 AND epoch=$2 AND active FOR UPDATE', [run.id, run.epoch])
    if (current.rows[0]?.status === 'waiting') {
      await db.query(`UPDATE work_runs SET cleanup_state=$3, active=$4, sandbox_id=CASE WHEN $4 THEN sandbox_id ELSE NULL END,
        active_ms=active_ms + COALESCE(GREATEST(0, EXTRACT(EPOCH FROM (now()-active_since))*1000)::bigint,0), active_since=NULL
        WHERE id=$1 AND epoch=$2`, [run.id, run.epoch, state, state !== 'cleaned'])
    } else if (current.rows[0]?.status === 'cancelling' && state === 'cleaned') {
      await db.query(`UPDATE work_runs SET status='cancelled', cleanup_state='cleaned', active=false, sandbox_id=NULL, finished_at=now(),
        active_ms=active_ms + COALESCE(GREATEST(0, EXTRACT(EPOCH FROM (now()-active_since))*1000)::bigint,0), active_since=NULL
        WHERE id=$1 AND epoch=$2`, [run.id, run.epoch])
      await db.query("UPDATE work_tasks SET status='cancelled' WHERE id=$1", [run.task_id])
      await db.query("INSERT INTO work_events (run_id, epoch, event_id, type, payload, occurred_at) VALUES ($1,$2,$3,'run.cancelled','{}'::jsonb,now())", [run.id, run.epoch, randomUUID()])
    } else if (current.rows[0]?.status === 'cancelling') {
      await db.query("UPDATE work_runs SET cleanup_state='failed' WHERE id=$1 AND epoch=$2", [run.id, run.epoch])
    }
    await db.query('COMMIT')
  } catch (error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
}

async function markSaveBlocked(run, error, result) {
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    const current = await db.query('SELECT status FROM work_runs WHERE id=$1 AND epoch=$2 FOR UPDATE', [run.id, run.epoch])
    if (current.rows[0]?.status === 'cancelling') result = { status: 'cancelled', failure: null }
    const updated = await db.query(`UPDATE work_runs SET status='save_failed', failure=$3, cleanup_state='blocked',
      pending_status=$4, pending_failure=$5, run_token_hash=NULL WHERE id=$1 AND epoch=$2 AND active RETURNING task_id`,
      [run.id, run.epoch, `成果保存失败：${error.message}`, result.status, result.failure])
    if (updated.rowCount) await db.query("UPDATE work_tasks SET status='save_failed' WHERE id=$1", [updated.rows[0].task_id])
    await db.query('COMMIT')
  } catch (failure) { await db.query('ROLLBACK'); throw failure } finally { db.release() }
}

async function cleanup(run, sandboxId) {
  try {
    const items = await adapter.listSandboxes({ runId: run.id })
    const ids = new Set(items.filter(item => item.metadata?.epoch === String(run.epoch) && item.state !== 'Deleted').map(item => item.id))
    if (sandboxId) ids.add(sandboxId)
    for (const id of ids) {
      await adapter.destroy(id)
    }
    const remaining = await adapter.listSandboxes({ runId: run.id })
    if (remaining.some(item => item.metadata?.epoch === String(run.epoch) && item.state !== 'Deleted')) throw new Error('沙箱仍存在')
    return 'cleaned'
  } catch { return 'failed' }
}

async function stopRecoveredAgent(sandboxId) {
  await adapter.writeFile(sandboxId, [{ path: '/tmp/agentanywhere-recovery-stop', data: Buffer.from('stop'), mode: 600 }])
  const command = String.raw`node -e 'const fs=require("node:fs");
    const idle="/tmp/agentanywhere-recovery-idle";
    const running=()=>fs.readdirSync("/proc").filter(name=>/^[0-9]+$/.test(name)).filter(pid=>{
      try { const args=fs.readFileSync("/proc/"+pid+"/cmdline","utf8").split(String.fromCharCode(0));
        return args[0].split("/").at(-1)==="node" && args[1]==="/app/agent-worker.mjs" }
      catch { return false }
    });
    const found=running();
    if(found.length>1) process.exit(2);
    if(found.length && !fs.existsSync(idle)) process.kill(Number(found[0]),"SIGTERM");
    const started=Date.now();
    setInterval(()=>{ if(fs.existsSync(idle) && running().length===1) process.exit(0); if(Date.now()-started>10000) process.exit(3) },100)'`
  const result = await adapter.startProcess(sandboxId, { command, timeoutSeconds: 12 })
  if (result.exitCode !== 0) throw new Error('旧 Pi 未停止')
}

async function finish(run, result, sandboxId) {
  const cleanupState = await cleanup(run, sandboxId)
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    const current = await db.query('SELECT status FROM work_runs WHERE id=$1 AND epoch=$2 FOR UPDATE', [run.id, run.epoch])
    if (current.rows[0]?.status === 'cancelling') result = { status: 'cancelled', failure: null }
    const updated = await db.query(`UPDATE work_runs SET status=$3, failure=$4, cleanup_state=$5, active=$6,
      run_token_hash=NULL, finished_at=COALESCE(finished_at, now()),
      active_ms=active_ms + COALESCE(GREATEST(0, EXTRACT(EPOCH FROM (now()-active_since))*1000)::bigint,0), active_since=NULL
      WHERE id=$1 AND epoch=$2 AND active RETURNING task_id`,
      [run.id, run.epoch, result.status, result.failure, cleanupState, cleanupState !== 'cleaned'])
    if (updated.rowCount) await db.query('UPDATE work_tasks SET status=$2 WHERE id=$1', [updated.rows[0].task_id, result.status])
    await db.query('COMMIT')
  } catch (error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
}

async function execute(run, token) {
  let sandboxId
  let result = { status: 'failed', failure: 'Pi 启动失败' }
  let cancelled = false
  let endpoint
  const eventsAbort = new AbortController()
  let stopSent = false
  const watch = setInterval(() => void pool.query(`UPDATE work_runs SET active_heartbeat_at=now()
    WHERE id=$1 AND epoch=$2 AND active RETURNING status, budget_reason, active_since, active_ms, active_limit_ms`, [run.id, run.epoch]).then(async ({ rows }) => {
    const state = rows[0]
    if (!state || stopSent) return
    const elapsed = Number(state.active_ms) + (state.active_since ? Math.max(0, Date.now() - new Date(state.active_since).getTime()) : 0)
    if (state.status !== 'cancelling' && !state.budget_reason && elapsed >= Number(state.active_limit_ms)) {
      await pool.query("UPDATE work_runs SET budget_reason='time' WHERE id=$1 AND epoch=$2 AND active AND budget_reason IS NULL", [run.id, run.epoch])
      state.budget_reason = 'time'
    }
    if (state.status !== 'cancelling' && !state.budget_reason) return
    stopSent = true
    cancelled = state.status === 'cancelling'
    if (endpoint) {
      const base = endpoint.endpoint
      try { await fetch(`${base}/cancel`, { method: 'POST', headers: { ...endpoint.headers, 'x-run-token': token }, signal: AbortSignal.timeout(3000) }) }
      catch { /* cleanup still follows */ }
    }
    setTimeout(() => eventsAbort.abort(), 5000)
  }).catch(() => {}), 200)
  const ensureActive = async () => {
    const { rows } = await pool.query('SELECT status FROM work_runs WHERE id=$1 AND epoch=$2', [run.id, run.epoch])
    if (rows[0]?.status === 'cancelling') { cancelled = true; throw new Error('Run cancelled') }
  }
  try {
    await ensureActive()
    const row = await pool.query('SELECT goal, source_url, repo_url FROM work_tasks WHERE id=$1', [run.task_id])
    const repoUrl = row.rows[0]?.repo_url || null
    let goal = [row.rows[0].goal, row.rows[0].source_url && `指定来源：${row.rows[0].source_url}`].filter(Boolean).join('\n\n')
    if (run.previous_report_version_id && !run.checkpoint_ref) {
      const previous = await pool.query(`SELECT v.storage_key, v.sha256, v.size_bytes, v.run_id
        FROM work_artifact_versions v JOIN work_artifacts a ON a.id=v.artifact_id
        WHERE v.id=$1 AND a.task_id=$2 AND a.kind='report'`, [run.previous_report_version_id, run.task_id])
      const version = previous.rows[0]
      if (!version || !(version.storage_key === `${version.run_id}/report.md` || new RegExp(`^${version.run_id}/epoch-[0-9]+/report\\.md$`).test(version.storage_key)) || !Number.isSafeInteger(Number(version.size_bytes))
        || Number(version.size_bytes) < 1 || Number(version.size_bytes) > 2_000_000) throw new Error('旧报告校验失败')
      let report
      try { report = await readFile(join(artifactDir, version.storage_key)) } catch { throw new Error('旧报告校验失败') }
      if (report.length !== Number(version.size_bytes) || createHash('sha256').update(report).digest('hex') !== version.sha256) throw new Error('旧报告校验失败')
      const context = typeof run.context_snapshot === 'string' ? JSON.parse(run.context_snapshot) : run.context_snapshot
      if (!Array.isArray(context?.messages) || !context.messages.every(item => typeof item === 'string') || typeof context.instruction !== 'string') throw new Error('保留上下文无效')
      goal = `${goal}\n\n既往用户要求：\n${context.messages.map((message, index) => `${index + 1}. ${message}`).join('\n')}\n\n上一版报告（作为修改输入）：\n${new TextDecoder('utf-8', { fatal: true }).decode(report)}\n\n本次修改要求：\n${context.instruction}`
    }
    await ensureActive()
    let profileId = 'worker-basic'
    let agentType = 'research'
    if (run.agent_version_id) {
      const avRow = await pool.query('SELECT profile_id, tool_set FROM agent_versions WHERE id = $1', [run.agent_version_id])
      if (avRow.rows[0]) {
        profileId = avRow.rows[0].profile_id
        agentType = avRow.rows[0].tool_set || 'research'
      }
    }
    const profile = PROFILES[profileId] || PROFILES['worker-basic']
    const created = await adapter.create({
      image: profile.image, entrypoint: profile.entrypoint,
      env: { RUN_TOKEN: token }, metadata: { runId: run.id, epoch: String(run.epoch) },
      resource: { cpu: profile.cpu, memory: profile.memory }, timeoutSeconds: null, readyTimeoutSeconds: 60,
    })
    sandboxId = created.sandboxId
    run.sandbox_id = sandboxId
    await pool.query('UPDATE work_runs SET sandbox_id=$3 WHERE id=$1 AND epoch=$2 AND active', [run.id, run.epoch, sandboxId])
    const checkpoint = await restoreCheckpoint(run, sandboxId)
    if (repoUrl && !checkpoint) {
      try {
        await injectRepository(adapter, sandboxId, repoUrl, '/home/node/workspace')
      } catch (err) {
        await pool.query("UPDATE work_runs SET status='failed', failure=$1, finished_at=now() WHERE id=$2 AND epoch=$3 AND active",
          [`Repository injection failed: ${err.message}`, run.id, run.epoch])
        await pool.query("UPDATE work_tasks SET status='failed' WHERE id=$1", [run.task_id])
        await cleanup(run, sandboxId)
        return
      }
    }
    await ensureActive()
    endpoint = await adapter.getEndpoint(sandboxId, 3001)
    let ready = false
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const health = await fetch(`${endpoint.endpoint}/health`, { headers: endpoint.headers, signal: AbortSignal.timeout(1000) })
        if (health.ok) { ready = true; break }
      } catch { /* process can still be starting */ }
      await pause(500)
    }
    if (!ready) throw new Error('Pi 进程未能启动')
    await ensureActive()
    const proxyOrigin = new URL(process.env.MODEL_PROXY_ORIGIN || 'http://web:3000')
    proxyOrigin.hostname = (await lookup(proxyOrigin.hostname, { family: 4 })).address
    const proxyBase = `${proxyOrigin.origin}/internal/runs/${run.id}/${run.epoch}/v1`
    const toolOrigin = new URL(process.env.TOOL_GATEWAY_ORIGIN || 'http://queue:3003')
    toolOrigin.hostname = (await lookup(toolOrigin.hostname, { family: 4 })).address
    const base = endpoint.endpoint
    await ensureActive()
    const started = await fetch(`${base}/run`, { method: 'POST', headers: { ...endpoint.headers, 'x-run-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ goal, model: run.model_snapshot, proxyBase, toolBase: `${toolOrigin.origin}/internal/research/${run.id}/${run.epoch}`, resume: checkpoint?.resume ?? false, answer: checkpoint?.answer ?? null, agentType }), signal: AbortSignal.timeout(10_000) })
    if (!started.ok) throw new Error('Pi 启动请求失败')
    endpoint = { ...endpoint, endpoint: base }
    result = await liveEvents(endpoint, token, run, AbortSignal.any([eventsAbort.signal, AbortSignal.timeout(50 * 60_000)]))
  } catch (error) {
    if (!cancelled) console.error('Run execution interrupted', run.id, error?.message)
    result = cancelled ? { status: 'cancelled', failure: null } : { status: 'failed', failure: error?.message === '旧报告校验失败' ? error.message : 'Pi 启动或执行中断' }
  }
  finally {
    clearInterval(watch)
    try {
      if (sandboxId) {
        const state = await pool.query('SELECT status, budget_reason, model_call_limit, active_limit_ms FROM work_runs WHERE id=$1 AND epoch=$2', [run.id, run.epoch])
        if (state.rows[0]?.status !== 'cancelling' && state.rows[0]?.budget_reason) {
          const question = state.rows[0].budget_reason === 'time'
            ? `已达到 ${Math.ceil(Number(state.rows[0].active_limit_ms) / 60000)} 分钟活跃执行上限。继续会增加 45 分钟和 40 次模型调用额度；是否继续？`
            : `已达到 ${state.rows[0].model_call_limit} 次模型调用上限。继续会增加 45 分钟和 40 次模型调用额度；是否继续？`
          try {
            const saved = await saveCheckpoint(run, sandboxId, question, 'limit')
            if (saved) { await releaseWaiting(run, sandboxId); return }
          } catch (error) { await markSaveBlocked(run, error, { status: 'waiting', failure: null }); return }
          result = { status: 'cancelled', failure: null }
        }
        if (result.status === 'waiting') {
          let saved
          try { saved = await saveCheckpoint(run, sandboxId, result.question) }
          catch (error) {
            const current = await pool.query('SELECT status FROM work_runs WHERE id=$1 AND epoch=$2', [run.id, run.epoch])
            if (current.rows[0]?.status !== 'cancelling') { await markSaveBlocked(run, error, result); return }
          }
          if (saved) { await releaseWaiting(run, sandboxId); return }
          result = { status: 'cancelled', failure: null }
        }
        if (result.status === 'failed') {
          let sessionInfo
          try { sessionInfo = await optionalFileInfo(sandboxId, '/tmp/agentanywhere-session/checkpoint.jsonl') }
          catch (error) { await markSaveBlocked(run, error, result); return }
          if (sessionInfo) {
            try { await saveCheckpoint(run, sandboxId) }
            catch (error) { await markSaveBlocked(run, error, result); return }
          }
        }
        const manifestPath = `${outputDir}/manifest.json`
        const reportPath = `${outputDir}/report.md`
        try { await adapter.close(sandboxId); await adapter.connect(sandboxId) } catch (err) { console.error('Sandbox reconnect failed:', err.message) }
        let manifest, report
        try { [manifest, report] = await Promise.all([optionalFileInfo(sandboxId, manifestPath), optionalFileInfo(sandboxId, reportPath)]) }
        catch (error) { await markSaveBlocked(run, error, result); return }
        if (result.status === 'succeeded' || manifest || report) {
          try { await persistArtifacts(run, sandboxId) }
          catch (error) { await markSaveBlocked(run, error, result); return }
        }
      }
      await finish(run, result, sandboxId)
    }
    finally {
      if (sandboxId) await adapter.close(sandboxId)
      active.delete(run.id)
    }
  }
}

async function reconcile() {
  const rows = await pool.query('SELECT id, task_id, epoch, sandbox_id, status, failure, cleanup_state FROM work_runs WHERE active')
  for (const run of rows.rows) {
    await pool.query('UPDATE work_runs SET run_token_hash=NULL WHERE id=$1 AND epoch=$2 AND active', [run.id, run.epoch])
    if (run.cleanup_state === 'blocked' || run.cleanup_state === 'failed' || run.cleanup_state === 'retry_requested') continue
    if (run.status === 'waiting') { await releaseWaiting(run, run.sandbox_id); continue }
    await pool.query(`UPDATE work_runs SET active_ms=active_ms + COALESCE(GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(active_heartbeat_at,now())-active_since))*1000)::bigint,0),
      active_since=NULL WHERE id=$1 AND epoch=$2 AND active`, [run.id, run.epoch])
    try {
      if (run.sandbox_id) {
        await adapter.connect(run.sandbox_id)
        await stopRecoveredAgent(run.sandbox_id)
      }
      if (run.sandbox_id && run.status !== 'cancelling' && await optionalFileInfo(run.sandbox_id, '/tmp/agentanywhere-session/checkpoint.jsonl')) await saveCheckpoint(run, run.sandbox_id)
      const persisted = await pool.query('SELECT 1 FROM work_artifact_versions WHERE run_id=$1 LIMIT 1', [run.id])
      if (persisted.rowCount) {
        const terminal = await pool.query("SELECT type, payload FROM work_events WHERE run_id=$1 AND type IN ('run.finished', 'run.failed') ORDER BY server_seq DESC LIMIT 1", [run.id])
        const last = terminal.rows[0]
        await finish(run, { status: last?.type === 'run.finished' ? 'succeeded' : last?.type === 'run.failed' ? 'failed' : 'lost', failure: last?.type === 'run.failed' ? last.payload?.error : last?.type === 'run.finished' ? null : '执行服务中断；请手动重试' }, run.sandbox_id)
        continue
      }
      const manifest = run.sandbox_id && await optionalFileInfo(run.sandbox_id, `${outputDir}/manifest.json`)
      const report = run.sandbox_id && await optionalFileInfo(run.sandbox_id, `${outputDir}/report.md`)
      if (run.status === 'cancelling') {
        if (manifest || report) await persistArtifacts(run, run.sandbox_id)
        await finish(run, { status: 'cancelled', failure: null }, run.sandbox_id)
        continue
      }
      if (manifest || report) await markSaveBlocked(run, new Error('执行服务中断，需重试保存已有报告'), { status: 'lost', failure: '执行服务中断；请手动重试' })
      else await finish(run, { status: 'lost', failure: '执行服务中断；请手动重试' }, run.sandbox_id)
    } catch (error) {
      if (error.statusCode === 404 && !run.sandbox_id) await finish(run, { status: 'lost', failure: '执行中断且沙箱已失效；请手动重试' }, run.sandbox_id)
      else await markSaveBlocked(run, error, { status: 'lost', failure: '执行服务中断；请手动重试' })
    }
    finally { if (run.sandbox_id) await adapter.close(run.sandbox_id) }
  }
}

async function recoverPending() {
  const rows = await pool.query("SELECT id, task_id, epoch, sandbox_id, status, failure, pending_status, pending_failure FROM work_runs WHERE active AND cleanup_state='retry_requested'")
  for (const run of rows.rows) {
    if (recovering.has(run.id)) continue
    recovering.add(run.id)
    void (async () => {
      try {
        if (run.status === 'waiting') { await releaseWaiting(run, run.sandbox_id); return }
        if (run.status === 'save_failed') {
          await adapter.connect(run.sandbox_id)
          await stopRecoveredAgent(run.sandbox_id)
          if (run.pending_status === 'waiting') {
            const event = await pool.query("SELECT payload FROM work_events WHERE run_id=$1 AND epoch=$2 AND type='interaction.requested' ORDER BY server_seq DESC LIMIT 1", [run.id, run.epoch])
            const reason = (await pool.query('SELECT budget_reason FROM work_runs WHERE id=$1', [run.id])).rows[0]?.budget_reason
            const question = event.rows[0]?.payload?.question || (reason ? '执行达到上限。是否继续？' : null)
            if (!question) throw new Error('待保存问题缺失')
            await saveCheckpoint(run, run.sandbox_id, question, event.rows[0] ? 'question' : 'limit')
            await releaseWaiting(run, run.sandbox_id)
            return
          }
          const manifest = await optionalFileInfo(run.sandbox_id, `${outputDir}/manifest.json`)
          const report = await optionalFileInfo(run.sandbox_id, `${outputDir}/report.md`)
          if (run.pending_status !== 'cancelled' && await optionalFileInfo(run.sandbox_id, '/tmp/agentanywhere-session/checkpoint.jsonl')) await saveCheckpoint(run, run.sandbox_id)
          if (run.pending_status === 'succeeded' || manifest || report) await persistArtifacts(run, run.sandbox_id)
        }
        await finish(run, { status: run.pending_status || run.status, failure: run.pending_failure || (run.status === 'save_failed' ? null : run.failure) }, run.sandbox_id)
      } catch (error) { await markSaveBlocked(run, error, { status: run.pending_status || run.status, failure: run.pending_failure || run.failure }) }
      finally { if (run.sandbox_id) await adapter.close(run.sandbox_id); recovering.delete(run.id) }
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
  await boss.stop().catch(error => console.error('Queue shutdown failed', error?.message))
  process.exit(0)
})
