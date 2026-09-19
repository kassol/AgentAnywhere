import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SQL } from 'bun'
import { startServer } from './server'

const databaseUrl = process.env.AGENTANYWHERE_TEST_DATABASE_URL
if (!databaseUrl) throw new Error('AGENTANYWHERE_TEST_DATABASE_URL is required for the steward summary regression')

function toolResponse(model: string, name: string, args: unknown) {
  const common = { id: crypto.randomUUID(), object: 'chat.completion.chunk', created: 1, model }
  return new Response([
    `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call_${crypto.randomUUID()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}`,
    'data: [DONE]', '',
  ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } })
}

function textResponse(model: string, content: string) {
  const common = { id: crypto.randomUUID(), object: 'chat.completion.chunk', created: 1, model }
  return new Response([
    `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}`,
    'data: [DONE]', '',
  ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } })
}

test('the eighth model response cannot start a new tool operation', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agentanywhere-steward-budget-'))
  const schema = `steward_budget_${crypto.randomUUID().replaceAll('-', '')}`
  const admin = new SQL(databaseUrl)
  await admin.unsafe(`CREATE SCHEMA ${schema}`)
  const isolatedUrl = new URL(databaseUrl)
  isolatedUrl.searchParams.set('options', `-csearch_path=${schema}`)
  let taskId = ''
  let modelCalls = 0
  const upstream = Bun.serve({ port: 0, async fetch(request) {
    const body = await request.json() as any
    const names = (body.tools ?? []).map((tool: any) => tool.function?.name)
    if (!names.includes('find_work_candidates')) return textResponse(body.model, '未执行新的工作操作。')
    modelCalls++
    if (modelCalls < 8) return toolResponse(body.model, 'find_work_candidates', { purpose: 'read', query: taskId, cursor: 0 })
    return toolResponse(body.model, 'freeze_work_selection', { purpose: 'read', taskIds: [taskId], versionIds: [] })
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
    await send('/api/model-connection/models', 'PUT', {
      defaultModel: 'budget-model', stewardModel: { modelId: 'budget-model', protocol: 'chat-completions' }, researchModelPool: [],
      models: [{ id: 'budget-model', protocol: 'chat-completions', contextWindow: 128000, maxTokens: 4096, input: ['text'], reasoning: false, tools: true }],
    })
    const task = await (await send('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: '预算边界目标', modelId: 'budget-model' })).json()
    taskId = task.id
    const thread = await (await send('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })).json()
    await send(`/api/steward/threads/${thread.id}/turns`, 'POST', { requestId: crypto.randomUUID(), content: `读取工作 ${taskId}` })
    let detail: any
    for (let attempt = 0; attempt < 200; attempt++) {
      detail = await (await send(`/api/steward/threads/${thread.id}`)).json()
      if (!['queued', 'running'].includes(detail.turns[0]?.status)) break
      await Bun.sleep(20)
    }
    expect(modelCalls).toBe(8)
    expect(detail.turns[0]).toMatchObject({ status: 'limited', budgetReason: 'calls', modelCalls: 8 })
    expect(detail.relatedTasks).toEqual([])
  } finally {
    await app.stop(true)
    upstream.stop(true)
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`)
    await admin.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('a long steward conversation exposes a summary while retaining original messages and live work state', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agentanywhere-steward-summary-'))
  const schema = `steward_summary_${crypto.randomUUID().replaceAll('-', '')}`
  const admin = new SQL(databaseUrl)
  await admin.unsafe(`CREATE SCHEMA ${schema}`)
  const isolatedUrl = new URL(databaseUrl)
  isolatedUrl.searchParams.set('options', `-csearch_path=${schema}`)
  let taskId = ''
  let failSummary = false
  let oversizedSummary = false
  let summaryCalls = 0
  const summaryText = '较早讨论摘要：目标 SUMMARY_GOAL；约束 SUMMARY_CONSTRAINT；关联工作保持原 ID；待处理 SUMMARY_PENDING。'
  const upstream = Bun.serve({ port: 0, async fetch(request) {
    const body = await request.json() as any
    const messages = body.messages ?? []
    const system = messages.filter((message: any) => message.role === 'system').map((message: any) => message.content).join('\n')
    const tools = (body.tools ?? []).map((tool: any) => tool.function)
    const names = tools.map((tool: any) => tool.name)
    const results = messages.filter((message: any) => message.role === 'tool')
    const user = JSON.stringify(messages.filter((message: any) => message.role === 'user').at(-1)?.content ?? '')
    if (system.includes('对话摘要器')) {
      summaryCalls++
      if (failSummary) return new Response('summary unavailable', { status: 500 })
      return textResponse(body.model, oversizedSummary ? 'x'.repeat(4000) : summaryText)
    }
    if (names.includes('find_work_candidates') && user.includes('LINK_TASK')) {
      if (!results.length) return toolResponse(body.model, 'find_work_candidates', { purpose: 'read', query: taskId, cursor: 0 })
      return toolResponse(body.model, 'freeze_work_selection', { purpose: 'read', taskIds: [taskId], versionIds: [] })
    }
    if (names.includes('read_frozen_work')) {
      if (!results.length) return toolResponse(body.model, 'read_frozen_work', { operationId: tools.find((tool: any) => tool.name === 'read_frozen_work').parameters.properties.operationId.const })
      return textResponse(body.model, '工作当前状态来自服务端读取。')
    }
    if (system.includes('受限意图规划器')) return textResponse(body.model, '当前消息无需工作操作。')
    return textResponse(body.model, '已记录本轮讨论。')
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
    await send('/api/model-connection/models', 'PUT', {
      defaultModel: 'summary-model', stewardModel: { modelId: 'summary-model', protocol: 'chat-completions' }, researchModelPool: [],
      models: [{ id: 'summary-model', protocol: 'chat-completions', contextWindow: 6000, maxTokens: 1000, input: ['text'], reasoning: false, tools: true }],
    })
    const task = await (await send('/api/tasks', 'POST', { requestId: crypto.randomUUID(), goal: 'SUMMARY_GOAL 当前事实样本', modelId: 'summary-model' })).json()
    taskId = task.id
    const ask = async (threadId: string, content: string) => {
      await send(`/api/steward/threads/${threadId}/turns`, 'POST', { requestId: crypto.randomUUID(), content })
      let detail: any
      for (let attempt = 0; attempt < 250; attempt++) {
        detail = await (await send(`/api/steward/threads/${threadId}`)).json()
        if (!['queued', 'running'].includes(detail.turns.at(-1)?.status)) return detail
        await Bun.sleep(20)
      }
      throw new Error('steward turn timed out')
    }
    const decoy = await (await send('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })).json()
    await ask(decoy.id, '占用全局轮次序号')
    const thread = await (await send('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })).json()
    const original = [
      `SUMMARY_GOAL ${'a'.repeat(14000)}`,
      `SUMMARY_CONSTRAINT ${'b'.repeat(14000)}`,
      `SUMMARY_PENDING ${'c'.repeat(14000)}`,
    ]
    let detail: any
    for (const content of original) detail = await ask(thread.id, content)
    expect(detail.summaries[0].content).toBe(summaryText)
    expect(detail.summaries[0]).toMatchObject({ fromTurnNumber: 1, throughTurnNumber: 2, coveredTurns: 2 })
    expect(detail.summaries[0].fromTurnSeq > detail.summaries[0].fromTurnNumber).toBe(true)
    expect(summaryCalls).toBe(2)
    expect(detail.turns.at(-1).modelCalls).toBe(3)
    for (const content of original) expect(detail.messages.some((message: any) => message.role === 'user' && message.content === content)).toBe(true)
    detail = await ask(thread.id, `LINK_TASK：读取工作 ${taskId}`)
    expect((await send(`/api/tasks/${taskId}/cancel`, 'POST')).status).toBe(202)
    detail = await (await send(`/api/steward/threads/${thread.id}`)).json()
    expect(detail.relatedTasks).toMatchObject([{ id: taskId, status: 'cancelled' }])
    failSummary = true
    const failedMessage = `FAIL_SUMMARY ${'d'.repeat(14000)}`
    detail = await ask(thread.id, failedMessage)
    expect(detail.turns.at(-1)).toMatchObject({ status: 'failed', failure: '对话摘要失败，原文已保留' })
    expect(detail.summaries).toHaveLength(1)
    expect(detail.messages.some((message: any) => message.role === 'user' && message.content === failedMessage)).toBe(true)
    failSummary = false
    oversizedSummary = true
    const oversizedThread = await (await send('/api/steward/threads', 'POST', { requestId: crypto.randomUUID() })).json()
    const oversizedOriginal = [`OVERSIZED_OLD ${'e'.repeat(14000)}`, `OVERSIZED_CURRENT ${'f'.repeat(14000)}`]
    await ask(oversizedThread.id, oversizedOriginal[0])
    detail = await ask(oversizedThread.id, oversizedOriginal[1])
    expect(detail.turns.at(-1)).toMatchObject({ status: 'failed', failure: '对话摘要后仍超过模型上下文限制，原文已保留', modelCalls: 1 })
    expect(detail.summaries).toEqual([])
    for (const content of oversizedOriginal) expect(detail.messages.some((message: any) => message.role === 'user' && message.content === content)).toBe(true)
  } finally {
    await app.stop(true)
    upstream.stop(true)
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`)
    await admin.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})
