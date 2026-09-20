import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SQL } from 'bun'
import { startServer } from './server'

const databaseUrl = process.env.AGENTANYWHERE_TEST_DATABASE_URL
if (!databaseUrl) throw new Error('AGENTANYWHERE_TEST_DATABASE_URL is required for the steward revision regression')

const taskId = 'aeed38de-126f-453e-a8d8-5dc0669dab41'
const versionId = '5ada816c-e468-4937-865b-73d980c5434a'
const revisionContent = `请按以下批注修改报告；引用只用于定位原文。

[批注 714bdf81-79e3-482c-8ef7-8c28d00ae55d]
引用：
> 成果交付检查
> 
> 成果可直接打开，中文表述清晰，标题、结论与操作步骤易读。
意见：在第二节末尾补充“每次修改均可回看来源版本。”，保留其他内容，直接提交新版，无需再次提问或联网。`
const command = `请修改工作 ${taskId} 的报告 ${versionId}：\n${revisionContent}`

function textResponse(model: string, responses: boolean) {
  if (responses) {
    const item = { id: crypto.randomUUID(), type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '已处理。', annotations: [] }] }
    return new Response([
      `data: ${JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } })}`,
      `data: ${JSON.stringify({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: '已处理。' })}`,
      `data: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item })}`,
      `data: ${JSON.stringify({ type: 'response.completed', response: { id: crypto.randomUUID(), status: 'completed', output: [item], usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } } })}`, '',
    ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } })
  }
  const common = { id: crypto.randomUUID(), object: 'chat.completion.chunk', created: 1, model }
  return new Response([
    `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: 'assistant', content: '已处理。' }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}`,
    'data: [DONE]', '',
  ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } })
}

function toolResponse(model: string, responses: boolean, args: unknown) {
  if (responses) {
    const item = { id: crypto.randomUUID(), type: 'function_call', call_id: crypto.randomUUID(), name: 'freeze_report_revision', arguments: JSON.stringify(args), status: 'completed' }
    return new Response([
      `data: ${JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } })}`,
      `data: ${JSON.stringify({ type: 'response.function_call_arguments.delta', output_index: 0, delta: item.arguments })}`,
      `data: ${JSON.stringify({ type: 'response.function_call_arguments.done', output_index: 0, arguments: item.arguments })}`,
      `data: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item })}`,
      `data: ${JSON.stringify({ type: 'response.completed', response: { id: crypto.randomUUID(), status: 'completed', output: [item], usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } } })}`, '',
    ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } })
  }
  const common = { id: crypto.randomUUID(), object: 'chat.completion.chunk', created: 1, model }
  return new Response([
    `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: crypto.randomUUID(), type: 'function', function: { name: 'freeze_report_revision', arguments: JSON.stringify(args) } }] }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}`,
    'data: [DONE]', '',
  ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } })
}

test('canonical report revisions force the first planner tool in both protocols', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agentanywhere-steward-revision-entry-'))
  const schema = `steward_revision_entry_${crypto.randomUUID().replaceAll('-', '')}`
  const admin = new SQL(databaseUrl)
  await admin.unsafe(`CREATE SCHEMA ${schema}`)
  const isolatedUrl = new URL(databaseUrl)
  isolatedUrl.searchParams.set('options', `-csearch_path=${schema}`)
  const plannerRequests: any[] = []
  const upstream = Bun.serve({ port: 0, async fetch(request) {
    const body = await request.json() as any
    const responses = request.url.endsWith('/responses')
    if (body.max_tokens === 64 || body.max_completion_tokens === 64 || body.max_output_tokens === 64) return textResponse(body.model, responses)
    const messages = responses ? body.input ?? [] : body.messages ?? []
    const text = (content: any) => typeof content === 'string' ? content
      : (content ?? []).filter((part: any) => ['text', 'input_text', 'output_text'].includes(part.type)).map((part: any) => part.text).join('')
    const system = [body.instructions ?? '', ...messages.filter((message: any) => ['system', 'developer'].includes(message.role)).map((message: any) => text(message.content))].join('\n')
    const planner = system.includes('受限意图规划器')
    if (planner) plannerRequests.push(body)
    const forcedName = responses ? body.tool_choice?.name : body.tool_choice?.function?.name
    const outputs = responses ? (body.input ?? []).filter((item: any) => item.type === 'function_call_output')
      : (body.messages ?? []).filter((message: any) => message.role === 'tool')
    if (planner && !outputs.length && forcedName === 'freeze_report_revision') {
      return toolResponse(body.model, responses, { query: taskId, content: revisionContent, modelId: body.model, reason: '使用当前有效人工模型池生成新版。' })
    }
    return textResponse(body.model, responses)
  } })
  const password = 'test-password-12345'
  const app = await startServer({ password, port: 0, dataDir, databaseUrl: isolatedUrl.toString() })
  try {
    const login = await fetch(`${app.url.origin}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
    const cookie = login.headers.get('set-cookie')!
    const send = (path: string, method = 'GET', body?: unknown) => fetch(`${app.url.origin}${path}`, {
      method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    })
    await send('/api/model-connection', 'PUT', { endpoint: `${upstream.url.origin}/v1`, apiKey: 'fixture-key' })
    for (const protocol of ['chat-completions', 'responses'] as const) {
      const modelId = `revision-${protocol}`
      await send('/api/model-connection/models', 'PUT', {
        defaultModel: modelId, stewardModel: { modelId, protocol }, researchModelPool: [modelId],
        models: [{ id: modelId, protocol, contextWindow: 128000, maxTokens: 4096, input: ['text'], reasoning: false, tools: true }],
      })
      const thread = await (await send('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })).json()
      await send(`/api/steward/threads/${thread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content: command })
      let detail: any
      for (let index = 0; index < 150; index++) {
        detail = await (await send(`/api/steward/threads/${thread.id}`)).json()
        if (!['queued', 'running', 'stopping'].includes(detail.turns[0]?.status)) break
        await Bun.sleep(20)
      }
      expect(detail.turns[0].status).toBe('completed')
      expect(detail.revisionOperations).toHaveLength(1)
      expect(detail.revisionOperations[0]).toMatchObject({ content: revisionContent, modelId, protocol, status: 'unexecuted' })
    }
    expect(plannerRequests.map(body => body.tool_choice)).toContainEqual({ type: 'function', function: { name: 'freeze_report_revision' } })
    expect(plannerRequests.map(body => body.tool_choice)).toContainEqual({ type: 'function', name: 'freeze_report_revision' })
  } finally {
    await app.stop(true)
    upstream.stop(true)
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`)
    await admin.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})
