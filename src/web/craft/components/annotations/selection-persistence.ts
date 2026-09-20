/*
 * AgentAnywhere adapter for the Craft annotation callback boundary.
 * Persists a stable annotation identity before writing the annotation, then
 * keeps that identity while annotation or draft cleanup writes are retried.
 */
export type SelectionPersistenceResult =
  | { status: 'failed'; persistedAnnotationId: string | null }
  | { status: 'draft-clear-failed'; persistedAnnotationId: string }
  | { status: 'complete'; persistedAnnotationId: null }

export function persistSelectionWithDraftCleanup({
  annotationId,
  persistedAnnotationId,
  persist,
  rememberPersistedDraft,
  clearDraft,
}: {
  annotationId: string
  persistedAnnotationId: string | null
  persist: (annotationId: string) => boolean | void
  rememberPersistedDraft: (annotationId: string) => boolean | void
  clearDraft: () => boolean | void
}): SelectionPersistenceResult {
  const targetId = persistedAnnotationId ?? annotationId
  if (rememberPersistedDraft(targetId) === false) return { status: 'failed', persistedAnnotationId }

  if (persist(targetId) === false) return { status: 'failed', persistedAnnotationId: targetId }
  if (clearDraft() === false) return { status: 'draft-clear-failed', persistedAnnotationId: targetId }
  return { status: 'complete', persistedAnnotationId: null }
}
