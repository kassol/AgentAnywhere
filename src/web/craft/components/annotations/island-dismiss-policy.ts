/*
 * Adapted from packages/ui/src/components/annotations/island-dismiss-policy.ts in Craft Agents OSS v0.13.3 at
 * e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 * Local changes: none; copied with its original dismiss decision table.
 */
export type IslandOutsideDismissBehavior = 'back-or-close' | 'close-only'
export type IslandOutsideDismissAction = 'back' | 'close'

export interface ResolveIslandOutsideDismissActionOptions {
  isCompactView: boolean
  behavior: IslandOutsideDismissBehavior
}

export function resolveIslandOutsideDismissAction({
  isCompactView,
  behavior,
}: ResolveIslandOutsideDismissActionOptions): IslandOutsideDismissAction {
  if (behavior === 'close-only') {
    return 'close'
  }

  return isCompactView ? 'close' : 'back'
}
