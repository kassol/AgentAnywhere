import { describe, expect, test } from 'bun:test'
import { resolveTextAnnotations } from './annotation-resolver'
import type { AnnotationV1 } from './types'

function annotation(selectors: AnnotationV1['target']['selectors']): AnnotationV1 {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', schemaVersion: 1, createdAt: 1,
    body: [{ type: 'highlight' }], target: { source: { sessionId: 'task', messageId: 'version' }, selectors },
  }
}

describe('report annotation resolution', () => {
  test('rejects a valid position whose immutable quote no longer matches', () => {
    const item = annotation([
      { type: 'text-position', start: 1, end: 5 },
      { type: 'text-quote', exact: '原始原文', prefix: '甲', suffix: '乙' },
    ])
    const result = resolveTextAnnotations('甲替换原文乙', [item])
    expect(result.resolved).toHaveLength(0)
    expect(result.unresolved[0]?.reason).toBe('invalid-position')
  })

  test('does not guess between repeated quotes without distinguishing context', () => {
    const item = annotation([{ type: 'text-quote', exact: '重复' }])
    const result = resolveTextAnnotations('重复，中间，重复', [item])
    expect(result.resolved).toHaveLength(0)
    expect(result.unresolved[0]?.reason).toBe('quote-not-found')
  })

  test('uses prefix and suffix to resolve one repeated quote', () => {
    const item = annotation([{ type: 'text-quote', exact: '重复', prefix: '甲', suffix: '乙' }])
    expect(resolveTextAnnotations('甲重复乙，丙重复丁', [item]).resolved[0]?.range).toEqual({ start: 1, end: 3 })
  })
})
