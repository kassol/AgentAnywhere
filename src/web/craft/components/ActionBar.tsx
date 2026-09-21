/*
 * Adapted from AuthCardActions in
 * apps/electron/src/renderer/components/chat/AuthRequestCard.tsx in Craft
 * Agents OSS v0.13.3 at e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 *
 * The credential-specific primary/secondary model is replaced by children so
 * AgentAnywhere can render its exact authorization commands with Craft Button.
 */
import * as React from 'react'
import { cn } from '../lib/utils'

export interface ActionBarProps extends React.HTMLAttributes<HTMLDivElement> {
  hint?: React.ReactNode
}

export function ActionBar({ children, hint, className, ...props }: ActionBarProps) {
  return <div className={cn('flex items-center gap-2 px-3 py-2 border-t border-border/50', className)} {...props}>
    {children}
    {hint && <>
      <div className="flex-1" />
      <span className="text-xs text-muted-foreground">{hint}</span>
    </>}
  </div>
}
