import { expect, test } from 'bun:test'
import { receiptBelongsToTurn } from './StewardReceipts'

test('one receipt belongs to its original turn and every recorded resume turn', () => {
  const receipt = { turnId: 'original', resumeTurnIds: ['resume-1', 'resume-2'] }
  expect(receiptBelongsToTurn(receipt, 'original')).toBe(true)
  expect(receiptBelongsToTurn(receipt, 'resume-1')).toBe(true)
  expect(receiptBelongsToTurn(receipt, 'resume-2')).toBe(true)
  expect(receiptBelongsToTurn(receipt, 'other')).toBe(false)
})

test('work history renders each receipt once, with unbound operations retained in the turn', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { StewardReceipts } = await import('./StewardReceipts')
  const props = {
    research: [], interactions: [], retries: [], revisions: [], onFill() {},
    controls: [
      { operationId: 'bound-operation', turnId: 'original', resumeTurnIds: ['resume'], taskId: 'task-a', runId: 'run-a', kind: 'cancel' as const, status: 'accepted' },
      { operationId: 'unbound-operation', turnId: 'original', kind: 'cancel' as const, status: 'intent' },
    ],
  }
  const render = (scope: { taskId?: string; turnId?: string }) => renderToStaticMarkup(createElement(StewardReceipts, { ...props, ...scope }))
  expect(render({ taskId: 'task-a' })).toContain('bound-operation')
  expect(render({ taskId: 'task-a' })).not.toContain('unbound-operation')
  expect(render({ taskId: 'task-b' })).toBe('')
  expect(render({ turnId: 'original' })).toContain('unbound-operation')
  expect(render({ turnId: 'original' })).not.toContain('Operation bound-operation')
  expect(render({ turnId: 'resume' })).toBe('')
})
