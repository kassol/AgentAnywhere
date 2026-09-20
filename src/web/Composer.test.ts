import { describe, expect, test } from 'bun:test'
import {
  acceptComposerSubmission,
  attachComposerThread,
  changeComposerDraft,
  composerStorageKey,
  confirmComposerReplacement,
  prepareComposerSubmission,
  readComposerState,
  rejectComposerSubmission,
  startComposerSubmission,
  shouldSubmitComposerKey,
  writeComposerState,
  type ComposerState,
} from './Composer'
import { buildReviewCommand, type ReportAnnotation } from './ReviewAnnotations'

const empty = (): ComposerState => ({ draft: { content: '', revision: 0 } })

describe('reliable composer state', () => {
  test('isolates drafts by conversation and keeps new-conversation separate', () => {
    expect(composerStorageKey(null)).not.toBe(composerStorageKey('515bd1e4-f388-4d4a-8b40-a0de2bdb1f6d'))
    expect(composerStorageKey('a')).not.toBe(composerStorageKey('b'))
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
    writeComposerState('a', changeComposerDraft(empty(), '对话 A 草稿'), storage)
    writeComposerState('b', changeComposerDraft(empty(), '对话 B 草稿'), storage)
    expect(readComposerState('a', storage).draft.content).toBe('对话 A 草稿')
    expect(readComposerState('b', storage).draft.content).toBe('对话 B 草稿')
  })

  test('retries the same submission and an old response cannot clear newer editing', () => {
    const edited = changeComposerDraft(empty(), '原消息')
    const prepared = prepareComposerSubmission(edited)
    expect(prepared?.pending).toMatchObject({ content: '原消息', draftRevision: 1 })
    expect(prepareComposerSubmission(prepared!)).toBe(prepared)

    const newer = changeComposerDraft(prepared!, '提交期间新增编辑')
    expect(acceptComposerSubmission(newer, prepared!.pending!)).toEqual({
      draft: { content: '提交期间新增编辑', revision: 2 },
    })
  })

  test('version preflight attaches the original submission without overwriting newer editing', () => {
    const original = changeComposerDraft(empty(), '原消息')
    const submission = prepareComposerSubmission(original)!.pending!
    const newer = changeComposerDraft(original, '预检期间新增编辑')
    const started = startComposerSubmission(newer, submission)
    expect(started).toMatchObject({ draft: { content: '预检期间新增编辑', revision: 2 }, pending: { content: '原消息', draftRevision: 1 } })
    expect(acceptComposerSubmission(started, submission)).toEqual({ draft: { content: '预检期间新增编辑', revision: 2 } })
  })

  test('fill actions require confirmation before replacing a non-empty draft', () => {
    const current = changeComposerDraft(empty(), '保留我')
    expect(confirmComposerReplacement(current, '快捷命令', () => false)).toBe(false)
    expect(confirmComposerReplacement(current, '快捷命令', () => true)).toBe(true)
    expect(confirmComposerReplacement(empty(), '快捷命令', () => false)).toBe(true)
  })

  test('persists the created thread for refresh checks and releases a definite rejection', () => {
    const prepared = prepareComposerSubmission(changeComposerDraft(empty(), '可更正消息'))!
    const attached = attachComposerThread(prepared, prepared.pending!, '515bd1e4-f388-4d4a-8b40-a0de2bdb1f6d')
    expect(attached).toMatchObject({
      threadId: '515bd1e4-f388-4d4a-8b40-a0de2bdb1f6d',
      pending: { threadId: '515bd1e4-f388-4d4a-8b40-a0de2bdb1f6d' },
    })
    expect(rejectComposerSubmission(attached, attached.pending!)).toEqual({
      threadId: '515bd1e4-f388-4d4a-8b40-a0de2bdb1f6d',
      draft: { content: '可更正消息', revision: 1 },
    })
  })

  test('clears only the unchanged draft accepted by the server', () => {
    const prepared = prepareComposerSubmission(changeComposerDraft(empty(), '已发送'))!
    expect(acceptComposerSubmission(prepared, prepared.pending!)).toEqual({ draft: { content: '', revision: 2 } })
  })

  test('carries only review annotations still represented in the submitted content', () => {
    const annotation: ReportAnnotation = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', taskId: '11111111-1111-4111-8111-111111111111',
      versionId: '22222222-2222-4222-8222-222222222222', quote: '原文', note: '修改意见',
      selector: { type: 'text-quote', exact: '原文', prefix: '', suffix: '', start: 0, end: 2 }, createdAt: 1, updatedAt: 2,
    }
    const built = buildReviewCommand(annotation.taskId, annotation.versionId, [annotation])
    const reviewDraft = changeComposerDraft(empty(), built.content, built.review)
    expect(prepareComposerSubmission(reviewDraft)?.pending?.review?.annotations?.map(item => item.id)).toEqual([annotation.id])
    expect(prepareComposerSubmission(changeComposerDraft(reviewDraft, '普通消息'))?.pending?.review).toBeUndefined()
  })
})

test('Enter submits while Shift+Enter and IME composition keep editing', () => {
  expect(shouldSubmitComposerKey({ key: 'Enter', shiftKey: false, metaKey: false, ctrlKey: false, isComposing: false })).toBe(true)
  expect(shouldSubmitComposerKey({ key: 'Enter', shiftKey: true, metaKey: false, ctrlKey: false, isComposing: false })).toBe(false)
  expect(shouldSubmitComposerKey({ key: 'Enter', shiftKey: false, metaKey: false, ctrlKey: false, isComposing: true })).toBe(false)
  expect(shouldSubmitComposerKey({ key: 'Enter', keyCode: 229, shiftKey: false, metaKey: false, ctrlKey: false, isComposing: false })).toBe(false)
})
