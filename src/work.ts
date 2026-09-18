import { createHash } from 'node:crypto'
import { SQL } from 'bun'
import type { ModelSelection, Protocol } from './model-connection'

type VisibleConnection = { endpoint: string; hasCredential: boolean; models: ModelSelection[] }
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
    status text NOT NULL, model_snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
  )`
  await db`CREATE TABLE IF NOT EXISTS work_messages (
    id uuid PRIMARY KEY, thread_id uuid NOT NULL REFERENCES work_threads(id),
    role text NOT NULL CHECK (role = 'user'), content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`

  async function detail(id: string) {
    const [row] = await db`SELECT t.id, t.goal, t.source_url AS "sourceUrl", t.status, t.created_at AS "createdAt",
      r.id AS "runId", r.status AS "runStatus", r.model_snapshot AS "model", h.id AS "threadId"
      FROM work_tasks t JOIN work_runs r ON r.task_id = t.id JOIN work_threads h ON h.task_id = t.id
      WHERE t.id = ${id} AND t.owner_id = 'owner' ORDER BY r.created_at DESC, r.id DESC LIMIT 1`
    if (!row) return null
    const messages = await db`SELECT role, content FROM work_messages WHERE thread_id = ${row.threadId} ORDER BY created_at, id`
    return { id: row.id, goal: row.goal, sourceUrl: row.sourceUrl, status: row.status, createdAt: row.createdAt,
      run: { id: row.runId, status: row.runStatus, model: typeof row.model === 'string' ? JSON.parse(row.model) : row.model }, thread: { id: row.threadId, messages } }
  }

  async function list() {
    return db`SELECT id, goal, source_url AS "sourceUrl", status, created_at AS "createdAt"
      FROM work_tasks WHERE owner_id = 'owner' ORDER BY created_at DESC, id DESC`
  }

  async function create(body: unknown, connection: VisibleConnection) {
    const input = parseRequest(body)
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    const [existing] = await db`SELECT id, request_hash FROM work_tasks WHERE request_id = ${input.requestId} AND owner_id = 'owner'`
    if (existing) {
      if (existing.request_hash !== requestHash) throw new WorkConflictError('请求 ID 已用于其他工作')
      return { task: await detail(existing.id), created: false }
    }
    const model = connection.models.find(item => item.id === input.modelId)
    if (!connection.endpoint || !connection.hasCredential || !model) throw new WorkInputError('请先选择可用模型并配置连接')
    if (!model.contextWindow || !model.maxTokens || !model.input?.includes('text')) throw new WorkInputError('请补充模型的上下文、输出上限和文本输入配置')
    const snapshot = { ...model, protocol: input.protocol ?? model.protocol, endpoint: connection.endpoint }
    const taskId = crypto.randomUUID()
    const inserted = await db.begin(async sql => {
      const rows = await sql`INSERT INTO work_tasks (id, owner_id, request_id, request_hash, goal, source_url, status)
        VALUES (${taskId}, 'owner', ${input.requestId}, ${requestHash}, ${input.goal}, ${input.sourceUrl}, 'queued')
        ON CONFLICT (request_id) DO NOTHING RETURNING id`
      if (!rows.length) return false
      const threadId = crypto.randomUUID()
      await sql`INSERT INTO work_threads (id, task_id) VALUES (${threadId}, ${taskId})`
      await sql`INSERT INTO work_runs (id, task_id, status, model_snapshot)
        VALUES (${crypto.randomUUID()}, ${taskId}, 'queued', ${JSON.stringify(snapshot)}::jsonb)`
      await sql`INSERT INTO work_messages (id, thread_id, role, content)
        VALUES (${crypto.randomUUID()}, ${threadId}, 'user', ${input.goal || input.sourceUrl!})`
      return true
    })
    if (inserted) return { task: await detail(taskId), created: true }
    const [winner] = await db`SELECT id, request_hash FROM work_tasks WHERE request_id = ${input.requestId} AND owner_id = 'owner'`
    if (!winner || winner.request_hash !== requestHash) throw new WorkConflictError('请求 ID 已用于其他工作')
    return { task: await detail(winner.id), created: false }
  }

  return { list, detail, create }
}
