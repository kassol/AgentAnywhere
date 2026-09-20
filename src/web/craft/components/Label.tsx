/**
 * Adapted from Craft Agents OSS v0.13.3 at e8963854c3679edcceb105a42537a06749e6cb64.
 * Original: apps/electron/src/renderer/components/ui/label.tsx
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 * Local changes: use the local relative cn import.
 */
import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from '../lib/utils'

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root
    data-slot="label"
    className={cn('flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50', className)}
    {...props}
  />
}

export { Label }
