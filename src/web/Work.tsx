import { useEffect, useRef, useState, type FormEvent } from 'react'
import { EmptyStateCard } from './EmptyStateCard'
import Markdown from 'react-markdown'

type Model = { id: string; protocol: 'chat-completions' | 'responses' }
type Task = { id: string; goal: string; sourceUrl: string | null; status: string; createdAt: string }
type Artifact = { id: string; kind: 'report' | 'attachment'; name: string; versionId: string; runId: string; runStatus: string; sha256: string; sizeBytes: number; createdAt: string }
type Detail = Task & { run: { id: string; status: string; model: Model; cleanupState: string; failure: string | null; startedAt: string | null; finishedAt: string | null; previousReportVersionId: string | null }; runs: { id: string; status: string; createdAt: string; previousReportVersionId: string | null }[]; thread: { id: string; messages: { role: 'user'; content: string; status: 'pending' | 'applied' | 'carried' }[] }; artifacts: Artifact[] }
type RunEvent = { serverSeq: number; type: string; payload: Record<string, any>; occurredAt: string }
const statusLabel: Record<string, string> = { queued: '待执行', provisioning: '准备环境', running: '执行中', succeeded: '已完成', failed: '失败', lost: '执行中断', cancelled: '已取消', save_failed: '成果保存失败' }
const safeLink = (url: string) => {
  try {
    const parsed = new URL(url)
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : ''
  } catch { return '' }
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
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null)
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
  const [steerCommandId, setSteerCommandId] = useState(() => crypto.randomUUID())
  const [continuation, setContinuation] = useState('')
  const [continueRequestId, setContinueRequestId] = useState(() => crypto.randomUUID())

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
          const additions = await read<RunEvent[]>(await fetch(`${path}/events?after=${cursor.current}`))
          if (disposed) return
          const fresh = additions.filter(event => event.serverSeq > cursor.current)
          if (fresh.length) {
            cursor.current = fresh[fresh.length - 1].serverSeq
            setEvents(previous => [...previous, ...fresh])
          }
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

  const currentVersion = selectedVersion ?? detail?.artifacts.find(item => item.kind === 'report' && item.runStatus === 'succeeded')?.versionId
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

  const activity: { id: string; kind: 'message' | 'tool'; text: string; done: boolean }[] = []
  let draft = ''
  for (const event of events) {
    if (event.type === 'message.delta') draft += String(event.payload.delta ?? '')
    if (event.type === 'message.completed') {
      const text = String(event.payload.content || draft)
      if (text) activity.push({ id: String(event.serverSeq), kind: 'message', text, done: true })
      draft = ''
    }
    if (event.type === 'tool.started') activity.push({ id: String(event.payload.toolCallId), kind: 'tool', text: `${event.payload.name}(${JSON.stringify(event.payload.args)})`, done: false })
    if (event.type === 'tool.completed') {
      const item = activity.find(item => item.kind === 'tool' && item.id === event.payload.toolCallId)
      if (item) { item.text += ` → ${String(event.payload.result ?? '')}`; item.done = true }
    }
  }
  if (draft) activity.push({ id: 'stream', kind: 'message', text: draft, done: false })
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

  if (detailId) return <>
    <a href="/">返回工作列表</a>
    {error && <p className="error" role="alert">{error}</p>}
    {!detail && !error && <p className="muted" role="status">正在加载工作…</p>}
    {detail && <section className="work-detail">
      <p className="work-status">{statusLabel[detail.run.status] ?? detail.run.status}</p>
      <h2>{detail.goal || detail.sourceUrl}</h2>
      {detail.sourceUrl && <p><a href={detail.sourceUrl} target="_blank" rel="noopener noreferrer">{detail.sourceUrl}</a></p>}
      <p className="muted">模型：{detail.run.model.id} · 协议：{detail.run.model.protocol}</p>
      <h3>工作对话</h3>
      {detail.thread.messages.map((message, index) => <p className="work-message" key={index}>{message.content}{message.status === 'pending' && <span className="muted">（待处理{detail.run.status === 'running' ? '，将在下一模型步骤生效' : '，本次执行已结束，等待继续处理'}）</span>}{message.status === 'carried' && <span className="muted">（已纳入新 Run）</span>}</p>)}
      {detail.run.status === 'running' && <form className="work-form" onSubmit={submitSteer}>
        <label>追加要求<textarea value={steerContent} onChange={event => { setSteerContent(event.target.value); setSteerCommandId(crypto.randomUUID()) }} maxLength={4000} required rows={3} /></label>
        <button disabled={busy || !steerContent.trim()} type="submit">{busy ? '正在保存…' : '发送追加要求'}</button>
      </form>}
      {['succeeded', 'failed', 'lost', 'cancelled'].includes(detail.run.status) && detail.run.cleanupState === 'cleaned' && detail.artifacts.some(item => item.kind === 'report' && item.runStatus === 'succeeded') && <form className="work-form" onSubmit={submitContinuation}>
        <h3>继续这项工作</h3>
        <p className="muted">将原目标、既往要求和上一版报告交给新 Run；旧报告保留。</p>
        <label>修改要求<textarea value={continuation} onChange={event => { setContinuation(event.target.value); setContinueRequestId(crypto.randomUUID()) }} maxLength={4000} required rows={3} /></label>
        <label>模型<select value={modelId} onChange={event => setModelId(event.target.value)} required><option value="">请选择模型</option>{models.map(model => <option key={model.id} value={model.id}>{model.id}</option>)}</select></label>
        <label>协议<select value={protocol} onChange={event => setProtocol(event.target.value)}><option value="default">使用模型默认协议</option><option value="chat-completions">Chat Completions</option><option value="responses">Responses</option></select></label>
        <button disabled={busy || !continuation.trim() || !modelId} type="submit">{busy ? '正在保存…' : '创建新 Run'}</button>
      </form>}
      {activity.map(item => <p className="work-message" key={item.id}>{item.kind === 'tool' ? '工具：' : 'Agent：'}{item.text}{!item.done && '…'}</p>)}
      <p className="muted">用量：输入 {tokens('inputTokens') ?? '未知'} / 输出 {tokens('outputTokens') ?? '未知'} token</p>
      <p className="muted">实际费用：未知</p>
      <p className="muted">耗时：{detail.run.startedAt && detail.run.finishedAt ? `${Math.round((Date.parse(detail.run.finishedAt) - Date.parse(detail.run.startedAt)) / 1000)} 秒` : '未知'}</p>
      {detail.run.failure && <p className="error" role="alert">{detail.run.failure}</p>}
      {(detail.run.cleanupState === 'failed' || detail.run.cleanupState === 'blocked') && <p className="error" role="alert">{detail.run.cleanupState === 'blocked' ? '成果尚未安全保存；沙箱已保留。' : '沙箱回收失败，请重试。'} <button type="button" onClick={retryCleanup}>重试保存与回收</button></p>}
      {detail.artifacts.length > 0 && <section className="artifacts"><h3>成果</h3>
        {detail.artifacts.filter(item => item.kind === 'report').map((item, index, reports) => <button type="button" key={item.versionId} onClick={() => setSelectedVersion(item.versionId)} aria-pressed={currentVersion === item.versionId}>第 {reports.length - index} 版 · {new Date(item.createdAt).toLocaleString('zh-CN')} · Run {item.runId.slice(0, 8)}{item.runStatus !== 'succeeded' && ' · 未完成'}</button>)}
        {currentVersion && <><p><a href={`/api/artifacts/${currentVersion}/download`}>下载 Markdown 报告</a></p>
          <div className="report-markdown">{loadedVersion === currentVersion ? <Markdown skipHtml urlTransform={safeLink} components={{ a: props => <a {...props} target="_blank" rel="noopener noreferrer" />, img: () => null }}>{report}</Markdown> : <p role="status">正在加载报告…</p>}</div></>}
        {detail.artifacts.some(item => item.kind === 'attachment' && item.runId === detail.artifacts.find(report => report.versionId === currentVersion)?.runId) && <><h4>该版本附件</h4><ul>{detail.artifacts.filter(item => item.kind === 'attachment' && item.runId === detail.artifacts.find(report => report.versionId === currentVersion)?.runId).map(item => <li key={item.versionId}><a href={`/api/artifacts/${item.versionId}/download`}>{item.name}</a></li>)}</ul></>}
      </section>}
    </section>}
  </>

  return <>
    <form className="work-form" onSubmit={submit} onChange={() => setRequestId(crypto.randomUUID())}>
      <h2>创建工作</h2>
      <label>目标<textarea name="goal" rows={4} maxLength={4000} placeholder="描述希望完成的工作" /></label>
      <label>公开链接（可选）<input name="sourceUrl" type="url" placeholder="https://example.com" /></label>
      <label>模型<select value={modelId} onChange={event => setModelId(event.target.value)} required>
        <option value="">请选择模型</option>
        {models.map(model => <option key={model.id} value={model.id}>{model.id}</option>)}
      </select></label>
      <details><summary>高级选项</summary><label>协议<select value={protocol} onChange={event => setProtocol(event.target.value)}>
        <option value="default">使用模型默认协议</option>
        <option value="chat-completions">Chat Completions</option>
        <option value="responses">Responses</option>
      </select></label></details>
      <button disabled={busy || !modelId} type="submit">{busy ? '正在保存…' : '创建工作'}</button>
      {!models.length && <p className="muted">请先到<a href="/settings">设置</a>选择模型。</p>}
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    <section className="work-list"><h2>工作列表</h2>
      {tasks === null ? (!error && <p className="muted" role="status">正在加载工作…</p>) : tasks.length === 0 ?
        <EmptyStateCard title="还没有工作" description="创建后会显示在这里。" /> :
        <ul className="task-list">{tasks.map(task => <li key={task.id}><a href={`/tasks/${task.id}`}>{task.goal || task.sourceUrl}</a><span>{statusLabel[task.status] ?? task.status}</span></li>)}</ul>}
    </section>
  </>
}
