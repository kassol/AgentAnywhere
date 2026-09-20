/**
 * Adapted from apps/electron/src/renderer/components/app-shell/kanban/
 * StatusBadge.tsx in Craft Agents OSS v0.13.3 at
 * e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 *
 * The Craft SessionStatus dependency is replaced by its two rendered fields.
 */
import { cn } from '../lib/utils'

export interface StatusBadgeValue {
  label: string
  color: string
}

export function StatusBadge({ status, live = false, className }: { status: StatusBadgeValue; live?: boolean; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', className)}
    style={{ backgroundColor: `color-mix(in srgb, ${status.color} 12%, transparent)`, color: status.color }}>
    <span className="relative flex h-1.5 w-1.5 shrink-0">
      {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
        style={{ backgroundColor: status.color }} aria-hidden="true" />}
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.color }} aria-hidden="true" />
    </span>
    {status.label}
  </span>
}
