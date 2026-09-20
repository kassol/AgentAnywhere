import { expect, test } from 'bun:test'
import { receiptBelongsToTurn } from './StewardReceipts'

test('one receipt belongs to its original turn and every recorded resume turn', () => {
  const receipt = { turnId: 'original', resumeTurnIds: ['resume-1', 'resume-2'] }
  expect(receiptBelongsToTurn(receipt, 'original')).toBe(true)
  expect(receiptBelongsToTurn(receipt, 'resume-1')).toBe(true)
  expect(receiptBelongsToTurn(receipt, 'resume-2')).toBe(true)
  expect(receiptBelongsToTurn(receipt, 'other')).toBe(false)
})
