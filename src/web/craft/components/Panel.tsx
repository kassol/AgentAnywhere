/**
 * Adapted from apps/electron/src/renderer/components/app-shell/Panel.tsx in
 * Craft Agents OSS v0.13.3 at e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 *
 * AgentAnywhere adds a semantic `as` element so the browser shell keeps its
 * aside/main landmarks. Panel sizing and the original container structure stay
 * unchanged; the A shell continues to own the 252px layout and surfaces.
 */
import * as React from 'react'
import { cn } from '../lib/utils'

type PanelElement = 'div' | 'aside' | 'main' | 'section'

export interface PanelProps extends React.HTMLAttributes<HTMLElement> {
  as?: PanelElement
  variant?: 'shrink' | 'grow'
  width?: number
  children: React.ReactNode
}

export function Panel({
  as: Component = 'div',
  variant = 'grow',
  width,
  className,
  style,
  children,
  ...props
}: PanelProps) {
  return (
    <Component
      className={cn(
        'h-full flex flex-col min-w-0 overflow-hidden',
        variant === 'grow' && 'flex-1',
        variant === 'shrink' && 'shrink-0',
        className,
      )}
      style={{
        ...(variant === 'shrink' && width ? { width } : {}),
        ...style,
      }}
      {...props}
    >
      {children}
    </Component>
  )
}
