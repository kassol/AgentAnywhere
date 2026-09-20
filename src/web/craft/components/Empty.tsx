/**
 * Adapted from apps/electron/src/renderer/components/ui/empty.tsx in Craft
 * Agents OSS v0.13.3 at e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 */
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/utils'

export function Empty({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="empty" className={cn(
    'flex min-w-0 flex-1 flex-col items-center justify-center gap-3 rounded-lg p-6 pb-[20%] text-center text-balance',
    className,
  )} {...props} />
}

export function EmptyHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="empty-header" className={cn('flex max-w-sm flex-col items-center gap-2 text-center', className)} {...props} />
}

const emptyMediaVariants = cva(
  "flex shrink-0 items-center justify-center mb-2 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        icon: "text-muted-foreground flex shrink-0 items-center justify-center [&_svg:not([class*='size-'])]:size-10 [&_svg]:stroke-[1.5]",
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export function EmptyMedia({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof emptyMediaVariants>) {
  return <div data-slot="empty-icon" data-variant={variant} className={cn(emptyMediaVariants({ variant, className }))} {...props} />
}

export function EmptyTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="empty-title" className={cn('text-sm font-medium tracking-tight', className)} {...props} />
}

export function EmptyDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="empty-description" className={cn(
    'text-muted-foreground [&>a:hover]:text-foreground text-xs/snug [&>a]:underline [&>a]:underline-offset-4',
    className,
  )} {...props} />
}

export function EmptyContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="empty-content" className={cn(
    'flex w-full max-w-sm min-w-0 flex-row items-center justify-center gap-3 mt-3 text-sm',
    className,
  )} {...props} />
}
