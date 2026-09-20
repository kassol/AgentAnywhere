/**
 * Adapted from apps/electron/src/renderer/components/ui/entity-row.tsx in
 * Craft Agents OSS v0.13.3 at e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 *
 * AgentAnywhere retains the original icon, title, subtitle, badges, trailing,
 * children and selection structure. Craft dropdown/context-menu, long-press
 * and multi-select dependencies are removed because work rows only navigate or
 * display persisted receipts. An href renders the original row surface as a
 * browser link so open-in-new-tab and copied-link behavior remain available.
 */
import * as React from 'react'
import { cn } from '../lib/utils'

export interface EntityRowProps {
  icon?: React.ReactNode
  title: React.ReactNode
  titleClassName?: string
  titleSuffix?: React.ReactNode
  subtitle?: React.ReactNode
  badges?: React.ReactNode
  trailing?: React.ReactNode
  children?: React.ReactNode
  overlay?: React.ReactNode
  href?: string
  isSelected?: boolean
  className?: string
  surfaceClassName?: string
  dataAttributes?: Record<string, string | undefined>
}

export function EntityRow({
  icon,
  title,
  titleClassName,
  titleSuffix,
  subtitle,
  badges,
  trailing,
  children,
  overlay,
  href,
  isSelected = false,
  className,
  surfaceClassName,
  dataAttributes,
}: EntityRowProps) {
  const content = <>
    <div className="flex flex-col gap-1.5 min-w-0 flex-1">
      <div className="flex items-center gap-[10px] w-full pr-1 min-w-0">
        {icon && <div className="shrink-0 flex items-center gap-[10px] [&>*]:w-3 [&>*]:h-3">{icon}</div>}
        <div className={cn('font-medium font-sans line-clamp-2 min-w-0 -mb-[2px]', titleClassName)}>{title}</div>
        {titleSuffix && <div className="shrink-0 self-center flex items-center">{titleSuffix}</div>}
      </div>
      {subtitle && <div className="flex items-start gap-[10px] w-full text-[12px] text-foreground/55 min-w-0 -mt-1">
        {icon && <div className="shrink-0 flex items-center gap-[10px] [&>*]:w-3 [&>*]:h-3 invisible" aria-hidden="true">{icon}</div>}
        <div className="min-w-0 flex-1 line-clamp-2 leading-[1.35]">{subtitle}</div>
      </div>}
      {(badges || trailing) && <div className="flex items-center gap-[10px] text-xs text-foreground/70 w-full -mb-[2px] min-w-0">
        {icon && <div className="shrink-0 flex items-center gap-[10px] [&>*]:w-3 [&>*]:h-3 invisible" aria-hidden="true">{icon}</div>}
        {badges && <div className="flex-1 flex items-center gap-1 min-w-0 overflow-x-auto scrollbar-hide">{badges}</div>}
        {trailing && <div className="shrink-0 flex items-center gap-1 ml-auto">{trailing}</div>}
      </div>}
    </div>
  </>

  return <div className={className} data-selected={isSelected || undefined} {...dataAttributes}>
    <div className="relative group select-none pl-2 mr-2">
      {isSelected && <div className="absolute left-0 inset-y-0 w-[2px] bg-accent" />}
      {href
        ? <a href={href} className={cn(
          'entity-row-btn flex w-full items-start gap-2 pl-2 pr-4 py-3 text-left text-sm outline-none rounded-[8px] no-underline text-foreground',
          'transition-[background-color] duration-75 focus-visible:ring-1 focus-visible:ring-ring',
          isSelected ? 'bg-foreground/3' : 'hover:bg-foreground/2',
          surfaceClassName,
        )}>{content}</a>
        : <div className={cn(
          'entity-row-btn flex w-full items-start gap-2 pl-2 pr-4 py-3 text-left text-sm rounded-[8px]',
          isSelected && 'bg-foreground/3',
          surfaceClassName,
        )}>{content}</div>}
      {children}
      {overlay}
    </div>
  </div>
}
