/*
 * Adapted from packages/ui/src/components/annotations/annotation-host-config.ts in Craft Agents OSS v0.13.3 at
 * e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 * Local change: add the browser-preview host. Its A panel clips descendants,
 * so the annotation island must share the document.body portal with its blocker.
 */
export type AnnotationHost = 'turncard' | 'fullscreen' | 'browser-preview'

export interface AnnotationCanAnnotateOptions {
  hasAddAnnotationHandler: boolean
  hasMessageId: boolean
  isStreaming: boolean
}

export function canAnnotateMessage({
  hasAddAnnotationHandler,
  hasMessageId,
  isStreaming,
}: AnnotationCanAnnotateOptions): boolean {
  return hasAddAnnotationHandler && hasMessageId && !isStreaming
}

/**
 * Portal strategy is centralized so host-specific differences are explicit.
 * Fullscreen keeps in-overlay rendering to avoid stack/clip issues with modal hosts.
 */
export function shouldRenderAnnotationIslandInPortal(host: AnnotationHost): boolean {
  return host !== 'fullscreen'
}
