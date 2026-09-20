/*
 * Preview header and document surface adapted from Craft Agents OSS
 * PreviewHeader.tsx and DocumentFormattedMarkdownOverlay.tsx at
 * e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 */
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { ReportMarkdown, selectReportVersion } from './Work'
import './work-preview.css'

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
  artifacts: PreviewArtifact[]
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

  return <div className={`preview-workspace${selection ? ' has-preview' : ''}`}>
    <div className="preview-workspace-main" onClickCapture={capture}>{children}</div>
    {selection && <WorkPreview key={selection.taskId} selection={selection} onSelect={next => open(next)} onClose={close} />}
  </div>
}

function WorkPreview({ selection, onSelect, onClose }: { selection: PreviewSelection; onSelect(selection: PreviewSelection): void; onClose(): void }) {
  const [task, setTask] = useState<PreviewTask | null | undefined>()
  const [taskError, setTaskError] = useState('')
  const [report, setReport] = useState<{ versionId: string; markdown: string } | null>(null)
  const [reportError, setReportError] = useState('')
  const scroll = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const frame = useRef<number>()

  useEffect(() => { closeButton.current?.focus() }, [])
  useEffect(() => {
    const controller = new AbortController()
    setTask(undefined)
    setTaskError('')
    fetch(`/api/tasks/${selection.taskId}`, { signal: controller.signal }).then(async response => {
      if (response.status === 401) return location.assign('/login')
      if (!response.ok) throw new Error(response.status === 404 ? '工作不存在或无权访问。' : '工作详情加载失败。')
      setTask(await response.json())
    }).catch(error => { if (error.name !== 'AbortError') { setTask(null); setTaskError(error.message) } })
    return () => controller.abort()
  }, [selection.taskId])

  const resolved = task ? resolveReportVersion(task.artifacts, selection.versionId) : { artifact: null }
  const artifact = 'artifact' in resolved ? resolved.artifact : null
  const versionError = 'error' in resolved ? resolved.error : ''

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

  const reports = task?.artifacts.filter(item => item.kind === 'report') ?? []
  const attachments = task?.artifacts.filter(item => item.kind === 'attachment' && item.runId === artifact?.runId) ?? []
  const independentVersion = selection.versionId ?? artifact?.versionId
  return <aside className="work-preview" aria-labelledby="work-preview-title">
    <header className="work-preview-header">
      <button ref={closeButton} type="button" className="work-preview-back" onClick={onClose}>← 返回对话</button>
      <div><span>工作预览</span><h2 id="work-preview-title">{task?.goal ?? '正在读取工作…'}</h2></div>
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
          {report?.versionId === artifact.versionId && <article className="work-preview-report" data-task-id={task.id} data-report-version={artifact.versionId}>
            <ReportMarkdown markdown={report.markdown} />
          </article>}
          {!!attachments.length && <section className="work-preview-attachments"><h3>该版本附件</h3><ul>{attachments.map(item => <li key={item.versionId}>
            <a href={`/api/artifacts/${item.versionId}/download`}>{item.name}</a>
          </li>)}</ul></section>}
        </>}
      </>}
    </div>
  </aside>
}
