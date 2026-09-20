import { describe, expect, test } from 'bun:test'
import { createTextSelectionAnnotation } from './craft/components/annotations/annotation-core'
import { persistSelectionWithDraftCleanup } from './craft/components/annotations/selection-persistence'
import {
  annotationStorageKey,
  annotationDraftStorageKey,
  buildReviewCommand,
  captureTextControlSelection,
  clearAcceptedAnnotations,
  createTextSelector,
  filterReviewContextForContent,
  fromCraftAnnotation,
  isReviewContext,
  latestSucceededReportVersion,
  readReportAnnotations,
  readReportAnnotationDraft,
  selectorStatus,
  toCraftAnnotation,
  writeReportAnnotations,
  writeReportAnnotationDraft,
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

  test('maps a native text control selection to the report selector', () => {
    expect(captureTextControlSelection('前文可批注原文后文', 2, 7)).toMatchObject({ exact: '可批注原文', start: 2, end: 7 })
    expect(captureTextControlSelection('前文可批注原文后文', 2, 2)).toBeNull()
    expect(captureTextControlSelection('前文   后文', 2, 5)).toBeNull()
  })

  test('keeps Task and Version identity through the Craft annotation adapter', () => {
    const local = annotation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '意见 A')
    const craft = toCraftAnnotation(local)
    expect(craft.target.source).toEqual({ sessionId: taskId, messageId: versionId })
    expect(fromCraftAnnotation(taskId, versionId, craft)).toEqual(local)
  })

  test('persists a newly created Craft annotation through review context validation', () => {
    const storage = memoryStorage()
    const craft = createTextSelectionAnnotation(versionId, {
      start: 1,
      end: 5,
      selectedText: '重复原文',
      prefix: '甲',
      suffix: '乙',
    }, '意见 A', taskId)
    const local = fromCraftAnnotation(taskId, versionId, craft)

    expect(local).not.toBeNull()
    expect(local?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(writeReportAnnotations(taskId, versionId, [local!], storage)).toBe(true)
    const restored = readReportAnnotations(taskId, versionId, storage)
    expect(restored).toEqual([local!])
    const { review } = buildReviewCommand(taskId, versionId, restored)
    expect(isReviewContext(review)).toBe(true)
  })

  test('retries a failed annotation storage write with the UUID already stored in the real draft', () => {
    const stored = memoryStorage()
    let failAnnotationWrite = true
    const storage = {
      getItem: stored.getItem,
      removeItem: stored.removeItem,
      setItem: (key: string, value: string) => {
        if (failAnnotationWrite && key === annotationStorageKey(taskId, versionId)) throw new Error('unavailable')
        stored.setItem(key, value)
      },
    }
    const selection = { start: 1, end: 5, selectedText: '重复原文', prefix: '甲', suffix: '乙' }
    const craft = createTextSelectionAnnotation(versionId, selection, '意见 A', taskId)
    const callbacks = {
      annotationId: craft.id,
      rememberPersistedDraft: (id: string) => writeReportAnnotationDraft(taskId, versionId, {
        selector: createTextSelector('甲重复原文乙', 1, 5), note: '意见 A', persistedAnnotationId: id,
      }, storage),
      persist: (id: string) => {
        const local = fromCraftAnnotation(taskId, versionId, { ...craft, id })
        if (!local) return false
        const current = readReportAnnotations(taskId, versionId, storage)
        const next = current.some(item => item.id === id) ? current.map(item => item.id === id ? local : item) : [...current, local]
        return writeReportAnnotations(taskId, versionId, next, storage)
      },
      clearDraft: () => writeReportAnnotationDraft(taskId, versionId, null, storage),
    }

    const first = persistSelectionWithDraftCleanup({ ...callbacks, persistedAnnotationId: null })
    expect(first).toEqual({ status: 'failed', persistedAnnotationId: craft.id })
    expect(readReportAnnotationDraft(taskId, versionId, storage)?.persistedAnnotationId).toBe(craft.id)
    expect(readReportAnnotations(taskId, versionId, storage)).toEqual([])

    failAnnotationWrite = false
    expect(persistSelectionWithDraftCleanup({ ...callbacks, persistedAnnotationId: first.persistedAnnotationId })).toEqual({
      status: 'complete', persistedAnnotationId: null,
    })
    expect(readReportAnnotations(taskId, versionId, storage).map(item => item.id)).toEqual([craft.id])
    expect(readReportAnnotationDraft(taskId, versionId, storage)).toBeNull()
  })

  test('restores an unfinished selection and note only for its report version', () => {
    const storage = memoryStorage()
    const selector = createTextSelector('甲重复原文乙', 1, 5)
    writeReportAnnotationDraft(taskId, versionId, { selector, note: '尚未保存的意见' }, storage)
    expect(annotationDraftStorageKey(taskId, versionId)).not.toBe(annotationDraftStorageKey(taskId, otherVersion))
    expect(readReportAnnotationDraft(taskId, versionId, storage)).toEqual({ selector, note: '尚未保存的意见' })
    expect(readReportAnnotationDraft(taskId, otherVersion, storage)).toBeNull()
    writeReportAnnotationDraft(taskId, versionId, null, storage)
    expect(readReportAnnotationDraft(taskId, versionId, storage)).toBeNull()
  })

  test('restores the persisted annotation identity after draft cleanup fails', () => {
    const storage = memoryStorage()
    const selector = createTextSelector('甲重复原文乙', 1, 5)
    const persistedAnnotationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    writeReportAnnotationDraft(taskId, versionId, { selector, note: '已保存但清理失败', persistedAnnotationId }, storage)
    expect(readReportAnnotationDraft(taskId, versionId, storage)).toEqual({ selector, note: '已保存但清理失败', persistedAnnotationId })
  })

  test('reports unavailable storage so the editor can retain unsaved input', () => {
    const unavailable = {
      getItem: () => null,
      setItem: () => { throw new Error('unavailable') },
      removeItem: () => { throw new Error('unavailable') },
    }
    const selector = createTextSelector('甲重复原文乙', 1, 5)
    expect(writeReportAnnotationDraft(taskId, versionId, { selector, note: '保留我' }, unavailable)).toBe(false)
    expect(writeReportAnnotations(taskId, versionId, [annotation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '保留我')], unavailable)).toBe(false)
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
    writeReportAnnotationDraft(taskId, versionId, { selector: first.selector, note: first.note, persistedAnnotationId: first.id }, storage)
    writeReportAnnotations(taskId, otherVersion, [{ ...first, versionId: otherVersion }], storage)
    expect(clearAcceptedAnnotations(built.review, built.content, storage)).toBe(true)
    expect(readReportAnnotations(taskId, versionId, storage).map(item => item.id)).toEqual([second.id])
    expect(readReportAnnotationDraft(taskId, versionId, storage)).toBeNull()
    expect(readReportAnnotations(taskId, otherVersion, storage)).toHaveLength(1)
  })

  test('keeps accepted annotations visible when their storage cleanup fails', () => {
    const stored = memoryStorage()
    const first = annotation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '意见 A')
    const second = annotation('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '意见 B')
    const built = buildReviewCommand(taskId, versionId, [first])
    writeReportAnnotations(taskId, versionId, [first, second], stored)
    const unavailable = {
      getItem: stored.getItem,
      removeItem: stored.removeItem,
      setItem: (key: string, value: string) => {
        if (key === annotationStorageKey(taskId, versionId)) throw new Error('unavailable')
        stored.setItem(key, value)
      },
    }

    expect(clearAcceptedAnnotations(built.review, built.content, unavailable)).toBe(false)
    expect(readReportAnnotations(taskId, versionId, stored).map(item => item.id)).toEqual([first.id, second.id])
  })

  test('does not remove an accepted annotation when its matching persisted draft cannot be cleared', () => {
    const stored = memoryStorage()
    const first = annotation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '意见 A')
    const built = buildReviewCommand(taskId, versionId, [first])
    writeReportAnnotations(taskId, versionId, [first], stored)
    writeReportAnnotationDraft(taskId, versionId, { selector: first.selector, note: first.note, persistedAnnotationId: first.id }, stored)
    const unavailable = {
      getItem: stored.getItem,
      setItem: stored.setItem,
      removeItem: (key: string) => {
        if (key === annotationDraftStorageKey(taskId, versionId)) throw new Error('unavailable')
        stored.removeItem(key)
      },
    }

    expect(clearAcceptedAnnotations(built.review, built.content, unavailable)).toBe(false)
    expect(readReportAnnotations(taskId, versionId, stored)).toEqual([first])
    expect(readReportAnnotationDraft(taskId, versionId, stored)?.persistedAnnotationId).toBe(first.id)
  })

  test('finds the latest successful report without rewriting the requested version', () => {
    expect(latestSucceededReportVersion([
      { kind: 'report', runStatus: 'failed', versionId: 'failed' },
      { kind: 'report', runStatus: 'succeeded', versionId: 'latest' },
      { kind: 'report', runStatus: 'succeeded', versionId },
    ])).toBe('latest')
  })
})
