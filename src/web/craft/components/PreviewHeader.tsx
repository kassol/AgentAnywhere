/**
 * Adapted from packages/ui/src/components/ui/PreviewHeader.tsx in Craft Agents
 * OSS v0.13.3 at e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 *
 * AgentAnywhere keeps the original balanced header and badge structure. The
 * Electron traffic-light spacer is replaced by an optional left action, and
 * the close control uses the shared Button with an explicit Chinese label.
 */
import * as React from 'react'
import { X, type LucideIcon } from 'lucide-react'
import { cn } from '../lib/utils'
import { Button } from './Button'

export const PREVIEW_BADGE_VARIANTS = {
  edit: 'text-foreground/70',
  write: 'text-foreground/70',
  read: 'text-foreground/70',
  bash: 'text-foreground/70',
  grep: 'text-foreground/70',
  glob: 'text-foreground/70',
  blue: 'text-foreground/70',
  amber: 'text-foreground/70',
  orange: 'text-foreground/70',
  green: 'text-foreground/70',
  purple: 'text-foreground/70',
  gray: 'text-foreground/70',
  default: 'text-foreground/70',
} as const

export type PreviewBadgeVariant = keyof typeof PREVIEW_BADGE_VARIANTS

export interface PreviewHeaderBadgeProps {
  icon?: LucideIcon
  id?: string
  label: string
  variant?: PreviewBadgeVariant
  onClick?: () => void
  title?: string
  className?: string
  shrinkable?: boolean
}

export function PreviewHeaderBadge({
  icon: Icon,
  id,
  label,
  variant = 'default',
  onClick,
  title,
  className,
  shrinkable = false,
}: PreviewHeaderBadgeProps) {
  const variantClasses = PREVIEW_BADGE_VARIANTS[variant]
  const baseClasses = cn(
    'flex items-center gap-1.5 h-[26px] px-2.5 rounded-[6px] font-sans text-[13px] font-medium bg-background shadow-minimal',
    variantClasses,
    className,
  )

  if (onClick) {
    return (
      <Button
        id={id}
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClick}
        className={cn(baseClasses, 'min-w-0 cursor-pointer group')}
        title={title || label}
      >
        {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
        <span className="truncate group-hover:underline">{label}</span>
      </Button>
    )
  }

  return (
    <div id={id} className={cn(baseClasses, shrinkable ? 'min-w-0' : 'shrink-0')} title={title || label}>
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
      <span className="truncate">{label}</span>
    </div>
  )
}

export interface PreviewHeaderProps {
  children?: React.ReactNode
  onClose?: () => void
  leftActions?: React.ReactNode
  rightActions?: React.ReactNode
  height?: number
  className?: string
  style?: React.CSSProperties
}

export function PreviewHeader({
  children,
  onClose,
  leftActions,
  rightActions,
  height = 50,
  className,
  style,
}: PreviewHeaderProps) {
  return (
    <header
      className={cn('shrink-0 flex items-center justify-between px-3', className)}
      style={{ height, ...style }}
    >
      <div className="flex-1 min-w-[70px] flex items-center">{leftActions}</div>

      <div className="flex items-center gap-2 min-w-0">
        {children}
      </div>

      <div className="flex-1 min-w-[70px] flex items-center gap-2 justify-end">
        {rightActions}
        {onClose && (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={onClose}
            className={cn(
              'work-preview-close size-auto p-1.5 rounded-[6px] bg-background shadow-minimal cursor-pointer',
              'opacity-70 hover:opacity-100 transition-opacity',
            )}
            title="关闭预览（Esc）"
            aria-label="关闭报告"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
    </header>
  )
}
