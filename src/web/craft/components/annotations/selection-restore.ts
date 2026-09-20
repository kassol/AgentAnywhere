/*
 * Adapted from packages/ui/src/components/annotations/selection-restore.ts in Craft Agents OSS v0.13.3 at
 * e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 * Local change: import range resolution from the locally copied annotation core.
 */
import { resolveRangeFromOffsets } from './annotation-core'

export type RestorableTextSelection = {
  start: number
  end: number
}

export function restoreDomSelectionFromOffsets(
  root: HTMLElement,
  start: number,
  end: number,
): boolean {
  const range = resolveRangeFromOffsets(root, start, end)
  if (!range) return false

  const selection = window.getSelection()
  if (!selection) return false

  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

export function restoreDomSelection(
  root: HTMLElement,
  selection: RestorableTextSelection | null | undefined,
): boolean {
  if (!selection) return false
  return restoreDomSelectionFromOffsets(root, selection.start, selection.end)
}

export function clearDomSelection(): void {
  if (typeof window === 'undefined') return
  window.getSelection()?.removeAllRanges()
}

export function scheduleDomSelectionRestore(
  rootRef: { current: HTMLElement | null },
  selection: RestorableTextSelection | null | undefined,
): void {
  if (!selection || typeof window === 'undefined') {
    return
  }

  window.requestAnimationFrame(() => {
    const root = rootRef.current
    if (!root) return
    restoreDomSelection(root, selection)
  })
}
