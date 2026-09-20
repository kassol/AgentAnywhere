/**
 * Adapted from apps/electron/src/renderer/components/app-shell/input/
 * structured/PermissionRequest.tsx in Craft Agents OSS v0.13.3 at
 * e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 *
 * Craft permission response types and i18next are replaced by AgentAnywhere's
 * persisted Interaction identity, question/limit content and existing action
 * callbacks. The source card, scrollable body and fixed action row remain.
 */
import * as React from 'react'
import { ShieldAlert } from 'lucide-react'
import { cn } from '../lib/utils'
import { ActionBar } from './ActionBar'

export interface PermissionRequestProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string
  identity: React.ReactNode
  description: React.ReactNode
  actions: React.ReactNode
  hint?: React.ReactNode
  unstyled?: boolean
}

export function PermissionRequest({ title, identity, description, actions, hint, unstyled = false, className, children, ...props }: PermissionRequestProps) {
  return <div className={cn(
    'overflow-hidden flex flex-col bg-info/5',
    unstyled ? 'border-0' : 'border border-info/30 rounded-[8px] shadow-middle',
    className,
  )} {...props}>
    <div className="p-4 space-y-3 flex-1 min-h-0 flex flex-col overflow-y-auto">
      <div className="space-y-2 pb-1">
        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <ShieldAlert className="h-3.5 w-3.5 text-info" aria-hidden="true" />
          <span>{title}</span>
        </div>
        <div className="text-xs leading-[18px] text-muted-foreground">
          <span className="font-medium text-foreground">目标：</span> {identity}
          <br />
          {description}
        </div>
      </div>
      {children}
    </div>
    <ActionBar className="shrink-0 flex-wrap" hint={hint}>{actions}</ActionBar>
  </div>
}
