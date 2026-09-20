import { expect, test } from 'bun:test'
import { persistSelectionWithDraftCleanup } from './selection-persistence'

test('draft cleanup retry updates the persisted annotation instead of adding a duplicate', () => {
  const persisted = new Set<string>()
  let rememberedId = ''
  let clearCalls = 0
  const callbacks = {
    annotationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    persist: (id: string) => { persisted.add(id); return true },
    rememberPersistedDraft: (id: string) => { rememberedId = id; return true },
    clearDraft: () => { clearCalls += 1; return clearCalls > 1 },
  }

  const first = persistSelectionWithDraftCleanup({ ...callbacks, persistedAnnotationId: null })
  expect(first).toEqual({ status: 'draft-clear-failed', persistedAnnotationId: callbacks.annotationId })
  expect(rememberedId).toBe(callbacks.annotationId)

  const retried = persistSelectionWithDraftCleanup({ ...callbacks, persistedAnnotationId: first.persistedAnnotationId })
  expect(retried).toEqual({ status: 'complete', persistedAnnotationId: null })
  expect([...persisted]).toEqual([callbacks.annotationId])
})

test('never writes an annotation until its stable identity is durable', () => {
  let persistCalls = 0
  const result = persistSelectionWithDraftCleanup({
    annotationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    persistedAnnotationId: null,
    rememberPersistedDraft: () => false,
    persist: () => { persistCalls += 1; return true },
    clearDraft: () => true,
  })

  expect(result).toEqual({ status: 'failed', persistedAnnotationId: null })
  expect(persistCalls).toBe(0)
})

test('retries an annotation write with the identity already stored in the draft', () => {
  const persistedIds: string[] = []
  let persistCalls = 0
  const callbacks = {
    annotationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    rememberPersistedDraft: (id: string) => { persistedIds.push(id); return true },
    persist: () => { persistCalls += 1; return persistCalls > 1 },
    clearDraft: () => true,
  }

  const first = persistSelectionWithDraftCleanup({ ...callbacks, persistedAnnotationId: null })
  const retried = persistSelectionWithDraftCleanup({ ...callbacks, persistedAnnotationId: first.persistedAnnotationId })
  expect(first).toEqual({ status: 'failed', persistedAnnotationId: callbacks.annotationId })
  expect(retried).toEqual({ status: 'complete', persistedAnnotationId: null })
  expect(persistedIds).toEqual([callbacks.annotationId, callbacks.annotationId])
})
