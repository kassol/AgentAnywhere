import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SQL } from 'bun'
import type { ModelSelection, Protocol } from './model-connection'
import { lockStewardTurnBudget, stewardBudgetFailure, stewardOperationBudget } from './steward-budget'
import { parseTitle, titleSummary } from './title'

type RunConnection = { endpoint: string; hasCredential: boolean; credentialRef: string | null; models: ModelSelection[] }
type CreateRequest = { requestId: string; goal: string; sourceUrl: string | null; repoUrl: string | null; modelId: string; protocol: Protocol | null; agentType?: string }
type FrozenResearchModel = ModelSelection & { endpoint: string }
type ContinueRequest = { requestId: string; content: string; modelId: string; protocol: Protocol | null }
type AppendRunMessageInput = { commandId: string; kind: 'steer'; content: string }

export type AgentVersionRow = { profile_id: string; system_prompt: string; tool_set: string; config: Record<string, unknown> }

const RESEARCH_SYSTEM_PROMPT = `可以用 search_web 查询主题；目标含指定来源时，先用 open_public_page 读取该 URL。需要核对搜索结果正文时，也用 open_public_page。搜索摘要与网页正文是不同来源；报告引用实际 URL，注明搜索引擎部分失败、不可读页面和未核查推断。需要用户决定时调用 ask_user 提问，等待回答。完成后调用 submit_report 保存 Markdown 报告，最后简短回复已提交。测试要求使用 echo_observation 时可以调用。`

const CODING_SYSTEM_PROMPT = `You are working in a cloned Git repository. Use the available tools to understand, modify, and test code.

## Tools
- shell: Run shell commands (bash). Use for building, testing, installing dependencies, inspecting the repo.
- read_file: Read file contents. Use to understand existing code before modifying.
- write_file: Write or overwrite file contents. Use to implement changes.
- git_diff: Show uncommitted changes (optionally staged only). Use to verify your work before submitting.
- search_web: Search public pages for documentation or references.
- open_public_page: Read the HTTP text of a public URL.
- ask_user: Ask the user a question when their decision is needed.

## Workflow
1. Read the relevant source files to understand the codebase structure.
2. Make changes using write_file.
3. Run tests to verify correctness. If tests fail, read the output, fix the code, and re-run.
4. When tests pass, submit results:
   a. submit_artifact(kind='test_log'): Submit test results as JSON with fields: command, stdout, stderr, exitCode.
   b. submit_artifact(kind='patch'): Submit the output of git diff showing all changes.
   c. submit_artifact(kind='report'): Submit a Markdown summary of what was done and why.
5. If tests cannot be fixed, submit a report explaining the failure.

## Rules
- Always run tests before submitting a patch.
- Do not commit changes; only produce a diff.
- Keep changes minimal and focused on the task.`

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
  const repoUrl = typeof value.repoUrl === 'string' && value.repoUrl.trim() ? value.repoUrl.trim() : null
  if (repoUrl) {
    if (repoUrl.length > 2048) throw new WorkInputError('仓库链接过长')
    let parsed: URL
    try { parsed = new URL(repoUrl) } catch { throw new WorkInputError('仓库链接无效') }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) throw new WorkInputError('仓库链接须为 HTTPS 地址')
  }
  if (!goal && !sourceUrl) throw new WorkInputError('请填写目标或公开链接')
  if (typeof value.modelId !== 'string' || !value.modelId.trim()) throw new WorkInputError('请选择模型')
  if (value.protocol !== undefined && value.protocol !== null && value.protocol !== 'chat-completions' && value.protocol !== 'responses') throw new WorkInputError('协议无效')
  const agentType = typeof value.agentType === 'string' && ['research', 'coding'].includes(value.agentType) ? value.agentType : undefined
  return { requestId: value.requestId, goal, sourceUrl, repoUrl, modelId: value.modelId, protocol: value.protocol as Protocol | null ?? null, agentType }
}

function parseContinueRequest(body: unknown): ContinueRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new WorkInputError('修改要求无效')
  const input = body as Record<string, unknown>
  if (typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw new WorkInputError('请求 ID 无效')
  const content = typeof input.content === 'string' ? input.content.trim() : ''
  if (!content || content.length > 4000) throw new WorkInputError('修改要求须为 1–4000 字')
  if (typeof input.modelId !== 'string' || !input.modelId.trim()) throw new WorkInputError('请选择模型')
  if (input.protocol !== undefined && input.protocol !== null && input.protocol !== 'chat-completions' && input.protocol !== 'responses') throw new WorkInputError('协议无效')
  return { requestId: input.requestId, content, modelId: input.modelId, protocol: input.protocol as Protocol | null ?? null }
}

export async function createWorkStore(databaseUrl: string, artifactDir = join(process.cwd(), 'data', 'artifacts'), onCreated?: (id: string, source: string) => Promise<void>) {
  const db = new SQL(databaseUrl)
  await db`CREATE TABLE IF NOT EXISTS work_tasks (
    id uuid PRIMARY KEY, owner_id text NOT NULL, request_id uuid NOT NULL UNIQUE,
    request_hash text NOT NULL, goal text NOT NULL, source_url text,
    status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
  )`
  await db`ALTER TABLE work_tasks ADD COLUMN IF NOT EXISTS title text`
  await db`ALTER TABLE work_tasks ADD COLUMN IF NOT EXISTS title_edited boolean NOT NULL DEFAULT false`
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
  await db`CREATE TABLE IF NOT EXISTS agent_definitions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    description text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`
  await db`CREATE TABLE IF NOT EXISTS agent_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    definition_id uuid NOT NULL REFERENCES agent_definitions(id),
    version integer NOT NULL,
    profile_id text NOT NULL,
    system_prompt text NOT NULL,
    tool_set text NOT NULL,
    config jsonb NOT NULL DEFAULT '{}',
    content_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (definition_id, version)
  )`
  await db`ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS agent_version_id uuid REFERENCES agent_versions(id)`
  await db`ALTER TABLE work_tasks ADD COLUMN IF NOT EXISTS repo_url text`

  // Idempotent upsert of builtin agent definitions
  const builtins = [
    { name: 'research', description: 'Research agent for investigating topics and producing reports', profileId: 'worker-basic', toolSet: 'research', systemPrompt: RESEARCH_SYSTEM_PROMPT },
    { name: 'coding', description: 'Coding agent for modifying code, running tests, and producing patches', profileId: 'worker-coding', toolSet: 'coding', systemPrompt: CODING_SYSTEM_PROMPT },
  ] as const
  for (const builtin of builtins) {
    const contentHash = createHash('sha256').update(builtin.systemPrompt).digest('hex')
    const [def] = await db`INSERT INTO agent_definitions (id, name, description) VALUES (${crypto.randomUUID()}, ${builtin.name}, ${builtin.description})
      ON CONFLICT (name) DO NOTHING RETURNING id`
    const definitionId = def?.id ?? (await db`SELECT id FROM agent_definitions WHERE name=${builtin.name}`)[0]?.id
    if (definitionId) {
      await db`INSERT INTO agent_versions (id, definition_id, version, profile_id, system_prompt, tool_set, config, content_hash)
        VALUES (${crypto.randomUUID()}, ${definitionId}, 1, ${builtin.profileId}, ${builtin.systemPrompt}, ${builtin.toolSet}, '{}'::jsonb, ${contentHash})
        ON CONFLICT (definition_id, version) DO NOTHING`
    }
  }

  async function resolveAgentVersionId(sql: SQL, agentType: string) {
    const name = agentType === 'coding' ? 'coding' : 'research'
    const [row] = await sql`SELECT av.id FROM agent_versions av JOIN agent_definitions ad ON ad.id=av.definition_id
      WHERE ad.name=${name} ORDER BY av.version DESC LIMIT 1`
    return row?.id ?? null
  }

  async function createWorkInTransaction(sql: SQL, input: CreateRequest, requestHash: string, snapshot: FrozenResearchModel, credentialRef: string, taskId: string) {
    const rows = await sql`INSERT INTO work_tasks (id, owner_id, request_id, request_hash, goal, source_url, repo_url, status)
      VALUES (${taskId}, 'owner', ${input.requestId}, ${requestHash}, ${input.goal}, ${input.sourceUrl}, ${input.repoUrl}, 'queued')
      ON CONFLICT (request_id) DO NOTHING RETURNING id`
    if (!rows.length) return null
    const threadId = crypto.randomUUID()
    await sql`INSERT INTO work_threads (id, task_id) VALUES (${threadId}, ${taskId})`
    const runId = crypto.randomUUID()
    const agentVersionId = await resolveAgentVersionId(sql, input.agentType ?? 'research')
    await sql`INSERT INTO work_runs (id, task_id, status, model_snapshot, credential_ref, agent_version_id)
      VALUES (${runId}, ${taskId}, 'queued', ${JSON.stringify(snapshot)}::text::jsonb, ${credentialRef}, ${agentVersionId})`
    await sql`INSERT INTO work_outbox (run_id) VALUES (${runId})`
    await sql`INSERT INTO work_messages (id, thread_id, role, content)
      VALUES (${crypto.randomUUID()}, ${threadId}, 'user', ${input.goal || input.sourceUrl!})`
    return { taskId, runId }
  }

  async function detail(id: string) {
    const [row] = await db`SELECT t.id, t.title, t.title_edited AS "titleEdited", t.goal, t.source_url AS "sourceUrl", t.status, t.created_at AS "createdAt",
      (SELECT jsonb_build_object('status', g.status, 'attempts', g.attempts, 'maxAttempts', g.max_attempts,
        'timeoutMs', g.timeout_ms, 'maxOutputTokens', g.max_output_tokens, 'modelId', g.model_snapshot->>'id',
        'protocol', g.model_snapshot->>'protocol', 'inputTokens', g.input_tokens, 'outputTokens', g.output_tokens,
        'totalTokens', g.total_tokens, 'estimatedCostUsd', g.estimated_cost_usd, 'failure', g.failure,
        'createdAt', g.created_at, 'finishedAt', g.finished_at)
        FROM title_generations g WHERE g.object_kind='task' AND g.object_id=t.id) AS "titleGeneration",
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
    return { id: row.id, title: row.title ?? titleSummary(row.goal, row.sourceUrl), titleEdited: row.titleEdited,
      goal: row.goal, sourceUrl: row.sourceUrl, status: row.status, createdAt: row.createdAt,
      run: { id: row.runId, status: row.runStatus, model: typeof row.model === 'string' ? JSON.parse(row.model) : row.model,
        epoch: row.epoch, cleanupState: row.cleanupState, failure: row.failure, startedAt: row.startedAt, finishedAt: row.finishedAt,
        previousReportVersionId: row.previousReportVersionId, retryOfRunId: row.retryOfRunId,
        modelCalls: row.modelCalls, modelCallLimit: row.modelCallLimit, activeMs: Number(row.activeMs), activeLimitMs: Number(row.activeLimitMs), budgetReason: row.budgetReason },
      runs, interaction: interaction ?? null, thread: { id: row.threadId, messages }, artifacts,
      titleGeneration: typeof row.titleGeneration === 'string' ? JSON.parse(row.titleGeneration) : row.titleGeneration ?? null }
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
      id: row.id, title: row.title ?? titleSummary(row.goal, row.sourceUrl), titleEdited: row.titleEdited,
      goal: row.goal, sourceUrl: row.sourceUrl, status: row.status, createdAt: row.createdAt, href: `/tasks/${row.id}`,
      runs: typeof row.runs === 'string' ? JSON.parse(row.runs) : row.runs,
      interaction: typeof row.interaction === 'string' ? JSON.parse(row.interaction) : row.interaction,
      reports: reportLinks(row.id, row.reports),
    }))
  }

  function reportLinks(taskId: string, value: any) {
    return (typeof value === 'string' ? JSON.parse(value) : value).map((report: any) => ({ ...report,
      href: `/tasks/${taskId}?version=${report.versionId}`, contentHref: `/api/artifacts/${report.versionId}/content`, downloadHref: `/api/artifacts/${report.versionId}/download`,
    }))
  }

  async function stewardCatalog(cursor = 0, query = '') {
    const pattern = `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
    const rows = await db`SELECT t.id, t.title, t.title_edited AS "titleEdited", t.goal, t.source_url AS "sourceUrl", t.status, t.created_at AS "createdAt",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'createdAt', r.created_at, 'finishedAt', r.finished_at) ORDER BY r.created_at, r.id)
        FROM work_runs r WHERE r.task_id=t.id), '[]'::jsonb) AS runs,
      (SELECT jsonb_build_object('id', i.id, 'kind', i.kind, 'question', i.question, 'status', i.status,
          'runId', i.run_id, 'epoch', i.epoch)
        FROM work_runs current_run JOIN work_interactions i ON i.run_id=current_run.id
        WHERE current_run.task_id=t.id AND current_run.id=(SELECT latest.id FROM work_runs latest WHERE latest.task_id=t.id
          ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1) ORDER BY i.epoch DESC LIMIT 1) AS interaction,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('versionId', v.id, 'runId', v.run_id, 'runStatus', r.status, 'createdAt', v.created_at) ORDER BY v.created_at DESC, v.id DESC)
        FROM work_artifacts a JOIN work_artifact_versions v ON v.artifact_id=a.id JOIN work_runs r ON r.id=v.run_id
        WHERE a.task_id=t.id AND a.kind='report'), '[]'::jsonb) AS reports
      FROM work_tasks t WHERE t.owner_id='owner' AND (${query}='' OR t.id::text=${query} OR t.goal ILIKE ${pattern} ESCAPE '\\' OR COALESCE(t.source_url,'') ILIKE ${pattern} ESCAPE '\\')
      ORDER BY t.created_at DESC, t.id DESC LIMIT 26 OFFSET ${cursor}`
    return { items: workCards(rows.slice(0, 25)), nextCursor: rows.length > 25 ? cursor + 25 : null }
  }

  async function stewardMetadata(taskIds: string[]) {
    if (!taskIds.length) return []
    const rows = await db`SELECT t.id, t.title, t.title_edited AS "titleEdited", t.goal, t.source_url AS "sourceUrl", t.status, t.created_at AS "createdAt",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'createdAt', r.created_at, 'finishedAt', r.finished_at) ORDER BY r.created_at, r.id)
        FROM work_runs r WHERE r.task_id=t.id), '[]'::jsonb) AS runs,
      (SELECT jsonb_build_object('id', i.id, 'kind', i.kind, 'question', i.question, 'status', i.status,
          'runId', i.run_id, 'epoch', i.epoch)
        FROM work_runs current_run JOIN work_interactions i ON i.run_id=current_run.id
        WHERE current_run.task_id=t.id AND current_run.id=(SELECT latest.id FROM work_runs latest WHERE latest.task_id=t.id
          ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1) ORDER BY i.epoch DESC LIMIT 1) AS interaction,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('versionId', v.id, 'runId', v.run_id, 'runStatus', r.status, 'createdAt', v.created_at) ORDER BY v.created_at DESC, v.id DESC)
        FROM work_artifacts a JOIN work_artifact_versions v ON v.artifact_id=a.id JOIN work_runs r ON r.id=v.run_id
        WHERE a.task_id=t.id AND a.kind='report'), '[]'::jsonb) AS reports
      FROM work_tasks t WHERE t.owner_id='owner' AND t.id=ANY(string_to_array(${taskIds.join(',')}, ',')::uuid[])
      ORDER BY t.created_at DESC, t.id DESC`
    return workCards(rows)
  }

  async function stewardStatusCards(taskIds: string[]) {
    const ids = [...new Set(taskIds)]
    if (!ids.length) return []
    const selected = ids.join(',')
    const [runs, interactions] = await Promise.all([
      db`SELECT r.id AS "runId", r.status AS "runStatus", r.failure, r.model_snapshot AS model, r.created_at AS "createdAt", r.finished_at AS "finishedAt",
          t.id AS "taskId", t.title, t.title_edited AS "titleEdited", t.goal,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('versionId', v.id, 'runId', v.run_id, 'runStatus', r.status, 'createdAt', v.created_at) ORDER BY v.created_at DESC, v.id DESC)
            FROM work_artifacts a JOIN work_artifact_versions v ON v.artifact_id=a.id
            WHERE a.task_id=t.id AND a.kind='report' AND v.run_id=r.id), '[]'::jsonb) AS reports
        FROM work_runs r JOIN work_tasks t ON t.id=r.task_id
        WHERE t.owner_id='owner' AND t.id=ANY(string_to_array(${selected}, ',')::uuid[])
          AND r.status IN ('succeeded','failed','lost','save_failed')
        ORDER BY r.created_at, r.id`,
      db`SELECT i.id AS "interactionId", i.kind AS "interactionKind", i.question, i.status AS "interactionStatus", i.answer,
          i.created_at AS "createdAt", i.answered_at AS "answeredAt", r.id AS "runId", r.status AS "runStatus",
          r.model_snapshot AS model, t.id AS "taskId", t.title, t.title_edited AS "titleEdited", t.goal,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('versionId', v.id, 'runId', v.run_id, 'runStatus', r.status, 'createdAt', v.created_at) ORDER BY v.created_at DESC, v.id DESC)
            FROM work_artifacts a JOIN work_artifact_versions v ON v.artifact_id=a.id
            WHERE a.task_id=t.id AND a.kind='report' AND v.run_id=r.id), '[]'::jsonb) AS reports
        FROM work_interactions i JOIN work_runs r ON r.id=i.run_id JOIN work_tasks t ON t.id=r.task_id
        WHERE t.owner_id='owner' AND t.id=ANY(string_to_array(${selected}, ',')::uuid[])
        ORDER BY i.created_at, i.id`,
    ])
    return [
      ...runs.map((row: any) => ({
        id: `run:${row.runId}`, kind: row.runStatus === 'succeeded' ? 'completed' : 'failed', taskId: row.taskId,
        runId: row.runId, title: row.title ?? titleSummary(row.goal), titleEdited: row.titleEdited,
        goal: row.goal, runStatus: row.runStatus, failure: row.failure,
        model: typeof row.model === 'string' ? JSON.parse(row.model) : row.model, createdAt: row.createdAt,
        finishedAt: row.finishedAt, href: `/tasks/${row.taskId}`, reports: reportLinks(row.taskId, row.reports),
      })),
      ...interactions.map((row: any) => ({
        id: `interaction:${row.interactionId}`, kind: 'interaction', taskId: row.taskId, runId: row.runId,
        title: row.title ?? titleSummary(row.goal), titleEdited: row.titleEdited, goal: row.goal,
        runStatus: row.runStatus, model: typeof row.model === 'string' ? JSON.parse(row.model) : row.model,
        createdAt: row.createdAt, href: `/tasks/${row.taskId}`, reports: reportLinks(row.taskId, row.reports),
        interaction: { id: row.interactionId, kind: row.interactionKind, question: row.question,
          status: row.interactionStatus, answer: row.answer, answeredAt: row.answeredAt },
      })),
    ].sort((left, right) => new Date('finishedAt' in left && left.finishedAt || left.createdAt).getTime()
      - new Date('finishedAt' in right && right.finishedAt || right.createdAt).getTime() || left.id.localeCompare(right.id))
  }

  async function pendingInteractions() {
    const rows = await db`SELECT i.id, i.kind, i.question, i.created_at AS "createdAt", r.id AS "runId", r.status AS "runStatus",
      t.id AS "taskId", t.title, t.source_url AS "sourceUrl",
      t.title_edited AS "titleEdited", t.goal, t.status AS "taskStatus", ('/tasks/' || t.id::text) AS href
      FROM work_interactions i JOIN work_runs r ON r.id=i.run_id JOIN work_tasks t ON t.id=r.task_id
      WHERE t.owner_id='owner' AND i.status='pending' ORDER BY i.created_at, i.id`
    return rows.map((row: any) => ({ ...row, title: row.title ?? titleSummary(row.goal, row.sourceUrl) }))
  }

  async function stewardRead(taskIds: string[], versionIds: string[], artifactDir: string) {
    const tasks = await stewardMetadata(taskIds)
    if (tasks.length !== taskIds.length) throw new WorkArtifactError('not-found')
    const runContexts = await stewardLatestRunContexts(taskIds)
    const contextByTask = new Map(runContexts.map((context: any) => [context.taskId, context]))
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
    return tasks.map((task: any) => ({ ...task, latestRun: contextByTask.get(task.id) ?? null, reports: task.reports.map((report: any) => ({ ...report,
      ...(contents.find(item => item.versionId === report.versionId) ?? {}),
    })) }))
  }

  function publicRunContext(row: any) {
    const model = typeof row.model === 'string' ? JSON.parse(row.model) : row.model
    return {
      taskId: row.taskId, runId: row.runId, status: row.status, failure: row.failure,
      model: model ? { id: model.id, protocol: model.protocol, contextWindow: model.contextWindow,
        maxTokens: model.maxTokens, input: model.input, reasoning: model.reasoning, tools: model.tools } : null,
      checkpointAvailable: row.checkpointAvailable, pendingRequirements: Number(row.pendingRequirements),
    }
  }

  async function stewardLatestRunContexts(taskIds: string[]) {
    if (!taskIds.length) return []
    const rows = await db`SELECT DISTINCT ON (r.task_id) r.task_id AS "taskId", r.id AS "runId", r.status, r.failure,
      r.model_snapshot AS model, (r.checkpoint_ref IS NOT NULL) AS "checkpointAvailable",
      (SELECT COUNT(*) FROM work_messages m WHERE m.run_id=r.id AND m.status='pending')::integer AS "pendingRequirements"
      FROM work_runs r JOIN work_tasks t ON t.id=r.task_id
      WHERE t.owner_id='owner' AND t.id=ANY(string_to_array(${taskIds.join(',')}, ',')::uuid[])
      ORDER BY r.task_id, r.created_at DESC, r.id DESC`
    return rows.map(publicRunContext)
  }

  async function stewardRetryContext(taskId: string, runId: string) {
    const [row] = await db`SELECT r.task_id AS "taskId", r.id AS "runId", r.status, r.failure,
      r.model_snapshot AS model, (r.checkpoint_ref IS NOT NULL) AS "checkpointAvailable",
      (SELECT COUNT(*) FROM work_messages m WHERE m.run_id=r.id AND m.status='pending')::integer AS "pendingRequirements"
      FROM work_runs r JOIN work_tasks t ON t.id=r.task_id
      WHERE t.owner_id='owner' AND t.id=${taskId} AND r.id=${runId}`
    if (!row) throw new WorkArtifactError('not-found')
    return publicRunContext(row)
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
      const turn = await lockStewardTurnBudget(sql, currentTurnId)
      const [operation] = await sql`SELECT turn_id AS "turnId", request_id AS "requestId", request_hash AS "requestHash",
        goal, source_url AS "sourceUrl", model_snapshot AS "modelSnapshot", credential_ref AS "credentialRef",
        status, task_id AS "taskId", run_id AS "runId"
        FROM steward_research_operations WHERE operation_id=${operationId} FOR UPDATE`
      const [resume] = operation ? await sql`SELECT 1 FROM steward_research_resumes WHERE turn_id=${currentTurnId} AND operation_id=${operationId}` : []
      if (!turn || !operation || operation.turnId !== currentTurnId && !resume) throw new WorkInputError('调研操作回执无效')
      if (operation.status === 'accepted') return { taskId: operation.taskId, runId: operation.runId, created: false, status: 'accepted' as const }
      if (operation.status !== 'planned') return { created: false, status: operation.status as string, failure: '调研操作已结束' }
      const budget = await stewardOperationBudget(sql, turn, currentTime)
      if (budget.reason === 'stopped') {
        await sql`UPDATE steward_research_operations SET status='unexecuted', failure='管家轮次已停止', finished_at=now() WHERE operation_id=${operationId}`
        return { created: false, status: 'unexecuted' as const, failure: '管家轮次已停止' }
      }
      if (budget.reason) {
        const failure = stewardBudgetFailure(budget.reason)
        await sql`UPDATE steward_research_operations SET status='unexecuted', failure=${failure}, finished_at=now() WHERE operation_id=${operationId}`
        return { created: false, status: 'unexecuted' as const, failure }
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
      const input: CreateRequest = { requestId: operation.requestId, goal: operation.goal, sourceUrl: operation.sourceUrl, repoUrl: operation.repoUrl ?? null, modelId: snapshot.id, protocol: snapshot.protocol }
      const taskId = crypto.randomUUID()
      const created = await createWorkInTransaction(sql, input, operation.requestHash, snapshot, operation.credentialRef, taskId)
      if (!created) {
        const [existing] = await sql`SELECT id, request_hash AS "requestHash" FROM work_tasks WHERE request_id=${operation.requestId}`
        if (!existing || existing.requestHash !== operation.requestHash) throw new WorkConflictError('调研请求 ID 已用于其他工作')
        await sql`UPDATE steward_research_operations SET status='accepted', task_id=${existing.id}, accepted_turn_id=${currentTurnId}, finished_at=now()
          WHERE operation_id=${operationId}`
        await sql`INSERT INTO steward_thread_tasks (thread_id, task_id) VALUES (${turn.threadId}, ${existing.id}) ON CONFLICT DO NOTHING`
        if (budget.createCount + 1 >= 3) await sql`UPDATE steward_turns SET budget_reason='creates' WHERE id=${currentTurnId}`
        return { taskId: existing.id, created: false, status: 'accepted' as const }
      }
      await sql`UPDATE steward_research_operations SET status='accepted', task_id=${created.taskId}, run_id=${created.runId},
        accepted_turn_id=${currentTurnId}, finished_at=now() WHERE operation_id=${operationId}`
      await sql`INSERT INTO steward_thread_tasks (thread_id, task_id) VALUES (${turn.threadId}, ${created.taskId}) ON CONFLICT DO NOTHING`
      await sql`INSERT INTO steward_events (turn_id, event_id, type, payload) VALUES (${currentTurnId}, ${crypto.randomUUID()}, 'work.accepted',
        ${JSON.stringify({ operationId, taskId: created.taskId, runId: created.runId })}::jsonb)`
      if (budget.createCount + 1 >= 3) await sql`UPDATE steward_turns SET budget_reason='creates' WHERE id=${currentTurnId}`
      return { ...created, created: true, status: 'accepted' as const }
    })
    const task = result.taskId ? await detail(result.taskId) : null
    if (result.created && task) await onCreated?.(result.taskId, task.goal || task.sourceUrl || '').catch(() => {})
    return task ? { ...result, task } : result
  }

  async function freezeStewardControl(currentTurnId: string, operationId: string, taskId: string, expectedRunId: string | null, currentTime: () => number) {
    return db.begin(async sql => {
      const turn = await lockStewardTurnBudget(sql, currentTurnId)
      const [operation] = await sql`SELECT turn_id AS "turnId", kind, status, task_id AS "taskId", run_id AS "runId"
        FROM steward_control_operations WHERE operation_id=${operationId} FOR UPDATE`
      if (!turn || !operation || operation.turnId !== currentTurnId) throw new WorkInputError('控制操作回执无效')
      if (operation.status === 'planned' || operation.status === 'accepted') {
        if (operation.taskId !== taskId || expectedRunId && operation.runId !== expectedRunId) throw new WorkConflictError('当前轮次的控制目标已冻结')
        return { operationId, taskId: operation.taskId, runId: operation.runId, status: operation.status }
      }
      if (operation.status !== 'intent') throw new WorkConflictError('控制操作已结束')
      const budget = await stewardOperationBudget(sql, turn, currentTime)
      if (budget.reason) throw new WorkConflictError(budget.reason === 'stopped' ? '管家轮次已停止' : stewardBudgetFailure(budget.reason))
      await sql`SELECT pg_advisory_xact_lock(720, hashtext(${taskId}))`
      const [run] = await sql`SELECT r.id, r.status, r.active FROM work_runs r JOIN work_tasks t ON t.id=r.task_id
        WHERE t.id=${taskId} AND t.owner_id='owner' ORDER BY r.created_at DESC, r.id DESC LIMIT 1 FOR UPDATE OF r`
      if (!run) throw new WorkInputError('控制目标不存在')
      if (expectedRunId && run.id !== expectedRunId) throw new WorkConflictError('快捷操作指定的 Run 已被新的 Run 替代')
      if (operation.kind === 'steer' && (run.status !== 'running' || !run.active)) throw new WorkConflictError('当前 Run 不在执行中')
      if (operation.kind === 'cancel' && !['queued', 'provisioning', 'running', 'waiting'].includes(run.status)) throw new WorkConflictError('当前 Run 不可取消')
      await sql`UPDATE steward_control_operations SET task_id=${taskId}, run_id=${run.id}, status='planned' WHERE operation_id=${operationId}`
      return { operationId, taskId, runId: run.id, status: 'planned' as const }
    })
  }

  async function applyStewardControl(currentTurnId: string, operationId: string, currentTime: () => number) {
    return db.begin(async sql => {
      const turn = await lockStewardTurnBudget(sql, currentTurnId)
      const [operation] = await sql`SELECT turn_id AS "turnId", kind, content, command_id AS "commandId", status,
        task_id AS "taskId", run_id AS "runId", result_json AS "resultJson", failure
        FROM steward_control_operations WHERE operation_id=${operationId} FOR UPDATE`
      const [resume] = operation ? await sql`SELECT 1 FROM steward_control_resumes WHERE turn_id=${currentTurnId} AND operation_id=${operationId}` : []
      if (!turn || !operation || operation.turnId !== currentTurnId && !resume) throw new WorkInputError('控制操作回执无效')
      if (operation.status === 'accepted') return typeof operation.resultJson === 'string' ? JSON.parse(operation.resultJson) : operation.resultJson
      if (operation.status !== 'planned') return { operationId, status: operation.status, failure: operation.failure }
      const budget = await stewardOperationBudget(sql, turn, currentTime)
      if (budget.reason) {
        const failure = budget.reason === 'stopped' ? '管家轮次已停止' : stewardBudgetFailure(budget.reason)
        await sql`UPDATE steward_control_operations SET status='unexecuted', failure=${failure}, finished_at=now() WHERE operation_id=${operationId}`
        return { operationId, status: 'unexecuted' as const, failure }
      }
      await sql`SELECT pg_advisory_xact_lock(720, hashtext(${operation.taskId}))`
      const [latest] = await sql`SELECT r.id, r.status FROM work_runs r JOIN work_tasks t ON t.id=r.task_id
        WHERE t.id=${operation.taskId} AND t.owner_id='owner' ORDER BY r.created_at DESC, r.id DESC LIMIT 1 FOR UPDATE OF r`
      if (!latest || latest.id !== operation.runId) {
        const failure = '已冻结 Run 已被新的 Run 替代'
        await sql`UPDATE steward_control_operations SET status='failed', failure=${failure}, finished_at=now() WHERE operation_id=${operationId}`
        return { operationId, status: 'failed' as const, failure }
      }
      let receipt: Record<string, unknown>
      if (operation.kind === 'steer') {
        try {
          const appended = await appendRunMessageInTransaction(sql, operation.runId, { commandId: operation.commandId, kind: 'steer', content: operation.content })
          if (!appended) throw new WorkInputError('已冻结 Run 不存在')
          receipt = { kind: 'steer', taskId: operation.taskId, runId: operation.runId,
            messageId: appended.message.id, messageStatus: appended.message.status }
        } catch (error) {
          if (!(error instanceof WorkConflictError || error instanceof WorkInputError)) throw error
          const failure = error.message.slice(0, 500)
          await sql`UPDATE steward_control_operations SET status='failed', failure=${failure}, finished_at=now() WHERE operation_id=${operationId}`
          return { operationId, status: 'failed' as const, failure }
        }
      } else {
        const cancelled = await cancelInTransaction(sql, operation.taskId, operation.runId)
        if (!cancelled?.accepted) {
          const failure = cancelled?.stale ? '已冻结 Run 已被新的 Run 替代' : '当前 Run 不可取消'
          await sql`UPDATE steward_control_operations SET status='failed', failure=${failure}, finished_at=now() WHERE operation_id=${operationId}`
          return { operationId, status: 'failed' as const, failure }
        }
        receipt = { kind: 'cancel', taskId: operation.taskId, runId: operation.runId, runStatus: cancelled.runStatus }
      }
      await sql`UPDATE steward_control_operations SET status='accepted', result_json=${JSON.stringify(receipt)}::jsonb,
        failure=NULL, finished_at=now() WHERE operation_id=${operationId}`
      await sql`INSERT INTO steward_thread_tasks (thread_id, task_id) VALUES (${turn.threadId}, ${operation.taskId}) ON CONFLICT DO NOTHING`
      await sql`INSERT INTO steward_events (turn_id, event_id, type, payload) VALUES (${currentTurnId}, ${crypto.randomUUID()},
        ${operation.kind === 'steer' ? 'work.steered' : 'work.cancelled'}, ${JSON.stringify({ operationId, ...receipt })}::jsonb)`
      return receipt
    })
  }

  async function freezeStewardInteraction(currentTurnId: string, operationId: string, taskId: string, interactionId: string, currentTime: () => number) {
    return db.begin(async sql => {
      const turn = await lockStewardTurnBudget(sql, currentTurnId)
      const [operation] = await sql`SELECT turn_id AS "turnId", desired_kind AS "desiredKind", status, task_id AS "taskId",
        run_id AS "runId", run_epoch AS "runEpoch", interaction_id AS "interactionId"
        FROM steward_interaction_operations WHERE operation_id=${operationId} FOR UPDATE`
      if (!turn || !operation || operation.turnId !== currentTurnId) throw new WorkInputError('回答操作回执无效')
      if (operation.status === 'planned' || operation.status === 'accepted') {
        if (operation.taskId !== taskId || operation.interactionId !== interactionId) throw new WorkConflictError('当前轮次的回答目标已冻结')
        return { operationId, taskId: operation.taskId, runId: operation.runId, epoch: operation.runEpoch,
          interactionId: operation.interactionId, interactionKind: operation.desiredKind, status: operation.status }
      }
      if (operation.status !== 'intent') throw new WorkConflictError('回答操作已结束')
      const budget = await stewardOperationBudget(sql, turn, currentTime)
      if (budget.reason) throw new WorkConflictError(budget.reason === 'stopped' ? '管家轮次已停止' : stewardBudgetFailure(budget.reason))
      await sql`SELECT pg_advisory_xact_lock(720, hashtext(${taskId}))`
      const [target] = await sql`SELECT i.run_id AS "runId" FROM work_interactions i
        JOIN work_runs r ON r.id=i.run_id JOIN work_tasks t ON t.id=r.task_id
        WHERE i.id=${interactionId} AND t.id=${taskId} AND t.owner_id='owner'`
      if (!target) throw new WorkInputError('回答目标不存在')
      const [run] = await sql`SELECT id AS "runId", epoch AS "runEpoch", status AS "runStatus", active,
        cleanup_state AS "cleanupState", checkpoint_ref AS "checkpointRef"
        FROM work_runs WHERE id=${target.runId} AND task_id=${taskId} FOR UPDATE`
      const [interaction] = await sql`SELECT id AS "interactionId", kind, question, status AS "interactionStatus", epoch
        FROM work_interactions WHERE id=${interactionId} AND run_id=${target.runId} FOR UPDATE`
      if (!run || !interaction) throw new WorkInputError('回答目标不存在')
      const [latest] = await sql`SELECT id FROM work_runs WHERE task_id=${taskId} ORDER BY created_at DESC, id DESC LIMIT 1`
      const checkpoint = typeof run.checkpointRef === 'string' ? JSON.parse(run.checkpointRef) : run.checkpointRef
      if (latest?.id !== run.runId || interaction.kind !== operation.desiredKind || interaction.interactionStatus !== 'pending'
        || run.runStatus !== 'waiting' || run.active || run.cleanupState !== 'cleaned' || !checkpoint
        || interaction.epoch !== run.runEpoch || interaction.epoch !== checkpoint.epoch) throw new WorkConflictError('问题尚未准备好回答')
      await sql`UPDATE steward_interaction_operations SET task_id=${taskId}, run_id=${run.runId}, run_epoch=${interaction.epoch},
        interaction_id=${interactionId}, interaction_kind=${interaction.kind}, status='planned',
        candidates_json=COALESCE(candidates_json, ${JSON.stringify([{ id: taskId, interaction: { id: interactionId, kind: interaction.kind,
          question: interaction.question, status: interaction.interactionStatus, runId: run.runId, epoch: interaction.epoch } }])}::jsonb)
        WHERE operation_id=${operationId}`
      return { operationId, taskId, runId: run.runId, epoch: interaction.epoch, interactionId,
        interactionKind: interaction.kind, status: 'planned' as const }
    })
  }

  async function applyStewardInteraction(currentTurnId: string, operationId: string, currentTime: () => number) {
    return db.begin(async sql => {
      const turn = await lockStewardTurnBudget(sql, currentTurnId)
      const [operation] = await sql`SELECT turn_id AS "turnId", answer, decision, status, task_id AS "taskId", run_id AS "runId",
        run_epoch AS "runEpoch", interaction_id AS "interactionId", interaction_kind AS "interactionKind",
        result_json AS "resultJson", failure FROM steward_interaction_operations WHERE operation_id=${operationId} FOR UPDATE`
      const [resume] = operation ? await sql`SELECT 1 FROM steward_interaction_resumes WHERE turn_id=${currentTurnId} AND operation_id=${operationId}` : []
      if (!turn || !operation || operation.turnId !== currentTurnId && !resume) throw new WorkInputError('回答操作回执无效')
      if (operation.status === 'accepted') return typeof operation.resultJson === 'string' ? JSON.parse(operation.resultJson) : operation.resultJson
      if (operation.status !== 'planned') return { operationId, status: operation.status, failure: operation.failure }
      const fail = async (status: 'unexecuted' | 'failed', failure: string) => {
        await sql`UPDATE steward_interaction_operations SET status=${status}, failure=${failure}, finished_at=now() WHERE operation_id=${operationId}`
        return { operationId, status, failure }
      }
      const budget = await stewardOperationBudget(sql, turn, currentTime)
      if (budget.reason) return fail('unexecuted', budget.reason === 'stopped' ? '管家轮次已停止' : stewardBudgetFailure(budget.reason))
      const answer = operation.decision ?? operation.answer
      let resolved
      try {
        resolved = await resolveInteractionInTransaction(sql, operation.interactionId, answer, {
          taskId: operation.taskId, runId: operation.runId, epoch: operation.runEpoch, kind: operation.interactionKind,
        })
      } catch (error) {
        if (!(error instanceof WorkConflictError || error instanceof WorkInputError)) throw error
        return fail('failed', error.message.slice(0, 500))
      }
      if (!resolved) return fail('failed', '已冻结问题不存在')
      const receipt = { interactionId: resolved.interactionId, taskId: resolved.taskId, runId: resolved.runId,
        epoch: resolved.epoch, kind: resolved.kind, answer: resolved.answer, runStatus: resolved.runStatus }
      await sql`UPDATE steward_interaction_operations SET status='accepted', result_json=${JSON.stringify(receipt)}::jsonb,
        failure=NULL, finished_at=now() WHERE operation_id=${operationId}`
      await sql`INSERT INTO steward_thread_tasks (thread_id, task_id) VALUES (${turn.threadId}, ${operation.taskId}) ON CONFLICT DO NOTHING`
      await sql`INSERT INTO steward_events (turn_id, event_id, type, payload) VALUES (${currentTurnId}, ${crypto.randomUUID()},
        'work.interaction-answered', ${JSON.stringify({ operationId, ...receipt })}::jsonb)`
      return receipt
    })
  }

  async function freezeStewardRetry(currentTurnId: string, operationId: string, taskId: string, expectedRunId: string | null, currentTime: () => number) {
    return db.begin(async sql => {
      const turn = await lockStewardTurnBudget(sql, currentTurnId)
      const [operation] = await sql`SELECT turn_id AS "turnId", mode, status, task_id AS "taskId", source_run_id AS "sourceRunId",
        model_snapshot AS "modelSnapshot", credential_ref AS "credentialRef"
        FROM steward_retry_operations WHERE operation_id=${operationId} FOR UPDATE`
      if (!turn || !operation || operation.turnId !== currentTurnId) throw new WorkInputError('重试操作回执无效')
      if (['planned', 'accepted', 'failed'].includes(operation.status)) {
        if (operation.taskId !== taskId || expectedRunId && operation.sourceRunId !== expectedRunId) throw new WorkConflictError('当前轮次的重试目标已冻结')
        return { operationId, taskId: operation.taskId, sourceRunId: operation.sourceRunId, status: operation.status }
      }
      if (operation.status !== 'intent') throw new WorkConflictError('重试操作已结束')
      const budget = await stewardOperationBudget(sql, turn, currentTime)
      if (budget.reason) throw new WorkConflictError(budget.reason === 'stopped' ? '管家轮次已停止' : stewardBudgetFailure(budget.reason))
      await sql`SELECT pg_advisory_xact_lock(720, hashtext(${taskId}))`
      const [run] = await sql`SELECT r.id, r.status, r.active, r.cleanup_state AS "cleanupState", r.model_snapshot AS "modelSnapshot",
        r.credential_ref AS "credentialRef" FROM work_runs r JOIN work_tasks t ON t.id=r.task_id
        WHERE t.id=${taskId} AND t.owner_id='owner' ORDER BY r.created_at DESC, r.id DESC LIMIT 1 FOR UPDATE OF r`
      if (!run) throw new WorkInputError('重试目标不存在')
      if (expectedRunId && run.id !== expectedRunId) throw new WorkConflictError('快捷操作指定的 Run 已被新的 Run 替代')
      if (run.active || run.cleanupState !== 'cleaned' || !['failed', 'lost'].includes(run.status)) throw new WorkConflictError('当前 Run 不可重试')
      const source = typeof run.modelSnapshot === 'string' ? JSON.parse(run.modelSnapshot) : run.modelSnapshot
      let snapshot = source
      let credentialRef = run.credentialRef
      let failure: string | null = null
      if (operation.mode === 'replacement') {
        const selected = typeof operation.modelSnapshot === 'string' ? JSON.parse(operation.modelSnapshot) : operation.modelSnapshot
        if (!selected || selected.id === source.id) failure = '替代模型必须与原模型不同'
        else if (selected.protocol !== source.protocol) failure = '替代模型协议与原 Run 不兼容'
        else if (selected.tools !== true || !Array.isArray(selected.input) || !selected.input.includes('text')
          || !Number.isSafeInteger(selected.contextWindow) || selected.contextWindow < 1
          || !Number.isSafeInteger(selected.maxTokens) || selected.maxTokens < 1 || typeof selected.reasoning !== 'boolean') failure = '替代模型缺少完整的文本与工具运行参数'
        else if (!Number.isSafeInteger(source.contextWindow) || selected.contextWindow < source.contextWindow) failure = '替代模型上下文长度小于原 Run'
        else if (typeof operation.credentialRef !== 'string' || !operation.credentialRef) failure = '替代模型凭证版本无效'
        else { snapshot = selected; credentialRef = operation.credentialRef }
      }
      if (failure) {
        await sql`UPDATE steward_retry_operations SET task_id=${taskId}, source_run_id=${run.id}, status='failed', failure=${failure}, finished_at=now()
          WHERE operation_id=${operationId}`
        return { operationId, taskId, sourceRunId: run.id, status: 'failed' as const, failure }
      }
      await sql`UPDATE steward_retry_operations SET task_id=${taskId}, source_run_id=${run.id}, model_snapshot=${JSON.stringify(snapshot)}::text::jsonb,
        credential_ref=${credentialRef}, status='planned', failure=NULL WHERE operation_id=${operationId}`
      return { operationId, taskId, sourceRunId: run.id, status: 'planned' as const }
    })
  }

  async function verifiedRetryCheckpoint(sql: SQL, taskId: string, run: { id: string; epoch: number; checkpointRef: any }) {
    if (!run.checkpointRef) return null
    const checkpoint = typeof run.checkpointRef === 'string' ? JSON.parse(run.checkpointRef) : run.checkpointRef
    const sourceRunId = checkpoint.sourceRunId ?? run.id
    if (typeof sourceRunId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sourceRunId) || !Number.isSafeInteger(checkpoint.epoch)
      || checkpoint.epoch < 0 || !Array.isArray(checkpoint.files) || checkpoint.files.length < 1 || checkpoint.files.length > 8) {
      throw new WorkConflictError('检查点来源无效')
    }
    const [source] = await sql`WITH RECURSIVE chain AS (
        SELECT id, task_id, retry_of_run_id, epoch FROM work_runs WHERE id=${run.id}
        UNION ALL SELECT parent.id, parent.task_id, parent.retry_of_run_id, parent.epoch
        FROM work_runs parent JOIN chain child ON parent.id=child.retry_of_run_id
      ) SELECT id, task_id AS "taskId", epoch FROM chain WHERE id=${sourceRunId}`
    if (!source || source.taskId !== taskId || Number(source.epoch) < checkpoint.epoch) throw new WorkConflictError('检查点来源链无效')
    const names = new Set<string>()
    let hasSession = false
    for (const file of checkpoint.files) {
      const limit = file?.name === 'manifest.json' ? 4096 : file?.name === 'session.jsonl' ? 10_000_000
        : /^generation-[0-9a-f-]{36}\/report\.md$/i.test(file?.name) ? 2_000_000
        : /^generation-[0-9a-f-]{36}\/attachment-[0-4]\.(txt|csv|json|md)$/i.test(file?.name) ? 10_000_000 : 0
      const minimum = file?.name?.includes('/attachment-') ? 0 : 1
      if (!limit || names.has(file.name) || !Number.isSafeInteger(file.size) || file.size < minimum || file.size > limit
        || typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(file.sha256)) throw new WorkConflictError('检查点文件清单无效')
      names.add(file.name)
      hasSession ||= file.name === 'session.jsonl'
      let bytes: Buffer
      try { bytes = await readFile(join(artifactDir, sourceRunId, `checkpoint-${checkpoint.epoch}`, file.name)) }
      catch { throw new WorkConflictError('检查点文件不可读取') }
      if (bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new WorkConflictError('检查点文件校验失败')
    }
    if (!hasSession) throw new WorkConflictError('检查点会话缺失')
    return { ...checkpoint, sourceRunId }
  }

  async function applyStewardRetry(currentTurnId: string, operationId: string, currentTime: () => number) {
    return db.begin(async sql => {
      const turn = await lockStewardTurnBudget(sql, currentTurnId)
      const [operation] = await sql`SELECT turn_id AS "turnId", request_id AS "requestId", request_hash AS "requestHash", mode, status,
        task_id AS "taskId", source_run_id AS "sourceRunId", model_snapshot AS "modelSnapshot", credential_ref AS "credentialRef",
        result_json AS "resultJson", failure FROM steward_retry_operations WHERE operation_id=${operationId} FOR UPDATE`
      const [resume] = operation ? await sql`SELECT 1 FROM steward_retry_resumes WHERE turn_id=${currentTurnId} AND operation_id=${operationId}` : []
      if (!turn || !operation || operation.turnId !== currentTurnId && !resume) throw new WorkInputError('重试操作回执无效')
      if (operation.status === 'accepted') return typeof operation.resultJson === 'string' ? JSON.parse(operation.resultJson) : operation.resultJson
      if (operation.status !== 'planned') return { operationId, status: operation.status, failure: operation.failure }
      const stop = async (failure: string) => {
        await sql`UPDATE steward_retry_operations SET status='unexecuted', failure=${failure}, finished_at=now() WHERE operation_id=${operationId}`
        return { operationId, status: 'unexecuted' as const, failure }
      }
      const budget = await stewardOperationBudget(sql, turn, currentTime)
      if (budget.reason) return stop(budget.reason === 'stopped' ? '管家轮次已停止' : stewardBudgetFailure(budget.reason))
      await sql`SELECT pg_advisory_xact_lock(720, hashtext(${operation.taskId}))`
      const [source] = await sql`SELECT r.id, r.epoch, r.status, r.active, r.cleanup_state AS "cleanupState",
        r.previous_report_version_id AS "previousReportVersionId", r.context_snapshot AS "contextSnapshot", r.checkpoint_ref AS "checkpointRef"
        FROM work_runs r JOIN work_tasks t ON t.id=r.task_id WHERE t.id=${operation.taskId} AND t.owner_id='owner'
        ORDER BY r.created_at DESC, r.id DESC LIMIT 1 FOR UPDATE OF r`
      const fail = async (failure: string) => {
        await sql`UPDATE steward_retry_operations SET status='failed', failure=${failure}, finished_at=now() WHERE operation_id=${operationId}`
        return { operationId, status: 'failed' as const, failure }
      }
      if (!source || source.id !== operation.sourceRunId) return fail('已冻结 Run 已被新的 Run 替代')
      if (source.active || source.cleanupState !== 'cleaned' || !['failed', 'lost'].includes(source.status)) return fail('已冻结 Run 当前不可重试')
      let checkpoint
      try { checkpoint = await verifiedRetryCheckpoint(sql, operation.taskId, source) }
      catch (error) { if (error instanceof WorkConflictError) return fail(error.message); throw error }
      const snapshot = typeof operation.modelSnapshot === 'string' ? JSON.parse(operation.modelSnapshot) : operation.modelSnapshot
      const context = typeof source.contextSnapshot === 'string' ? JSON.parse(source.contextSnapshot) : source.contextSnapshot
      const runId = crypto.randomUUID()
      await sql`INSERT INTO work_runs (id, task_id, status, model_snapshot, credential_ref, request_id, request_hash,
        previous_report_version_id, context_snapshot, checkpoint_ref, retry_of_run_id)
        VALUES (${runId}, ${operation.taskId}, 'queued', ${JSON.stringify(snapshot)}::jsonb, ${operation.credentialRef},
          ${operation.requestId}, ${operation.requestHash}, ${source.previousReportVersionId}, ${context ? JSON.stringify(context) : null}::text::jsonb,
          ${checkpoint ? JSON.stringify(checkpoint) : null}::text::jsonb, ${source.id})`
      await sql`UPDATE work_messages SET run_id=${runId} WHERE run_id=${source.id} AND status='pending'`
      await sql`INSERT INTO work_outbox (run_id) VALUES (${runId})`
      await sql`UPDATE work_tasks SET status='queued' WHERE id=${operation.taskId}`
      const receipt = { kind: 'retry', mode: operation.mode, taskId: operation.taskId, sourceRunId: source.id, runId,
        modelId: snapshot.id, protocol: snapshot.protocol }
      await sql`UPDATE steward_retry_operations SET status='accepted', run_id=${runId}, result_json=${JSON.stringify(receipt)}::text::jsonb,
        failure=NULL, finished_at=now() WHERE operation_id=${operationId}`
      await sql`INSERT INTO steward_thread_tasks (thread_id, task_id) VALUES (${turn.threadId}, ${operation.taskId}) ON CONFLICT DO NOTHING`
      await sql`INSERT INTO steward_events (turn_id, event_id, type, payload) VALUES (${currentTurnId}, ${crypto.randomUUID()}, 'work.retried',
        ${JSON.stringify({ operationId, ...receipt })}::jsonb)`
      return receipt
    })
  }

  async function freezeStewardRevision(currentTurnId: string, operationId: string, taskId: string, versionId: string, currentTime: () => number) {
    return db.begin(async sql => {
      const turn = await lockStewardTurnBudget(sql, currentTurnId)
      const [operation] = await sql`SELECT turn_id AS "turnId", status, task_id AS "taskId", base_run_id AS "baseRunId",
        source_version_id AS "sourceVersionId" FROM steward_revision_operations WHERE operation_id=${operationId} FOR UPDATE`
      if (!turn || !operation || operation.turnId !== currentTurnId) throw new WorkInputError('改稿操作回执无效')
      if (operation.status === 'planned' || operation.status === 'accepted') {
        if (operation.taskId !== taskId || operation.sourceVersionId !== versionId) throw new WorkConflictError('当前轮次的改稿目标已冻结')
        return { operationId, taskId, baseRunId: operation.baseRunId, sourceVersionId: operation.sourceVersionId, status: operation.status }
      }
      if (operation.status !== 'intent') throw new WorkConflictError('改稿操作已结束')
      const budget = await stewardOperationBudget(sql, turn, currentTime)
      if (budget.reason) throw new WorkConflictError(budget.reason === 'stopped' ? '管家轮次已停止' : stewardBudgetFailure(budget.reason))
      await sql`SELECT pg_advisory_xact_lock(720, hashtext(${taskId}))`
      const [run] = await sql`SELECT r.id, r.status, r.active, r.cleanup_state AS "cleanupState" FROM work_runs r JOIN work_tasks t ON t.id=r.task_id
        WHERE t.id=${taskId} AND t.owner_id='owner' ORDER BY r.created_at DESC, r.id DESC LIMIT 1 FOR UPDATE OF r`
      if (!run) throw new WorkInputError('改稿目标不存在')
      if (run.active || run.cleanupState !== 'cleaned' || !['succeeded', 'failed', 'lost', 'cancelled'].includes(run.status)) throw new WorkConflictError('当前工作尚未完成')
      const [report] = await sql`SELECT v.id FROM work_artifact_versions v JOIN work_artifacts a ON a.id=v.artifact_id
        JOIN work_runs source ON source.id=v.run_id
        WHERE v.id=${versionId} AND a.task_id=${taskId} AND a.kind='report' AND source.status='succeeded'`
      if (!report) throw new WorkConflictError('所选报告版本不可修改')
      await sql`UPDATE steward_revision_operations SET task_id=${taskId}, base_run_id=${run.id}, source_version_id=${versionId}, status='planned'
        WHERE operation_id=${operationId}`
      return { operationId, taskId, baseRunId: run.id, sourceVersionId: versionId, status: 'planned' as const }
    })
  }

  async function applyStewardRevision(currentTurnId: string, operationId: string, currentTime: () => number) {
    return db.begin(async sql => {
      const turn = await lockStewardTurnBudget(sql, currentTurnId)
      const [operation] = await sql`SELECT turn_id AS "turnId", request_id AS "requestId", content, model_snapshot AS "modelSnapshot",
        credential_ref AS "credentialRef", reason, status, task_id AS "taskId", base_run_id AS "baseRunId",
        source_version_id AS "sourceVersionId", run_id AS "runId", result_json AS "resultJson", failure
        FROM steward_revision_operations WHERE operation_id=${operationId} FOR UPDATE`
      const [resume] = operation ? await sql`SELECT 1 FROM steward_revision_resumes WHERE turn_id=${currentTurnId} AND operation_id=${operationId}` : []
      if (!turn || !operation || operation.turnId !== currentTurnId && !resume) throw new WorkInputError('改稿操作回执无效')
      if (operation.status === 'accepted') return typeof operation.resultJson === 'string' ? JSON.parse(operation.resultJson) : operation.resultJson
      if (operation.status !== 'planned') return { operationId, status: operation.status, failure: operation.failure }
      const budget = await stewardOperationBudget(sql, turn, currentTime)
      if (budget.reason) {
        const failure = budget.reason === 'stopped' ? '管家轮次已停止' : stewardBudgetFailure(budget.reason)
        await sql`UPDATE steward_revision_operations SET status='unexecuted', failure=${failure}, finished_at=now() WHERE operation_id=${operationId}`
        return { operationId, status: 'unexecuted' as const, failure }
      }
      const snapshot = typeof operation.modelSnapshot === 'string' ? JSON.parse(operation.modelSnapshot) : operation.modelSnapshot
      let continued
      try {
        continued = await continueTaskInTransaction(sql, operation.taskId, {
          requestId: operation.requestId, content: operation.content, modelId: snapshot.id, protocol: snapshot.protocol,
        }, snapshot, operation.credentialRef, { runId: operation.baseRunId, versionId: operation.sourceVersionId })
        if (!continued) throw new WorkInputError('已冻结工作不存在')
      } catch (error) {
        if (!(error instanceof WorkConflictError || error instanceof WorkInputError)) throw error
        const failure = error.message.slice(0, 500)
        await sql`UPDATE steward_revision_operations SET status='failed', failure=${failure}, finished_at=now() WHERE operation_id=${operationId}`
        return { operationId, status: 'failed' as const, failure }
      }
      const receipt = { operationId, status: 'accepted', taskId: operation.taskId, runId: continued.runId,
        sourceVersionId: operation.sourceVersionId, modelId: snapshot.id, protocol: snapshot.protocol, reason: operation.reason }
      await sql`UPDATE steward_revision_operations SET status='accepted', run_id=${continued.runId}, result_json=${JSON.stringify(receipt)}::jsonb,
        failure=NULL, finished_at=now() WHERE operation_id=${operationId}`
      await sql`INSERT INTO steward_thread_tasks (thread_id, task_id) VALUES (${turn.threadId}, ${operation.taskId}) ON CONFLICT DO NOTHING`
      await sql`INSERT INTO steward_events (turn_id, event_id, type, payload) VALUES (${currentTurnId}, ${crypto.randomUUID()}, 'work.revision-accepted', ${JSON.stringify(receipt)}::jsonb)`
      return receipt
    })
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

  async function cancelInTransaction(sql: SQL, taskId: string, expectedRunId?: string) {
    await sql`SELECT pg_advisory_xact_lock(720, hashtext(${taskId}))`
    const [run] = await sql`SELECT r.id, r.epoch, r.status, r.active, r.checkpoint_ref AS "checkpointRef" FROM work_runs r
      JOIN work_tasks t ON t.id = r.task_id WHERE t.id = ${taskId} AND t.owner_id = 'owner'
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1 FOR UPDATE OF r`
    if (!run) return null
    if (expectedRunId && run.id !== expectedRunId) return { accepted: false, stale: true, runId: run.id, runStatus: run.status }
    if (run.status === 'cancelling' || run.status === 'cancelled') return { accepted: false, runId: run.id, runStatus: run.status }
    if (!['queued', 'provisioning', 'running', 'waiting'].includes(run.status)) return { accepted: false, runId: run.id, runStatus: run.status }
    if (run.active) {
      const [terminal] = await sql`SELECT 1 FROM work_events WHERE run_id = ${run.id} AND epoch = ${run.epoch}
        AND type IN ('run.finished', 'run.failed') LIMIT 1`
      if (terminal) return { accepted: false, runId: run.id, runStatus: run.status }
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
    return { accepted: true, runId: run.id, runStatus: status }
  }

  async function cancel(taskId: string) {
    return db.begin(sql => cancelInTransaction(sql, taskId))
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
    const rows = await db`SELECT id, title, title_edited AS "titleEdited", goal, source_url AS "sourceUrl", status, created_at AS "createdAt"
      FROM work_tasks WHERE owner_id = 'owner' ORDER BY created_at DESC, id DESC`
    return rows.map((row: any) => ({ ...row, title: row.title ?? titleSummary(row.goal, row.sourceUrl) }))
  }

  async function updateTitle(id: string, body: unknown) {
    const title = parseTitle(body)
    const [updated] = await db`UPDATE work_tasks SET title=${title}, title_edited=true WHERE id=${id} AND owner_id='owner' RETURNING id`
    return updated ? detail(id) : null
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
    if (inserted) {
      await onCreated?.(taskId, input.goal || input.sourceUrl || '').catch(() => {})
      return { task: await detail(taskId), created: true }
    }
    const [winner] = await db`SELECT id, request_hash FROM work_tasks WHERE request_id = ${input.requestId} AND owner_id = 'owner'`
    if (!winner || winner.request_hash !== requestHash) throw new WorkConflictError('请求 ID 已用于其他工作')
    return { task: await detail(winner.id), created: false }
  }

  async function continueTaskInTransaction(sql: SQL, taskId: string, input: ContinueRequest, snapshot: FrozenResearchModel,
    credentialRef: string, expected?: { runId: string; versionId: string }) {
    const requestHash = createHash('sha256').update(JSON.stringify({ taskId, content: input.content, modelId: input.modelId, protocol: input.protocol })).digest('hex')
    await sql`SELECT pg_advisory_xact_lock(720, hashtext(${taskId}))`
    const [task] = await sql`SELECT t.id, h.id AS "threadId" FROM work_tasks t JOIN work_threads h ON h.task_id=t.id
      WHERE t.id=${taskId} AND t.owner_id='owner'`
    if (!task) return null
    const [existing] = await sql`SELECT id, task_id AS "taskId", request_hash AS "requestHash" FROM work_runs WHERE request_id=${input.requestId}`
    if (existing) {
      if (existing.taskId !== taskId || existing.requestHash !== requestHash) throw new WorkConflictError('请求 ID 已用于其他修改')
      return { runId: existing.id, created: false }
    }
    const [previous] = await sql`SELECT id, status, active, cleanup_state AS "cleanupState" FROM work_runs
      WHERE task_id=${taskId} ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`
    if (!previous || previous.active || previous.cleanupState !== 'cleaned' || !['succeeded', 'failed', 'lost', 'cancelled'].includes(previous.status)) throw new WorkConflictError('当前工作尚未完成')
    if (expected && previous.id !== expected.runId) throw new WorkConflictError('已冻结 Run 已被新的 Run 替代')
    const [report] = expected
      ? await sql`SELECT v.id FROM work_artifact_versions v JOIN work_artifacts a ON a.id=v.artifact_id
          JOIN work_runs source ON source.id=v.run_id
          WHERE v.id=${expected.versionId} AND a.task_id=${taskId} AND a.kind='report' AND source.status='succeeded'`
      : await sql`SELECT v.id FROM work_artifact_versions v JOIN work_artifacts a ON a.id=v.artifact_id
          JOIN work_runs source ON source.id=v.run_id
          WHERE a.task_id=${taskId} AND a.kind='report' AND source.status='succeeded'
          ORDER BY v.created_at DESC, v.id DESC LIMIT 1`
    if (!report) throw new WorkConflictError('当前工作尚无可修改报告')
    const messages = await sql`SELECT content FROM work_messages WHERE thread_id=${task.threadId} ORDER BY created_at, id`
    const runId = crypto.randomUUID()
    const inserted = await sql`INSERT INTO work_runs (id, task_id, status, model_snapshot, credential_ref, request_id, request_hash,
      previous_report_version_id, context_snapshot) VALUES (${runId}, ${taskId}, 'queued', ${JSON.stringify(snapshot)}::jsonb,
      ${credentialRef}, ${input.requestId}, ${requestHash}, ${report.id}, ${JSON.stringify({ messages: messages.map((row: { content: string }) => row.content), instruction: input.content })}::jsonb)
      ON CONFLICT (request_id) DO NOTHING RETURNING id`
    if (!inserted.length) {
      const [winner] = await sql`SELECT id, task_id AS "taskId", request_hash AS "requestHash" FROM work_runs WHERE request_id=${input.requestId}`
      if (!winner || winner.taskId !== taskId || winner.requestHash !== requestHash) throw new WorkConflictError('请求 ID 已用于其他修改')
      return { runId: winner.id, created: false }
    }
    await sql`INSERT INTO work_outbox (run_id) VALUES (${runId})`
    await sql`UPDATE work_messages SET status='carried' WHERE thread_id=${task.threadId} AND status='pending'`
    await sql`INSERT INTO work_messages (id, thread_id, run_id, role, content, status)
      VALUES (${crypto.randomUUID()}, ${task.threadId}, ${runId}, 'user', ${input.content}, 'applied')`
    await sql`UPDATE work_tasks SET status='queued' WHERE id=${taskId}`
    return { runId, created: true }
  }

  async function continueTask(taskId: string, body: unknown, connection: RunConnection) {
    const input = parseContinueRequest(body)
    const model = connection.models.find(item => item.id === input.modelId)
    if (!connection.endpoint || !connection.hasCredential || !connection.credentialRef || !model) throw new WorkInputError('请先选择可用模型并配置连接')
    if (!model.contextWindow || !model.maxTokens || !model.input?.includes('text') || typeof model.reasoning !== 'boolean') throw new WorkInputError('请补充模型的上下文、输出上限、文本输入和推理配置')
    const snapshot = { ...model, protocol: input.protocol ?? model.protocol, endpoint: connection.endpoint }
    const result = await db.begin(sql => continueTaskInTransaction(sql, taskId, input, snapshot, connection.credentialRef!))
    return result === null ? null : { task: await detail(taskId), created: result.created }
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

  function parseAppendRunMessage(body: unknown): AppendRunMessageInput {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new WorkInputError('追加要求无效')
    const input = body as Record<string, unknown>
    if (typeof input.commandId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.commandId)) throw new WorkInputError('命令 ID 无效')
    if (input.kind !== 'steer') throw new WorkInputError('追加类型无效')
    const content = typeof input.content === 'string' ? input.content.trim() : ''
    if (!content || content.length > 4000) throw new WorkInputError('追加要求须为 1–4000 字')
    return { commandId: input.commandId, kind: 'steer', content }
  }

  async function appendRunMessageInTransaction(sql: SQL, runId: string, input: AppendRunMessageInput) {
    const [run] = await sql`SELECT r.status, r.active, r.epoch, h.id AS "threadId" FROM work_runs r
      JOIN work_tasks t ON t.id = r.task_id JOIN work_threads h ON h.task_id = t.id
      WHERE r.id = ${runId} AND t.owner_id = 'owner' FOR UPDATE OF r`
    if (!run) return null
    const [existing] = await sql`SELECT id, run_id AS "runId", content, status FROM work_messages WHERE command_id = ${input.commandId}`
    if (existing) {
      if (existing.runId !== runId || existing.content !== input.content) throw new WorkConflictError('命令 ID 已用于其他追加要求')
      return { message: existing, created: false }
    }
    if (run.status !== 'running' || !run.active) throw new WorkConflictError('当前 Run 不在执行中')
    const id = crypto.randomUUID()
    const rows = await sql`INSERT INTO work_messages (id, thread_id, run_id, command_id, role, content, status)
      VALUES (${id}, ${run.threadId}, ${runId}, ${input.commandId}, 'user', ${input.content}, 'pending')
      ON CONFLICT (command_id) DO NOTHING RETURNING id, run_id AS "runId", content, status`
    if (rows.length) return { message: rows[0], created: true }
    const [winner] = await sql`SELECT id, run_id AS "runId", content, status FROM work_messages WHERE command_id = ${input.commandId}`
    if (!winner || winner.runId !== runId || winner.content !== input.content) throw new WorkConflictError('命令 ID 已用于其他追加要求')
    return { message: winner, created: false }
  }

  async function appendRunMessage(runId: string, body: unknown) {
    const input = parseAppendRunMessage(body)
    return db.begin(async sql => {
      return appendRunMessageInTransaction(sql, runId, input)
    })
  }

  async function resolveInteractionInTransaction(sql: SQL, id: string, answer: string,
    expected?: { taskId: string; runId: string; epoch: number; kind: 'question' | 'limit' }) {
      const [target] = await sql`SELECT i.run_id AS "runId" FROM work_interactions i
        JOIN work_runs r ON r.id=i.run_id JOIN work_tasks t ON t.id=r.task_id
        WHERE i.id=${id} AND t.owner_id='owner'`
      if (!target) return null
      const [run] = await sql`SELECT id, epoch, task_id AS "taskId", status, active, cleanup_state AS "cleanupState", checkpoint_ref AS "checkpointRef",
        model_call_limit AS "modelCallLimit", active_limit_ms AS "activeLimitMs", budget_reason AS "budgetReason"
        FROM work_runs WHERE id=${target.runId} FOR UPDATE`
      const [interaction] = await sql`SELECT status, answer, kind, epoch FROM work_interactions WHERE id=${id} AND run_id=${target.runId} FOR UPDATE`
      if (!interaction || !run) return null
      if (expected && (run.taskId !== expected.taskId || run.id !== expected.runId
        || interaction.epoch !== expected.epoch || interaction.kind !== expected.kind)) throw new WorkConflictError('已冻结问题不属于当前执行')
      if (interaction.status === 'answered') {
        if (interaction.answer !== answer) throw new WorkConflictError('问题已用不同内容回答')
        return { created: false, interactionId: id, taskId: run.taskId, runId: run.id, epoch: interaction.epoch,
          kind: interaction.kind, answer, runStatus: run.status }
      }
      if (expected && run.epoch !== expected.epoch) throw new WorkConflictError('已冻结问题不属于当前执行')
      if (interaction.kind === 'limit' && !['continue', 'finish'].includes(answer)) throw new WorkInputError('请选择继续或结束')
      if (interaction.status !== 'pending' || run.status !== 'waiting' || run.active || run.cleanupState !== 'cleaned' || !run.checkpointRef) throw new WorkConflictError('问题尚未准备好回答')
      const checkpoint = typeof run.checkpointRef === 'string' ? JSON.parse(run.checkpointRef) : run.checkpointRef
      if (interaction.epoch !== run.epoch || checkpoint?.epoch !== run.epoch) throw new WorkConflictError('问题执行版本已失效')
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
          return { created: true, interactionId: id, taskId: run.taskId, runId: run.id, epoch: interaction.epoch,
            kind: interaction.kind, answer, runStatus: 'cancelled' }
        }
        await sql`UPDATE work_runs SET model_call_limit=${nextCalls}, active_limit_ms=${nextMs}, budget_reason=NULL WHERE id=${target.runId}`
      }
      await sql`UPDATE work_runs SET status='queued', cleanup_state='none' WHERE id=${target.runId}`
      await sql`UPDATE work_tasks SET status='queued' WHERE id=${run.taskId}`
      await sql`INSERT INTO work_outbox (run_id) VALUES (${target.runId}) ON CONFLICT DO NOTHING`
      return { created: true, interactionId: id, taskId: run.taskId, runId: run.id, epoch: interaction.epoch,
        kind: interaction.kind, answer, runStatus: 'queued' }
  }

  async function resolveInteraction(id: string, body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new WorkInputError('回答无效')
    const answer = typeof (body as Record<string, unknown>).answer === 'string' ? (body as Record<string, string>).answer.trim() : ''
    if (!answer || answer.length > 4000) throw new WorkInputError('回答须为 1–4000 字')
    return db.begin(async sql => {
      return resolveInteractionInTransaction(sql, id, answer)
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

  async function getAgentVersion(versionId: string): Promise<AgentVersionRow | null> {
    const [row] = await db`SELECT profile_id AS "profile_id", system_prompt AS "system_prompt", tool_set AS "tool_set", config
      FROM agent_versions WHERE id=${versionId}`
    if (!row) return null
    return { profile_id: row.profile_id, system_prompt: row.system_prompt, tool_set: row.tool_set,
      config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config ?? {} }
  }

  async function close() { await db.close() }

  return { list, detail, updateTitle, events, create, continueTask, retryTask, appendRunMessage, resolveInteraction, pendingInteractions, pendingRunMessages, acknowledgeRunMessage, cancel, isRunStopped, artifactVersion, readArtifact, stewardCatalog, stewardMetadata, stewardStatusCards, stewardRead, stewardRetryContext, stewardModelStats, createFromSteward, freezeStewardControl, applyStewardControl, freezeStewardInteraction, applyStewardInteraction, freezeStewardRetry, applyStewardRetry, freezeStewardRevision, applyStewardRevision, requestCleanupRetry, resolveRunModelConnection, authorizeModelProxy, reserveModelAttempt, recordModelUsage, getAgentVersion, close }
}
