/*
 * Adapted from packages/ui/src/components/chat/UserMessageBubble.tsx in Craft
 * Agents OSS v0.13.3 at e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 *
 * Attachments, badges and Markdown are outside R4-02. AgentAnywhere keeps user
 * messages as literal text while retaining the original bubble JSX and spacing.
 */
import { Clock } from 'lucide-react'
import { cn } from '../lib/utils'

export interface UserMessageBubbleProps {
  content: string
  className?: string
  isQueued?: boolean
  compactMode?: boolean
}

export function UserMessageBubble({ content, className, isQueued = false, compactMode = false }: UserMessageBubbleProps) {
  return <div className={cn('flex flex-col items-end gap-3 w-full', className)}>
    <div className={cn(
      'max-w-[80%] bg-foreground/5 rounded-[16px] break-words min-w-0 select-text [&_p]:m-0',
      compactMode ? 'px-4 py-2' : 'px-5 py-3.5',
    )}>
      {isQueued && <div className="flex items-center gap-1.5 text-foreground/55 mb-1.5" role="status" aria-live="polite">
        <Clock className="h-3 w-3 animate-pulse" aria-hidden="true" />
        <span className="text-[11px] italic">排队中</span>
      </div>}
      <p className="text-sm whitespace-pre-wrap">{content}</p>
    </div>
  </div>
}
