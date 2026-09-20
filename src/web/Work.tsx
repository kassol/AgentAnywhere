import { useEffect, useRef, useState, type FormEvent } from 'react'
import { EmptyStateCard } from './EmptyStateCard'
import { buildToolActivities, readActivityPages, StableScroll, ToolActivityList, type ActivityEvent } from './ActivityFeed'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './work.css'

type Model = { id: string; protocol: 'chat-completions' | 'responses' }
type Task = { id: string; goal: string; sourceUrl: string | null; status: string; createdAt: string }
type Artifact = { id: string; kind: 'report' | 'attachment'; name: string; versionId: string; runId: string; runStatus: string; sha256: string; sizeBytes: number; createdAt: string }
type Detail = Task & { run: { id: string; status: string; model: Model; cleanupState: string; failure: string | null; startedAt: string | null; finishedAt: string | null; previousReportVersionId: string | null; retryOfRunId: string | null; modelCalls: number; modelCallLimit: number; activeMs: number; activeLimitMs: number; budgetReason: string | null }; runs: { id: string; status: string; createdAt: string; previousReportVersionId: string | null; retryOfRunId: string | null }[]; interaction: { id: string; kind: 'question' | 'limit'; question: string; status: string; answer: string | null } | null; thread: { id: string; messages: { role: 'user'; content: string; status: 'pending' | 'applied' | 'carried' }[] }; artifacts: Artifact[] }
type RunEvent = ActivityEvent & { epoch: number }
export function selectReportVersion<T extends { kind: string; versionId: string; runStatus: string }>(artifacts: T[], requested?: string | null) {
  const reports = artifacts.filter(item => item.kind === 'report')
  return requested ? reports.find(item => item.versionId === requested) : reports.find(item => item.runStatus === 'succeeded')
}
const statusLabel: Record<string, string> = { queued: '待执行', provisioning: '准备环境', running: '执行中', waiting: '等待回答', cancelling: '正在取消', cancelled: '已取消', succeeded: '已完成', failed: '失败', lost: '执行中断', save_failed: '成果保存失败' }
const activeStatuses = ['queued', 'provisioning', 'running', 'waiting']
const finishedStatuses = ['succeeded', 'failed', 'lost', 'cancelled']
function WorkGlyph({ name }: { name: 'work' | 'arrow' | 'back' }) {
  const path = name === 'work' ? <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M8 6V4h8v2M3 11h18" /></>
    : name === 'back' ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />
  return <svg className="work-glyph" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
}
const safeLink = (url: string) => {
  if (/^\/tasks\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(url)
    || /^\/tasks\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\?version=[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(url)
    || /^\/api\/artifacts\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(content|download)$/i.test(url)) return url
  try {
    const parsed = new URL(url)
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : ''
  } catch { return '' }
}
const reportMarkdownComponents: Components = {
  a: props => <a {...props} target="_blank" rel="noopener noreferrer" />,
  img: () => null,
}

export function ReportMarkdown({ markdown }: { markdown: string }) {
  return <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={safeLink} components={reportMarkdownComponents}>{markdown}</Markdown>
}

async function read<T>(response: Response): Promise<T> {
  if (response.status === 401) location.assign('/login')
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || '请求失败')
  return body as T
}

export function Work() {
  const detailId = location.pathname.startsWith('/tasks/') ? location.pathname.slice('/tasks/'.length) : null
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const requestedVersion = new URLSearchParams(location.search).get('version')
  const [selectedVersion, setSelectedVersion] = useState<string | null>(requestedVersion)
  const [report, setReport] = useState('')
  const [loadedVersion, setLoadedVersion] = useState<string | null>(null)
  const [events, setEvents] = useState<RunEvent[]>([])
  const cursor = useRef(0)
  const currentRun = useRef<string | null>(null)
  const [models, setModels] = useState<Model[]>([])
  const [modelId, setModelId] = useState('')
  const [protocol, setProtocol] = useState('default')
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [steerContent, setSteerContent] = useState('')
  const [answer, setAnswer] = useState('')
  const [steerCommandId, setSteerCommandId] = useState(() => crypto.randomUUID())
  const [continuation, setContinuation] = useState('')
  const [continueRequestId, setContinueRequestId] = useState(() => crypto.randomUUID())
  const [retryRequestId, setRetryRequestId] = useState(() => crypto.randomUUID())

  useEffect(() => {
    const path = detailId ? `/api/tasks/${detailId}` : '/api/tasks'
    let loading = false
    let disposed = false
    async function refresh() {
      if (loading || disposed) return
      loading = true
      try {
        const value = await read<Detail | Task[]>(await fetch(path))
        if (disposed) return
        if (Array.isArray(value)) setTasks(value)
        else {
          if (currentRun.current !== value.run.id) { currentRun.current = value.run.id; cursor.current = 0; setEvents([]) }
          setDetail(value)
          const loaded = await readActivityPages(cursor.current, after => fetch(`${path}/events?after=${after}`).then(response => read<RunEvent[]>(response)))
          if (disposed) return
          cursor.current = loaded.cursor
          if (loaded.events.length) setEvents(previous => [...previous, ...loaded.events])
        }
      } finally { loading = false }
    }
    void refresh().catch(error => setError(error.message))
    const timer = detailId ? setInterval(() => void refresh().catch(error => setError(error.message)), 1000) : undefined
    fetch('/api/model-connection').then(response => read<{ models: Model[]; defaultModel: string | null }>(response)).then(value => {
      setModels(value.models)
      setModelId(value.defaultModel ?? value.models[0]?.id ?? '')
    }).catch(error => setError(error.message))
    return () => { disposed = true; if (timer) clearInterval(timer) }
  }, [detailId])

  const currentVersion = detail ? selectReportVersion(detail.artifacts, selectedVersion)?.versionId : undefined
  useEffect(() => {
    if (!currentVersion) return
    let disposed = false
    setReport('')
    setLoadedVersion(null)
    fetch(`/api/artifacts/${currentVersion}/content`).then(response => read<{ markdown: string }>(response))
      .then(value => { if (!disposed) { setReport(value.markdown); setLoadedVersion(currentVersion) } })
      .catch(error => { if (!disposed) setError(error.message) })
    return () => { disposed = true }
  }, [currentVersion])

  const messagesByEpoch = new Map<number, { id: string; text: string; done: boolean }[]>()
  const drafts = new Map<number, string>()
  for (const event of events) {
    if (event.type === 'message.delta') drafts.set(event.epoch, (drafts.get(event.epoch) ?? '') + String(event.payload.delta ?? ''))
    if (event.type === 'message.completed') {
      const text = String(event.payload.content || drafts.get(event.epoch) || '')
      if (text) messagesByEpoch.set(event.epoch, [...(messagesByEpoch.get(event.epoch) ?? []), { id: String(event.serverSeq), text, done: true }])
      drafts.delete(event.epoch)
    }
  }
  for (const [epoch, text] of drafts) if (text) messagesByEpoch.set(epoch, [...(messagesByEpoch.get(epoch) ?? []), { id: `stream:${epoch}`, text, done: false }])
  const toolActivities = buildToolActivities(events)
  const activityEpochs = [...new Set([...messagesByEpoch.keys(), ...toolActivities.map(item => Number(item.scopeId))])].filter(Number.isFinite).sort((a, b) => a - b)
  const usageByCall = new Map<string, Record<string, any>>()
  for (const event of events) if (event.type === 'usage') usageByCall.set(String(event.payload.callId ?? event.serverSeq), event.payload)
  const usage = [...usageByCall.values()]
  const tokens = (field: string) => usage.length && usage.every(item => typeof item[field] === 'number')
    ? usage.reduce((sum, item) => sum + item[field], 0) : null

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    try {
      const created = await read<Detail>(await fetch('/api/tasks', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId, goal: form.get('goal'), sourceUrl: form.get('sourceUrl'), modelId,
          ...(protocol === 'default' ? {} : { protocol }) }),
      }))
      location.assign(`/tasks/${created.id}`)
    } catch (error) {
      setError(error instanceof Error ? error.message : '创建工作失败')
    } finally { setBusy(false) }
  }

  async function submitSteer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!detail) return
    setBusy(true)
    setError('')
    try {
      await read(await fetch(`/api/runs/${detail.run.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commandId: steerCommandId, kind: 'steer', content: steerContent }) }))
      setDetail(await read<Detail>(await fetch(`/api/tasks/${detail.id}`)))
      setSteerContent('')
      setSteerCommandId(crypto.randomUUID())
    } catch (error) { setError(error instanceof Error ? error.message : '追加要求失败') }
    finally { setBusy(false) }
  }

  async function submitContinuation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!detail) return
    setBusy(true)
    setError('')
    try {
      const updated = await read<Detail>(await fetch(`/api/tasks/${detail.id}/runs`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: continueRequestId, content: continuation, modelId,
          ...(protocol === 'default' ? {} : { protocol }) }) }))
      setDetail(updated)
      setSelectedVersion(null)
      currentRun.current = updated.run.id
      cursor.current = 0
      setEvents([])
      setContinuation('')
      setContinueRequestId(crypto.randomUUID())
    } catch (error) { setError(error instanceof Error ? error.message : '继续工作失败') }
    finally { setBusy(false) }
  }

  async function retryCleanup() {
    try { await read(await fetch(`/api/tasks/${detailId}/cleanup-retry`, { method: 'POST' })) }
    catch (error) { setError(error instanceof Error ? error.message : '重试失败') }
  }

  async function submitAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!detail?.interaction) return
    setBusy(true)
    setError('')
    try {
      await read(await fetch(`/api/interactions/${detail.interaction.id}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answer }) }))
      setDetail(await read<Detail>(await fetch(`/api/tasks/${detail.id}`)))
    } catch (error) { setError(error instanceof Error ? error.message : '回答失败') }
    finally { setBusy(false) }
  }

  async function decideLimit(decision: 'continue' | 'finish') {
    if (!detail?.interaction) return
    setBusy(true)
    setError('')
    try {
      await read(await fetch(`/api/interactions/${detail.interaction.id}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answer: decision }) }))
      setDetail(await read<Detail>(await fetch(`/api/tasks/${detail.id}`)))
    } catch (error) { setError(error instanceof Error ? error.message : '决定保存失败') }
    finally { setBusy(false) }
  }

  async function retry() {
    if (!detail) return
    setBusy(true)
    setError('')
    try {
      const updated = await read<Detail>(await fetch(`/api/tasks/${detail.id}/retry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: retryRequestId }) }))
      setDetail(updated)
      currentRun.current = updated.run.id
      cursor.current = 0
      setEvents([])
      setRetryRequestId(crypto.randomUUID())
    } catch (error) { setError(error instanceof Error ? error.message : '重试失败') }
    finally { setBusy(false) }
  }

  async function cancel() {
    setBusy(true)
    try {
      await read(await fetch(`/api/tasks/${detailId}/cancel`, { method: 'POST' }))
      const updated = await read<Detail>(await fetch(`/api/tasks/${detailId}`))
      setDetail(updated)
    } catch (error) { setError(error instanceof Error ? error.message : '取消失败') }
    finally { setBusy(false) }
  }

  if (detailId) return <div className="work-detail-page">
    <a className="work-back" href="/tasks"><WorkGlyph name="back" />返回工作列表</a>
    {error && <p className="error" role="alert">{error}</p>}
    {!detail && !error && <div className="work-loading muted" role="status">正在加载工作…</div>}
    {detail && <section className="work-detail">
      <header className="work-detail-header">
        <div className="work-detail-heading"><span className="work-status" data-status={detail.run.status}>{statusLabel[detail.run.status] ?? detail.run.status}</span>
          <h2>{detail.goal || detail.sourceUrl}</h2>
          {detail.sourceUrl && <a className="work-source" href={detail.sourceUrl} target="_blank" rel="noopener noreferrer">{detail.sourceUrl}</a>}
        </div>
        {activeStatuses.includes(detail.run.status) && <button className="work-danger-button" type="button" disabled={busy} onClick={cancel}>取消工作</button>}
      </header>
      <dl className="work-metadata">
        <div><dt>模型</dt><dd>{detail.run.model.id}</dd></div>
        <div><dt>协议</dt><dd>{detail.run.model.protocol}</dd></div>
        <div><dt>执行额度</dt><dd>{detail.run.modelCalls}/{detail.run.modelCallLimit} 次 · {Math.ceil(detail.run.activeMs / 60000)}/{Math.ceil(detail.run.activeLimitMs / 60000)} 分钟</dd></div>
      </dl>
      {detail.run.retryOfRunId && <p className="work-run-note muted">从 Run {detail.run.retryOfRunId.slice(0, 8)} 手动重试。</p>}
      {detail.runs.length > 1 && <details className="work-history"><summary>执行历史 · {detail.runs.length} 次</summary><ul>{detail.runs.map(run => <li key={run.id}>Run {run.id.slice(0, 8)} · {statusLabel[run.status] ?? run.status}{run.retryOfRunId && ` · 重试 ${run.retryOfRunId.slice(0, 8)}`}</li>)}</ul></details>}
      <section className="work-conversation" aria-labelledby="work-conversation-title"><header><h3 id="work-conversation-title">工作对话</h3><span>{detail.thread.messages.length} 条要求</span></header>
      {detail.interaction?.status === 'pending' && detail.interaction.kind === 'question' && <form className="work-form work-interaction" onSubmit={submitAnswer}>
        <p className="work-message">Agent 提问：{detail.interaction.question}</p>
        <label>回答<textarea value={answer} onChange={event => setAnswer(event.target.value)} maxLength={4000} required rows={3} /></label>
        <button disabled={busy || !answer.trim() || detail.run.status !== 'waiting' || detail.run.cleanupState !== 'cleaned'} type="submit">提交回答</button>
      </form>}
      {detail.interaction?.status === 'pending' && detail.interaction.kind === 'limit' && <div className="work-form work-interaction">
        <p className="work-message">{detail.interaction.question}</p>
        <div className="work-form-actions"><button type="button" disabled={busy || detail.run.cleanupState !== 'cleaned'} onClick={() => void decideLimit('continue')}>增加额度并继续</button>
          <button type="button" className="work-secondary-button" disabled={busy || detail.run.cleanupState !== 'cleaned'} onClick={() => void decideLimit('finish')}>结束执行</button></div>
      </div>}
      {detail.interaction?.status === 'answered' && <p className="work-message">回答：{detail.interaction.answer}</p>}
      {['failed', 'lost'].includes(detail.run.status) && detail.run.cleanupState === 'cleaned' && <button className="work-standalone-action" type="button" disabled={busy} onClick={() => void retry()}>手动重试（创建新 Run）</button>}
      {detail.thread.messages.map((message, index) => <p className="work-message" key={index}>{message.content}{message.status === 'pending' && <span className="muted">（待处理{detail.run.status === 'running' ? '，将在下一模型步骤生效' : '，本次执行已结束，等待继续处理'}）</span>}{message.status === 'carried' && <span className="muted">（已纳入新 Run）</span>}</p>)}
      {detail.run.status === 'running' && <form className="work-form work-inline-form" onSubmit={submitSteer}>
        <label>追加要求<textarea value={steerContent} onChange={event => { setSteerContent(event.target.value); setSteerCommandId(crypto.randomUUID()) }} maxLength={4000} required rows={3} /></label>
        <button disabled={busy || !steerContent.trim()} type="submit">{busy ? '正在保存…' : '发送追加要求'}</button>
      </form>}
      {finishedStatuses.includes(detail.run.status) && detail.run.cleanupState === 'cleaned' && detail.artifacts.some(item => item.kind === 'report' && item.runStatus === 'succeeded') && <form className="work-form work-continuation" onSubmit={submitContinuation}>
        <h3>继续这项工作</h3>
        <p className="muted">将原目标、既往要求和上一版报告交给新 Run；旧报告保留。</p>
        <label>修改要求<textarea value={continuation} onChange={event => { setContinuation(event.target.value); setContinueRequestId(crypto.randomUUID()) }} maxLength={4000} required rows={3} /></label>
        <div className="work-form-grid"><label>模型<select value={modelId} onChange={event => setModelId(event.target.value)} required><option value="">请选择模型</option>{models.map(model => <option key={model.id} value={model.id}>{model.id}</option>)}</select></label>
          <label>协议<select value={protocol} onChange={event => setProtocol(event.target.value)}><option value="default">使用模型默认协议</option><option value="chat-completions">Chat Completions</option><option value="responses">Responses</option></select></label></div>
        <button disabled={busy || !continuation.trim() || !modelId} type="submit">{busy ? '正在保存…' : '创建新 Run'}</button>
      </form>}
      </section>
      {!!activityEpochs.length && <section className="work-activity" aria-label="执行活动"><h3>执行活动</h3>
        <StableScroll storageKey={`agentanywhere:work-scroll:${detail.run.id}`} revision={events.at(-1)?.serverSeq ?? 0} className="work-activity-scroll">
          {activityEpochs.map(epoch => <section className="work-activity-epoch" key={epoch} aria-labelledby={`epoch-${epoch}`}>
            <h4 id={`epoch-${epoch}`}>执行阶段 {epoch}</h4>
            <ToolActivityList activities={toolActivities.filter(item => item.scopeId === String(epoch))} />
            {messagesByEpoch.get(epoch)?.map(item => <article className="work-agent-message" key={item.id}><strong>Agent</strong><ReportMarkdown markdown={item.text} />{!item.done && <small>生成中</small>}</article>)}
          </section>)}
        </StableScroll>
      </section>}
      <dl className="work-usage muted"><div><dt>用量</dt><dd>输入 {tokens('inputTokens') ?? '未知'} / 输出 {tokens('outputTokens') ?? '未知'} token</dd></div><div><dt>实际费用</dt><dd>未知</dd></div><div><dt>耗时</dt><dd>{detail.run.startedAt && detail.run.finishedAt ? `${Math.round((Date.parse(detail.run.finishedAt) - Date.parse(detail.run.startedAt)) / 1000)} 秒` : '未知'}</dd></div></dl>
      {detail.run.failure && <p className="error" role="alert">{detail.run.failure}</p>}
      {(detail.run.cleanupState === 'failed' || detail.run.cleanupState === 'blocked') && <p className="error" role="alert">{detail.run.cleanupState === 'blocked' ? '成果尚未安全保存；沙箱已保留。' : '沙箱回收失败，请重试。'} <button type="button" onClick={retryCleanup}>重试保存与回收</button></p>}
      {selectedVersion && !currentVersion && <p className="error" role="alert">指定报告版本不存在或不属于当前工作。</p>}
      {detail.artifacts.length > 0 && <section className="artifacts"><header><h3>成果</h3>{currentVersion && <a href={`/api/artifacts/${currentVersion}/download`}>下载 Markdown</a>}</header>
        <div className="artifact-versions" role="group" aria-label="报告版本">{detail.artifacts.filter(item => item.kind === 'report').map((item, index, reports) => <button type="button" key={item.versionId} onClick={() => setSelectedVersion(item.versionId)} aria-pressed={currentVersion === item.versionId}>第 {reports.length - index} 版<span>{new Date(item.createdAt).toLocaleString('zh-CN')} · Run {item.runId.slice(0, 8)}{item.runStatus !== 'succeeded' && ' · 未完成'}</span></button>)}</div>
        {currentVersion && <>
          <div className="report-markdown">{loadedVersion === currentVersion ? <ReportMarkdown markdown={report} /> : <p role="status">正在加载报告…</p>}</div></>}
        {detail.artifacts.some(item => item.kind === 'attachment' && item.runId === detail.artifacts.find(report => report.versionId === currentVersion)?.runId) && <><h4>该版本附件</h4><ul>{detail.artifacts.filter(item => item.kind === 'attachment' && item.runId === detail.artifacts.find(report => report.versionId === currentVersion)?.runId).map(item => <li key={item.versionId}><a href={`/api/artifacts/${item.versionId}/download`}>{item.name}</a></li>)}</ul></>}
      </section>}
    </section>}
  </div>

  return <div className="work-index">
    <form className="work-form work-create" onSubmit={submit} onChange={() => setRequestId(crypto.randomUUID())}>
      <header><div><h2>创建工作</h2><p>写清目标，Agent 会在隔离环境中执行并保存结果。</p></div></header>
      <label className="work-goal-field"><span>目标</span><textarea name="goal" rows={3} maxLength={4000} placeholder="描述希望完成的工作" /></label>
      <div className="work-create-options"><label><span>公开链接 <small>可选</small></span><input name="sourceUrl" type="url" placeholder="https://example.com" /></label>
        <label>模型<select value={modelId} onChange={event => setModelId(event.target.value)} required>
          <option value="">请选择模型</option>
          {models.map(model => <option key={model.id} value={model.id}>{model.id}</option>)}
        </select></label></div>
      <div className="work-create-footer"><details><summary>高级选项</summary><label>协议<select value={protocol} onChange={event => setProtocol(event.target.value)}>
          <option value="default">使用模型默认协议</option>
          <option value="chat-completions">Chat Completions</option>
          <option value="responses">Responses</option>
        </select></label></details>
        <button disabled={busy || !modelId} type="submit">{busy ? '正在保存…' : '创建工作'}</button></div>
      {!models.length && <p className="work-form-note muted">请先到<a href="/settings">设置</a>选择模型。</p>}
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    <section className="work-list"><header><div><h2>工作列表</h2><p>按最近创建排序</p></div>{tasks && <span>{tasks.length} 项</span>}</header>
      {tasks === null ? (!error && <div className="work-loading muted" role="status">正在加载工作…</div>) : tasks.length === 0 ?
        <EmptyStateCard title="还没有工作" description="创建后会显示在这里。" /> :
        <ul className="task-list">{tasks.map(task => <li key={task.id}><a href={`/tasks/${task.id}`}>
          <span className="task-list-icon"><WorkGlyph name="work" /></span>
          <span className="task-list-copy"><strong>{task.goal || task.sourceUrl}</strong><small>{new Date(task.createdAt).toLocaleString('zh-CN')}</small></span>
          <span className="work-status" data-status={task.status}>{statusLabel[task.status] ?? task.status}</span><WorkGlyph name="arrow" />
        </a></li>)}</ul>}
    </section>
  </div>
}
