/*
 * Adapted from apps/electron/src/renderer/components/ui/rich-text-input.tsx
 * in Craft Agents OSS v0.13.3 at e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 *
 * AgentAnywhere removes mentions, source icons and rotating placeholders. It
 * keeps the original contenteditable text model, cursor handling, plain-text
 * paste/undo path, HTML escaping, IME guards and controlled-value sync. The
 * maxLength guard is local because contenteditable has no native equivalent.
 */
import * as React from 'react'
import { cn } from '../lib/utils'

export interface EscapeCompositionEventLike {
  key?: string
  isComposing?: boolean
  nativeEvent?: { isComposing?: boolean }
}

export function isEscapeDuringComposition(event: EscapeCompositionEventLike, isComposingRefActive: boolean): boolean {
  if (event.key !== 'Escape') return false
  return Boolean(isComposingRefActive || event.isComposing || event.nativeEvent?.isComposing)
}

export interface RichTextInputProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'onInput' | 'onPaste'> {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  maxLength?: number
  onInput?: (value: string, cursorPosition: number) => void
  onPaste?: (event: React.ClipboardEvent<HTMLDivElement>) => void
}

export interface RichTextInputHandle {
  focus: () => void
  blur: () => void
  value: string
  selectionStart: number
  setValue: (value: string) => void
  setSelectionRange: (start: number, end: number) => void
  getBoundingClientRect: () => DOMRect
  getCaretRect: () => DOMRect | null
  element: HTMLDivElement | null
}

function getTextFromElement(element: HTMLElement): string {
  let text = ''

  function processNode(node: Node, isTopLevel = false) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += (node.textContent || '').replace(/\u200B/g, '')
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const elementNode = node as HTMLElement
      if (elementNode.tagName === 'BR') {
        text += '\n'
      } else if (elementNode.tagName === 'DIV' && text.length > 0 && !text.endsWith('\n')) {
        // Browsers use top-level divs for contenteditable line breaks.
        if (isTopLevel || elementNode.parentElement !== element) text += '\n'
      }
      Array.from(elementNode.childNodes).forEach(child => processNode(child, false))
    }
  }

  Array.from(element.childNodes).forEach(child => processNode(child, true))
  return text
}

function getCursorPosition(element: HTMLElement, fallback = 0): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return fallback
  const range = selection.getRangeAt(0)
  if (!element.contains(range.startContainer)) return fallback
  const preRange = document.createRange()
  preRange.selectNodeContents(element)
  preRange.setEnd(range.startContainer, range.startOffset)
  const fragment = preRange.cloneContents()
  const div = document.createElement('div')
  div.appendChild(fragment)
  return getTextFromElement(div).length
}

function setCursorPosition(element: HTMLElement, targetPosition: number): void {
  const selection = window.getSelection()
  if (!selection) return
  let currentPosition = 0

  function findPosition(node: Node): { node: Node; offset: number } | null {
    if (node.nodeType === Node.TEXT_NODE) {
      const rawText = node.textContent || ''
      const textWithoutZeroWidthSpaces = rawText.replace(/\u200B/g, '')
      if (currentPosition + textWithoutZeroWidthSpaces.length >= targetPosition) {
        const modelOffset = targetPosition - currentPosition
        let domOffset = 0
        let modelCount = 0
        while (modelCount < modelOffset && domOffset < rawText.length) {
          if (rawText[domOffset] !== '\u200B') modelCount++
          domOffset++
        }
        while (domOffset < rawText.length && rawText[domOffset] === '\u200B') domOffset++
        return { node, offset: domOffset }
      }
      currentPosition += textWithoutZeroWidthSpaces.length
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const elementNode = node as HTMLElement
      if (elementNode.tagName === 'BR') {
        currentPosition += 1
        if (currentPosition >= targetPosition) {
          return { node: elementNode.parentNode!, offset: Array.from(elementNode.parentNode!.childNodes).indexOf(elementNode) + 1 }
        }
        return null
      }
      for (const child of Array.from(elementNode.childNodes)) {
        const result = findPosition(child)
        if (result) return result
      }
    }
    return null
  }

  const result = findPosition(element)
  const range = document.createRange()
  if (result) range.setStart(result.node, result.offset)
  else {
    range.selectNodeContents(element)
    range.collapse(false)
  }
  if (result) range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

function textToHTML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

export const RichTextInput = React.forwardRef<RichTextInputHandle, RichTextInputProps>(
  function RichTextInput(
    {
      value,
      onChange,
      placeholder,
      disabled = false,
      maxLength,
      className,
      style,
      onFocus,
      onBlur,
      onKeyDown,
      onInput,
      onPaste,
      ...restProps
    },
    forwardedRef,
  ) {
    const safeValue = typeof value === 'string' ? value : ''
    const divRef = React.useRef<HTMLDivElement>(null)
    const isComposing = React.useRef(false)
    const lastValueRef = React.useRef(safeValue)
    const cursorPositionRef = React.useRef(0)
    const isInternalUpdate = React.useRef(false)
    const pendingCursorRef = React.useRef<number | null>(null)

    React.useImperativeHandle(forwardedRef, () => ({
      focus: () => divRef.current?.focus(),
      blur: () => divRef.current?.blur(),
      get value() { return lastValueRef.current },
      get selectionStart() { return cursorPositionRef.current },
      setValue: newValue => { lastValueRef.current = newValue },
      setSelectionRange: (start, _end) => {
        pendingCursorRef.current = start
        cursorPositionRef.current = start
        if (divRef.current) setCursorPosition(divRef.current, start)
      },
      getBoundingClientRect: () => divRef.current?.getBoundingClientRect() ?? new DOMRect(),
      getCaretRect: () => {
        const selection = window.getSelection()
        if (!selection || selection.rangeCount === 0) return null
        const range = selection.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0 && rect.x === 0 && rect.y === 0) {
          const span = document.createElement('span')
          span.textContent = '\u200B'
          range.insertNode(span)
          const spanRect = span.getBoundingClientRect()
          span.remove()
          selection.removeAllRanges()
          selection.addRange(range)
          return spanRect
        }
        return rect
      },
      get element() { return divRef.current },
    }), [])

    const handleInput = React.useCallback(() => {
      if (isComposing.current || !divRef.current) return
      let newText = getTextFromElement(divRef.current)
      let cursorPosition = getCursorPosition(divRef.current, cursorPositionRef.current)
      if (maxLength !== undefined && newText.length > maxLength) {
        newText = newText.slice(0, maxLength)
        cursorPosition = Math.min(cursorPosition, maxLength)
        isInternalUpdate.current = true
        divRef.current.innerHTML = textToHTML(newText) || '<br>'
        setCursorPosition(divRef.current, cursorPosition)
        isInternalUpdate.current = false
      }
      lastValueRef.current = newText
      cursorPositionRef.current = cursorPosition
      onChange(newText)
      onInput?.(newText, cursorPosition)
    }, [maxLength, onChange, onInput])

    const handleCompositionStart = React.useCallback(() => { isComposing.current = true }, [])
    const handleCompositionEnd = React.useCallback(() => {
      isComposing.current = false
      handleInput()
    }, [handleInput])

    const handleKeyDownInternal = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
      if (isEscapeDuringComposition(event, isComposing.current)) {
        event.stopPropagation()
        return
      }
      onKeyDown?.(event)
    }, [onKeyDown])

    const handlePasteInternal = React.useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
      if (onPaste) {
        onPaste(event)
        if (event.defaultPrevented) return
      }
      event.preventDefault()
      const text = event.clipboardData?.getData('text/plain')
      if (!text) return
      // execCommand keeps the browser's native undo stack intact after paste.
      document.execCommand('insertText', false, text)
    }, [onPaste])

    const handleFocus = React.useCallback((event: React.FocusEvent<HTMLDivElement>) => {
      document.execCommand('defaultParagraphSeparator', false, 'br')
      onFocus?.(event)
    }, [onFocus])

    React.useEffect(() => {
      if (!divRef.current || isInternalUpdate.current || lastValueRef.current === safeValue) return
      lastValueRef.current = safeValue
      divRef.current.innerHTML = textToHTML(safeValue) || '<br>'
      if (pendingCursorRef.current !== null || document.activeElement === divRef.current) {
        const cursorPosition = pendingCursorRef.current ?? cursorPositionRef.current ?? safeValue.length
        setCursorPosition(divRef.current, cursorPosition)
        pendingCursorRef.current = null
      }
    }, [safeValue])

    React.useEffect(() => {
      if (!divRef.current) return
      divRef.current.innerHTML = textToHTML(safeValue) || '<br>'
      lastValueRef.current = safeValue
    }, [])

    const showPlaceholder = !safeValue
    return <div className="relative">
      <div
        ref={divRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        tabIndex={disabled ? -1 : 0}
        autoCapitalize="none"
        autoCorrect="off"
        className={cn(
          'outline-none text-sm whitespace-pre-wrap break-words min-h-[1.5em]',
          disabled && 'opacity-50 cursor-not-allowed',
          showPlaceholder && 'text-transparent caret-foreground',
          className,
        )}
        style={{ lineHeight: 1.25, ...style }}
        onInput={handleInput}
        onKeyDown={handleKeyDownInternal}
        onFocus={handleFocus}
        onBlur={onBlur}
        onPaste={handlePasteInternal}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        aria-disabled={disabled}
        aria-placeholder={placeholder}
        role="textbox"
        aria-multiline="true"
        data-max-length={maxLength}
        {...restProps}
      />
      {showPlaceholder && placeholder && <div
        className={cn('absolute inset-0 text-sm text-muted-foreground pointer-events-none select-none', className)}
        aria-hidden="true"
      >{placeholder}</div>}
    </div>
  },
)
