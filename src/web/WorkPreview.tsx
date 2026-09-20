/*
 * Preview header and document surface adapted from Craft Agents OSS
 * PreviewHeader.tsx and DocumentFormattedMarkdownOverlay.tsx at
 * e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { ReportMarkdown, selectReportVersion } from './Work'
import { buildReviewCommand, captureTextSelection, readReportAnnotationDraft, readReportAnnotations, selectorStatus,
  writeReportAnnotationDraft, writeReportAnnotations,
  type ReportAnnotation, type ReviewContext, type TextQuoteSelector } from './ReviewAnnotations'
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

function WorkPreview({ selection, onSelect, onClose, onFillComposer }: { selection: PreviewSelection; onSelect(selection: PreviewSelection): void;
  onClose(): void; onFillComposer(payload: ReviewComposerPayload): boolean }) {
  const [task, setTask] = useState<PreviewTask | null | undefined>()
  const [taskError, setTaskError] = useState('')
  const [report, setReport] = useState<{ versionId: string; markdown: string } | null>(null)
  const [reportError, setReportError] = useState('')
  const scroll = useRef<HTMLDivElement>(null)
  const reportRoot = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const frame = useRef<number>()
  const [annotations, setAnnotations] = useState<ReportAnnotation[]>([])
  const [pendingSelection, setPendingSelection] = useState<TextQuoteSelector | null>(null)
  const [note, setNote] = useState('')
  const [annotationError, setAnnotationError] = useState('')

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
    if (!artifact) { setAnnotations([]); setPendingSelection(null); setNote(''); return }
    setAnnotations(readReportAnnotations(selection.taskId, artifact.versionId))
    const draft = readReportAnnotationDraft(selection.taskId, artifact.versionId)
    setPendingSelection(draft?.selector ?? null)
    setNote(draft?.note ?? '')
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

  function selectReportText() {
    const selector = reportRoot.current ? captureTextSelection(reportRoot.current) : null
    if (!selector) return
    if (selector.exact.length > 4000) {
      setAnnotationError('单条引用最多 4000 个字符，请缩小选区。')
      return
    }
    if (pendingSelection && !confirmAnnotationReplacement(note)) return
    setPendingSelection(selector)
    setNote('')
    const stored = artifact && writeReportAnnotationDraft(selection.taskId, artifact.versionId, { selector, note: '' })
    setAnnotationError(stored ? '' : '浏览器无法保存批注草稿；当前选区仍保留，请勿刷新或切换版本。')
  }

  function changeAnnotationNote(value: string) {
    setNote(value)
    if (artifact && pendingSelection && !writeReportAnnotationDraft(selection.taskId, artifact.versionId, { selector: pendingSelection, note: value })) {
      setAnnotationError('浏览器无法保存批注草稿；当前意见仍保留，请勿刷新或切换版本。')
    } else setAnnotationError('')
  }

  function cancelAnnotation() {
    if (artifact && !writeReportAnnotationDraft(selection.taskId, artifact.versionId, null)) {
      setAnnotationError('浏览器无法清除批注草稿，请重试。')
      return
    }
    setPendingSelection(null)
    setNote('')
  }

  function addAnnotation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!artifact || !pendingSelection || !note.trim()) return
    const now = Date.now()
    const next = [...annotations, { id: crypto.randomUUID(), taskId: selection.taskId, versionId: artifact.versionId,
      quote: pendingSelection.exact, note: note.trim(), selector: pendingSelection, createdAt: now, updatedAt: now }]
    if (!writeReportAnnotations(selection.taskId, artifact.versionId, next)) {
      setAnnotationError('浏览器无法保存批注；所选原文和意见仍保留，请重试。')
      return
    }
    setAnnotations(next)
    if (!writeReportAnnotationDraft(selection.taskId, artifact.versionId, null)) {
      setAnnotationError('批注已保存，但临时草稿无法清除；请重试取消。')
      return
    }
    setPendingSelection(null)
    setNote('')
    getSelection()?.removeAllRanges()
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

  function summarizeAnnotations() {
    if (!artifact || !annotations.length) return
    try {
      const built = buildReviewCommand(selection.taskId, artifact.versionId, annotations)
      if (built.content.length > 16000) throw new Error('汇总内容超过消息长度上限，请减少单次提交的批注。')
      if (!onFillComposer(built)) return
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
  return <aside className="work-preview" aria-labelledby="work-preview-title">
    <header className="work-preview-header">
      <button ref={closeButton} type="button" className="work-preview-back" onClick={onClose}>← 返回对话</button>
      <div><span>工作预览</span><h2 id="work-preview-title">{task ? task.goal || task.sourceUrl || `工作 ${task.id.slice(0, 8)}` : '正在读取工作…'}</h2></div>
      <button type="button" className="work-preview-close" aria-label="关闭预览" onClick={onClose}>×</button>
    </header>
    <div ref={scroll} className="work-preview-scroll" onScroll={rememberScroll}>
      {task === undefined && <p className="muted" role="status">正在加载工作详情…</p>}
      {taskError && <p className="error" role="alert">{taskError}</p>}
      {task && <>
        <section className="work-preview-summary" aria-label="工作摘要">
          <span className="work-preview-status">{statusLabel[task.status] ?? task.status}</span>
          <a href={`/tasks/${task.id}${independentVersion ? `?version=${encodeURIComponent(independentVersion)}` : ''}`}>独立打开工作</a>
          {task.run.failure && <p className="error">{task.run.failure}</p>}
          {task.interaction?.status === 'pending' && <p className="work-preview-interaction" role="status">
            {task.interaction.kind === 'limit' ? '等待额度决定' : '等待回答'}：{task.interaction.question} <a href={`/tasks/${task.id}`}>前往处理</a>
          </p>}
        </section>
        {!!reports.length && <nav className="work-preview-versions" aria-label="报告版本">
          {reports.map((item, index) => <button key={item.versionId} type="button" aria-pressed={artifact?.versionId === item.versionId}
            onClick={() => onSelect({ taskId: task.id, versionId: item.versionId })}>
            第 {reports.length - index} 版 <small>{new Date(item.createdAt).toLocaleString('zh-CN')}</small>
          </button>)}
        </nav>}
        {versionError && <p className="error work-preview-version-error" role="alert">{versionError}</p>}
        {!versionError && !artifact && <p className="muted">这项工作尚无可读报告。</p>}
        {artifact && <>
          <div className="work-preview-report-actions">
            <span>报告版本 {artifact.versionId.slice(0, 8)}</span>
            <a href={`/api/artifacts/${artifact.versionId}/download`}>下载 Markdown</a>
          </div>
          {reportError && <p className="error" role="alert">{reportError}</p>}
          {!reportError && report?.versionId !== artifact.versionId && <p className="muted" role="status">正在加载报告…</p>}
          {report?.versionId === artifact.versionId && <>
            <p className="review-hint">鼠标选中文字后可直接批注；键盘在正文中用 Shift + 方向键扩选，按 Enter 写批注。批注仅保存在当前浏览器，并固定到此报告版本。</p>
            <article ref={reportRoot} className="work-preview-report" data-task-id={task.id} data-report-version={artifact.versionId}
              tabIndex={0} aria-label="报告正文，可选择文字并按 Enter 添加批注" onMouseUp={selectReportText}
              onKeyDown={event => {
                if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return
                event.preventDefault()
                selectReportText()
              }}>
              <ReportMarkdown markdown={report.markdown} />
            </article>
            {pendingSelection && <form className="review-selection" onSubmit={addAnnotation}>
              <strong>为所选文字添加批注</strong>
              <blockquote>{pendingSelection.exact}</blockquote>
              <label>意见<textarea autoFocus rows={3} maxLength={2000} required value={note} onChange={event => changeAnnotationNote(event.target.value)} /></label>
              <div><button type="submit" disabled={!note.trim()}>保存批注</button>
                <button type="button" className="secondary" onClick={cancelAnnotation}>取消</button></div>
            </form>}
            {!!annotations.length && <section className="review-annotations" aria-label="未发送批注">
              <header><h3>未发送批注（{annotations.length}）</h3><button type="button" onClick={summarizeAnnotations}>汇总到聊天框</button></header>
              {annotations.map((annotation, index) => <article key={annotation.id}>
                <div><strong>批注 {index + 1}</strong><small>{selectorStatus(reportRoot.current?.textContent ?? '', annotation.selector) === 'exact'
                  ? '原文位置已确认' : '原文位置无法确认，保留引用'}</small></div>
                <blockquote>{annotation.quote}</blockquote><p>{annotation.note}</p>
                <button type="button" className="secondary" onClick={() => removeAnnotation(annotation.id)}>删除</button>
              </article>)}
            </section>}
            {annotationError && <p className="error" role="alert">{annotationError}</p>}
          </>}
          {!!attachments.length && <section className="work-preview-attachments"><h3>该版本附件</h3><ul>{attachments.map(item => <li key={item.versionId}>
            <a href={`/api/artifacts/${item.versionId}/download`}>{item.name}</a>
          </li>)}</ul></section>}
        </>}
      </>}
    </div>
  </aside>
}
