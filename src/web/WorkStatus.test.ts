import { describe, expect, test } from 'bun:test'
import { workStatusDefinition, workStatusLabel } from './WorkStatus'

describe('work status presentation', () => {
  test('uses the work lifecycle label for an active run', () => {
    expect(workStatusLabel('running')).toBe('执行中')
    expect(workStatusDefinition('running').label).not.toBe('回复中')
  })

  test('preserves an unknown server status for diagnosis', () => {
    expect(workStatusDefinition('future-status')).toEqual({ label: 'future-status', color: 'var(--muted)' })
  })
})
