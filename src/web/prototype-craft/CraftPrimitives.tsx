// PROTOTYPE ONLY. Adapted from Craft Agents OSS at e8963854c3679edcceb105a42537a06749e6cb64.
// Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
import type { HTMLAttributes, ReactNode } from 'react'

export function CraftSpinner({ label = '正在处理', className = '' }: { label?: string; className?: string }) {
  return (
    <span className={`craft-spinner ${className}`.trim()} role="status" aria-label={label}>
      {Array.from({ length: 9 }, (_, index) => <span className="craft-spinner-cube" key={index} />)}
    </span>
  )
}

export function CraftSurface({
  kind = 'tool',
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { kind?: 'input' | 'tool'; children: ReactNode }) {
  return (
    <div className={`craft-surface craft-surface-${kind} ${className}`.trim()} {...props}>
      {children}
    </div>
  )
}
