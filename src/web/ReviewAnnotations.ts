export type TextQuoteSelector = {
  type: 'text-quote'
  exact: string
  prefix: string
  suffix: string
  start: number
  end: number
}

export type ReportAnnotation = {
  id: string
  taskId: string
  versionId: string
  quote: string
  note: string
  selector: TextQuoteSelector
  createdAt: number
  updatedAt: number
}

export type ReviewAnnotationSnapshot = { id: string; updatedAt: number; quote: string }
export type ReviewContext = { taskId: string; versionId: string; annotations?: ReviewAnnotationSnapshot[]; annotationIds?: string[] }
export type ReportAnnotationDraft = { selector: TextQuoteSelector; note: string }
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function annotationStorageKey(taskId: string, versionId: string) {
  return `agentanywhere:report-annotations:${taskId}:${versionId}`
}

export function annotationDraftStorageKey(taskId: string, versionId: string) {
  return `agentanywhere:report-annotation-draft:${taskId}:${versionId}`
}

function validSelector(value: unknown): value is TextQuoteSelector {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const selector = value as Record<string, unknown>
  return selector.type === 'text-quote' && typeof selector.exact === 'string' && typeof selector.prefix === 'string'
    && typeof selector.suffix === 'string' && Number.isSafeInteger(selector.start) && Number.isSafeInteger(selector.end)
}

function validAnnotation(value: unknown, taskId: string, versionId: string): value is ReportAnnotation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const annotation = value as Record<string, unknown>
  return uuid.test(String(annotation.id)) && annotation.taskId === taskId && annotation.versionId === versionId
    && typeof annotation.quote === 'string' && annotation.quote.trim().length > 0 && typeof annotation.note === 'string'
    && annotation.note.trim().length > 0 && validSelector(annotation.selector)
    && Number.isSafeInteger(annotation.createdAt) && Number.isSafeInteger(annotation.updatedAt)
}

export function isReviewContext(value: unknown): value is ReviewContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const review = value as Record<string, unknown>
  return uuid.test(String(review.taskId)) && uuid.test(String(review.versionId)) && Array.isArray(review.annotations)
    && review.annotations.every(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false
      const annotation = item as Record<string, unknown>
      return uuid.test(String(annotation.id)) && Number.isSafeInteger(annotation.updatedAt)
        && typeof annotation.quote === 'string' && annotation.quote.trim().length > 0
    })
}

export function readReportAnnotations(taskId: string, versionId: string, storage: StorageLike = localStorage): ReportAnnotation[] {
  try {
    const value = JSON.parse(storage.getItem(annotationStorageKey(taskId, versionId)) ?? '[]')
    return Array.isArray(value) ? value.filter(item => validAnnotation(item, taskId, versionId)) : []
  } catch { return [] }
}

function notifyAcceptedAnnotations(taskId: string, versionId: string, annotations: ReviewAnnotationSnapshot[]) {
  if (typeof dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    dispatchEvent(new CustomEvent('agentanywhere:report-annotations-accepted', { detail: { taskId, versionId, annotations } }))
  }
}

export function writeReportAnnotations(taskId: string, versionId: string, annotations: ReportAnnotation[], storage: StorageLike = localStorage) {
  try {
    const key = annotationStorageKey(taskId, versionId)
    if (annotations.length) storage.setItem(key, JSON.stringify(annotations))
    else storage.removeItem(key)
    return true
  } catch { return false }
}

export function readReportAnnotationDraft(taskId: string, versionId: string, storage: StorageLike = localStorage): ReportAnnotationDraft | null {
  try {
    const value = JSON.parse(storage.getItem(annotationDraftStorageKey(taskId, versionId)) ?? 'null') as Record<string, unknown> | null
    return value && validSelector(value.selector) && typeof value.note === 'string' && value.note.length <= 2000
      && value.selector.exact.trim().length > 0 && value.selector.exact.length <= 4000
      ? { selector: value.selector, note: value.note } : null
  } catch { return null }
}

export function writeReportAnnotationDraft(taskId: string, versionId: string, draft: ReportAnnotationDraft | null, storage: StorageLike = localStorage) {
  try {
    const key = annotationDraftStorageKey(taskId, versionId)
    if (draft) storage.setItem(key, JSON.stringify(draft))
    else storage.removeItem(key)
    return true
  } catch { return false }
}

export function createTextSelector(text: string, start: number, end: number): TextQuoteSelector {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > text.length) throw new Error('选区无效')
  return { type: 'text-quote', exact: text.slice(start, end), prefix: text.slice(Math.max(0, start - 32), start),
    suffix: text.slice(end, end + 32), start, end }
}

export function captureTextSelection(root: HTMLElement, selection: Selection | null = getSelection()): TextQuoteSelector | null {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  const inside = (node: Node) => node === root || root.contains(node)
  if (!inside(range.startContainer) || !inside(range.endContainer)) return null
  const before = range.cloneRange()
  before.selectNodeContents(root)
  before.setEnd(range.startContainer, range.startOffset)
  const text = root.textContent ?? ''
  const start = before.toString().length
  const exact = range.toString()
  if (!exact.trim() || text.slice(start, start + exact.length) !== exact) return null
  return createTextSelector(text, start, start + exact.length)
}

export function selectorStatus(text: string, selector: TextQuoteSelector): 'exact' | 'stale' {
  return text.slice(selector.start, selector.end) === selector.exact ? 'exact' : 'stale'
}

function quoteMarkdown(quote: string) {
  return quote.split('\n').map(line => `> ${line}`).join('\n')
}

function annotationBlock(annotation: Pick<ReportAnnotation, 'id' | 'quote' | 'note'>) {
  return `[批注 ${annotation.id}]\n引用：\n${quoteMarkdown(annotation.quote)}\n意见：${annotation.note.trim()}`
}

export function buildReviewCommand(taskId: string, versionId: string, annotations: ReportAnnotation[]) {
  if (!annotations.length) throw new Error('没有可汇总的批注')
  const content = `请修改工作 ${taskId} 的报告 ${versionId}：\n请按以下批注修改报告；引用只用于定位原文。\n\n${annotations.map(annotationBlock).join('\n\n')}`
  const review: ReviewContext = { taskId, versionId,
    annotations: annotations.map(annotation => ({ id: annotation.id, updatedAt: annotation.updatedAt, quote: annotation.quote })) }
  return { content, review }
}

function representedAnnotationIds(review: ReviewContext, content: string) {
  const prefix = `请修改工作 ${review.taskId} 的报告 ${review.versionId}：`
  if (!content.trimStart().startsWith(prefix)) return new Set<string>()
  const ids = new Set<string>()
  for (const annotation of review.annotations ?? []) {
    const marker = `[批注 ${annotation.id}]`
    const start = content.indexOf(marker)
    if (start < 0) continue
    const next = content.indexOf('\n[批注 ', start + marker.length)
    const block = content.slice(start, next < 0 ? undefined : next)
    if (block.includes(`引用：\n${quoteMarkdown(annotation.quote)}`) && /\n意见：\s*\S/.test(block)) ids.add(annotation.id)
  }
  return ids
}

export function filterReviewContextForContent(review: ReviewContext | undefined, content: string): ReviewContext | undefined {
  if (!review) return undefined
  const ids = representedAnnotationIds(review, content)
  const annotations = (review.annotations ?? []).filter(annotation => ids.has(annotation.id))
  return annotations.length ? { ...review, annotations } : undefined
}

export function clearAcceptedAnnotations(review: ReviewContext | undefined, content: string, storage: StorageLike = localStorage) {
  const represented = filterReviewContextForContent(review, content)
  if (!represented) return
  const accepted = new Map((represented.annotations ?? []).map(annotation => [annotation.id, annotation.updatedAt]))
  const current = readReportAnnotations(represented.taskId, represented.versionId, storage)
  const removed = current.filter(annotation => accepted.get(annotation.id) === annotation.updatedAt).map(annotation => annotation.id)
  const remaining = current.filter(annotation => !removed.includes(annotation.id))
  writeReportAnnotations(represented.taskId, represented.versionId, remaining, storage)
  notifyAcceptedAnnotations(represented.taskId, represented.versionId, represented.annotations ?? [])
}

export function latestSucceededReportVersion(artifacts: { kind: string; runStatus: string; versionId: string }[]) {
  return artifacts.find(artifact => artifact.kind === 'report' && artifact.runStatus === 'succeeded')?.versionId ?? null
}
