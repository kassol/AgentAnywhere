/**
 * Adapted from packages/ui/src/components/overlay/DocumentFormattedMarkdownOverlay.tsx
 * in Craft Agents OSS v0.13.3 at e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 *
 * AgentAnywhere renders the original document surface inside the A workspace's
 * right panel. Portal, Electron window controls, file actions, copy, and Craft's
 * annotation data is adapted at the WorkPreview boundary; the full-screen
 * min-height/vertical centering is removed for this embedded surface. The local
 * safe Markdown renderer and existing version-bound review controls are retained.
 */
import { useEffect, type ReactNode, type Ref } from 'react'
import { ListTodo } from 'lucide-react'
import { cn } from '../lib/utils'

export interface DocumentFormattedMarkdownOverlayProps {
  content: string
  isOpen: boolean
  onClose: () => void
  variant?: 'response' | 'plan'
  error?: string
  sessionId?: string
  messageId?: string
  renderMarkdown: (content: string) => ReactNode
  beforeContent?: ReactNode
  afterContent?: ReactNode
  documentRef?: Ref<HTMLElement>
  documentClassName?: string
  documentAriaLabel?: string
}

export function DocumentFormattedMarkdownOverlay({
  content,
  isOpen,
  onClose,
  variant = 'response',
  error,
  sessionId,
  messageId,
  renderMarkdown,
  beforeContent,
  afterContent,
  documentRef,
  documentClassName,
  documentAriaLabel,
}: DocumentFormattedMarkdownOverlayProps) {
  useEffect(() => {
    if (!isOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229 && !event.defaultPrevented) onClose()
    }
    addEventListener('keydown', closeOnEscape)
    return () => removeEventListener('keydown', closeOnEscape)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="flex flex-col px-0 py-2 sm:px-6 sm:py-8">
      {error && (
        <div className="w-full max-w-[960px] mx-auto mb-3 px-4 py-3 rounded-[10px] bg-destructive/5 text-destructive" role="alert">
          <strong className="text-[13px]">报告读取失败</strong>
          <p className="m-0 mt-1 text-xs">{error}</p>
        </div>
      )}

      <div className="bg-background rounded-[16px] shadow-middle w-full max-w-[960px] h-fit mx-auto">
        {variant === 'plan' && (
          <div className="px-4 py-2 border-b border-border/30 flex items-center gap-2 bg-success/5 rounded-t-[16px]">
            <ListTodo className="w-3 h-3 text-success" />
            <span className="text-[13px] font-medium text-success">计划</span>
          </div>
        )}

        <div className="px-4 pt-6 pb-6 sm:px-10 sm:pt-8 sm:pb-8">
          <div className="text-sm">
            {beforeContent}
            <article
              ref={documentRef}
              className={cn('work-preview-report', documentClassName)}
              data-task-id={sessionId}
              data-report-version={messageId}
              aria-label={documentAriaLabel}
            >
              {renderMarkdown(content)}
            </article>
            {afterContent}
          </div>
        </div>
      </div>
    </div>
  )
}
