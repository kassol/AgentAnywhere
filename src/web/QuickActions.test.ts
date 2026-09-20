import { describe, expect, test } from 'bun:test'
import { quickActionCommand, quickActionIdentity, type QuickAction } from './QuickActions'

const taskId = '11111111-1111-4111-8111-111111111111'
const runId = '22222222-2222-4222-8222-222222222222'
const interactionId = '33333333-3333-4333-8333-333333333333'
const versionId = '44444444-4444-4444-8444-444444444444'
const operationId = '55555555-5555-4555-8555-555555555555'

describe('quick action commands', () => {
  test('matches the existing explicit authorization syntax', () => {
    const cases: [QuickAction, string][] = [
      [{ kind: 'append', taskId, runId }, `给工作 ${taskId} 追加要求：`],
      [{ kind: 'answer', taskId, interactionId }, `回答工作 ${taskId}：`],
      [{ kind: 'limit', taskId, interactionId, decision: 'continue' }, `继续工作 ${taskId}`],
      [{ kind: 'limit', taskId, interactionId, decision: 'finish' }, `结束工作 ${taskId}`],
      [{ kind: 'cancel', taskId, runId }, `取消工作 ${taskId}`],
      [{ kind: 'same-retry', taskId, sourceRunId: runId }, `同模型重试工作 ${taskId}`],
      [{ kind: 'replacement-retry', taskId, sourceRunId: runId, modelId: 'research-model' }, `把工作 ${taskId} 改用模型：research-model 重试`],
      [{ kind: 'revision', taskId, versionId }, `请修改工作 ${taskId} 的报告 ${versionId}：`],
      [{ kind: 'resume', operationId, action: '回答' }, `继续回答回执 ${operationId}`],
    ]

    for (const [action, expected] of cases) expect(quickActionCommand(action)).toBe(expected)
  })

  test('keeps the exact interaction identity visible while the command targets its task', () => {
    const action: QuickAction = { kind: 'answer', taskId, interactionId }

    expect(quickActionIdentity(action)).toBe('工作 11111111 · Interaction 33333333')
    expect(quickActionCommand(action)).toContain(taskId)
    expect(quickActionCommand(action)).not.toContain(interactionId)
  })
})
