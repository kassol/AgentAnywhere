/**
 * Adapted from Craft Agents OSS v0.13.3 at e8963854c3679edcceb105a42537a06749e6cb64.
 * Original: apps/electron/src/renderer/components/settings/SettingsSection.tsx
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 * Local changes: use the local relative cn import.
 */
import * as React from 'react'
import { cn } from '../lib/utils'

export interface SettingsSectionProps {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  className?: string
  variant?: 'default' | 'danger'
  action?: React.ReactNode
}

export function SettingsSection({ title, description, children, className, variant = 'default', action }: SettingsSectionProps) {
  return <section className={cn('space-y-3', className)}>
    <div className="flex items-start justify-between gap-4 pl-1">
      <div className="space-y-0.5">
        <h3 className={cn('text-base font-semibold', variant === 'danger' && 'text-destructive')}>{title}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
    {children}
  </section>
}

export interface SettingsGroupProps { title: string; children: React.ReactNode; className?: string }
export function SettingsGroup({ title, children, className }: SettingsGroupProps) {
  return <div className={cn('space-y-6', className)}><h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pb-2 border-b border-border">{title}</h2><div className="space-y-8">{children}</div></div>
}

export function SettingsDivider({ className }: { className?: string }) {
  return <div className={cn('h-px bg-border', className)} />
}
