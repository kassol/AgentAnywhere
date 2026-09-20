/*
 * Adapted from packages/core/src/types/message.ts lines 110-227 in Craft
 * Agents OSS v0.13.3 at e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 *
 * This local structural type avoids importing Craft's runtime package. The
 * browser business adapter remains responsible for Task and Version identity.
 */
export interface AnnotationAuthor {
  id: string
  name?: string
  type?: 'user' | 'agent' | 'system'
}

export type AnnotationBody =
  | { type: 'highlight' }
  | { type: 'note'; text: string; format?: 'plain' | 'markdown' }
  | { type: 'tag'; value: string }

export type AnnotationBlockType = 'paragraph' | 'code' | 'latex' | 'mermaid' | 'datatable' | 'spreadsheet' | 'image-preview' | 'pdf-preview' | 'html-preview'
export type AnnotationSelector =
  | { type: 'text-quote'; exact: string; prefix?: string; suffix?: string }
  | { type: 'text-position'; start: number; end: number; textVersion?: string }
  | { type: 'block'; blockType: AnnotationBlockType; path: string; blockId?: string }
  | { type: 'xywh'; unit: 'pixel' | 'percent'; x: number; y: number; w: number; h: number; page?: number; rotation?: number }
  | { type: 'table-cell'; rowKey: string | number; columnKey: string }

export interface AnnotationV1 {
  id: string
  schemaVersion: 1
  createdAt: number
  updatedAt?: number
  createdBy?: AnnotationAuthor
  deletedAt?: number
  body: AnnotationBody[]
  target: { source: { sessionId: string; messageId: string }; selectors: AnnotationSelector[] }
  intent?: 'highlight' | 'comment' | 'question'
  status?: 'pending' | 'acknowledged' | 'resolved' | 'dismissed'
  threadRef?: { threadId?: string; sessionId?: string }
  style?: { color?: 'yellow' | 'green' | 'blue' | 'pink' | string; opacity?: number }
  meta?: Record<string, unknown>
}
