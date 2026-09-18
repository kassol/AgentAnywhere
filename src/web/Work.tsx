import { useEffect, useState, type FormEvent } from 'react'
import { EmptyStateCard } from './EmptyStateCard'

type Model = { id: string; protocol: 'chat-completions' | 'responses' }
type Task = { id: string; goal: string; sourceUrl: string | null; status: 'queued'; createdAt: string }
type Detail = Task & { run: { id: string; status: 'queued'; model: Model }; thread: { id: string; messages: { role: 'user'; content: string }[] } }

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
  const [models, setModels] = useState<Model[]>([])
  const [modelId, setModelId] = useState('')
  const [protocol, setProtocol] = useState('default')
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const path = detailId ? `/api/tasks/${detailId}` : '/api/tasks'
    fetch(path).then(response => read<Detail | Task[]>(response)).then(value => {
      if (Array.isArray(value)) setTasks(value)
      else setDetail(value)
    }).catch(error => setError(error.message))
    if (!detailId) fetch('/api/model-connection').then(response => read<{ models: Model[]; defaultModel: string | null }>(response)).then(value => {
      setModels(value.models)
      setModelId(value.defaultModel ?? value.models[0]?.id ?? '')
    }).catch(error => setError(error.message))
  }, [detailId])

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
      <p className="work-status">待执行</p>
      <h2>{detail.goal || detail.sourceUrl}</h2>
      {detail.sourceUrl && <p><a href={detail.sourceUrl} target="_blank" rel="noopener noreferrer">{detail.sourceUrl}</a></p>}
      <p className="muted">模型：{detail.run.model.id} · 协议：{detail.run.model.protocol}</p>
      <h3>工作对话</h3>
      {detail.thread.messages.map((message, index) => <p className="work-message" key={index}>{message.content}</p>)}
      <p className="muted">已保存请求，等待执行。</p>
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
        <ul className="task-list">{tasks.map(task => <li key={task.id}><a href={`/tasks/${task.id}`}>{task.goal || task.sourceUrl}</a><span>待执行</span></li>)}</ul>}
    </section>
  </>
}
