/**
 * Adapted from Craft Agents OSS v0.13.3 at e8963854c3679edcceb105a42537a06749e6cb64.
 * Original: apps/electron/src/renderer/components/settings/SettingsRow.tsx
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 * Local changes: use local relative imports.
 */
import * as React from 'react'
import { cn } from '../lib/utils'
import { settingsUI } from './SettingsUIConstants'

export interface SettingsRowProps { label: React.ReactNode; description?: string; children?: React.ReactNode; onClick?: () => void; action?: React.ReactNode; className?: string; inCard?: boolean }
export function SettingsRow({ label, description, children, onClick, action, className, inCard = true }: SettingsRowProps) {
  const Component = onClick ? 'button' : 'div'
  return <Component type={onClick ? 'button' : undefined} onClick={onClick} data-layout="settings-row" className={cn('w-full flex items-center justify-between text-left', inCard ? 'px-4 py-3.5' : 'py-3', onClick && 'hover:bg-muted/70 transition-colors cursor-pointer', className)}>
    <div className="flex-1 min-w-0"><div className={settingsUI.label}>{label}</div>{description && <div className={cn(settingsUI.description, settingsUI.labelDescriptionGap, 'truncate')}>{description}</div>}</div>
    {(children || action) && <div data-layout="settings-control" className="flex items-center gap-3 ml-4 shrink-0">{children}{action}</div>}
  </Component>
}

export function SettingsRowLabel({ label, description, className }: { label: string; description?: string; className?: string }) {
  return <div className={cn(settingsUI.labelGroup, className)}><div className={settingsUI.label}>{label}</div>{description && <div className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>{description}</div>}</div>
}
