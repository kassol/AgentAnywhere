/*
 * Enter/Shift+Enter/IME handling and the 16px input surface are adapted from
 * Craft Agents OSS FreeFormInput.tsx at e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 */
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import { filterReviewContextForContent, isReviewContext, type ReviewContext } from './ReviewAnnotations'
import './composer.css'

export type ComposerReviewContext = ReviewContext
export type ComposerDraft = { content: string; revision: number; review?: ComposerReviewContext }
export type ComposerSubmission = {
  content: string
  draftRevision: number
  threadRequestId: string
  turnRequestId: string
  threadId?: string
  review?: ComposerReviewContext
}
export type ComposerState = { draft: ComposerDraft; threadId?: string; pending?: ComposerSubmission }
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function composerStorageKey(threadId: string | null) {
  return `agentanywhere:steward-composer:${threadId ?? 'new'}`
}

export function readComposerState(threadId: string | null, storage: StorageLike = localStorage): ComposerState {
  try {
    const value = JSON.parse(storage.getItem(composerStorageKey(threadId)) ?? 'null') as any
    if (!value?.draft || typeof value.draft.content !== 'string' || !Number.isSafeInteger(value.draft.revision) || value.draft.revision < 0) throw new Error()
    const draft: ComposerDraft = { content: value.draft.content, revision: value.draft.revision,
      ...(isReviewContext(value.draft.review) ? { review: value.draft.review } : {}) }
    const storedThreadId = typeof value.threadId === 'string' ? value.threadId : undefined
    const pending = value.pending
    if (!pending) return { draft, ...(storedThreadId ? { threadId: storedThreadId } : {}) }
    if (typeof pending.content !== 'string' || !Number.isSafeInteger(pending.draftRevision) || pending.draftRevision < 0
      || typeof pending.threadRequestId !== 'string' || typeof pending.turnRequestId !== 'string') throw new Error()
    return { draft, ...(storedThreadId ? { threadId: storedThreadId } : {}), pending: { content: pending.content, draftRevision: pending.draftRevision,
      threadRequestId: pending.threadRequestId, turnRequestId: pending.turnRequestId,
      ...(typeof pending.threadId === 'string' ? { threadId: pending.threadId } : {}),
      ...(isReviewContext(pending.review) ? { review: pending.review } : {}) } }
  } catch {
    return { draft: { content: '', revision: 0 } }
  }
}

export function writeComposerState(threadId: string | null, state: ComposerState, storage: StorageLike = localStorage) {
  try {
    if (!state.draft.content && !state.draft.review && !state.pending) storage.removeItem(composerStorageKey(threadId))
    else storage.setItem(composerStorageKey(threadId), JSON.stringify(state))
  } catch { /* keep the live draft usable when browser storage is unavailable */ }
}

export function changeComposerDraft(state: ComposerState, content: string, review: ComposerReviewContext | null = state.draft.review ?? null): ComposerState {
  return { ...state, draft: { content, revision: state.draft.revision + 1, ...(review ? { review } : {}) } }
}

export function prepareComposerSubmission(state: ComposerState): ComposerState | null {
  if (state.pending) return state
  const content = state.draft.content.trim()
  if (!content) return null
  const review = filterReviewContextForContent(state.draft.review, content)
  return { ...state, pending: { content, draftRevision: state.draft.revision,
    threadRequestId: crypto.randomUUID(), turnRequestId: crypto.randomUUID(),
    ...(state.threadId ? { threadId: state.threadId } : {}),
    ...(review ? { review } : {}) } }
}

export function attachComposerThread(state: ComposerState, submission: ComposerSubmission, threadId: string): ComposerState {
  if (state.pending?.turnRequestId !== submission.turnRequestId) return state
  return { ...state, threadId, pending: { ...state.pending, threadId } }
}

export function acceptComposerSubmission(state: ComposerState, accepted: ComposerSubmission): ComposerState {
  if (state.pending?.turnRequestId !== accepted.turnRequestId) return state
  if (state.draft.revision !== accepted.draftRevision) return { draft: state.draft }
  return { draft: { content: '', revision: state.draft.revision + 1 } }
}

export function rejectComposerSubmission(state: ComposerState, rejected: ComposerSubmission): ComposerState {
  if (state.pending?.turnRequestId !== rejected.turnRequestId) return state
  return { draft: state.draft, ...(state.threadId ? { threadId: state.threadId } : {}) }
}

export function shouldSubmitComposerKey(event: Pick<KeyboardEvent<HTMLTextAreaElement>, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey'> & { isComposing: boolean; keyCode?: number }) {
  return event.key === 'Enter' && event.keyCode !== 229 && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.isComposing
}

export function Composer({ state, busy, error, actions, onChange, onSubmit }: {
  state: ComposerState
  busy: boolean
  error: string
  actions?: ReactNode
  onChange(content: string): void
  onSubmit(): void
}) {
  function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    onSubmit()
  }

  return <>
    <form className="steward-composer" onSubmit={submit}>
      <label htmlFor="steward-message">消息</label>
      <textarea id="steward-message" value={state.draft.content} onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (busy || !shouldSubmitComposerKey({ key: event.key, shiftKey: event.shiftKey, metaKey: event.metaKey,
            ctrlKey: event.ctrlKey, keyCode: event.nativeEvent.keyCode, isComposing: event.nativeEvent.isComposing })) return
          event.preventDefault()
          event.currentTarget.form?.requestSubmit()
        }} maxLength={16000} rows={3} placeholder="输入消息…" />
      {state.pending && <small role="status">发送结果待核对；重试会使用同一请求，不会重复创建轮次。</small>}
      <div><button type="submit" disabled={busy || (!state.pending && !state.draft.content.trim())}>
        {busy ? '核对中…' : state.pending ? '核对并重试' : '发送'}
      </button>{actions}</div>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
  </>
}
