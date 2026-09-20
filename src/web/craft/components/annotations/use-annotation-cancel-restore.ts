/*
 * Adapted from packages/ui/src/components/annotations/use-annotation-cancel-restore.ts in Craft Agents OSS v0.13.3 at
 * e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 * Local changes: use local annotation types and selection restore helpers.
 */
import * as React from 'react'
import type { AnchoredSelection } from './interaction-state-machine'
import { scheduleDomSelectionRestore } from './selection-restore'

export interface UseAnnotationCancelRestoreOptions<T extends HTMLElement> {
  contentRootRef: React.RefObject<T | null>
  cancelFollowUp: () => { pendingSelection: AnchoredSelection | null }
}

export function useAnnotationCancelRestore<T extends HTMLElement>({
  contentRootRef,
  cancelFollowUp,
}: UseAnnotationCancelRestoreOptions<T>) {
  return React.useCallback(() => {
    const { pendingSelection } = cancelFollowUp()
    scheduleDomSelectionRestore(contentRootRef as { current: HTMLElement | null }, pendingSelection)
  }, [cancelFollowUp, contentRootRef])
}

