import { describe, expect, test } from 'bun:test'
import {
  acceptComposerSubmission,
  attachComposerThread,
  changeComposerDraft,
  composerStorageKey,
  prepareComposerSubmission,
  readComposerState,
  rejectComposerSubmission,
  shouldSubmitComposerKey,
  writeComposerState,
  type ComposerState,
} from './Composer'

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
})

test('Enter submits while Shift+Enter and IME composition keep editing', () => {
  expect(shouldSubmitComposerKey({ key: 'Enter', shiftKey: false, metaKey: false, ctrlKey: false, isComposing: false })).toBe(true)
  expect(shouldSubmitComposerKey({ key: 'Enter', shiftKey: true, metaKey: false, ctrlKey: false, isComposing: false })).toBe(false)
  expect(shouldSubmitComposerKey({ key: 'Enter', shiftKey: false, metaKey: false, ctrlKey: false, isComposing: true })).toBe(false)
  expect(shouldSubmitComposerKey({ key: 'Enter', keyCode: 229, shiftKey: false, metaKey: false, ctrlKey: false, isComposing: false })).toBe(false)
})
