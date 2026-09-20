import { describe, expect, test } from 'bun:test'
import {
  annotationStorageKey,
  buildReviewCommand,
  clearAcceptedAnnotations,
  createTextSelector,
  filterReviewContextForContent,
  latestSucceededReportVersion,
  readReportAnnotations,
  selectorStatus,
  writeReportAnnotations,
  type ReportAnnotation,
} from './ReviewAnnotations'

const taskId = '11111111-1111-4111-8111-111111111111'
const versionId = '22222222-2222-4222-8222-222222222222'
const otherVersion = '33333333-3333-4333-8333-333333333333'
const annotation = (id: string, note: string, updatedAt = 2): ReportAnnotation => ({
  id, taskId, versionId, quote: '重复原文', note,
  selector: { type: 'text-quote', exact: '重复原文', prefix: '甲', suffix: '乙', start: 1, end: 5 },
  createdAt: 1, updatedAt,
})

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

describe('report annotation drafts', () => {
  test('isolates immutable report versions and never relocates a stale or repeated quote', () => {
    const storage = memoryStorage()
    writeReportAnnotations(taskId, versionId, [annotation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '意见 A')], storage)
    writeReportAnnotations(taskId, otherVersion, [], storage)
    expect(annotationStorageKey(taskId, versionId)).not.toBe(annotationStorageKey(taskId, otherVersion))
    expect(readReportAnnotations(taskId, versionId, storage)).toHaveLength(1)
    expect(selectorStatus('甲重复原文乙，另有重复原文', createTextSelector('甲重复原文乙，另有重复原文', 1, 5))).toBe('exact')
    expect(selectorStatus('重复原文，另有重复原文', createTextSelector('甲重复原文乙，另有重复原文', 1, 5))).toBe('stale')
  })

  test('keeps review identity through editing and filters annotations removed from actual content', () => {
    const first = annotation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '意见 A')
    const second = annotation('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '意见 B')
    const built = buildReviewCommand(taskId, versionId, [first, second])
    expect(built.content).toContain(`请修改工作 ${taskId} 的报告 ${versionId}：`)
    expect(filterReviewContextForContent(built.review, built.content)?.annotations).toHaveLength(2)
    const edited = built.content.replace(/\n\[批注 bbbbbbbb[\s\S]*$/, '')
    expect(filterReviewContextForContent(built.review, edited)?.annotations?.map(item => item.id)).toEqual([first.id])
    expect(filterReviewContextForContent(built.review, '普通消息')).toBeUndefined()
  })

  test('clears only represented unchanged annotations after acceptance', () => {
    const storage = memoryStorage()
    const first = annotation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '意见 A')
    const second = annotation('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '意见 B', 3)
    const built = buildReviewCommand(taskId, versionId, [first, second])
    writeReportAnnotations(taskId, versionId, [first, { ...second, note: '发送期间的新编辑', updatedAt: 4 }], storage)
    writeReportAnnotations(taskId, otherVersion, [{ ...first, versionId: otherVersion }], storage)
    clearAcceptedAnnotations(built.review, built.content, storage)
    expect(readReportAnnotations(taskId, versionId, storage).map(item => item.id)).toEqual([second.id])
    expect(readReportAnnotations(taskId, otherVersion, storage)).toHaveLength(1)
  })

  test('finds the latest successful report without rewriting the requested version', () => {
    expect(latestSucceededReportVersion([
      { kind: 'report', runStatus: 'failed', versionId: 'failed' },
      { kind: 'report', runStatus: 'succeeded', versionId: 'latest' },
      { kind: 'report', runStatus: 'succeeded', versionId },
    ])).toBe('latest')
  })
})
