import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SQL } from 'bun'
import { startServer } from './server'

const databaseUrl = process.env.AGENTANYWHERE_TEST_DATABASE_URL
if (!databaseUrl) throw new Error('AGENTANYWHERE_TEST_DATABASE_URL is required for the preview API regression')

test('one immutable report version has matching detail, content and download boundaries', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agentanywhere-preview-'))
  const schema = `preview_test_${crypto.randomUUID().replaceAll('-', '')}`
  const admin = new SQL(databaseUrl)
  await admin.unsafe(`CREATE SCHEMA ${schema}`)
  const isolatedUrl = new URL(databaseUrl)
  isolatedUrl.searchParams.set('options', `-csearch_path=${schema}`)
  const password = 'test-password-12345'
  const app = await startServer({ password, port: 0, dataDir, databaseUrl: isolatedUrl.toString() })
  try {
    const login = await fetch(`${app.url.origin}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
    const cookie = login.headers.get('set-cookie')!
    const send = (path: string, method = 'GET', body?: unknown) => fetch(`${app.url.origin}${path}`, {
      method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    })
    await send('/api/model-connection', 'PUT', { endpoint: 'https://models.example/v1', apiKey: 'preview-key' })
    await send('/api/model-connection/models', 'PUT', {
      defaultModel: 'preview-model',
      models: [{ id: 'preview-model', protocol: 'responses', contextWindow: 128000, maxTokens: 8192, input: ['text'], reasoning: false, tools: true }],
    })
    const task = await (await send('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '预览边界', modelId: 'preview-model' })).json()
    const versionId = crypto.randomUUID()
    const artifactId = crypto.randomUUID()
    const markdown = '# 固定版本\n\n同一内容。\n'
    const storageKey = `${task.run.id}/report.md`
    await mkdir(join(dataDir, 'artifacts', task.run.id), { recursive: true })
    await writeFile(join(dataDir, 'artifacts', storageKey), markdown)
    const db = new SQL(isolatedUrl.toString())
    await db`UPDATE work_runs SET status='succeeded', cleanup_state='cleaned', active=false WHERE id=${task.run.id}`
    await db`UPDATE work_tasks SET status='succeeded' WHERE id=${task.id}`
    await db`INSERT INTO work_artifacts (id, task_id, kind, name) VALUES (${artifactId}, ${task.id}, 'report', 'report.md')`
    await db`INSERT INTO work_artifact_versions (id, artifact_id, run_id, storage_key, sha256, size_bytes, mime_type)
      VALUES (${versionId}, ${artifactId}, ${task.run.id}, ${storageKey}, ${createHash('sha256').update(markdown).digest('hex')}, ${Buffer.byteLength(markdown)}, 'text/markdown')`
    await db.close()

    const detail = await (await send(`/api/tasks/${task.id}`)).json()
    expect(detail.artifacts).toMatchObject([{ versionId, runId: task.run.id, kind: 'report' }])
    const content = await send(`/api/artifacts/${versionId}/content`)
    const download = await send(`/api/artifacts/${versionId}/download`)
    expect((await content.json()).markdown).toBe(markdown)
    expect(await download.text()).toBe(markdown)
    expect((await send(`/api/artifacts/${crypto.randomUUID()}/content`)).status).toBe(404)
    expect((await fetch(`${app.url.origin}/api/artifacts/${versionId}/content`)).status).toBe(401)
  } finally {
    await app.stop(true)
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`)
    await admin.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})
