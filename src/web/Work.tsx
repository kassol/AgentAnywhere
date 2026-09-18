import { useEffect, useRef, useState, type FormEvent } from 'react'
import { EmptyStateCard } from './EmptyStateCard'

type Model = { id: string; protocol: 'chat-completions' | 'responses' }
type Task = { id: string; goal: string; sourceUrl: string | null; status: string; createdAt: string }
type Detail = Task & { run: { id: string; status: string; model: Model; cleanupState: string; failure: string | null; startedAt: string | null; finishedAt: string | null }; thread: { id: string; messages: { role: 'user'; content: string }[] } }
type RunEvent = { serverSeq: number; type: string; payload: Record<string, any>; occurredAt: string }
const statusLabel: Record<string, string> = { queued: '待执行', provisioning: '准备环境', running: '执行中', succeeded: '已完成', failed: '失败', lost: '执行中断' }

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
  const [events, setEvents] = useState<RunEvent[]>([])
  const cursor = useRef(0)
  const [models, setModels] = useState<Model[]>([])
  const [modelId, setModelId] = useState('')
  const [protocol, setProtocol] = useState('default')
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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
    if (!detailId) fetch('/api/model-connection').then(response => read<{ models: Model[]; defaultModel: string | null }>(response)).then(value => {
      setModels(value.models)
      setModelId(value.defaultModel ?? value.models[0]?.id ?? '')
    }).catch(error => setError(error.message))
    return () => { disposed = true; if (timer) clearInterval(timer) }
  }, [detailId])

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
  const usage = events.filter(event => event.type === 'usage').map(event => event.payload)
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
      {detail.thread.messages.map((message, index) => <p className="work-message" key={index}>{message.content}</p>)}
      {activity.map(item => <p className="work-message" key={item.id}>{item.kind === 'tool' ? '工具：' : 'Agent：'}{item.text}{!item.done && '…'}</p>)}
      <p className="muted">用量：输入 {tokens('inputTokens') ?? '未知'} / 输出 {tokens('outputTokens') ?? '未知'} token</p>
      <p className="muted">耗时：{detail.run.startedAt && detail.run.finishedAt ? `${Math.round((Date.parse(detail.run.finishedAt) - Date.parse(detail.run.startedAt)) / 1000)} 秒` : '未知'}</p>
      {detail.run.failure && <p className="error" role="alert">{detail.run.failure}</p>}
      {detail.run.cleanupState === 'failed' && <p className="error" role="alert">沙箱回收失败，需要核查。</p>}
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
