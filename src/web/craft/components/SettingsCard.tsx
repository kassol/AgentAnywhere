/**
 * Adapted from Craft Agents OSS v0.13.3 at e8963854c3679edcceb105a42537a06749e6cb64.
 * Original: apps/electron/src/renderer/components/settings/SettingsCard.tsx
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 * Local changes: use the local relative cn import.
 */
import * as React from 'react'
import { cn } from '../lib/utils'

export interface SettingsCardProps extends React.HTMLAttributes<HTMLDivElement> { divided?: boolean }
export function SettingsCard({ children, className, divided = true, ...props }: SettingsCardProps) {
  const childArray = React.Children.toArray(children).filter(Boolean)
  return <div className={cn('rounded-xl bg-background shadow-minimal overflow-hidden', className)} {...props}>
    {divided && childArray.length > 1 ? childArray.map((child, index) => <React.Fragment key={index}>{index > 0 && <div className="h-px bg-border/50 mx-4" />}{child}</React.Fragment>) : children}
  </div>
}

export function SettingsCardContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('px-4 py-3.5', className)}>{children}</div>
}

export function SettingsCardFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('px-4 py-3 border-t border-border/50 bg-muted/30 flex items-center justify-end gap-2', className)}>{children}</div>
}
