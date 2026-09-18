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

  async function detail(id: string) {
    const [row] = await db`SELECT t.id, t.goal, t.source_url AS "sourceUrl", t.status, t.created_at AS "createdAt",
      r.id AS "runId", r.status AS "runStatus", r.model_snapshot AS "model", r.epoch,
      r.cleanup_state AS "cleanupState", r.failure, r.started_at AS "startedAt", r.finished_at AS "finishedAt", h.id AS "threadId"
      FROM work_tasks t JOIN work_runs r ON r.task_id = t.id JOIN work_threads h ON h.task_id = t.id
      WHERE t.id = ${id} AND t.owner_id = 'owner' ORDER BY r.created_at DESC, r.id DESC LIMIT 1`
    if (!row) return null
    const messages = await db`SELECT role, content FROM work_messages WHERE thread_id = ${row.threadId} ORDER BY created_at, id`
    return { id: row.id, goal: row.goal, sourceUrl: row.sourceUrl, status: row.status, createdAt: row.createdAt,
      run: { id: row.runId, status: row.runStatus, model: typeof row.model === 'string' ? JSON.parse(row.model) : row.model,
        epoch: row.epoch, cleanupState: row.cleanupState, failure: row.failure, startedAt: row.startedAt, finishedAt: row.finishedAt }, thread: { id: row.threadId, messages } }
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

  return { list, detail, events, create, resolveRunModelConnection, authorizeModelProxy, recordModelUsage }
}
