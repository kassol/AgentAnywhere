import { createHash } from 'node:crypto'
import { SQL } from 'bun'
import type { ModelSelection, Protocol } from './model-connection'

type RunConnection = { endpoint: string; hasCredential: boolean; credentialRef: string | null; models: ModelSelection[] }
type CreateRequest = { requestId: string; goal: string; sourceUrl: string | null; modelId: string; protocol: Protocol | null }

export class WorkInputError extends Error {}
export class WorkConflictError extends Error {}

function parseRequest(body: unknown): CreateRequest {
  if (!body || typeof body !== 'object') throw new WorkInputError('请填写工作内容')
  const value = body as Record<string, unknown>
  if (typeof value.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId)) throw new WorkInputError('请求 ID 无效')
  const goal = typeof value.goal === 'string' ? value.goal.trim() : ''
  if (goal.length > 4000) throw new WorkInputError('目标内容过长')
  const sourceUrl = typeof value.sourceUrl === 'string' && value.sourceUrl.trim() ? value.sourceUrl.trim() : null
  if (sourceUrl) {
    if (sourceUrl.length > 2048) throw new WorkInputError('链接过长')
    let parsed: URL
    try { parsed = new URL(sourceUrl) } catch { throw new WorkInputError('公开链接无效') }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) throw new WorkInputError('公开链接须为 HTTP 地址')
  }
  if (!goal && !sourceUrl) throw new WorkInputError('请填写目标或公开链接')
  if (typeof value.modelId !== 'string' || !value.modelId.trim()) throw new WorkInputError('请选择模型')
  if (value.protocol !== undefined && value.protocol !== null && value.protocol !== 'chat-completions' && value.protocol !== 'responses') throw new WorkInputError('协议无效')
  return { requestId: value.requestId, goal, sourceUrl, modelId: value.modelId, protocol: value.protocol as Protocol | null ?? null }
}

export async function createWorkStore(databaseUrl: string) {
  const db = new SQL(databaseUrl)
  await db`CREATE TABLE IF NOT EXISTS work_tasks (
    id uuid PRIMARY KEY, owner_id text NOT NULL, request_id uuid NOT NULL UNIQUE,
    request_hash text NOT NULL, goal text NOT NULL, source_url text,
    status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
  )`
  await db`CREATE TABLE IF NOT EXISTS work_threads (
    id uuid PRIMARY KEY, task_id uuid NOT NULL UNIQUE REFERENCES work_tasks(id)
  )`
  await db`CREATE TABLE IF NOT EXISTS work_runs (
    id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES work_tasks(id),
    status text NOT NULL, model_snapshot jsonb NOT NULL, credential_ref text, created_at timestamptz NOT NULL DEFAULT now()
  )`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS credential_ref text`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS epoch integer NOT NULL DEFAULT 0`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT false`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS run_token_hash text`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS sandbox_id text`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS cleanup_state text NOT NULL DEFAULT 'none'`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS failure text`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS started_at timestamptz`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS finished_at timestamptz`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS pending_status text`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS pending_failure text`
  await db`CREATE UNIQUE INDEX IF NOT EXISTS one_active_work_run ON work_runs (active) WHERE active`
  await db`CREATE TABLE IF NOT EXISTS work_outbox (
    run_id uuid PRIMARY KEY REFERENCES work_runs(id), created_at timestamptz NOT NULL DEFAULT now()
  )`
  await db`CREATE TABLE IF NOT EXISTS work_events (
    server_seq bigserial PRIMARY KEY, run_id uuid NOT NULL REFERENCES work_runs(id),
    epoch integer NOT NULL, producer_seq integer, event_id text NOT NULL UNIQUE,
    type text NOT NULL, payload jsonb NOT NULL, occurred_at timestamptz NOT NULL,
    UNIQUE (run_id, epoch, producer_seq)
  )`
  await db`ALTER TABLE work_events ALTER COLUMN producer_seq DROP NOT NULL`
  await db`CREATE TABLE IF NOT EXISTS work_messages (
    id uuid PRIMARY KEY, thread_id uuid NOT NULL REFERENCES work_threads(id),
    role text NOT NULL CHECK (role = 'user'), content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`
  await db`ALTER TABLE work_messages ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES work_runs(id)`
  await db`ALTER TABLE work_messages ADD COLUMN IF NOT EXISTS command_id uuid UNIQUE`
  await db`ALTER TABLE work_messages ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'applied'`
  await db`ALTER TABLE work_messages ADD COLUMN IF NOT EXISTS applied_at timestamptz`
  await db`CREATE TABLE IF NOT EXISTS work_artifacts (
    id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES work_tasks(id),
    kind text NOT NULL, name text NOT NULL, UNIQUE (task_id, kind, name)
  )`
  await db`CREATE TABLE IF NOT EXISTS work_artifact_versions (
    id uuid PRIMARY KEY, artifact_id uuid NOT NULL REFERENCES work_artifacts(id),
    run_id uuid NOT NULL REFERENCES work_runs(id), storage_key text NOT NULL,
    sha256 text NOT NULL, size_bytes bigint NOT NULL, mime_type text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (artifact_id, run_id)
  )`

  async function detail(id: string) {
    const [row] = await db`SELECT t.id, t.goal, t.source_url AS "sourceUrl", t.status, t.created_at AS "createdAt",
      r.id AS "runId", r.status AS "runStatus", r.model_snapshot AS "model", r.epoch,
      r.cleanup_state AS "cleanupState", r.failure, r.started_at AS "startedAt", r.finished_at AS "finishedAt", h.id AS "threadId"
      FROM work_tasks t JOIN work_runs r ON r.task_id = t.id JOIN work_threads h ON h.task_id = t.id
      WHERE t.id = ${id} AND t.owner_id = 'owner' ORDER BY r.created_at DESC, r.id DESC LIMIT 1`
    if (!row) return null
    const messages = await db`SELECT id, role, content, status FROM work_messages WHERE thread_id = ${row.threadId} ORDER BY created_at, id`
    const artifacts = await db`SELECT a.id, a.kind, a.name, v.id AS "versionId", v.run_id AS "runId",
      v.sha256, v.size_bytes AS "sizeBytes", v.mime_type AS "mimeType", v.created_at AS "createdAt"
      FROM work_artifacts a JOIN work_artifact_versions v ON v.artifact_id = a.id
      WHERE a.task_id = ${id} ORDER BY v.created_at DESC, v.id DESC`
    return { id: row.id, goal: row.goal, sourceUrl: row.sourceUrl, status: row.status, createdAt: row.createdAt,
      run: { id: row.runId, status: row.runStatus, model: typeof row.model === 'string' ? JSON.parse(row.model) : row.model,
        epoch: row.epoch, cleanupState: row.cleanupState, failure: row.failure, startedAt: row.startedAt, finishedAt: row.finishedAt }, thread: { id: row.threadId, messages }, artifacts }
  }

  async function artifactVersion(versionId: string) {
    const [row] = await db`SELECT a.name, a.kind, v.storage_key AS "storageKey", v.sha256,
      v.size_bytes AS "sizeBytes", v.mime_type AS "mimeType"
      FROM work_artifact_versions v JOIN work_artifacts a ON a.id = v.artifact_id
      JOIN work_tasks t ON t.id = a.task_id WHERE v.id = ${versionId} AND t.owner_id = 'owner'`
    return row ?? null
  }

  async function requestCleanupRetry(taskId: string) {
    const rows = await db`UPDATE work_runs SET cleanup_state='retry_requested'
      WHERE id = (SELECT r.id FROM work_runs r JOIN work_tasks t ON t.id = r.task_id
        WHERE t.id = ${taskId} AND t.owner_id = 'owner' AND r.cleanup_state IN ('blocked', 'failed')
        ORDER BY r.created_at DESC, r.id DESC LIMIT 1)
      RETURNING id`
    return rows.length > 0
  }

  async function cancel(taskId: string) {
    return db.begin(async sql => {
      const [run] = await sql`SELECT r.id, r.epoch, r.status, r.active FROM work_runs r
        JOIN work_tasks t ON t.id = r.task_id WHERE t.id = ${taskId} AND t.owner_id = 'owner'
        ORDER BY r.created_at DESC, r.id DESC LIMIT 1 FOR UPDATE OF r`
      if (!run) return null
      if (run.status === 'cancelling' || run.status === 'cancelled') return { accepted: false }
      if (!['queued', 'provisioning', 'running'].includes(run.status)) return { accepted: false }
      if (run.active) {
        const [terminal] = await sql`SELECT 1 FROM work_events WHERE run_id = ${run.id} AND epoch = ${run.epoch}
          AND type IN ('run.finished', 'run.failed') LIMIT 1`
        if (terminal) return { accepted: false }
      }
      const status = run.active ? 'cancelling' : 'cancelled'
      await sql`UPDATE work_runs SET status = ${status}, run_token_hash = NULL,
        finished_at = CASE WHEN ${status} = 'cancelled' THEN now() ELSE finished_at END
        WHERE id = ${run.id}`
      await sql`UPDATE work_tasks SET status = ${status} WHERE id = ${taskId}`
      if (!run.active) await sql`DELETE FROM work_outbox WHERE run_id = ${run.id}`
      await sql`INSERT INTO work_events (run_id, epoch, event_id, type, payload, occurred_at)
        VALUES (${run.id}, ${run.epoch}, ${crypto.randomUUID()}, ${run.active ? 'run.cancel_requested' : 'run.cancelled'}, '{}'::jsonb, now())`
      return { accepted: true }
    })
  }

  async function isRunStopped(runId: string, epoch: number) {
    const [row] = await db`SELECT status FROM work_runs WHERE id = ${runId} AND epoch = ${epoch}`
    return !row || !['provisioning', 'running'].includes(row.status)
  }

  async function events(taskId: string, after: number) {
    const [run] = await db`SELECT r.id FROM work_tasks t JOIN work_runs r ON r.task_id = t.id
      WHERE t.id = ${taskId} AND t.owner_id = 'owner' ORDER BY r.created_at DESC, r.id DESC LIMIT 1`
    if (!run) return null
    const rows = await db`SELECT server_seq AS "serverSeq", epoch, producer_seq AS "producerSeq", event_id AS "eventId",
      type, payload, occurred_at AS "occurredAt" FROM work_events
      WHERE run_id = ${run.id} AND server_seq > ${after} ORDER BY server_seq LIMIT 500`
    return rows.map((row: { payload: unknown }) => ({ ...row, payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload }))
  }

  async function list() {
    return db`SELECT id, goal, source_url AS "sourceUrl", status, created_at AS "createdAt"
      FROM work_tasks WHERE owner_id = 'owner' ORDER BY created_at DESC, id DESC`
  }

  async function create(body: unknown, connection: RunConnection) {
    const input = parseRequest(body)
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    const [existing] = await db`SELECT id, request_hash FROM work_tasks WHERE request_id = ${input.requestId} AND owner_id = 'owner'`
    if (existing) {
      if (existing.request_hash !== requestHash) throw new WorkConflictError('请求 ID 已用于其他工作')
      return { task: await detail(existing.id), created: false }
    }
    const model = connection.models.find(item => item.id === input.modelId)
    if (!connection.endpoint || !connection.hasCredential || !connection.credentialRef || !model) throw new WorkInputError('请先选择可用模型并配置连接')
    if (!model.contextWindow || !model.maxTokens || !model.input?.includes('text') || typeof model.reasoning !== 'boolean') throw new WorkInputError('请补充模型的上下文、输出上限、文本输入和推理配置')
    const snapshot = { ...model, protocol: input.protocol ?? model.protocol, endpoint: connection.endpoint }
    const taskId = crypto.randomUUID()
    const inserted = await db.begin(async sql => {
      const rows = await sql`INSERT INTO work_tasks (id, owner_id, request_id, request_hash, goal, source_url, status)
        VALUES (${taskId}, 'owner', ${input.requestId}, ${requestHash}, ${input.goal}, ${input.sourceUrl}, 'queued')
        ON CONFLICT (request_id) DO NOTHING RETURNING id`
      if (!rows.length) return false
      const threadId = crypto.randomUUID()
      await sql`INSERT INTO work_threads (id, task_id) VALUES (${threadId}, ${taskId})`
      const runId = crypto.randomUUID()
      await sql`INSERT INTO work_runs (id, task_id, status, model_snapshot, credential_ref)
        VALUES (${runId}, ${taskId}, 'queued', ${JSON.stringify(snapshot)}::jsonb, ${connection.credentialRef})`
      await sql`INSERT INTO work_outbox (run_id) VALUES (${runId})`
      await sql`INSERT INTO work_messages (id, thread_id, role, content)
        VALUES (${crypto.randomUUID()}, ${threadId}, 'user', ${input.goal || input.sourceUrl!})`
      return true
    })
    if (inserted) return { task: await detail(taskId), created: true }
    const [winner] = await db`SELECT id, request_hash FROM work_tasks WHERE request_id = ${input.requestId} AND owner_id = 'owner'`
    if (!winner || winner.request_hash !== requestHash) throw new WorkConflictError('请求 ID 已用于其他工作')
    return { task: await detail(winner.id), created: false }
  }

  async function appendRunMessage(runId: string, body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new WorkInputError('追加要求无效')
    const input = body as Record<string, unknown>
    if (typeof input.commandId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.commandId)) throw new WorkInputError('命令 ID 无效')
    if (input.kind !== 'steer') throw new WorkInputError('追加类型无效')
    const content = typeof input.content === 'string' ? input.content.trim() : ''
    if (!content || content.length > 4000) throw new WorkInputError('追加要求须为 1–4000 字')
    return db.begin(async sql => {
      const [run] = await sql`SELECT r.status, r.active, r.epoch, h.id AS "threadId" FROM work_runs r
        JOIN work_tasks t ON t.id = r.task_id JOIN work_threads h ON h.task_id = t.id
        WHERE r.id = ${runId} AND t.owner_id = 'owner' FOR UPDATE OF r`
      if (!run) return null
      const [existing] = await sql`SELECT id, run_id AS "runId", content, status FROM work_messages WHERE command_id = ${input.commandId}`
      if (existing) {
        if (existing.runId !== runId || existing.content !== content) throw new WorkConflictError('命令 ID 已用于其他追加要求')
        return { message: existing, created: false }
      }
      if (run.status !== 'running' || !run.active) throw new WorkConflictError('当前 Run 不在执行中')
      const id = crypto.randomUUID()
      const rows = await sql`INSERT INTO work_messages (id, thread_id, run_id, command_id, role, content, status)
        VALUES (${id}, ${run.threadId}, ${runId}, ${input.commandId}, 'user', ${content}, 'pending')
        ON CONFLICT (command_id) DO NOTHING RETURNING id, run_id AS "runId", content, status`
      if (rows.length) return { message: rows[0], created: true }
      const [winner] = await sql`SELECT id, run_id AS "runId", content, status FROM work_messages WHERE command_id = ${input.commandId}`
      if (!winner || winner.runId !== runId || winner.content !== content) throw new WorkConflictError('命令 ID 已用于其他追加要求')
      return { message: winner, created: false }
    })
  }

  async function pendingRunMessages(runId: string, epoch: number, token: string) {
    const hash = createHash('sha256').update(token).digest('hex')
    const rows = await db`SELECT m.id, m.content FROM work_messages m JOIN work_runs r ON r.id = m.run_id
      WHERE r.id = ${runId} AND r.epoch = ${epoch} AND r.active AND r.status = 'running'
      AND r.run_token_hash = ${hash} AND m.status = 'pending' ORDER BY m.created_at, m.id`
    return rows
  }

  async function acknowledgeRunMessage(runId: string, epoch: number, token: string, id: string) {
    const hash = createHash('sha256').update(token).digest('hex')
    return db.begin(async sql => {
      const [run] = await sql`SELECT id FROM work_runs WHERE id = ${runId} AND epoch = ${epoch}
        AND active AND status = 'running' AND run_token_hash = ${hash} FOR UPDATE`
      if (!run) return false
      const rows = await sql`UPDATE work_messages SET status = 'applied', applied_at = now()
        WHERE id = ${id} AND run_id = ${runId} AND status = 'pending' RETURNING id`
      if (rows.length) return true
      const [message] = await sql`SELECT status FROM work_messages WHERE id = ${id} AND run_id = ${runId}`
      return message?.status === 'applied'
    })
  }

  async function resolveRunModelConnection(runId: string, resolveCredential: (ref: string) => { endpoint: string; apiKey: string }) {
    const [row] = await db`SELECT credential_ref AS "credentialRef", model_snapshot AS "model" FROM work_runs WHERE id = ${runId}`
    if (!row?.credentialRef) throw new Error('Run 凭证版本不存在')
    const credential = resolveCredential(row.credentialRef)
    const model = typeof row.model === 'string' ? JSON.parse(row.model) : row.model
    if (credential.endpoint !== model.endpoint) throw new Error('Run 凭证版本与端点不一致')
    return credential
  }

  async function authorizeModelProxy(runId: string, epoch: number, token: string, modelId: string, protocol: Protocol,
    resolveCredential: (ref: string) => { endpoint: string; apiKey: string }) {
    const hash = createHash('sha256').update(token).digest('hex')
    const [row] = await db`SELECT credential_ref AS "credentialRef", model_snapshot AS "model"
      FROM work_runs WHERE id = ${runId} AND epoch = ${epoch} AND active AND status IN ('provisioning', 'running') AND run_token_hash = ${hash}`
    if (!row?.credentialRef) return null
    const model = typeof row.model === 'string' ? JSON.parse(row.model) : row.model
    if (model.id !== modelId || model.protocol !== protocol) return null
    const credential = resolveCredential(row.credentialRef)
    if (credential.endpoint !== model.endpoint) return null
    return credential
  }

  async function recordModelUsage(runId: string, epoch: number, usage: { callId: string; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }) {
    await db`INSERT INTO work_events (run_id, epoch, event_id, type, payload, occurred_at)
      SELECT ${runId}, ${epoch}, ${crypto.randomUUID()}, 'usage',
        jsonb_build_object('callId', ${usage.callId}::text, 'inputTokens', ${usage.inputTokens}::bigint, 'outputTokens', ${usage.outputTokens}::bigint, 'totalTokens', ${usage.totalTokens}::bigint), now()
      WHERE EXISTS (SELECT 1 FROM work_runs WHERE id = ${runId} AND epoch = ${epoch} AND active)`
  }

  return { list, detail, events, create, appendRunMessage, pendingRunMessages, acknowledgeRunMessage, cancel, isRunStopped, artifactVersion, requestCleanupRetry, resolveRunModelConnection, authorizeModelProxy, recordModelUsage }
}
