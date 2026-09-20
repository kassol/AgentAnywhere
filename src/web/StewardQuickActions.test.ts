import { describe, expect, test } from 'bun:test'
import { quickActionCommand } from './QuickActions'
import { fillQuickCommand, relatedTaskQuickActions, statusCardQuickActions, type RelatedTask, type StatusCard } from './Steward'

const taskId = '11111111-1111-4111-8111-111111111111'
const runId = '22222222-2222-4222-8222-222222222222'
const interactionId = '33333333-3333-4333-8333-333333333333'
const versionId = '44444444-4444-4444-8444-444444444444'

function task(status: string): RelatedTask {
  return { id: taskId, goal: '调研主题', status, href: `/tasks/${taskId}`, runs: [{ id: runId, status }], reports: [] }
}

function card(overrides: Partial<StatusCard> = {}): StatusCard {
  return { id: `run:${runId}`, kind: 'failed', taskId, runId, goal: '调研主题', runStatus: 'failed', href: `/tasks/${taskId}`, reports: [], ...overrides }
}

describe('steward quick action mapping', () => {
  test('a running related work fills explicit append and cancel commands', () => {
    expect(relatedTaskQuickActions(task('running')).map(quickActionCommand)).toEqual([
      `给工作 ${taskId} 追加要求：`,
      `取消工作 ${taskId}`,
    ])
  })

  test('one pending question maps to the same interaction and task identity', () => {
    const actions = statusCardQuickActions(card({
      id: `interaction:${interactionId}`,
      kind: 'interaction',
      runStatus: 'waiting',
      interaction: { id: interactionId, kind: 'question', question: '需要哪种格式？', status: 'pending' },
    }), runId)

    expect(actions[0]).toEqual({ kind: 'answer', taskId, interactionId })
    expect(actions.map(quickActionCommand)).toEqual([`回答工作 ${taskId}：`, `取消工作 ${taskId}`])
  })

  test('limit choices, retry, and revision keep their exact targets', () => {
    const limit = statusCardQuickActions(card({
      id: `interaction:${interactionId}`,
      kind: 'interaction',
      runStatus: 'waiting',
      interaction: { id: interactionId, kind: 'limit', question: '是否继续？', status: 'pending' },
    }), runId)
    expect(limit.map(quickActionCommand)).toEqual([`继续工作 ${taskId}`, `结束工作 ${taskId}`, `取消工作 ${taskId}`])

    expect(statusCardQuickActions(card(), runId).map(quickActionCommand)).toEqual([`同模型重试工作 ${taskId}`])
    expect(statusCardQuickActions(card(), '99999999-9999-4999-8999-999999999999')).toEqual([])
    expect(statusCardQuickActions(card({ kind: 'completed', runStatus: 'succeeded', reports: [{ versionId, href: `/tasks/${taskId}?version=${versionId}` }] })).map(quickActionCommand))
      .toEqual([`请修改工作 ${taskId} 的报告 ${versionId}：`])
  })

  test('an answered interaction no longer exposes an answer action', () => {
    expect(statusCardQuickActions(card({
      id: `interaction:${interactionId}`,
      kind: 'interaction',
      runStatus: 'queued',
      interaction: { id: interactionId, kind: 'question', question: '需要哪种格式？', status: 'answered', answer: 'Markdown' },
    }))).toEqual([])
  })

  test('filling a command clears review context and retains an unresolved submission', () => {
    const pending = {
      content: '原请求', draftRevision: 4, threadRequestId: 'thread-request', turnRequestId: 'turn-request', threadId: 'thread-id',
    }
    const next = fillQuickCommand({
      threadId: 'thread-id',
      draft: { content: '批注汇总', revision: 5, review: { taskId, versionId, annotations: [{ id: interactionId, updatedAt: 1, quote: '原文' }] } },
      pending,
    }, `回答工作 ${taskId}：`)

    expect(next.pending).toBe(pending)
    expect(next.draft).toEqual({ content: `回答工作 ${taskId}：`, revision: 6 })
  })
})
