import { describe, expect, test } from 'bun:test'
import { buildToolActivities, readActivityPages, summarizeToolActivity, type ActivityEvent } from './ActivityFeed'

const event = (serverSeq: number, type: string, payload: Record<string, unknown>, turnId = 'turn-1'): ActivityEvent => ({
  serverSeq, turnId, type, payload, occurredAt: `2026-09-20T00:00:0${serverSeq}Z`,
})

describe('buildToolActivities', () => {
  test('merges duplicate and late tool facts within their real turn', () => {
    const activities = buildToolActivities([
      event(1, 'tool.completed', { toolCallId: 'late', name: 'read', result: 'late result', isError: false }),
      event(2, 'tool.started', { toolCallId: 'search', name: 'search_web', args: { query: 'R3' } }),
      event(3, 'tool.started', { toolCallId: 'search', name: 'search_web', args: { query: 'R3' } }),
      event(4, 'tool.completed', { toolCallId: 'search', name: 'search_web', result: '8 results', isError: false }),
      event(5, 'tool.completed', { toolCallId: 'search', name: 'search_web', result: '8 results', isError: false }),
      event(6, 'tool.completed', { toolCallId: 'search', name: 'search_web', result: 'failed', isError: true }, 'turn-2'),
    ])
    expect(activities).toEqual([
      expect.objectContaining({ id: 'turn-1:late', status: 'completed', result: 'late result', args: undefined }),
      expect.objectContaining({ id: 'turn-1:search', status: 'completed', args: { query: 'R3' }, result: '8 results' }),
      expect.objectContaining({ id: 'turn-2:search', status: 'error', result: 'failed' }),
    ])
  })

  test('reads every 500-event page without duplicating the cursor event', async () => {
    const all = Array.from({ length: 501 }, (_, index) => event(index + 1, 'assistant.delta', { delta: String(index) }))
    const calls: number[] = []
    const result = await readActivityPages(0, async after => {
      calls.push(after)
      return all.filter(item => item.serverSeq > after).slice(0, 500)
    })
    expect(calls).toEqual([0, 500])
    expect(result.events).toHaveLength(501)
    expect(result.cursor).toBe(501)
  })

  test('summarizes a persisted Pi result without exposing its protocol wrapper', () => {
    const summary = summarizeToolActivity({ id: 'turn:call', scopeId: 'turn', name: 'create', status: 'completed',
      result: { content: [{ type: 'text', text: JSON.stringify({ security: 'server receipt', receipt: { status: 'accepted' } }) }], details: {} },
      occurredAt: '2026-09-20T00:00:00Z' })
    expect(summary).toBe('完成 · 状态：已接收')
  })
})
