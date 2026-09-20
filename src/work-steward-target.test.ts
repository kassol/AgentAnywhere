import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SQL } from 'bun'
import { startServer } from './server'
import { createWorkStore } from './work'

const databaseUrl = process.env.AGENTANYWHERE_TEST_DATABASE_URL
if (!databaseUrl) throw new Error('AGENTANYWHERE_TEST_DATABASE_URL is required for the steward target regression')

test('exact quick commands reject a Run replaced before target freeze', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agentanywhere-steward-target-'))
  const schema = `steward_target_${crypto.randomUUID().replaceAll('-', '')}`
  const admin = new SQL(databaseUrl)
  await admin.unsafe(`CREATE SCHEMA ${schema}`)
  const isolatedUrl = new URL(databaseUrl)
  isolatedUrl.searchParams.set('options', `-csearch_path=${schema}`)
  const app = await startServer({ password: 'test-password-12345', port: 0, dataDir, databaseUrl: isolatedUrl.toString() })
  const work = await createWorkStore(isolatedUrl.toString())
  const db = new SQL(isolatedUrl.toString())
  try {
    const taskId = crypto.randomUUID()
    const oldRunId = crypto.randomUUID()
    const currentRunId = crypto.randomUUID()
    await db`INSERT INTO work_tasks (id, owner_id, request_id, request_hash, goal, status)
      VALUES (${taskId}, 'owner', ${crypto.randomUUID()}, 'task', '精确 Run 绑定', 'queued')`
    await db`INSERT INTO work_threads (id, task_id) VALUES (${crypto.randomUUID()}, ${taskId})`
    const model = JSON.stringify({ id: 'target-model', protocol: 'chat-completions' })
    await db`INSERT INTO work_runs (id, task_id, status, model_snapshot, credential_ref, created_at, cleanup_state)
      VALUES (${oldRunId}, ${taskId}, 'failed', ${model}::text::jsonb, 'model-connection', now(), 'cleaned'),
        (${currentRunId}, ${taskId}, 'queued', ${model}::text::jsonb, 'model-connection', now() + interval '1 second', 'none')`

    const stewardThreadId = crypto.randomUUID()
    await db`INSERT INTO steward_threads (id, owner_id, request_id, request_hash, title)
      VALUES (${stewardThreadId}, 'owner', ${crypto.randomUUID()}, 'thread', '精确目标')`
    const controlTurnId = crypto.randomUUID()
    const controlOperationId = crypto.randomUUID()
    await db`INSERT INTO steward_turns (id, thread_id, request_id, request_hash, status, model_snapshot, credential_ref, active, active_since)
      VALUES (${controlTurnId}, ${stewardThreadId}, ${crypto.randomUUID()}, 'control-turn', 'running', ${model}::text::jsonb, 'model-connection', true, now())`
    await db`INSERT INTO steward_control_operations (turn_id, operation_id, request_hash, kind, query, status)
      VALUES (${controlTurnId}, ${controlOperationId}, 'control', 'cancel', ${taskId}, 'intent')`
    await expect(work.freezeStewardControl(controlTurnId, controlOperationId, taskId, oldRunId, Date.now))
      .rejects.toThrow('快捷操作指定的 Run 已被新的 Run 替代')
    expect((await db`SELECT status, task_id AS "taskId", run_id AS "runId" FROM steward_control_operations WHERE operation_id=${controlOperationId}`)[0])
      .toEqual({ status: 'intent', taskId: null, runId: null })

    await db`UPDATE steward_turns SET active=false, status='completed', active_since=NULL WHERE id=${controlTurnId}`
    await db`UPDATE work_runs SET status='failed', cleanup_state='cleaned' WHERE id=${currentRunId}`
    const retryTurnId = crypto.randomUUID()
    const retryOperationId = crypto.randomUUID()
    await db`INSERT INTO steward_turns (id, thread_id, request_id, request_hash, status, model_snapshot, credential_ref, active, active_since)
      VALUES (${retryTurnId}, ${stewardThreadId}, ${crypto.randomUUID()}, 'retry-turn', 'running', ${model}::text::jsonb, 'model-connection', true, now())`
    await db`INSERT INTO steward_retry_operations (turn_id, operation_id, request_id, request_hash, mode, query, status)
      VALUES (${retryTurnId}, ${retryOperationId}, ${crypto.randomUUID()}, 'retry', 'same', ${taskId}, 'intent')`
    await expect(work.freezeStewardRetry(retryTurnId, retryOperationId, taskId, oldRunId, Date.now))
      .rejects.toThrow('快捷操作指定的 Run 已被新的 Run 替代')
    expect((await db`SELECT status, task_id AS "taskId", source_run_id AS "sourceRunId" FROM steward_retry_operations WHERE operation_id=${retryOperationId}`)[0])
      .toEqual({ status: 'intent', taskId: null, sourceRunId: null })
  } finally {
    await work.close()
    await app.stop(true)
    await db.close()
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`)
    await admin.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})
