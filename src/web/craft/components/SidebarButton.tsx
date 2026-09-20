/**
 * Adapted from apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx
 * lines 456-593 in Craft Agents OSS v0.13.3 at
 * e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 *
 * AgentAnywhere keeps the original icon/title/label structure and active/ghost
 * variants. Browser navigation uses an anchor so direct links, reload, history,
 * open-in-new-tab, and copied URLs retain their native behavior. Craft-only
 * expansion, drag overlay, context menu, and sortable branches are omitted.
 */
import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../lib/utils'

export interface SidebarLinkItem {
  id: string
  title: string
  href: string
  label?: string
  icon: LucideIcon | React.ReactNode
  iconColor?: string
  iconColorable?: boolean
  variant: 'default' | 'ghost'
  compact?: boolean
  dataTutorial?: string
}

export interface SidebarButtonProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  link: SidebarLinkItem
}

export const SidebarButton = React.forwardRef<HTMLAnchorElement, SidebarButtonProps>(
  ({ link, className: extraClassName, ...anchorProps }, forwardedRef) => (
    <a
      {...anchorProps}
      ref={forwardedRef}
      href={link.href}
      aria-current={link.variant === 'default' ? 'page' : undefined}
      data-sidebar-link="true"
      data-tutorial={link.dataTutorial}
      className={cn(
        'group flex w-full items-center gap-2 rounded-[6px] text-[13px] select-none outline-none no-underline',
        'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
        link.compact ? 'py-[3px]' : 'py-[5px]',
        'px-2',
        link.variant === 'default'
          ? 'bg-foreground/[0.07] text-foreground'
          : 'text-foreground/70 hover:bg-foreground/[0.02] hover:text-foreground',
        extraClassName,
      )}
    >
      <span className="sidebar-link-icon relative h-3.5 w-3.5 shrink-0 flex items-center justify-center">
        {renderIcon(link)}
      </span>
      <span className="sidebar-link-title min-w-0 flex-1 truncate">{link.title}</span>
      {link.label && (
        <span className="sidebar-link-label ml-auto shrink-0 text-[11px] text-foreground/50">
          {link.label}
        </span>
      )}
    </a>
  ),
)
SidebarButton.displayName = 'SidebarButton'

function renderIcon(link: SidebarLinkItem) {
  const isComponent = typeof link.icon === 'function'
    || (typeof link.icon === 'object' && link.icon !== null && 'render' in link.icon)
  const defaultColor = 'color-mix(in oklch, var(--foreground) 60%, transparent)'
  const applyColor = link.iconColorable !== false
  const colorStyle = applyColor ? { color: link.iconColor || defaultColor } : undefined

  if (isComponent) {
    const Icon = link.icon as React.ComponentType<{ className?: string; style?: React.CSSProperties }>
    return <Icon className="h-3.5 w-3.5 shrink-0" style={colorStyle} />
  }

  const iconElement = link.icon as React.ReactNode
  const bareIcon = React.isValidElement(iconElement)
    ? (typeof iconElement.type === 'function' && (iconElement.type as { acceptsBare?: boolean }).acceptsBare)
      ? React.cloneElement(iconElement as React.ReactElement<{ bare?: boolean }>, { bare: true })
      : iconElement
    : iconElement
  return (
    <span className="h-3.5 w-3.5 shrink-0 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full" style={colorStyle}>
      {bareIcon}
    </span>
  )
}
