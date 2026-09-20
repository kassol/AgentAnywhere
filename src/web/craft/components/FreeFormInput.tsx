/*
 * Adapted from apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx
 * in Craft Agents OSS v0.13.3 at e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 *
 * AgentAnywhere keeps the original form, rounded input container, RichTextInput
 * and bottom control row. Electron attachments, model/permission selectors,
 * mentions and menus are removed. Submission delegates to the existing
 * Composer state machine and therefore does not clear input optimistically.
 */
import * as React from 'react'
import { ArrowUp } from 'lucide-react'
import { cn } from '../lib/utils'
import { Button } from './Button'
import { LoadingIndicator } from './LoadingIndicator'
import { RichTextInput, type RichTextInputHandle } from './RichTextInput'

export interface FreeFormInputProps {
  id?: string
  label: string
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  shouldSubmitKey: (event: React.KeyboardEvent<HTMLDivElement>) => boolean
  placeholder?: string
  disabled?: boolean
  isProcessing?: boolean
  pending?: boolean
  maxLength?: number
  actions?: React.ReactNode
  status?: React.ReactNode
  className?: string
}

export function FreeFormInput({
  id = 'steward-message',
  label,
  value,
  onChange,
  onSubmit,
  shouldSubmitKey,
  placeholder = '给管家发消息…',
  disabled = false,
  isProcessing = false,
  pending = false,
  maxLength = 16000,
  actions,
  status,
  className,
}: FreeFormInputProps) {
  const richInputRef = React.useRef<RichTextInputHandle>(null)

  const submitMessage = React.useCallback(() => {
    if (disabled || isProcessing || (!pending && !value.trim())) return false
    onSubmit()
    requestAnimationFrame(() => richInputRef.current?.focus())
    return true
  }, [disabled, isProcessing, onSubmit, pending, value])

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    submitMessage()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!shouldSubmitKey(event) || isProcessing) return
    event.preventDefault()
    submitMessage()
  }

  const buttonLabel = isProcessing ? '正在核对发送结果' : pending ? '核对并重试发送' : '发送消息'

  return <form className={cn('steward-composer', className)} onSubmit={handleSubmit}>
    <label className="composer-label" htmlFor={id}>{label}</label>
    <div className="overflow-hidden transition-all rounded-[16px] shadow-middle bg-background focus-within:ring-1 focus-within:ring-foreground">
      <RichTextInput
        ref={richInputRef}
        id={id}
        aria-label={label}
        value={value}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        className="pl-5 pr-4 pt-4 pb-3 overflow-y-auto min-h-[88px] max-h-[260px]"
        spellCheck
      />
      {status && <div className="px-5 pb-1 text-xs text-muted-foreground">{status}</div>}
      <div className="relative">
        <div className="flex items-center gap-1 px-2 py-2 border-t border-border/50">
          <span className="px-2 text-xs text-muted-foreground max-[420px]:hidden">Enter 发送 · Shift+Enter 换行</span>
          <div className="composer-actions ml-auto flex min-w-0 items-center justify-end gap-2 max-[420px]:w-full">
            {actions}
            <Button
              type="submit"
              size={pending || isProcessing ? 'sm' : 'icon'}
              aria-label={buttonLabel}
              className={cn('send-btn h-7 shrink-0 rounded-full ml-2', !pending && !isProcessing && 'w-7')}
              disabled={disabled || isProcessing || (!pending && !value.trim())}
            >
              {isProcessing ? <LoadingIndicator label="核对中…" spinnerClassName="text-[10px]" /> : pending ? '核对并重试' : <ArrowUp aria-hidden="true" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  </form>
}
