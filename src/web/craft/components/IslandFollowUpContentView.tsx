/*
 * Adapted from packages/ui/src/components/ui/IslandFollowUpContentView.tsx in Craft Agents OSS v0.13.3 at
 * e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 * Local changes: replace i18n with Chinese props/defaults, remove the unavailable save-and-send menu, add IME guards, and constrain the editor to the browser viewport.
 */
import * as React from 'react'
import { IslandContentView, type IslandMorphTarget } from './Island'

export type IslandFollowUpMode = 'edit' | 'view'

export interface IslandFollowUpContentViewProps {
  id: string
  value: string
  onValueChange: (next: string) => void
  onCancel: () => void
  onSubmit: (value: string) => void
  onDelete?: () => void
  title?: string
  placeholder?: string
  submitLabel?: string
  editLabel?: string
  deleteLabel?: string
  maxInputHeight?: number
  sendMessageKey?: 'enter' | 'cmd-enter'
  morphFrom?: IslandMorphTarget | null
  lockScroll?: boolean
  blockOutsideInteraction?: boolean
  mode?: IslandFollowUpMode
  onRequestEdit?: () => void
}

/**
 * Reusable Follow-up confirmation view for Island flows.
 *
 * - Uses multiline textarea input
 * - Esc cancels
 * - Cmd/Ctrl+Enter submits
 */
export function IslandFollowUpContentView({
  id,
  value,
  onValueChange,
  onCancel,
  onSubmit,
  onDelete,
  title: titleProp,
  placeholder: placeholderProp,
  submitLabel: submitLabelProp,
  editLabel: editLabelProp,
  deleteLabel: deleteLabelProp,
  maxInputHeight = 400,
  sendMessageKey = 'enter',
  morphFrom = null,
  lockScroll = false,
  blockOutsideInteraction = false,
  mode = 'edit',
  onRequestEdit,
}: IslandFollowUpContentViewProps) {
  const title = titleProp ?? '批注意见'
  const placeholder = placeholderProp ?? '写下希望如何修改'
  const submitLabel = submitLabelProp ?? '保存批注'
  const editLabel = editLabelProp ?? '编辑'
  const deleteLabel = deleteLabelProp ?? '删除'
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const measureTextareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const isViewMode = mode === 'view'
  const isEmpty = !isViewMode && value.trim().length === 0
  const minInputHeight = isViewMode ? 20 : 44
  const [inputHeight, setInputHeight] = React.useState(minInputHeight)
  const [inputOverflow, setInputOverflow] = React.useState(false)

  React.useLayoutEffect(() => {
    const measure = measureTextareaRef.current
    if (!measure) return

    measure.value = value
    const measured = measure.scrollHeight
    const nextHeight = Math.min(Math.max(measured, minInputHeight), maxInputHeight)
    const nextOverflow = measured > maxInputHeight

    setInputHeight((prev) => (prev === nextHeight ? prev : nextHeight))
    setInputOverflow((prev) => (prev === nextOverflow ? prev : nextOverflow))
  }, [value, maxInputHeight, minInputHeight])

  React.useEffect(() => {
    if (isViewMode || typeof window === 'undefined') return

    const raf = window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return

      textarea.focus()
      const cursor = textarea.value.length
      textarea.setSelectionRange(cursor, cursor)
    })

    return () => window.cancelAnimationFrame(raf)
  }, [isViewMode])

  return (
    <IslandContentView id={id} anchorX="center" anchorY="top" morphFrom={morphFrom} lockScroll={lockScroll} blockOutsideInteraction={blockOutsideInteraction}>
      <div className="w-[min(330px,calc(100vw-16px))] px-3 pb-3 pt-3 space-y-2.5 select-none">
        <div className="flex items-center">
          <div className="pl-[4px] text-sm font-medium">{title}</div>
        </div>

        <div className="relative rounded-[8px] px-0 py-1">
          <textarea
            data-slot="textarea"
            ref={measureTextareaRef}
            aria-hidden="true"
            tabIndex={-1}
            readOnly
            rows={isViewMode ? 1 : 2}
            value={value}
            className="pointer-events-none absolute left-0 right-0 top-1 resize-none overflow-hidden border-0 bg-transparent text-sm leading-5 opacity-0 pl-[4px]"
          />

          <textarea
            data-slot="textarea"
            ref={textareaRef}
            value={value}
            readOnly={isViewMode}
            tabIndex={isViewMode ? -1 : 0}
            onChange={(event) => {
              if (isViewMode) return
              onValueChange(event.target.value)
            }}
            onKeyDown={(event) => {
              if (isViewMode) return

              if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                event.preventDefault()
                event.stopPropagation()
                onCancel()
                return
              }

              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return

              const trimmedEmpty = value.trim().length === 0

              if (sendMessageKey === 'enter') {
                if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
                  event.preventDefault()
                  if (!trimmedEmpty) onSubmit(value)
                  return
                }

                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  if (!trimmedEmpty) onSubmit(value)
                }

                return
              }

              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                if (!trimmedEmpty) onSubmit(value)
              }
            }}
            placeholder={placeholder}
            rows={isViewMode ? 1 : 2}
            style={{ height: inputHeight, overflowY: inputOverflow ? 'auto' : 'hidden' }}
            className="relative w-full resize-none rounded-[6px] border-0 bg-transparent outline-none text-sm leading-5 select-text pl-[4px] focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="flex justify-between items-center pt-1 shrink-0">
          <div>
            {onDelete && (
              <button
                data-craft-button
                type="button"
                onClick={onDelete}
                className="h-8 px-3 rounded-[8px] text-sm bg-background shadow-minimal text-red-500 inline-flex items-center cursor-pointer hover:bg-foreground/2"
              >
                {deleteLabel}
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <button
              data-craft-button
              type="button"
              onClick={onCancel}
              className="h-8 px-3 rounded-[8px] text-sm text-foreground/75 hover:bg-foreground/5"
            >
              取消
            </button>
            <button
              data-craft-button
              type="button"
              disabled={isEmpty}
              onClick={() => {
                if (isViewMode) {
                  onRequestEdit?.()
                  return
                }

                onSubmit(value)
              }}
              className="h-8 px-3 rounded-[8px] text-sm bg-background shadow-minimal text-foreground inline-flex items-center cursor-pointer hover:bg-foreground/2 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent"
            >
              {isViewMode ? editLabel : submitLabel}
            </button>
          </div>
        </div>
      </div>
    </IslandContentView>
  )
}
