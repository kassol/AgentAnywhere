import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ReportMarkdown } from './Work'

type Thread = { id: string; title: string; status?: string }
type Message = { id: string; turnId: string; role: 'user' | 'assistant'; content: string; status: string }
type Turn = { id: string; status: string; modelCalls: number; modelCallLimit: number; activeMs: number; activeLimitMs: number; budgetReason?: string; failure?: string }
type RelatedTask = { id: string; goal: string; status: string; href: string; reports: { versionId: string; href: string }[] }
type Detail = Thread & { messages: Message[]; turns: Turn[]; relatedTasks: RelatedTask[] }
const statusLabel: Record<string, string> = {
  queued: '排队中', running: '回复中', streaming: '生成中', stopping: '停止中', stopped: '已停止',
  completed: '已完成', interrupted: '已中断', limited: '已达上限', failed: '失败',
  waiting: '等待回答', cancelling: '正在取消', cancelled: '已取消', succeeded: '已完成', lost: '执行中断', save_failed: '成果保存失败',
}

export function Steward() {
  const routeId = /^\/steward\/([0-9a-f-]{36})$/i.exec(location.pathname)?.[1] ?? null
  const [threads, setThreads] = useState<Thread[]>([])
  const [detail, setDetail] = useState<Detail | null>(null)
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cursor = useRef(0)
  const pending = useRef<{ content: string; threadRequestId: string; turnRequestId: string } | null>(null)

  async function loadThreads() {
    const response = await fetch('/api/steward/threads')
    if (response.ok) setThreads(await response.json())
  }

  async function loadDetail(id: string) {
    const response = await fetch(`/api/steward/threads/${id}`)
    if (response.ok) setDetail(await response.json())
  }

  useEffect(() => { void loadThreads() }, [])
  useEffect(() => {
    cursor.current = 0
    pending.current = null
    setDetail(null)
    if (!routeId) return
    void loadDetail(routeId)
    const timer = setInterval(async () => {
      const response = await fetch(`/api/steward/threads/${routeId}/events?after=${cursor.current}`)
      if (!response.ok) return
      const events = await response.json() as { serverSeq: number }[]
      if (!events.length) return
      cursor.current = events.at(-1)!.serverSeq
      await Promise.all([loadDetail(routeId), loadThreads()])
    }, 500)
    return () => clearInterval(timer)
  }, [routeId])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const message = content.trim()
    if (!message) return
    setBusy(true)
    setError('')
    try {
      const request = pending.current?.content === message ? pending.current : {
        content: message, threadRequestId: crypto.randomUUID(), turnRequestId: crypto.randomUUID(),
      }
      pending.current = request
      let id = routeId
      if (!id) {
        const created = await fetch('/api/steward/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: request.threadRequestId }) })
        if (!created.ok) throw new Error((await created.json()).error ?? '创建对话失败')
        id = (await created.json()).id
      }
      if (!id) throw new Error('创建对话失败')
      const response = await fetch(`/api/steward/threads/${id}/turns`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: request.turnRequestId, content: message }),
      })
      if (!response.ok) throw new Error((await response.json()).error ?? '发送失败')
      pending.current = null
      setContent('')
      if (!routeId) location.assign(`/steward/${id}`)
      else await loadDetail(id)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '发送失败') }
    finally { setBusy(false) }
  }

  async function stop(turnId: string) {
    const response = await fetch(`/api/steward/turns/${turnId}/stop`, { method: 'POST' })
    if (!response.ok) setError('停止失败，请重试。')
    else if (routeId) await loadDetail(routeId)
  }

  const current = detail?.turns.at(-1)
  const activeTurns = detail?.turns.filter(turn => ['queued', 'running', 'stopping'].includes(turn.status)) ?? []
  return (
    <div className="steward-layout">
      <aside className="conversation-list">
        <a className="new-conversation" href="/">新对话</a>
        {threads.map(thread => <a key={thread.id} href={`/steward/${thread.id}`} aria-current={thread.id === routeId ? 'page' : undefined}>
          <span>{thread.title}</span><small>{thread.status ? statusLabel[thread.status] ?? thread.status : '尚未开始'}</small>
        </a>)}
      </aside>
      <section className="conversation" aria-label="管家对话">
        <div className="conversation-messages" aria-live="polite">
          {!detail?.messages.length && <div className="steward-empty"><h2>有什么需要一起梳理？</h2><p className="muted">管家当前可进行普通对话。每次发送会开始一个独立轮次。</p></div>}
          {detail?.messages.map(message => <article key={message.id} className={`conversation-message ${message.role}`}>
            <strong>{message.role === 'user' ? '你' : '管家'}</strong>
            {message.role === 'assistant' ? <ReportMarkdown markdown={message.content || '…'} /> : <p>{message.content}</p>}
            {message.role === 'assistant' && message.status !== 'completed' && <small>{statusLabel[message.status] ?? message.status}</small>}
          </article>)}
          {current?.failure && <p className="error" role="alert">{current.failure}</p>}
          {current?.status === 'limited' && <p className="error" role="status">本轮已达到{current.budgetReason === 'time' ? ' 5 分钟' : ' 8 次模型请求'}上限。发送新消息可开始下一轮。</p>}
          {!!detail?.relatedTasks.length && <section aria-label="关联工作"><h3>关联工作</h3><ul>{detail.relatedTasks.map(task => <li key={task.id}>
            <a href={task.href}>{task.goal}</a> <span>{statusLabel[task.status] ?? task.status}</span>
            {task.reports.map(report => <span key={report.versionId}> · <a href={report.href}>成果 {report.versionId.slice(0, 8)}</a></span>)}
          </li>)}</ul></section>}
        </div>
        <form className="steward-composer" onSubmit={submit}>
          <label htmlFor="steward-message">消息</label>
          <textarea id="steward-message" value={content} onChange={event => {
            if (pending.current && event.target.value.trim() !== pending.current.content) pending.current = null
            setContent(event.target.value)
          }} maxLength={16000} rows={3} disabled={busy} placeholder="输入消息…" />
          <div><button type="submit" disabled={busy || !content.trim()}>{busy ? '发送中…' : '发送'}</button>
            {activeTurns.map((turn, index) => <button key={turn.id} type="button" className="secondary" onClick={() => void stop(turn.id)}>
              {turn.status === 'queued' ? `撤回排队${activeTurns.length > 1 ? ` ${index + 1}` : ''}` : '停止本轮'}
            </button>)}</div>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </div>
  )
}
