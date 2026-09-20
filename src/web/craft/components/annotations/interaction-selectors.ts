/*
 * Adapted from packages/ui/src/components/annotations/interaction-selectors.ts in Craft Agents OSS v0.13.3 at
 * e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 * Local changes: none; copied with its original interaction selectors.
 */
import type { AnnotationInteractionState } from './interaction-state-machine'

export function getAnnotationInteractionSourceKey(state: AnnotationInteractionState, messageId?: string): string {
  const messageScope = messageId ?? 'no-message'

  if (state.pendingSelection) {
    return `selection:${messageScope}:${state.pendingSelection.start}:${state.pendingSelection.end}`
  }

  if (state.activeAnnotationDetail) {
    return `annotation:${messageScope}:${state.activeAnnotationDetail.annotationId}`
  }

  return `none:${messageScope}`
}

export function getAnnotationInteractionAnchor(state: AnnotationInteractionState): { x: number; y: number } | null {
  return state.selectionMenuAnchor
}

export function hasAnnotationInteraction(state: AnnotationInteractionState): boolean {
  return Boolean(state.pendingSelection || state.activeAnnotationDetail)
}
