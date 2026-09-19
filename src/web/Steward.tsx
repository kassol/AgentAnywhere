import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ReportMarkdown } from './Work'

type Thread = { id: string; title: string; status?: string }
type Message = { id: string; turnId: string; role: 'user' | 'assistant'; content: string; status: string }
type Turn = { id: string; status: string; modelCalls: number; modelCallLimit: number; activeMs: number; activeLimitMs: number; budgetReason?: string; failure?: string }
type RelatedTask = { id: string; goal: string; status: string; href: string; reports: { versionId: string; href: string }[] }
type StatusCard = { id: string; kind: 'completed' | 'failed' | 'interaction'; taskId: string; runId: string; goal: string; runStatus: string; failure?: string; href: string; reports: { versionId: string; href: string }[]; interaction?: { id: string; kind: 'question' | 'limit'; question: string; status: string; answer?: string } }
type ResearchOperation = { operationId: string; status: string; taskId?: string; runId?: string; goal: string; modelId: string; protocol: string; reason: string; verification: string; sources?: Record<string, { source: string }>; failure?: string }
type ControlOperation = { operationId: string; kind: 'steer' | 'cancel'; status: string; taskId?: string; runId?: string; content?: string; messageStatus?: 'pending' | 'applied' | 'carried'; failure?: string }
type Detail = Thread & { messages: Message[]; turns: Turn[]; relatedTasks: RelatedTask[]; statusCards: StatusCard[]; researchOperations: ResearchOperation[]; controlOperations: ControlOperation[] }
const statusLabel: Record<string, string> = {
  queued: '排队中', provisioning: '准备环境', running: '回复中', streaming: '生成中', stopping: '停止中', stopped: '已停止',
  completed: '已完成', interrupted: '已中断', limited: '已达上限', failed: '失败',
  waiting: '等待回答', cancelling: '正在取消', cancelled: '已取消', succeeded: '已完成', lost: '执行中断', save_failed: '成果保存失败',
  planned: '待派发', accepted: '已接收', unexecuted: '未执行', pending: '待回答', answered: '已回答',
}

function controlStatus(operation: ControlOperation) {
  if (operation.status === 'intent') return '待明确目标'
  if (operation.status === 'planned') return '待执行'
  if (operation.kind !== 'steer' || operation.status !== 'accepted') return statusLabel[operation.status] ?? operation.status
  if (operation.messageStatus === 'applied') return '已应用'
  if (operation.messageStatus === 'carried') return '已纳入后续执行'
  return '已接收，等待安全时机'
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
    let refreshing = false
    async function refresh() {
      if (refreshing) return
      refreshing = true
      try {
        const response = await fetch(`/api/steward/threads/${routeId}/events?after=${cursor.current}`)
        if (!response.ok) return
        const events = await response.json() as { serverSeq: number }[]
        if (events.length) cursor.current = events.at(-1)!.serverSeq
        await loadDetail(routeId!)
        if (events.length) await loadThreads()
      } catch { /* retain the last view until the connection recovers */ }
      finally { refreshing = false }
    }
    void refresh()
    const timer = setInterval(refresh, 500)
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
          {!detail?.messages.length && <div className="steward-empty"><h2>有什么需要一起梳理？</h2><p className="muted">可以讨论，也可以直接委托一项或多项独立调研。</p></div>}
          {detail?.messages.map(message => <article key={message.id} className={`conversation-message ${message.role}`}>
            <strong>{message.role === 'user' ? '你' : '管家'}</strong>
            {message.role === 'assistant' ? <ReportMarkdown markdown={message.content || '…'} /> : <p>{message.content}</p>}
            {message.role === 'assistant' && message.status !== 'completed' && <small>{statusLabel[message.status] ?? message.status}</small>}
          </article>)}
          {current?.failure && <p className="error" role="alert">{current.failure}</p>}
          {current?.status === 'limited' && <p className="error" role="status">本轮已达到{current.budgetReason === 'time' ? ' 5 分钟' : current.budgetReason === 'creates' ? ' 3 项工作创建' : ' 8 次模型请求'}上限。发送新消息可开始下一轮。</p>}
          {!!detail?.researchOperations.length && <section aria-label="调研派发"><h3>调研派发</h3><ul>{detail.researchOperations.map(operation => {
            const sourceLabels = [...new Set(Object.values(operation.sources ?? {}).map(source => source.source))]
            return <li key={operation.operationId}>
              {operation.taskId ? <a href={`/tasks/${operation.taskId}`}>{operation.goal}</a> : <span>{operation.goal}</span>}
              {' · '}{statusLabel[operation.status] ?? operation.status}{' · '}{operation.modelId}（{operation.protocol}）
              {' · '}{operation.verification === 'verified' ? '已有成功报告记录' : '尚未实测'}
              {sourceLabels.length > 0 && <> · 依据：{sourceLabels.join('、')}</>}
              <br /><small>选择理由：{operation.reason}{operation.runId ? ` · Run ${operation.runId.slice(0, 8)}` : ''}{operation.failure ? ` · ${operation.failure}` : ''}</small>
            </li>
          })}</ul></section>}
          {!!detail?.controlOperations.length && <section aria-label="工作控制"><h3>工作控制</h3><ul>{detail.controlOperations.map(operation => <li key={operation.operationId}>
            {operation.taskId ? <a href={`/tasks/${operation.taskId}`}>{operation.kind === 'steer' ? '追加要求' : '取消工作'}</a> : <span>{operation.kind === 'steer' ? '追加要求' : '取消工作'}</span>}
            {' · '}{controlStatus(operation)}
            {operation.runId ? ` · Run ${operation.runId.slice(0, 8)}` : ''}
            {operation.content ? <><br /><small>{operation.content}</small></> : null}
            {operation.failure ? <><br /><small>{operation.failure}</small></> : null}
          </li>)}</ul></section>}
          {!!detail?.relatedTasks.length && <section aria-label="关联工作"><h3>关联工作</h3><ul>{detail.relatedTasks.map(task => <li key={task.id}>
            <a href={task.href}>{task.goal}</a> <span>{statusLabel[task.status] ?? task.status}</span>
            {task.reports.map(report => <span key={report.versionId}> · <a href={report.href}>成果 {report.versionId.slice(0, 8)}</a></span>)}
          </li>)}</ul></section>}
          {!!detail?.statusCards.length && <section aria-label="工作状态卡"><h3>工作状态</h3><ul>{detail.statusCards.map(card => <li key={card.id}>
            <a href={card.href}>{card.goal}</a>{' · '}
            {card.interaction
              ? `${card.interaction.kind === 'limit' ? '额度等待' : '提问'}：${card.interaction.question} · ${statusLabel[card.interaction.status] ?? card.interaction.status}`
              : statusLabel[card.runStatus] ?? card.runStatus}
            {card.reports.map(report => <span key={report.versionId}> · <a href={report.href}>成果 {report.versionId.slice(0, 8)}</a></span>)}
            {card.interaction?.answer && <><br /><small>回答：{card.interaction.answer}</small></>}
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
