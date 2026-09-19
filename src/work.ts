import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SQL } from 'bun'
import type { ModelSelection, Protocol } from './model-connection'

type RunConnection = { endpoint: string; hasCredential: boolean; credentialRef: string | null; models: ModelSelection[] }
type CreateRequest = { requestId: string; goal: string; sourceUrl: string | null; modelId: string; protocol: Protocol | null }
type FrozenResearchModel = ModelSelection & { endpoint: string }

export class WorkInputError extends Error {}
export class WorkConflictError extends Error {}
export class WorkArtifactError extends Error {
  constructor(readonly kind: 'not-found' | 'invalid' | 'unavailable') { super(kind) }
}

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
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS request_id uuid UNIQUE`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS request_hash text`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS previous_report_version_id uuid`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS context_snapshot jsonb`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS checkpoint_ref jsonb`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS retry_of_run_id uuid REFERENCES work_runs(id)`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS model_calls integer NOT NULL DEFAULT 0`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS model_call_limit integer NOT NULL DEFAULT 40`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS active_ms bigint NOT NULL DEFAULT 0`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS active_limit_ms bigint NOT NULL DEFAULT 2700000`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS active_since timestamptz`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS active_heartbeat_at timestamptz`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS budget_reason text`
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
  await db`CREATE TABLE IF NOT EXISTS work_interactions (
    id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES work_runs(id), epoch integer NOT NULL,
    question text NOT NULL, status text NOT NULL, answer text,
    created_at timestamptz NOT NULL DEFAULT now(), answered_at timestamptz,
    UNIQUE (run_id, epoch)
  )`
  await db`ALTER TABLE work_interactions ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'question'`
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

  async function createWorkInTransaction(sql: SQL, input: CreateRequest, requestHash: string, snapshot: FrozenResearchModel, credentialRef: string, taskId: string) {
    const rows = await sql`INSERT INTO work_tasks (id, owner_id, request_id, request_hash, goal, source_url, status)
      VALUES (${taskId}, 'owner', ${input.requestId}, ${requestHash}, ${input.goal}, ${input.sourceUrl}, 'queued')
      ON CONFLICT (request_id) DO NOTHING RETURNING id`
    if (!rows.length) return null
    const threadId = crypto.randomUUID()
    await sql`INSERT INTO work_threads (id, task_id) VALUES (${threadId}, ${taskId})`
    const runId = crypto.randomUUID()
    await sql`INSERT INTO work_runs (id, task_id, status, model_snapshot, credential_ref)
      VALUES (${runId}, ${taskId}, 'queued', ${JSON.stringify(snapshot)}::text::jsonb, ${credentialRef})`
    await sql`INSERT INTO work_outbox (run_id) VALUES (${runId})`
    await sql`INSERT INTO work_messages (id, thread_id, role, content)
      VALUES (${crypto.randomUUID()}, ${threadId}, 'user', ${input.goal || input.sourceUrl!})`
    return { taskId, runId }
  }

  async function detail(id: string) {
    const [row] = await db`SELECT t.id, t.goal, t.source_url AS "sourceUrl", t.status, t.created_at AS "createdAt",
      r.id AS "runId", r.status AS "runStatus", r.model_snapshot AS "model", r.epoch,
      r.cleanup_state AS "cleanupState", r.failure, r.started_at AS "startedAt", r.finished_at AS "finishedAt",
      r.previous_report_version_id AS "previousReportVersionId", r.retry_of_run_id AS "retryOfRunId",
      r.model_calls AS "modelCalls", r.model_call_limit AS "modelCallLimit",
      r.active_ms + COALESCE(GREATEST(0, EXTRACT(EPOCH FROM (now()-r.active_since))*1000)::bigint,0) AS "activeMs",
      r.active_limit_ms AS "activeLimitMs", r.budget_reason AS "budgetReason", h.id AS "threadId"
      FROM work_tasks t JOIN work_runs r ON r.task_id = t.id JOIN work_threads h ON h.task_id = t.id
      WHERE t.id = ${id} AND t.owner_id = 'owner' ORDER BY r.created_at DESC, r.id DESC LIMIT 1`
    if (!row) return null
    const messages = await db`SELECT id, role, content, status FROM work_messages WHERE thread_id = ${row.threadId} ORDER BY created_at, id`
    const runs = await db`SELECT id, status, created_at AS "createdAt", finished_at AS "finishedAt", previous_report_version_id AS "previousReportVersionId", retry_of_run_id AS "retryOfRunId"
      FROM work_runs WHERE task_id = ${id} ORDER BY created_at, id`
    const [interaction] = await db`SELECT id, kind, question, status, answer FROM work_interactions WHERE run_id = ${row.runId} ORDER BY epoch DESC LIMIT 1`
    const artifacts = await db`SELECT a.id, a.kind, a.name, v.id AS "versionId", v.run_id AS "runId", r.status AS "runStatus",
      v.sha256, v.size_bytes AS "sizeBytes", v.mime_type AS "mimeType", v.created_at AS "createdAt"
      FROM work_artifacts a JOIN work_artifact_versions v ON v.artifact_id = a.id JOIN work_runs r ON r.id=v.run_id
      WHERE a.task_id = ${id} ORDER BY v.created_at DESC, v.id DESC`
    return { id: row.id, goal: row.goal, sourceUrl: row.sourceUrl, status: row.status, createdAt: row.createdAt,
      run: { id: row.runId, status: row.runStatus, model: typeof row.model === 'string' ? JSON.parse(row.model) : row.model,
        epoch: row.epoch, cleanupState: row.cleanupState, failure: row.failure, startedAt: row.startedAt, finishedAt: row.finishedAt,
        previousReportVersionId: row.previousReportVersionId, retryOfRunId: row.retryOfRunId,
        modelCalls: row.modelCalls, modelCallLimit: row.modelCallLimit, activeMs: Number(row.activeMs), activeLimitMs: Number(row.activeLimitMs), budgetReason: row.budgetReason },
      runs, interaction: interaction ?? null, thread: { id: row.threadId, messages }, artifacts }
  }

  async function artifactVersion(versionId: string) {
    const [row] = await db`SELECT a.name, a.kind, v.storage_key AS "storageKey", v.sha256,
      v.size_bytes AS "sizeBytes", v.mime_type AS "mimeType"
      FROM work_artifact_versions v JOIN work_artifacts a ON a.id = v.artifact_id
      JOIN work_tasks t ON t.id = a.task_id WHERE v.id = ${versionId} AND t.owner_id = 'owner'`
    return row ?? null
  }

  async function readArtifact(versionId: string, artifactDir: string, expectedKind?: 'report' | 'attachment') {
    const artifact = await artifactVersion(versionId)
    if (!artifact || (expectedKind && artifact.kind !== expectedKind)
      || !/^[0-9a-f-]{36}\/(?:epoch-\d+\/|checkpoint-\d+\/generation-[0-9a-f-]{36}\/)?(report\.md|attachment-[0-4]\.(txt|csv|json|md))$/i.test(artifact.storageKey)
      || !Number.isSafeInteger(Number(artifact.sizeBytes)) || Number(artifact.sizeBytes) < (artifact.kind === 'report' ? 1 : 0) || Number(artifact.sizeBytes) > 10_000_000
      || !['text/markdown', 'text/plain'].includes(artifact.mimeType)) throw new WorkArtifactError('not-found')
    let bytes: Buffer
    try { bytes = await readFile(join(artifactDir, artifact.storageKey)) } catch { throw new WorkArtifactError('unavailable') }
    if (bytes.length !== Number(artifact.sizeBytes) || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new WorkArtifactError('invalid')
    return { artifact, bytes }
  }

  function workCards(rows: any[]) {
    return rows.map(row => ({
      id: row.id, goal: row.goal, sourceUrl: row.sourceUrl, status: row.status, createdAt: row.createdAt, href: `/tasks/${row.id}`,
      runs: typeof row.runs === 'string' ? JSON.parse(row.runs) : row.runs,
      reports: (typeof row.reports === 'string' ? JSON.parse(row.reports) : row.reports).map((report: any) => ({ ...report,
        href: `/tasks/${row.id}?version=${report.versionId}`, contentHref: `/api/artifacts/${report.versionId}/content`, downloadHref: `/api/artifacts/${report.versionId}/download`,
      })),
    }))
  }

  async function stewardCatalog(cursor = 0, query = '') {
    const pattern = `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
    const rows = await db`SELECT t.id, t.goal, t.source_url AS "sourceUrl", t.status, t.created_at AS "createdAt",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'createdAt', r.created_at, 'finishedAt', r.finished_at) ORDER BY r.created_at, r.id)
        FROM work_runs r WHERE r.task_id=t.id), '[]'::jsonb) AS runs,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('versionId', v.id, 'runId', v.run_id, 'runStatus', r.status, 'createdAt', v.created_at) ORDER BY v.created_at DESC, v.id DESC)
        FROM work_artifacts a JOIN work_artifact_versions v ON v.artifact_id=a.id JOIN work_runs r ON r.id=v.run_id
        WHERE a.task_id=t.id AND a.kind='report'), '[]'::jsonb) AS reports
      FROM work_tasks t WHERE t.owner_id='owner' AND (${query}='' OR t.id::text=${query} OR t.goal ILIKE ${pattern} ESCAPE '\\' OR COALESCE(t.source_url,'') ILIKE ${pattern} ESCAPE '\\')
      ORDER BY t.created_at DESC, t.id DESC LIMIT 26 OFFSET ${cursor}`
    return { items: workCards(rows.slice(0, 25)), nextCursor: rows.length > 25 ? cursor + 25 : null }
  }

  async function stewardMetadata(taskIds: string[]) {
    if (!taskIds.length) return []
    const rows = await db`SELECT t.id, t.goal, t.source_url AS "sourceUrl", t.status, t.created_at AS "createdAt",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'createdAt', r.created_at, 'finishedAt', r.finished_at) ORDER BY r.created_at, r.id)
        FROM work_runs r WHERE r.task_id=t.id), '[]'::jsonb) AS runs,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('versionId', v.id, 'runId', v.run_id, 'runStatus', r.status, 'createdAt', v.created_at) ORDER BY v.created_at DESC, v.id DESC)
        FROM work_artifacts a JOIN work_artifact_versions v ON v.artifact_id=a.id JOIN work_runs r ON r.id=v.run_id
        WHERE a.task_id=t.id AND a.kind='report'), '[]'::jsonb) AS reports
      FROM work_tasks t WHERE t.owner_id='owner' AND t.id=ANY(string_to_array(${taskIds.join(',')}, ',')::uuid[])
      ORDER BY t.created_at DESC, t.id DESC`
    return workCards(rows)
  }

  async function stewardRead(taskIds: string[], versionIds: string[], artifactDir: string) {
    const tasks = await stewardMetadata(taskIds)
    if (tasks.length !== taskIds.length) throw new WorkArtifactError('not-found')
    const reports = tasks.flatMap((task: any) => task.reports.map((report: any) => ({ ...report, taskId: task.id })))
    const byVersion = new Map(reports.map((report: any) => [report.versionId, report]))
    if (versionIds.some(id => !byVersion.has(id))) throw new WorkArtifactError('not-found')
    const contents = await Promise.all(versionIds.map(async versionId => {
      const report: any = byVersion.get(versionId)
      const { artifact, bytes } = await readArtifact(versionId, artifactDir, 'report')
      let markdown: string
      try { markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new WorkArtifactError('invalid') }
      return { ...report, markdown, name: artifact.name }
    }))
    return tasks.map((task: any) => ({ ...task, reports: task.reports.map((report: any) => ({ ...report,
      ...(contents.find(item => item.versionId === report.versionId) ?? {}),
    })) }))
  }

  async function stewardModelStats(models: { id: string; protocol: Protocol; endpoint: string }[]) {
    if (!models.length) return []
    return db`WITH candidates AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(models)}::text::jsonb) AS item(id text, protocol text, endpoint text)
      )
      SELECT item.id, item.protocol, item.endpoint,
        COUNT(DISTINCT r.id) FILTER (WHERE r.id IS NOT NULL)::integer AS "successCount",
        MAX(r.finished_at) AS "lastSucceededAt"
      FROM candidates item LEFT JOIN work_runs r
        ON (CASE WHEN jsonb_typeof(r.model_snapshot)='string' THEN (r.model_snapshot#>>'{}')::jsonb ELSE r.model_snapshot END)->>'id'=item.id
        AND (CASE WHEN jsonb_typeof(r.model_snapshot)='string' THEN (r.model_snapshot#>>'{}')::jsonb ELSE r.model_snapshot END)->>'protocol'=item.protocol
        AND (CASE WHEN jsonb_typeof(r.model_snapshot)='string' THEN (r.model_snapshot#>>'{}')::jsonb ELSE r.model_snapshot END)->>'endpoint'=item.endpoint AND r.status='succeeded'
        AND EXISTS (SELECT 1 FROM work_artifact_versions v JOIN work_artifacts a ON a.id=v.artifact_id
          WHERE v.run_id=r.id AND a.kind='report')
      GROUP BY item.id, item.protocol, item.endpoint`
  }

  async function createFromSteward(currentTurnId: string, operationId: string, currentTime: () => number) {
    const result = await db.begin(async sql => {
      const [turn] = await sql`SELECT id, thread_id AS "threadId", status, active, active_ms AS "activeMs",
        active_limit_ms AS "activeLimitMs", active_since AS "activeSince", budget_reason AS "budgetReason",
        model_snapshot AS "modelSnapshot", credential_ref AS "credentialRef"
        FROM steward_turns WHERE id=${currentTurnId} FOR UPDATE`
      const [operation] = await sql`SELECT turn_id AS "turnId", request_id AS "requestId", request_hash AS "requestHash",
        goal, source_url AS "sourceUrl", model_snapshot AS "modelSnapshot", credential_ref AS "credentialRef",
        status, task_id AS "taskId", run_id AS "runId"
        FROM steward_research_operations WHERE operation_id=${operationId} FOR UPDATE`
      const [resume] = operation ? await sql`SELECT 1 FROM steward_research_resumes WHERE turn_id=${currentTurnId} AND operation_id=${operationId}` : []
      if (!turn || !operation || operation.turnId !== currentTurnId && !resume) throw new WorkInputError('调研操作回执无效')
      if (operation.status === 'accepted') return { taskId: operation.taskId, runId: operation.runId, created: false, status: 'accepted' as const }
      if (operation.status !== 'planned') return { created: false, status: operation.status as string, failure: '调研操作已结束' }
      if (!turn.active || turn.status !== 'running') {
        await sql`UPDATE steward_research_operations SET status='unexecuted', failure='管家轮次已停止', finished_at=now() WHERE operation_id=${operationId}`
        return { created: false, status: 'unexecuted' as const, failure: '管家轮次已停止' }
      }
      if (turn.budgetReason) {
        const failure = turn.budgetReason === 'creates' ? '本轮已达到 3 项工作创建额度' : '管家轮次额度已用尽'
        await sql`UPDATE steward_research_operations SET status='unexecuted', failure=${failure}, finished_at=now() WHERE operation_id=${operationId}`
        return { created: false, status: 'unexecuted' as const, failure }
      }
      const elapsed = Number(turn.activeMs) + (turn.activeSince ? Math.max(0, currentTime() - new Date(turn.activeSince).getTime()) : 0)
      if (elapsed >= Number(turn.activeLimitMs)) {
        await sql`UPDATE steward_turns SET budget_reason='time' WHERE id=${currentTurnId}`
        await sql`UPDATE steward_research_operations SET status='unexecuted', failure='管家轮次活跃时间已用尽', finished_at=now() WHERE operation_id=${operationId}`
        return { created: false, status: 'unexecuted' as const, failure: '管家轮次活跃时间已用尽' }
      }
      const snapshot = typeof operation.modelSnapshot === 'string' ? JSON.parse(operation.modelSnapshot) : operation.modelSnapshot
      if (resume) {
        const turnSnapshot = typeof turn.modelSnapshot === 'string' ? JSON.parse(turn.modelSnapshot) : turn.modelSnapshot
        const selected = Array.isArray(turnSnapshot.researchModels) ? turnSnapshot.researchModels.find((model: any) => model.id === snapshot.id) : null
        const matches = selected && ['id', 'protocol', 'endpoint', 'contextWindow', 'maxTokens', 'reasoning', 'tools'].every(field => selected[field] === snapshot[field])
          && JSON.stringify(selected.input) === JSON.stringify(snapshot.input) && operation.credentialRef === turn.credentialRef
        if (!matches) {
          const failure = `模型 ${snapshot.id} 已不在当前有效调研模型池`
          await sql`UPDATE steward_research_operations SET status='unexecuted', failure=${failure}, finished_at=now() WHERE operation_id=${operationId}`
          return { created: false, status: 'unexecuted' as const, failure }
        }
      }
      const [usage] = await sql`SELECT COUNT(*)::integer AS count FROM steward_research_operations WHERE accepted_turn_id=${currentTurnId} AND status='accepted'`
      if (Number(usage.count) >= 3) {
        await sql`UPDATE steward_turns SET budget_reason='creates' WHERE id=${currentTurnId}`
        await sql`UPDATE steward_research_operations SET status='unexecuted', failure='本轮已达到 3 项工作创建额度', finished_at=now() WHERE operation_id=${operationId}`
        return { created: false, status: 'unexecuted' as const, failure: '本轮已达到 3 项工作创建额度' }
      }
      const input: CreateRequest = { requestId: operation.requestId, goal: operation.goal, sourceUrl: operation.sourceUrl, modelId: snapshot.id, protocol: snapshot.protocol }
      const taskId = crypto.randomUUID()
      const created = await createWorkInTransaction(sql, input, operation.requestHash, snapshot, operation.credentialRef, taskId)
      if (!created) {
        const [existing] = await sql`SELECT id, request_hash AS "requestHash" FROM work_tasks WHERE request_id=${operation.requestId}`
        if (!existing || existing.requestHash !== operation.requestHash) throw new WorkConflictError('调研请求 ID 已用于其他工作')
        await sql`UPDATE steward_research_operations SET status='accepted', task_id=${existing.id}, accepted_turn_id=${currentTurnId}, finished_at=now()
          WHERE operation_id=${operationId}`
        await sql`INSERT INTO steward_thread_tasks (thread_id, task_id) VALUES (${turn.threadId}, ${existing.id}) ON CONFLICT DO NOTHING`
        if (Number(usage.count) + 1 >= 3) await sql`UPDATE steward_turns SET budget_reason='creates' WHERE id=${currentTurnId}`
        return { taskId: existing.id, created: false, status: 'accepted' as const }
      }
      await sql`UPDATE steward_research_operations SET status='accepted', task_id=${created.taskId}, run_id=${created.runId},
        accepted_turn_id=${currentTurnId}, finished_at=now() WHERE operation_id=${operationId}`
      await sql`INSERT INTO steward_thread_tasks (thread_id, task_id) VALUES (${turn.threadId}, ${created.taskId}) ON CONFLICT DO NOTHING`
      await sql`INSERT INTO steward_events (turn_id, event_id, type, payload) VALUES (${currentTurnId}, ${crypto.randomUUID()}, 'work.accepted',
        ${JSON.stringify({ operationId, taskId: created.taskId, runId: created.runId })}::jsonb)`
      if (Number(usage.count) + 1 >= 3) await sql`UPDATE steward_turns SET budget_reason='creates' WHERE id=${currentTurnId}`
      return { ...created, created: true, status: 'accepted' as const }
    })
    return result.taskId ? { ...result, task: await detail(result.taskId) } : result
  }

  async function requestCleanupRetry(taskId: string) {
    const rows = await db`UPDATE work_runs SET cleanup_state='retry_requested'
      WHERE id = (SELECT r.id FROM work_runs r JOIN work_tasks t ON t.id = r.task_id
        WHERE t.id = ${taskId} AND t.owner_id = 'owner' AND r.cleanup_state IN ('blocked', 'failed')
        ORDER BY r.created_at DESC, r.id DESC LIMIT 1)
      RETURNING id`
    return rows.length > 0
  }

  async function retainCheckpointArtifacts(sql: SQL, taskId: string, run: { id: string; epoch: number; checkpointRef: any }) {
    if (!run.checkpointRef) return
    const checkpoint = typeof run.checkpointRef === 'string' ? JSON.parse(run.checkpointRef) : run.checkpointRef
    if (checkpoint.epoch !== run.epoch || !Array.isArray(checkpoint.files)) throw new WorkConflictError('检查点无效')
    const artifacts = Array.isArray(checkpoint.artifacts) ? checkpoint.artifacts : checkpoint.files
      .filter((file: { name: string }) => /^generation-[0-9a-f-]{36}\/report\.md$/i.test(file.name))
      .map((file: { name: string }) => ({ path: file.name, name: 'report.md', type: 'text/markdown', kind: 'report' }))
    for (const item of artifacts) {
      const file = checkpoint.files.find((entry: { name: string }) => entry.name === item.path)
      if (!file || !Number.isSafeInteger(file.size) || file.size < (item.kind === 'report' ? 1 : 0) || file.size > (item.kind === 'report' ? 2_000_000 : 10_000_000)
        || !/^[0-9a-f]{64}$/i.test(file.sha256)
        || !/^generation-[0-9a-f-]{36}\/report\.md$/i.test(item.path) && !/^generation-[0-9a-f-]{36}\/attachment-[0-4]\.(txt|csv|json|md)$/i.test(item.path)
        || item.kind !== (item.path.endsWith('/report.md') ? 'report' : 'attachment')
        || item.type !== (item.kind === 'report' ? 'text/markdown' : 'text/plain')
        || typeof item.name !== 'string' || !/^[^/\\\x00-\x1f]{1,100}\.(txt|csv|json|md)$/i.test(item.name)) throw new WorkConflictError('检查点成果无效')
      const [artifact] = await sql`INSERT INTO work_artifacts (id, task_id, kind, name)
        VALUES (${crypto.randomUUID()}, ${taskId}, ${item.kind}, ${item.name})
        ON CONFLICT (task_id, kind, name) DO UPDATE SET name=EXCLUDED.name RETURNING id`
      await sql`INSERT INTO work_artifact_versions (id, artifact_id, run_id, storage_key, sha256, size_bytes, mime_type)
        VALUES (${crypto.randomUUID()}, ${artifact.id}, ${run.id}, ${`${run.id}/checkpoint-${run.epoch}/${item.path}`}, ${file.sha256}, ${file.size}, ${item.type})
        ON CONFLICT (artifact_id, run_id) DO NOTHING`
    }
  }

  async function cancel(taskId: string) {
    return db.begin(async sql => {
      const [run] = await sql`SELECT r.id, r.epoch, r.status, r.active, r.checkpoint_ref AS "checkpointRef" FROM work_runs r
        JOIN work_tasks t ON t.id = r.task_id WHERE t.id = ${taskId} AND t.owner_id = 'owner'
        ORDER BY r.created_at DESC, r.id DESC LIMIT 1 FOR UPDATE OF r`
      if (!run) return null
      if (run.status === 'cancelling' || run.status === 'cancelled') return { accepted: false }
      if (!['queued', 'provisioning', 'running', 'waiting'].includes(run.status)) return { accepted: false }
      if (run.active) {
        const [terminal] = await sql`SELECT 1 FROM work_events WHERE run_id = ${run.id} AND epoch = ${run.epoch}
          AND type IN ('run.finished', 'run.failed') LIMIT 1`
        if (terminal) return { accepted: false }
      }
      if (run.status === 'waiting') await retainCheckpointArtifacts(sql, taskId, run)
      const status = run.active ? 'cancelling' : 'cancelled'
      await sql`UPDATE work_runs SET status = ${status}, run_token_hash = NULL,
        finished_at = CASE WHEN ${status} = 'cancelled' THEN now() ELSE finished_at END
        WHERE id = ${run.id}`
      await sql`UPDATE work_tasks SET status = ${status} WHERE id = ${taskId}`
      if (run.status === 'waiting') await sql`UPDATE work_interactions SET status='cancelled' WHERE run_id=${run.id} AND status='pending'`
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
    const inserted = await db.begin(sql => createWorkInTransaction(sql, input, requestHash, snapshot, connection.credentialRef!, taskId))
    if (inserted) return { task: await detail(taskId), created: true }
    const [winner] = await db`SELECT id, request_hash FROM work_tasks WHERE request_id = ${input.requestId} AND owner_id = 'owner'`
    if (!winner || winner.request_hash !== requestHash) throw new WorkConflictError('请求 ID 已用于其他工作')
    return { task: await detail(winner.id), created: false }
  }

  async function continueTask(taskId: string, body: unknown, connection: RunConnection) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new WorkInputError('修改要求无效')
    const input = body as Record<string, unknown>
    if (typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw new WorkInputError('请求 ID 无效')
    const content = typeof input.content === 'string' ? input.content.trim() : ''
    if (!content || content.length > 4000) throw new WorkInputError('修改要求须为 1–4000 字')
    if (typeof input.modelId !== 'string' || !input.modelId.trim()) throw new WorkInputError('请选择模型')
    if (input.protocol !== undefined && input.protocol !== null && input.protocol !== 'chat-completions' && input.protocol !== 'responses') throw new WorkInputError('协议无效')
    const requestHash = createHash('sha256').update(JSON.stringify({ taskId, content, modelId: input.modelId, protocol: input.protocol ?? null })).digest('hex')
    const created = await db.begin(async sql => {
      await sql`SELECT pg_advisory_xact_lock(720, hashtext(${taskId}))`
      const [task] = await sql`SELECT t.id, h.id AS "threadId" FROM work_tasks t JOIN work_threads h ON h.task_id=t.id
        WHERE t.id=${taskId} AND t.owner_id='owner'`
      if (!task) return null
      const [existing] = await sql`SELECT id, task_id AS "taskId", request_hash AS "requestHash" FROM work_runs WHERE request_id=${input.requestId}`
      if (existing) {
        if (existing.taskId !== taskId || existing.requestHash !== requestHash) throw new WorkConflictError('请求 ID 已用于其他修改')
        return false
      }
      const [previous] = await sql`SELECT id, status, active, cleanup_state AS "cleanupState" FROM work_runs
        WHERE task_id=${taskId} ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`
      if (!previous || previous.active || previous.cleanupState !== 'cleaned' || !['succeeded', 'failed', 'lost', 'cancelled'].includes(previous.status)) throw new WorkConflictError('当前工作尚未完成')
      const [report] = await sql`SELECT v.id FROM work_artifact_versions v JOIN work_artifacts a ON a.id=v.artifact_id
        JOIN work_runs source ON source.id=v.run_id
        WHERE a.task_id=${taskId} AND a.kind='report' AND source.status='succeeded'
        ORDER BY v.created_at DESC, v.id DESC LIMIT 1`
      if (!report) throw new WorkConflictError('当前工作尚无可修改报告')
      const model = connection.models.find(item => item.id === input.modelId)
      if (!connection.endpoint || !connection.hasCredential || !connection.credentialRef || !model) throw new WorkInputError('请先选择可用模型并配置连接')
      if (!model.contextWindow || !model.maxTokens || !model.input?.includes('text') || typeof model.reasoning !== 'boolean') throw new WorkInputError('请补充模型的上下文、输出上限、文本输入和推理配置')
      const snapshot = { ...model, protocol: input.protocol ?? model.protocol, endpoint: connection.endpoint }
      const messages = await sql`SELECT content FROM work_messages WHERE thread_id=${task.threadId} ORDER BY created_at, id`
      const runId = crypto.randomUUID()
      const inserted = await sql`INSERT INTO work_runs (id, task_id, status, model_snapshot, credential_ref, request_id, request_hash,
        previous_report_version_id, context_snapshot) VALUES (${runId}, ${taskId}, 'queued', ${JSON.stringify(snapshot)}::jsonb,
        ${connection.credentialRef}, ${input.requestId}, ${requestHash}, ${report.id}, ${JSON.stringify({ messages: messages.map((row: { content: string }) => row.content), instruction: content })}::jsonb)
        ON CONFLICT (request_id) DO NOTHING RETURNING id`
      if (!inserted.length) {
        const [winner] = await sql`SELECT task_id AS "taskId", request_hash AS "requestHash" FROM work_runs WHERE request_id=${input.requestId}`
        if (!winner || winner.taskId !== taskId || winner.requestHash !== requestHash) throw new WorkConflictError('请求 ID 已用于其他修改')
        return false
      }
      await sql`INSERT INTO work_outbox (run_id) VALUES (${runId})`
      await sql`UPDATE work_messages SET status='carried' WHERE thread_id=${task.threadId} AND status='pending'`
      await sql`INSERT INTO work_messages (id, thread_id, run_id, role, content, status)
        VALUES (${crypto.randomUUID()}, ${task.threadId}, ${runId}, 'user', ${content}, 'applied')`
      await sql`UPDATE work_tasks SET status='queued' WHERE id=${taskId}`
      return true
    })
    return created === null ? null : { task: await detail(taskId), created }
  }

  async function retryTask(taskId: string, body: unknown) {
    const requestId = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).requestId : null
    if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new WorkInputError('请求 ID 无效')
    const hash = createHash('sha256').update(JSON.stringify({ taskId, kind: 'retry' })).digest('hex')
    const created = await db.begin(async sql => {
      await sql`SELECT pg_advisory_xact_lock(720, hashtext(${taskId}))`
      const [task] = await sql`SELECT id FROM work_tasks WHERE id=${taskId} AND owner_id='owner'`
      if (!task) return null
      const [existing] = await sql`SELECT task_id AS "taskId", request_hash AS "requestHash" FROM work_runs WHERE request_id=${requestId}`
      if (existing) {
        if (existing.taskId !== taskId || existing.requestHash !== hash) throw new WorkConflictError('请求 ID 已用于其他执行')
        return false
      }
      const [previous] = await sql`SELECT id, status, active, cleanup_state AS "cleanupState", model_snapshot AS "modelSnapshot",
        credential_ref AS "credentialRef", previous_report_version_id AS "previousReportVersionId", context_snapshot AS "contextSnapshot", checkpoint_ref AS "checkpointRef"
        FROM work_runs WHERE task_id=${taskId} ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`
      if (!previous || previous.active || previous.cleanupState !== 'cleaned' || !['failed', 'lost'].includes(previous.status)) throw new WorkConflictError('当前工作不可重试')
      const runId = crypto.randomUUID()
      const snapshot = typeof previous.modelSnapshot === 'string' ? JSON.parse(previous.modelSnapshot) : previous.modelSnapshot
      const context = typeof previous.contextSnapshot === 'string' ? JSON.parse(previous.contextSnapshot) : previous.contextSnapshot
      const priorCheckpoint = typeof previous.checkpointRef === 'string' ? JSON.parse(previous.checkpointRef) : previous.checkpointRef
      const checkpoint = priorCheckpoint ? { ...priorCheckpoint, sourceRunId: priorCheckpoint.sourceRunId ?? previous.id } : null
      await sql`INSERT INTO work_runs (id, task_id, status, model_snapshot, credential_ref, request_id, request_hash,
        previous_report_version_id, context_snapshot, checkpoint_ref, retry_of_run_id)
        VALUES (${runId}, ${taskId}, 'queued', ${JSON.stringify(snapshot)}::text::jsonb, ${previous.credentialRef},
          ${requestId}, ${hash}, ${previous.previousReportVersionId}, ${context ? JSON.stringify(context) : null}::text::jsonb,
          ${checkpoint ? JSON.stringify(checkpoint) : null}::text::jsonb, ${previous.id})`
      await sql`UPDATE work_messages SET run_id=${runId}
        WHERE run_id=${previous.id} AND status='pending'`
      await sql`INSERT INTO work_outbox (run_id) VALUES (${runId})`
      await sql`UPDATE work_tasks SET status='queued' WHERE id=${taskId}`
      return true
    })
    return created === null ? null : { task: await detail(taskId), created }
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

  async function resolveInteraction(id: string, body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new WorkInputError('回答无效')
    const answer = typeof (body as Record<string, unknown>).answer === 'string' ? (body as Record<string, string>).answer.trim() : ''
    if (!answer || answer.length > 4000) throw new WorkInputError('回答须为 1–4000 字')
    return db.begin(async sql => {
      const [target] = await sql`SELECT i.run_id AS "runId" FROM work_interactions i
        JOIN work_runs r ON r.id=i.run_id JOIN work_tasks t ON t.id=r.task_id
        WHERE i.id=${id} AND t.owner_id='owner'`
      if (!target) return null
      const [run] = await sql`SELECT id, epoch, task_id AS "taskId", status, active, cleanup_state AS "cleanupState", checkpoint_ref AS "checkpointRef",
        model_call_limit AS "modelCallLimit", active_limit_ms AS "activeLimitMs", budget_reason AS "budgetReason"
        FROM work_runs WHERE id=${target.runId} FOR UPDATE`
      const [interaction] = await sql`SELECT status, answer, kind FROM work_interactions WHERE id=${id} AND run_id=${target.runId} FOR UPDATE`
      if (!interaction || !run) return null
      if (interaction.status === 'answered') {
        if (interaction.answer !== answer) throw new WorkConflictError('问题已用不同内容回答')
        return { created: false }
      }
      if (interaction.kind === 'limit' && !['continue', 'finish'].includes(answer)) throw new WorkInputError('请选择继续或结束')
      if (interaction.status !== 'pending' || run.status !== 'waiting' || run.active || run.cleanupState !== 'cleaned' || !run.checkpointRef) throw new WorkConflictError('问题尚未准备好回答')
      await sql`UPDATE work_interactions SET status='answered', answer=${answer}, answered_at=now() WHERE id=${id}`
      if (interaction.kind === 'limit') {
        const continued = answer === 'continue'
        const nextCalls = continued ? run.modelCallLimit + 40 : run.modelCallLimit
        const nextMs = continued ? Number(run.activeLimitMs) + 2_700_000 : Number(run.activeLimitMs)
        await sql`INSERT INTO work_events (run_id, epoch, event_id, type, payload, occurred_at)
          SELECT id, epoch, ${crypto.randomUUID()}, 'run.limit_decided',
            ${JSON.stringify({ decision: answer, reason: run.budgetReason, previousModelCallLimit: run.modelCallLimit,
              modelCallLimit: nextCalls, previousActiveLimitMs: Number(run.activeLimitMs), activeLimitMs: nextMs })}::jsonb, now()
          FROM work_runs WHERE id=${target.runId}`
        if (!continued) {
          await retainCheckpointArtifacts(sql, run.taskId, run)
          await sql`UPDATE work_runs SET status='cancelled', finished_at=now() WHERE id=${target.runId}`
          await sql`UPDATE work_tasks SET status='cancelled' WHERE id=${run.taskId}`
          return { created: true }
        }
        await sql`UPDATE work_runs SET model_call_limit=${nextCalls}, active_limit_ms=${nextMs}, budget_reason=NULL WHERE id=${target.runId}`
      }
      await sql`UPDATE work_runs SET status='queued', cleanup_state='none' WHERE id=${target.runId}`
      await sql`UPDATE work_tasks SET status='queued' WHERE id=${run.taskId}`
      await sql`INSERT INTO work_outbox (run_id) VALUES (${target.runId}) ON CONFLICT DO NOTHING`
      return { created: true }
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

  async function reserveModelAttempt(runId: string, epoch: number, token: string, now = Date.now()) {
    const hash = createHash('sha256').update(token).digest('hex')
    return db.begin(async sql => {
      const [run] = await sql`SELECT status, active, run_token_hash AS "tokenHash", model_calls AS "modelCalls",
        model_call_limit AS "modelCallLimit", active_ms AS "activeMs", active_limit_ms AS "activeLimitMs",
        active_since AS "activeSince", budget_reason AS "budgetReason"
        FROM work_runs WHERE id=${runId} AND epoch=${epoch} FOR UPDATE`
      if (!run || !run.active || !['provisioning', 'running'].includes(run.status) || run.tokenHash !== hash) return 'stopped'
      const elapsed = Number(run.activeMs) + (run.activeSince ? Math.max(0, now - new Date(run.activeSince).getTime()) : 0)
      const reason = run.budgetReason || (elapsed >= Number(run.activeLimitMs) ? 'time' : run.modelCalls >= run.modelCallLimit ? 'rounds' : null)
      if (reason) {
        if (!run.budgetReason) await sql`UPDATE work_runs SET budget_reason=${reason} WHERE id=${runId}`
        return 'limit'
      }
      await sql`UPDATE work_runs SET model_calls=model_calls+1 WHERE id=${runId}`
      return 'allowed'
    })
  }

  async function recordModelUsage(runId: string, epoch: number, usage: { callId: string; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }) {
    await db`INSERT INTO work_events (run_id, epoch, event_id, type, payload, occurred_at)
      SELECT ${runId}, ${epoch}, ${crypto.randomUUID()}, 'usage',
        jsonb_build_object('callId', ${usage.callId}::text, 'inputTokens', ${usage.inputTokens}::bigint, 'outputTokens', ${usage.outputTokens}::bigint, 'totalTokens', ${usage.totalTokens}::bigint), now()
      WHERE EXISTS (SELECT 1 FROM work_runs WHERE id = ${runId} AND epoch = ${epoch} AND active)`
  }

  async function close() { await db.close() }

  return { list, detail, events, create, continueTask, retryTask, appendRunMessage, resolveInteraction, pendingRunMessages, acknowledgeRunMessage, cancel, isRunStopped, artifactVersion, readArtifact, stewardCatalog, stewardMetadata, stewardRead, stewardModelStats, createFromSteward, requestCleanupRetry, resolveRunModelConnection, authorizeModelProxy, reserveModelAttempt, recordModelUsage, close }
}
