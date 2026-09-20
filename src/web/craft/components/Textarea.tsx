/**
 * Adapted from apps/electron/src/renderer/components/ui/textarea.tsx in Craft
 * Agents OSS v0.13.3 at e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 * Local changes: use the local relative cn import and forward refs explicitly
 * for this project's React 18 runtime.
 */
import * as React from 'react'
import { cn } from '../lib/utils'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentPropsWithoutRef<'textarea'>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} data-slot="textarea" className={cn(
    'border-foreground/15 placeholder:text-muted-foreground focus-visible:border-foreground/30 focus-visible:ring-foreground/15 aria-invalid:ring-destructive/20 aria-invalid:border-destructive flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
    className,
  )} {...props} />
})
