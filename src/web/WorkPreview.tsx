/*
 * Preview header and document surface adapted from Craft Agents OSS
 * PreviewHeader.tsx and DocumentFormattedMarkdownOverlay.tsx at
 * e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { ArrowDownToLine, ChevronLeft, FileText } from 'lucide-react'
import { ReportMarkdown, selectReportVersion } from './Work'
import { changeComposerDraft, confirmComposerReplacement, readComposerState, writeComposerState } from './Composer'
import { buildReviewCommand, captureTextControlSelection, fromCraftAnnotation, fromCraftSelection, readReportAnnotationDraft, readReportAnnotations, selectorStatus,
  toCraftAnnotation, toCraftSelection,
  writeReportAnnotationDraft, writeReportAnnotations,
  type ReportAnnotation, type ReportAnnotationDraft, type ReviewContext } from './ReviewAnnotations'
import { Button } from './craft/components/Button'
import { Textarea } from './craft/components/Textarea'
import { AnnotatableMarkdownDocument } from './craft/components/AnnotatableMarkdownDocument'
import { DocumentFormattedMarkdownOverlay } from './craft/components/DocumentFormattedMarkdownOverlay'
import { PreviewHeader, PreviewHeaderBadge } from './craft/components/PreviewHeader'
import { getCanonicalText } from './craft/components/annotations/annotation-core'
import type { AnnotationV1 } from './craft/components/annotations/types'
import './work-preview.css'
import './review-annotations.css'

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const taskPath = new RegExp(`^/tasks/(${uuid})$`, 'i')

export type PreviewSelection = { taskId: string; versionId?: string }
export type PreviewArtifact = {
  kind: 'report' | 'attachment'
  versionId: string
  runId: string
  runStatus: string
  createdAt: string
  name: string
}
type PreviewTask = {
  id: string
  goal: string
  sourceUrl: string | null
  status: string
  run: { id: string; status: string; failure: string | null }
  interaction: { id: string; kind: 'question' | 'limit'; question: string; status: string; answer: string | null } | null
  artifacts: PreviewArtifact[]
}

export type ReviewComposerPayload = { content: string; review: ReviewContext }
type ReviewComposerBridge = { fill(payload: ReviewComposerPayload): boolean; register(handler: (payload: ReviewComposerPayload) => boolean): () => void }
const ReviewComposerBridgeContext = createContext<ReviewComposerBridge | null>(null)

export function useReviewComposerBridge() {
  return useContext(ReviewComposerBridgeContext)
}

const statusLabel: Record<string, string> = {
  queued: '排队中', provisioning: '准备环境', running: '执行中', waiting: '等待回答', cancelling: '正在取消',
  cancelled: '已取消', succeeded: '已完成', failed: '失败', lost: '执行中断', save_failed: '成果保存失败',
}

export function parseTaskPreviewHref(href: string, origin = location.origin): PreviewSelection | null {
  let url: URL
  try { url = new URL(href, origin) } catch { return null }
  if (url.origin !== origin) return null
  const match = taskPath.exec(url.pathname)
  if (!match) return null
  const versionId = url.searchParams.get('version') ?? undefined
  return { taskId: match[1], ...(versionId ? { versionId } : {}) }
}

export function resolveReportVersion(artifacts: PreviewArtifact[], requested?: string): { artifact: PreviewArtifact | null } | { error: string } {
  const artifact = selectReportVersion(artifacts, requested)
  return requested && !artifact ? { error: '指定报告版本不存在或不属于当前工作。' } : { artifact: artifact ?? null }
}

export function reportScrollKey(taskId: string, versionId: string) {
  return `agentanywhere:report-scroll:${taskId}:${versionId}`
}

export function confirmAnnotationReplacement(note: string, ask: (message: string) => boolean = confirm) {
  return !note.trim() || ask('当前选区已有未保存意见。替换选区后该意见将被覆盖，是否继续？')
}

export function pinPreviewVersion(selection: PreviewSelection, artifact: PreviewArtifact | null) {
  return !selection.versionId && artifact ? { taskId: selection.taskId, versionId: artifact.versionId } : null
}

function selectionFromLocation(): PreviewSelection | null {
  if (!location.pathname.startsWith('/steward') && location.pathname !== '/') return null
  const query = new URLSearchParams(location.search)
  const taskId = query.get('previewTask')
  if (!taskId || !new RegExp(`^${uuid}$`, 'i').test(taskId)) return null
  const versionId = query.get('previewVersion') ?? undefined
  return { taskId, ...(versionId ? { versionId } : {}) }
}

function updatePreviewUrl(selection: PreviewSelection | null, mode: 'push' | 'replace') {
  const url = new URL(location.href)
  if (selection) {
    url.searchParams.set('previewTask', selection.taskId)
    if (selection.versionId) url.searchParams.set('previewVersion', selection.versionId)
    else url.searchParams.delete('previewVersion')
  } else {
    url.searchParams.delete('previewTask')
    url.searchParams.delete('previewVersion')
  }
  history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', url)
}

export function PreviewWorkspace({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<PreviewSelection | null>(selectionFromLocation)
  const returnFocus = useRef<HTMLElement | null>(null)
  const openedHere = useRef(false)
  const reviewHandler = useRef<((payload: ReviewComposerPayload) => boolean) | null>(null)
  const reviewBridge = useMemo<ReviewComposerBridge>(() => ({
    fill(payload) { return reviewHandler.current?.(payload) ?? false },
    register(handler) {
      reviewHandler.current = handler
      return () => { if (reviewHandler.current === handler) reviewHandler.current = null }
    },
  }), [])

  useEffect(() => {
    const pop = () => setSelection(selectionFromLocation())
    addEventListener('popstate', pop)
    return () => removeEventListener('popstate', pop)
  }, [])

  function open(next: PreviewSelection, trigger?: HTMLElement) {
    if (!selection) {
      returnFocus.current = trigger ?? null
      openedHere.current = true
      updatePreviewUrl(next, 'push')
    } else updatePreviewUrl(next, 'replace')
    setSelection(next)
  }

  function close() {
    if (openedHere.current) history.back()
    else updatePreviewUrl(null, 'replace')
    openedHere.current = false
    setSelection(null)
    requestAnimationFrame(() => returnFocus.current?.focus())
  }

  function capture(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href]')
    if (!anchor || anchor.hasAttribute('download')) return
    const next = parseTaskPreviewHref(anchor.href)
    if (!next) return
    event.preventDefault()
    open(next, anchor)
  }

  return <ReviewComposerBridgeContext.Provider value={reviewBridge}>
    <div className={`preview-workspace${selection ? ' has-preview' : ''}`}>
      <div className="preview-workspace-main" onClickCapture={capture}>{children}</div>
      {selection && <WorkPreview key={selection.taskId} selection={selection} onSelect={next => open(next)} onClose={close}
        onFillComposer={payload => reviewBridge.fill(payload)} />}
    </div>
  </ReviewComposerBridgeContext.Provider>
}

function reportPageSelection(): PreviewSelection | null {
  if (location.pathname !== '/reports') return null
  const query = new URLSearchParams(location.search)
  const taskId = query.get('task')
  if (!taskId || !new RegExp(`^${uuid}$`, 'i').test(taskId)) return null
  const versionId = query.get('version') ?? undefined
  return { taskId, ...(versionId ? { versionId } : {}) }
}

function updateReportPageUrl(selection: PreviewSelection | null, mode: 'push' | 'replace') {
  const url = new URL('/reports', location.origin)
  if (selection) {
    url.searchParams.set('task', selection.taskId)
    if (selection.versionId) url.searchParams.set('version', selection.versionId)
  }
  history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', url)
}

export function ReportPage() {
  const [selection, setSelection] = useState<PreviewSelection | null>(reportPageSelection)
  const openedFromIndex = useRef(false)

  useEffect(() => {
    const pop = () => setSelection(reportPageSelection())
    addEventListener('popstate', pop)
    return () => removeEventListener('popstate', pop)
  }, [])

  function select(next: PreviewSelection) {
    const mode = selection ? 'replace' : 'push'
    if (!selection) openedFromIndex.current = true
    updateReportPageUrl(next, mode)
    setSelection(next)
  }

  function close() {
    if (openedFromIndex.current) history.back()
    else { updateReportPageUrl(null, 'replace'); setSelection(null) }
    openedFromIndex.current = false
  }

  function fillComposer(payload: ReviewComposerPayload) {
    const state = readComposerState(null)
    if (!confirmComposerReplacement(state, payload.content)) return false
    const next = changeComposerDraft(state, payload.content, payload.review)
    writeComposerState(null, next)
    const stored = readComposerState(null)
    if (stored.draft.content !== next.draft.content || JSON.stringify(stored.draft.review) !== JSON.stringify(next.draft.review)) return false
    location.assign('/')
    return true
  }

  return <div className="report-page">{selection
    ? <WorkPreview selection={selection} onSelect={select} onClose={close} onFillComposer={fillComposer} independent />
    : <ReportIndex onSelect={select} />}
  </div>
}

function ReportIndex({ onSelect }: { onSelect(selection: PreviewSelection): void }) {
  const [tasks, setTasks] = useState<PreviewTask[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let disposed = false
    fetch('/api/tasks').then(async response => {
      if (response.status === 401) return location.assign('/login')
      if (!response.ok) throw new Error('报告列表加载失败。')
      const summaries = await response.json() as { id: string }[]
      const details = await Promise.all(summaries.map(async summary => {
        const detail = await fetch(`/api/tasks/${summary.id}`)
        if (!detail.ok) throw new Error('报告列表加载失败。')
        return await detail.json() as PreviewTask
      }))
      if (!disposed) setTasks(details.filter(task => task.artifacts.some(item => item.kind === 'report' && item.runStatus === 'succeeded')))
    }).catch(caught => { if (!disposed) setError(caught instanceof Error ? caught.message : '报告列表加载失败。') })
    return () => { disposed = true }
  }, [])

  return <section className="report-index" aria-labelledby="report-index-title">
    <header><div><h1 id="report-index-title">报告</h1><p>选择一项真实成果进入独立阅读。</p></div><a href="/tasks">查看工作</a></header>
    {tasks === null && !error && <p className="report-index-state" role="status">正在加载报告…</p>}
    {error && <p className="error report-index-state" role="alert">{error}</p>}
    {tasks && !tasks.length && <div className="report-index-empty"><FileText aria-hidden="true" /><h2>还没有报告</h2><p>工作交付报告后会显示在这里。</p><a href="/tasks">前往工作</a></div>}
    {!!tasks?.length && <div className="report-index-list">{tasks.map(task => {
      const reports = task.artifacts.filter(item => item.kind === 'report' && item.runStatus === 'succeeded')
      const latest = reports[0]
      return <button type="button" key={task.id} onClick={() => onSelect({ taskId: task.id, versionId: latest.versionId })}>
        <FileText aria-hidden="true" /><span><strong>{task.goal || task.sourceUrl || `工作 ${task.id.slice(0, 8)}`}</strong>
          <small>{reports.length} 个版本 · 最近交付 {new Date(latest.createdAt).toLocaleString('zh-CN')}</small></span><span>阅读</span>
      </button>
    })}</div>}
  </section>
}

function WorkPreview({ selection, onSelect, onClose, onFillComposer, independent = false }: { selection: PreviewSelection; onSelect(selection: PreviewSelection): void;
  onClose(): void; onFillComposer(payload: ReviewComposerPayload): boolean; independent?: boolean }) {
  const [task, setTask] = useState<PreviewTask | null | undefined>()
  const [taskError, setTaskError] = useState('')
  const [report, setReport] = useState<{ versionId: string; markdown: string } | null>(null)
  const [reportError, setReportError] = useState('')
  const scroll = useRef<HTMLDivElement>(null)
  const reportRoot = useRef<HTMLElement>(null)
  const keyboardSelection = useRef<HTMLTextAreaElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const frame = useRef<number>()
  const [annotations, setAnnotations] = useState<ReportAnnotation[]>([])
  const [restoredDraft, setRestoredDraft] = useState<ReportAnnotationDraft | null>(null)
  const [draftSnapshot, setDraftSnapshot] = useState<ReportAnnotationDraft | null>(null)
  const [keyboardSelectionRequest, setKeyboardSelectionRequest] = useState<{
    selection: ReturnType<typeof toCraftSelection>; note: string; nonce: number
  } | null>(null)
  const [annotationError, setAnnotationError] = useState('')
  const [keyboardReportText, setKeyboardReportText] = useState<string | null>(null)
  const [renderedReportText, setRenderedReportText] = useState<{ versionId: string; text: string } | null>(null)

  function reportCanonicalText() {
    const root = reportRoot.current?.querySelector<HTMLElement>('[data-ca-annotatable-content]')
    return root ? getCanonicalText(root) : ''
  }

  useEffect(() => { closeButton.current?.focus() }, [])
  useEffect(() => {
    let controller: AbortController | null = null
    let loading = false
    let disposed = false
    setTask(undefined)
    setTaskError('')
    async function refresh() {
      if (loading || disposed) return
      loading = true
      controller = new AbortController()
      try {
        const response = await fetch(`/api/tasks/${selection.taskId}`, { signal: controller.signal })
        if (response.status === 401) return location.assign('/login')
        if (!response.ok) throw new Error(response.status === 404 ? '工作不存在或无权访问。' : '工作详情加载失败。')
        if (!disposed) { setTask(await response.json()); setTaskError('') }
      } catch (error) {
        if (!disposed && error instanceof Error && error.name !== 'AbortError') {
          setTask(previous => previous === undefined ? null : previous)
          setTaskError(error.message)
        }
      } finally { loading = false }
    }
    void refresh()
    const timer = setInterval(refresh, 1000)
    return () => { disposed = true; clearInterval(timer); controller?.abort() }
  }, [selection.taskId])

  const resolved = task ? resolveReportVersion(task.artifacts, selection.versionId) : { artifact: null }
  const artifact = 'artifact' in resolved ? resolved.artifact : null
  const versionError = 'error' in resolved ? resolved.error : ''

  useEffect(() => {
    const pinned = pinPreviewVersion(selection, artifact)
    if (pinned) onSelect(pinned)
  }, [selection.taskId, selection.versionId, artifact?.versionId])

  useEffect(() => {
    setReport(null)
    setReportError('')
    if (!artifact) return
    const controller = new AbortController()
    fetch(`/api/artifacts/${artifact.versionId}/content`, { signal: controller.signal }).then(async response => {
      if (response.status === 401) return location.assign('/login')
      if (!response.ok) throw new Error(response.status === 404 ? '报告不存在或无权访问。'
        : response.status === 409 ? '报告校验失败。' : response.status === 503 ? '报告文件暂时不可读取。' : '报告加载失败。')
      const value = await response.json() as { markdown?: unknown }
      if (typeof value.markdown !== 'string') throw new Error('报告内容无效。')
      setReport({ versionId: artifact.versionId, markdown: value.markdown })
    }).catch(error => { if (error.name !== 'AbortError') setReportError(error.message) })
    return () => controller.abort()
  }, [artifact?.versionId])

  useLayoutEffect(() => {
    if (!report || report.versionId !== artifact?.versionId || !reportRoot.current) setRenderedReportText(null)
    else setRenderedReportText({ versionId: report.versionId, text: reportCanonicalText() })
  }, [artifact?.versionId, report?.versionId])

  useEffect(() => {
    if (!artifact || report?.versionId !== artifact.versionId || !scroll.current) return
    let top = 0
    try { top = Number(localStorage.getItem(reportScrollKey(selection.taskId, artifact.versionId)) ?? 0) }
    catch { /* browser storage unavailable */ }
    const restore = requestAnimationFrame(() => { if (scroll.current && Number.isFinite(top) && top >= 0) scroll.current.scrollTop = top })
    return () => cancelAnimationFrame(restore)
  }, [selection.taskId, artifact?.versionId, report?.versionId])

  function rememberScroll() {
    if (!artifact || frame.current !== undefined) return
    const key = reportScrollKey(selection.taskId, artifact.versionId)
    const top = scroll.current?.scrollTop ?? 0
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined
      try { localStorage.setItem(key, String(top)) }
      catch { /* browser storage unavailable */ }
    })
  }

  useEffect(() => {
    setAnnotationError('')
    setKeyboardReportText(null)
    setKeyboardSelectionRequest(null)
    if (!artifact) { setAnnotations([]); setRestoredDraft(null); setDraftSnapshot(null); return }
    setAnnotations(readReportAnnotations(selection.taskId, artifact.versionId))
    const draft = readReportAnnotationDraft(selection.taskId, artifact.versionId)
    setRestoredDraft(draft)
    setDraftSnapshot(draft)
    const accepted = (event: Event) => {
      const detail = (event as CustomEvent<{ taskId?: string; versionId?: string; annotations?: { id: string; updatedAt: number }[] }>).detail
      if (detail?.taskId === selection.taskId && detail.versionId === artifact.versionId && Array.isArray(detail.annotations)) {
        const acceptedVersions = new Map(detail.annotations.map(annotation => [annotation.id, annotation.updatedAt]))
        setAnnotations(current => current.filter(annotation => acceptedVersions.get(annotation.id) !== annotation.updatedAt))
      }
    }
    addEventListener('agentanywhere:report-annotations-accepted', accepted)
    return () => removeEventListener('agentanywhere:report-annotations-accepted', accepted)
  }, [selection.taskId, artifact?.versionId])

  function openKeyboardSelection() {
    setKeyboardReportText(reportCanonicalText())
    requestAnimationFrame(() => keyboardSelection.current?.focus())
  }

  function selectKeyboardReportText() {
    const field = keyboardSelection.current
    const selector = field ? captureTextControlSelection(field.value, field.selectionStart, field.selectionEnd) : null
    if (!selector) {
      setAnnotationError('请先在报告纯文本中选择要引用的文字。')
      return
    }
    if (selector.exact.length > 4000) {
      setAnnotationError('单条引用最多 4000 个字符，请缩小选区。')
      return
    }
    if (draftSnapshot && !confirmAnnotationReplacement(draftSnapshot.note)) return
    setKeyboardSelectionRequest({ selection: toCraftSelection(selector), note: '', nonce: Date.now() })
    setKeyboardReportText(null)
  }

  function removeAnnotation(annotationId: string) {
    if (!artifact) return
    const next = annotations.filter(annotation => annotation.id !== annotationId)
    if (!writeReportAnnotations(selection.taskId, artifact.versionId, next)) {
      setAnnotationError('浏览器无法删除批注，请重试。')
      return
    }
    setAnnotations(next)
    setAnnotationError('')
  }

  function persistCraftDraft(selectionValue: Parameters<typeof fromCraftSelection>[0], nextNote: string, persistedAnnotationId?: string) {
    if (!artifact) return false
    const draft = { selector: fromCraftSelection(selectionValue), note: nextNote, ...(persistedAnnotationId ? { persistedAnnotationId } : {}) }
    setRestoredDraft(null)
    setDraftSnapshot(draft)
    if (!writeReportAnnotationDraft(selection.taskId, artifact.versionId, draft)) {
      setAnnotationError('浏览器无法保存批注草稿；当前意见仍保留，请勿刷新或切换版本。')
      return false
    }
    setAnnotationError('')
    return true
  }

  function clearCraftDraft() {
    if (!artifact) return false
    if (!writeReportAnnotationDraft(selection.taskId, artifact.versionId, null)) {
      setAnnotationError('浏览器无法清除批注草稿，请重试。')
      return false
    }
    setRestoredDraft(null)
    setDraftSnapshot(null)
    return true
  }

  function addCraftAnnotation(_messageId: string, annotation: AnnotationV1) {
    if (!artifact) return false
    const local = fromCraftAnnotation(selection.taskId, artifact.versionId, annotation)
    if (!local) return false
    if (local.quote.length > 4000) {
      setAnnotationError('单条引用最多 4000 个字符，请缩小选区。')
      return false
    }
    const next = annotations.some(item => item.id === local.id)
      ? annotations.map(item => item.id === local.id ? { ...local, createdAt: item.createdAt } : item)
      : [...annotations, local]
    if (!writeReportAnnotations(selection.taskId, artifact.versionId, next)) {
      setAnnotationError('浏览器无法保存批注；所选原文和意见仍保留，请重试。')
      return false
    }
    setAnnotations(next)
    setAnnotationError('')
    return true
  }

  function updateCraftAnnotation(_messageId: string, annotationId: string, patch: Partial<AnnotationV1>) {
    if (!artifact) return false
    const index = annotations.findIndex(annotation => annotation.id === annotationId)
    if (index < 0) return false
    const current = toCraftAnnotation(annotations[index])
    const local = fromCraftAnnotation(selection.taskId, artifact.versionId, { ...current, ...patch, id: annotationId })
    if (!local) return false
    const next = annotations.map((annotation, itemIndex) => itemIndex === index ? local : annotation)
    if (!writeReportAnnotations(selection.taskId, artifact.versionId, next)) {
      setAnnotationError('浏览器无法更新批注，原批注仍保留，请重试。')
      return false
    }
    setAnnotations(next)
    setAnnotationError('')
    return true
  }

  function removeCraftAnnotation(_messageId: string, annotationId: string) {
    if (!artifact) return false
    const next = annotations.filter(annotation => annotation.id !== annotationId)
    if (!writeReportAnnotations(selection.taskId, artifact.versionId, next)) {
      setAnnotationError('浏览器无法删除批注，请重试。')
      return false
    }
    setAnnotations(next)
    setAnnotationError('')
    return true
  }

  function summarizeAnnotations() {
    if (!artifact || !annotations.length) return
    try {
      const built = buildReviewCommand(selection.taskId, artifact.versionId, annotations)
      if (built.content.length > 16000) throw new Error('汇总内容超过消息长度上限，请减少单次提交的批注。')
      if (!onFillComposer(built)) {
        setAnnotationError('未替换聊天框草稿；批注已保留。')
        return
      }
      setAnnotationError('')
      if (typeof matchMedia === 'function' && matchMedia('(max-width: 900px)').matches) {
        onClose()
        requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('#steward-message')?.focus())
      }
    } catch (error) { setAnnotationError(error instanceof Error ? error.message : '批注汇总失败。') }
  }

  const reports = task?.artifacts.filter(item => item.kind === 'report') ?? []
  const attachments = task?.artifacts.filter(item => item.kind === 'attachment' && item.runId === artifact?.runId) ?? []
  const independentVersion = selection.versionId ?? artifact?.versionId
  const renderedText = renderedReportText && renderedReportText.versionId === artifact?.versionId ? renderedReportText.text : ''
  const craftAnnotations = annotations.filter(annotation => selectorStatus(renderedText, annotation.selector) === 'exact').map(toCraftAnnotation)
  const previewTitle = task ? task.goal || task.sourceUrl || `工作 ${task.id.slice(0, 8)}` : '正在读取工作…'
  const reportNumber = artifact ? reports.length - reports.findIndex(item => item.versionId === artifact.versionId) : null
  return <aside className={independent ? 'work-preview work-preview-independent' : 'work-preview'} aria-labelledby="work-preview-title">
    <PreviewHeader className="work-preview-craft-header py-[8px] px-[13px] gap-[11px] border-b border-border" height={independent ? 49 : 62}
      style={{ position: 'sticky', zIndex: 2, top: 0, background: 'var(--panel)' }} onClose={onClose}
      leftActions={<Button ref={closeButton} type="button" variant="ghost" size="sm" className="work-preview-back" onClick={onClose}>
        <ChevronLeft aria-hidden="true" />{independent ? '报告' : '返回对话'}
      </Button>}
      rightActions={artifact && <Button asChild type="button" variant="ghost" size="sm"><a href={`/api/artifacts/${artifact.versionId}/download`}><ArrowDownToLine aria-hidden="true" />下载</a></Button>}>
      {independent
        ? <PreviewHeaderBadge id="work-preview-title" icon={FileText} label={`${previewTitle}${reportNumber ? ` · 第 ${reportNumber} 版` : ''}`} title={previewTitle} shrinkable />
        : <><PreviewHeaderBadge label="报告" variant="read" /><PreviewHeaderBadge id="work-preview-title" label={previewTitle} title={previewTitle} shrinkable /></>}
    </PreviewHeader>
    <div ref={scroll} className="work-preview-scroll" onScroll={rememberScroll}>
      {task === undefined && <p className="muted" role="status">正在加载工作详情…</p>}
      {taskError && <p className="error" role="alert">{taskError}</p>}
      {task && <>
        <section className="work-preview-summary" aria-label="工作摘要">
          <span className="work-preview-status" data-status={task.status}>{statusLabel[task.status] ?? task.status}</span>
          <span className="work-preview-run">Run {task.run.id.slice(0, 8)}</span>
          <a href={`/tasks/${task.id}${independentVersion ? `?version=${encodeURIComponent(independentVersion)}` : ''}`}>打开工作详情</a>
          {task.run.failure && <p className="error">{task.run.failure}</p>}
          {task.interaction?.status === 'pending' && <p className="work-preview-interaction" role="status">
            {task.interaction.kind === 'limit' ? '等待额度决定' : '等待回答'}：{task.interaction.question} <a href={`/tasks/${task.id}`}>前往处理</a>
          </p>}
        </section>
        {!!reports.length && <div className="work-preview-toolbar"><nav className="work-preview-versions" aria-label="报告版本">
            {reports.map((item, index) => <Button key={item.versionId} type="button" variant="ghost" size="sm"
              className="work-preview-version-button" aria-pressed={artifact?.versionId === item.versionId}
              onClick={() => onSelect({ taskId: task.id, versionId: item.versionId })}>
              第 {reports.length - index} 版 <small>{new Date(item.createdAt).toLocaleString('zh-CN')}</small>
            </Button>)}
          </nav></div>}
        {versionError && <p className="error work-preview-version-error" role="alert">{versionError}</p>}
        {!versionError && !artifact && <p className="muted">这项工作尚无可读报告。</p>}
        {artifact && <>
          {reportError && <p className="error" role="alert">{reportError}</p>}
          {!reportError && report?.versionId !== artifact.versionId && <p className="muted" role="status">正在加载报告…</p>}
          {report?.versionId === artifact.versionId && <DocumentFormattedMarkdownOverlay
            content={report.markdown}
            isOpen
            onClose={onClose}
            sessionId={task.id}
            messageId={artifact.versionId}
            documentRef={reportRoot}
            documentAriaLabel="报告正文，可用鼠标选择文字添加批注"
            renderMarkdown={content => <AnnotatableMarkdownDocument
              content={content}
              messageId={artifact.versionId}
              sessionId={task.id}
              annotations={craftAnnotations}
              renderMarkdown={markdown => <ReportMarkdown markdown={markdown} />}
              onAddAnnotation={addCraftAnnotation}
              onUpdateAnnotation={updateCraftAnnotation}
              onRemoveAnnotation={removeCraftAnnotation}
              onDraftChange={persistCraftDraft}
              onDraftClear={clearCraftDraft}
              restoreDraft={restoredDraft ? { selection: toCraftSelection(restoredDraft.selector), note: restoredDraft.note,
                persistedAnnotationId: restoredDraft.persistedAnnotationId } : null}
              openSelectionRequest={keyboardSelectionRequest}
            />}
            beforeContent={<>
              <div className="work-preview-review-tools"><p className="review-hint">选中文字即可批注。批注保存在当前浏览器，并固定到此报告版本。</p>
                <Button type="button" variant="outline" size="sm" onClick={openKeyboardSelection}>键盘选择引用</Button></div>
              {keyboardReportText !== null && <section className="review-selection" aria-label="键盘选择报告引用">
                <strong>选择报告文字</strong>
                <label>报告纯文本<Textarea ref={keyboardSelection} readOnly rows={8} value={keyboardReportText}
                  onKeyDown={event => {
                    if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return
                    event.preventDefault()
                    selectKeyboardReportText()
                  }} /></label>
                <p className="review-hint">用 Shift + 方向键扩选，按 Enter 或使用下方按钮确认。</p>
                <div><Button type="button" size="sm" onClick={selectKeyboardReportText}>为所选文字写批注</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setKeyboardReportText(null)}>关闭</Button></div>
              </section>}
            </>}
            afterContent={<>
              {!!annotations.length && <section className="review-annotations" aria-label="未发送批注">
                <header><h3>未发送批注（{annotations.length}）</h3><Button type="button" size="sm" onClick={summarizeAnnotations}>汇总到聊天框</Button></header>
                {annotations.map((annotation, index) => <article key={annotation.id}>
                  <div><strong>批注 {index + 1}</strong><small>{selectorStatus(
                    renderedReportText?.versionId === artifact.versionId ? renderedReportText.text : '', annotation.selector) === 'exact'
                    ? '原文位置已确认' : '原文位置无法确认，保留引用'}</small></div>
                  <blockquote>{annotation.quote}</blockquote><p>{annotation.note}</p>
                  <Button type="button" className="review-annotation-delete" variant="outline" size="sm" onClick={() => removeAnnotation(annotation.id)}>删除</Button>
                </article>)}
              </section>}
              {annotationError && <p className="error" role="alert">{annotationError}</p>}
            </>}
          />}
          {!!attachments.length && <section className="work-preview-attachments"><h3>该版本附件</h3><ul>{attachments.map(item => <li key={item.versionId}>
            <a href={`/api/artifacts/${item.versionId}/download`}>{item.name}</a>
          </li>)}</ul></section>}
        </>}
      </>}
    </div>
  </aside>
}
