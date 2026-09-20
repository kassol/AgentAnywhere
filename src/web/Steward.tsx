import { useEffect, useRef, useState } from 'react'
import { Composer, acceptComposerSubmission, attachComposerThread, changeComposerDraft, confirmComposerReplacement, prepareComposerSubmission, readComposerState, rejectComposerSubmission, startComposerSubmission, writeComposerState, type ComposerState, type ComposerSubmission } from './Composer'
import { buildToolActivities, readActivityPages, StableScroll, ToolActivityList, type ActivityEvent } from './ActivityFeed'
import { ReportMarkdown } from './Work'
import { QuickActions, type QuickAction } from './QuickActions'
import { clearAcceptedAnnotations, latestSucceededReportVersion, type ReviewContext } from './ReviewAnnotations'
import { StewardReceipts, type ControlOperation, type InteractionOperation, type ResearchOperation, type RetryOperation, type RevisionOperation } from './StewardReceipts'
import { useReviewComposerBridge } from './WorkPreview'

type Message = { id: string; turnId: string; role: 'user' | 'assistant'; content: string; status: string }
type Summary = { id: string; content: string; fromTurnNumber: number; throughTurnNumber: number; coveredTurns: number }
type Turn = { id: string; requestId: string; status: string; modelCalls: number; modelCallLimit: number; activeMs: number; activeLimitMs: number; budgetReason?: string; failure?: string }
export type RelatedTask = { id: string; goal: string; status: string; href: string; runs: { id: string; status: string }[]; reports: { versionId: string; href: string }[] }
export type RetryModel = { id: string; protocol: 'chat-completions' | 'responses'; contextWindow?: number; researchReadiness?: { status: string } }
export type StatusCard = { id: string; kind: 'completed' | 'failed' | 'interaction'; taskId: string; runId: string; goal: string; runStatus: string; model: RetryModel; failure?: string; href: string; reports: { versionId: string; href: string }[]; interaction?: { id: string; kind: 'question' | 'limit'; question: string; status: string; answer?: string } }
type Detail = { id: string; title: string; messages: Message[]; summaries: Summary[]; turns: Turn[]; relatedTasks: RelatedTask[]; statusCards: StatusCard[]; researchOperations: ResearchOperation[];
  controlOperations: ControlOperation[]; interactionOperations: InteractionOperation[]; retryOperations: RetryOperation[]; revisionOperations: RevisionOperation[] }
const statusLabel: Record<string, string> = {
  queued: '排队中', provisioning: '准备环境', running: '回复中', streaming: '生成中', stopping: '停止中', stopped: '已停止',
  completed: '已完成', interrupted: '已中断', limited: '已达上限', failed: '失败',
  waiting: '等待回答', cancelling: '正在取消', cancelled: '已取消', succeeded: '已完成', lost: '执行中断', save_failed: '成果保存失败',
  planned: '待派发', accepted: '已接收', unexecuted: '未执行', pending: '待回答', answered: '已回答',
}

function limitMessage(turn: Turn) {
  const limit = turn.budgetReason === 'time' ? ' 5 分钟' : turn.budgetReason === 'creates' ? ' 3 项工作创建' : ' 8 次模型请求'
  return `本轮已达到${limit}上限。发送新消息可开始下一轮。`
}

export function fillQuickCommand(state: ComposerState, command: string) {
  return changeComposerDraft(state, command, null)
}

export function relatedTaskQuickActions(task: RelatedTask): QuickAction[] {
  const run = task.runs.at(-1)
  if (!run) return []
  if (run.status === 'running') return [
    { kind: 'append', taskId: task.id, runId: run.id },
    { kind: 'cancel', taskId: task.id, runId: run.id },
  ]
  if (['queued', 'provisioning'].includes(run.status)) return [{ kind: 'cancel', taskId: task.id, runId: run.id }]
  return []
}

export function statusCardQuickActions(card: StatusCard, latestRunId?: string, replacementModels: RetryModel[] = []): QuickAction[] {
  if (card.interaction?.status === 'pending') {
    if (latestRunId !== card.runId) return []
    const answer: QuickAction[] = card.interaction.kind === 'limit'
      ? [
          { kind: 'limit', taskId: card.taskId, interactionId: card.interaction.id, decision: 'continue' },
          { kind: 'limit', taskId: card.taskId, interactionId: card.interaction.id, decision: 'finish' },
        ]
      : [{ kind: 'answer', taskId: card.taskId, interactionId: card.interaction.id }]
    return [...answer, { kind: 'cancel', taskId: card.taskId, runId: card.runId }]
  }
  if (['failed', 'lost'].includes(card.runStatus)) {
    if (latestRunId !== card.runId) return []
    const replacements = replacementModels.filter(model => model.id !== card.model.id && model.protocol === card.model.protocol
      && model.researchReadiness?.status === 'ready-to-try' && typeof card.model.contextWindow === 'number'
      && typeof model.contextWindow === 'number' && model.contextWindow >= card.model.contextWindow)
    return [
      { kind: 'same-retry', taskId: card.taskId, sourceRunId: card.runId },
      ...replacements.map(model => ({ kind: 'replacement-retry' as const, taskId: card.taskId, sourceRunId: card.runId, modelId: model.id })),
    ]
  }
  const report = card.runStatus === 'succeeded' ? card.reports[0] : undefined
  return report ? [{ kind: 'revision', taskId: card.taskId, versionId: report.versionId }] : []
}

export function Steward({ fillRequest, onFillRequestHandled }: { fillRequest?: { id: number; command: string }; onFillRequestHandled?: () => void } = {}) {
  const routeId = /^\/steward\/([0-9a-f-]{36})$/i.exec(location.pathname)?.[1] ?? null
  const [detail, setDetail] = useState<Detail | null>(null)
  const [composer, setComposer] = useState<ComposerState>(() => readComposerState(routeId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [replacementModels, setReplacementModels] = useState<RetryModel[]>([])
  const [reviewConflict, setReviewConflict] = useState<{ taskId: string; versionId: string; latestVersionId: string; draftRevision: number } | null>(null)
  const cursor = useRef(0)
  const composerRef = useRef(composer)
  const reviewBridge = useReviewComposerBridge()

  function storeComposer(next: ComposerState, id = routeId) {
    composerRef.current = next
    setComposer(next)
    writeComposerState(id, next)
  }

  useEffect(() => {
    if (!fillRequest) return
    fillCommand(fillRequest.command)
    onFillRequestHandled?.()
  }, [fillRequest?.id])

  useEffect(() => reviewBridge?.register(payload => {
    if (!confirmComposerReplacement(composerRef.current, payload.content)) return false
    storeComposer(changeComposerDraft(composerRef.current, payload.content, payload.review))
    setReviewConflict(null)
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('#steward-message')?.focus())
    return true
  }), [reviewBridge, routeId])

  async function loadDetail(id: string) {
    const response = await fetch(`/api/steward/threads/${id}`)
    if (!response.ok) return
    const next = await response.json() as Detail
    if (routeId) setDetail(next)
    const pending = composerRef.current.pending
    if (pending && next.turns.some(turn => turn.requestId === pending.turnRequestId)) {
      clearAcceptedAnnotations(pending.review, pending.content)
      const accepted = acceptComposerSubmission(composerRef.current, pending)
      if (!routeId) {
        writeComposerState(null, { draft: { content: '', revision: 0 } })
        writeComposerState(id, accepted)
        location.assign(`/steward/${id}`)
      } else storeComposer(accepted, id)
      setError('')
    }
  }

  useEffect(() => {
    cursor.current = 0
    const restored = readComposerState(routeId)
    composerRef.current = restored
    setComposer(restored)
    setDetail(null)
    setEvents([])
    if (!routeId) {
      if (restored.pending?.threadId) void loadDetail(restored.pending.threadId)
      return
    }
    let refreshing = false
    async function refresh() {
      if (refreshing) return
      refreshing = true
      try {
        const loaded = await readActivityPages(cursor.current, async after => {
          const response = await fetch(`/api/steward/threads/${routeId}/events?after=${after}`)
          return response.ok ? await response.json() as ActivityEvent[] : []
        })
        cursor.current = loaded.cursor
        if (loaded.events.length) setEvents(previous => [...previous, ...loaded.events])
        await loadDetail(routeId!)
      } catch { /* retain the last view until the connection recovers */ }
      finally { refreshing = false }
    }
    void refresh()
    const timer = setInterval(refresh, 500)
    return () => clearInterval(timer)
  }, [routeId])

  useEffect(() => {
    fetch('/api/model-connection').then(async response => {
      if (response.status === 401) return location.assign('/login')
      if (!response.ok) return
      const value = await response.json() as { models: RetryModel[]; researchModelPool: string[] }
      const selected = new Set(value.researchModelPool)
      setReplacementModels(value.models.filter(model => selected.has(model.id)))
    }).catch(() => { /* same-model retry remains available while settings are unavailable */ })
  }, [])

  async function checkReviewVersion(review: ReviewContext) {
    const response = await fetch(`/api/tasks/${review.taskId}`)
    if (response.status === 401) { location.assign('/login'); throw new Error('登录已失效') }
    if (!response.ok) throw new Error('无法核对报告版本')
    const task = await response.json() as { artifacts?: { kind: string; runStatus: string; versionId: string }[] }
    const artifacts = Array.isArray(task.artifacts) ? task.artifacts : []
    if (!artifacts.some(artifact => artifact.kind === 'report' && artifact.runStatus === 'succeeded' && artifact.versionId === review.versionId)) {
      throw new Error('批注所选报告版本已不可用')
    }
    return latestSucceededReportVersion(artifacts)
  }

  async function submit(confirmed?: { taskId: string; versionId: string; draftRevision: number }) {
    const alreadyPending = Boolean(composerRef.current.pending)
    const prepared = prepareComposerSubmission(composerRef.current)
    if (!prepared?.pending) return
    let request = prepared.pending
    setBusy(true)
    setError('')
    if (!alreadyPending && request.review
      && !(confirmed?.taskId === request.review.taskId && confirmed.versionId === request.review.versionId && confirmed.draftRevision === request.draftRevision)) {
      try {
        const latestVersionId = await checkReviewVersion(request.review)
        if (latestVersionId && latestVersionId !== request.review.versionId) {
          setReviewConflict({ taskId: request.review.taskId, versionId: request.review.versionId, latestVersionId, draftRevision: request.draftRevision })
          setBusy(false)
          return
        }
      } catch (caught) {
        setError(`${caught instanceof Error ? caught.message : '无法核对报告版本'}；消息尚未发送，批注已保留。`)
        setBusy(false)
        return
      }
    }
    setReviewConflict(null)
    const started = startComposerSubmission(composerRef.current, request)
    storeComposer(started)
    request = started.pending!
    let outcomeUnknown = true
    try {
      let id = routeId ?? request.threadId ?? null
      if (!id) {
        const created = await fetch('/api/steward/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: request.threadRequestId }) })
        if (!created.ok) {
          if (created.status >= 400 && created.status < 500) {
            outcomeUnknown = false
            storeComposer(rejectComposerSubmission(composerRef.current, request))
          }
          throw new Error((await created.json()).error ?? '创建对话失败')
        }
        const createdThread = await created.json() as { id?: unknown }
        if (typeof createdThread.id !== 'string') throw new Error('创建对话失败')
        id = createdThread.id
        const attached = attachComposerThread(composerRef.current, request, createdThread.id)
        storeComposer(attached)
        request = attached.pending!
      }
      if (!id) throw new Error('创建对话失败')
      const response = await fetch(`/api/steward/threads/${id}/turns`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: request.turnRequestId, content: request.content }),
      })
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          outcomeUnknown = false
          storeComposer(rejectComposerSubmission(composerRef.current, request))
        }
        throw new Error((await response.json()).error ?? '发送失败')
      }
      clearAcceptedAnnotations(request.review, request.content)
      const accepted = acceptComposerSubmission(composerRef.current, request)
      if (!routeId) {
        writeComposerState(null, { draft: { content: '', revision: 0 } })
        writeComposerState(id, accepted)
        location.assign(`/steward/${id}`)
      } else {
        storeComposer(accepted, id)
        await loadDetail(id)
      }
    } catch (caught) { setError(`${caught instanceof Error ? caught.message : '发送失败'}；${outcomeUnknown ? '结果尚未确认，请核对并重试。' : '草稿已保留，请更正后重试。'}`) }
    finally { setBusy(false) }
  }

  async function stop(turnId: string) {
    const response = await fetch(`/api/steward/turns/${turnId}/stop`, { method: 'POST' })
    if (!response.ok) setError('停止失败，请重试。')
    else if (routeId) await loadDetail(routeId)
  }

  function fillCommand(command: string) {
    if (!confirmComposerReplacement(composerRef.current, command)) return
    storeComposer(fillQuickCommand(composerRef.current, command))
    setReviewConflict(null)
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('#steward-message')?.focus())
  }

  const activeTurns = detail?.turns.filter(turn => ['queued', 'running', 'stopping'].includes(turn.status)) ?? []
  const toolActivities = buildToolActivities(events)
  const messageContentLength = detail?.messages.reduce((length, message) => length + message.content.length, 0) ?? 0
  const projectedContentRevision = detail ? JSON.stringify([detail.researchOperations, detail.controlOperations, detail.interactionOperations,
    detail.retryOperations, detail.revisionOperations, detail.relatedTasks, detail.statusCards]) : ''
  const scrollRevision = `${detail?.messages.length ?? 0}:${messageContentLength}:${events.at(-1)?.serverSeq ?? 0}:${detail?.turns.at(-1)?.status ?? ''}:${projectedContentRevision}`
  return (
    <div className="steward-layout">
      <section className="conversation" aria-label="管家对话">
        <StableScroll storageKey={`agentanywhere:steward-scroll:${routeId ?? 'new'}`} revision={scrollRevision} className="conversation-messages">
          {!detail?.messages.length && <div className="steward-empty"><h2>有什么需要一起梳理？</h2><p className="muted">可以讨论，也可以直接委托一项或多项独立调研。</p></div>}
          {!!detail?.summaries.length && <section aria-label="较早讨论摘要"><h3>较早讨论摘要</h3>{detail.summaries.map(summary => <article key={summary.id}>
            <small>覆盖本对话第 {summary.fromTurnNumber}–{summary.throughTurnNumber} 轮，共 {summary.coveredTurns} 轮</small>
            <ReportMarkdown markdown={summary.content} />
          </article>)}</section>}
          {detail?.turns.map((turn, index) => {
            const messages = detail.messages.filter(message => message.turnId === turn.id)
            return <section className="steward-turn" key={turn.id} aria-labelledby={`steward-turn-${turn.id}`}>
              <header><h3 id={`steward-turn-${turn.id}`}>第 {index + 1} 轮</h3><small>{statusLabel[turn.status] ?? turn.status}</small></header>
              {messages.filter(message => message.role === 'user').map(message => <article key={message.id} className="conversation-message user">
                <strong>你</strong><p>{message.content}</p>
              </article>)}
              <ToolActivityList activities={toolActivities.filter(activity => activity.scopeId === turn.id)} />
              <StewardReceipts turnId={turn.id} research={detail.researchOperations} controls={detail.controlOperations}
                interactions={detail.interactionOperations} retries={detail.retryOperations} revisions={detail.revisionOperations}
                onFill={fillCommand} disabled={busy} />
              {messages.filter(message => message.role === 'assistant').map(message => <article key={message.id} className="conversation-message assistant">
                <strong>管家</strong><ReportMarkdown markdown={message.content || '…'} />
                {message.status !== 'completed' && <small>{statusLabel[message.status] ?? message.status}</small>}
              </article>)}
              {turn.failure && <p className="error" role="alert">{turn.failure}</p>}
              {turn.status === 'limited' && <p className="error" role="status">{limitMessage(turn)}</p>}
            </section>
          })}
          {!!detail?.relatedTasks.length && <section aria-label="关联工作"><h3>关联工作</h3><ul>{detail.relatedTasks.map(task => <li key={task.id}>
            <a href={task.href}>{task.goal}</a> <span>{statusLabel[task.status] ?? task.status}</span>
            {task.reports.map(report => <span key={report.versionId}> · <a href={report.href}>成果 {report.versionId.slice(0, 8)}</a></span>)}
            <QuickActions actions={relatedTaskQuickActions(task)} onFill={fillCommand} disabled={busy} />
          </li>)}</ul></section>}
          {!!detail?.statusCards.length && <section aria-label="工作状态卡"><h3>工作状态</h3><ul>{detail.statusCards.map(card => <li key={card.id}>
            <a href={card.href}>{card.goal}</a>{' · '}
            {card.interaction
              ? `${card.interaction.kind === 'limit' ? '额度等待' : '提问'}：${card.interaction.question} · ${statusLabel[card.interaction.status] ?? card.interaction.status}`
              : statusLabel[card.runStatus] ?? card.runStatus}
            {card.reports.map(report => <span key={report.versionId}> · <a href={report.href}>成果 {report.versionId.slice(0, 8)}</a></span>)}
            {card.interaction?.answer && <><br /><small>回答：{card.interaction.answer}</small></>}
            <QuickActions actions={statusCardQuickActions(card, detail.relatedTasks.find(task => task.id === card.taskId)?.runs.at(-1)?.id, replacementModels)}
              onFill={fillCommand} disabled={busy} />
          </li>)}</ul></section>}
        </StableScroll>
        <Composer state={composer} busy={busy} error={error} onChange={content => storeComposer(changeComposerDraft(composerRef.current, content))}
          onSubmit={() => void submit()} actions={activeTurns.map((turn, index) => <button key={turn.id} type="button" className="secondary" onClick={() => void stop(turn.id)}>
              {turn.status === 'queued' ? `撤回排队${activeTurns.length > 1 ? ` ${index + 1}` : ''}` : '停止本轮'}
            </button>)} />
        {reviewConflict && <div className="review-version-conflict" role="alertdialog" aria-labelledby="review-version-conflict-title">
          <strong id="review-version-conflict-title">这项工作已有新版报告</strong>
          <p>批注固定在版本 {reviewConflict.versionId}；当前最新版本为 {reviewConflict.latestVersionId}。继续后仍修改原版本。</p>
          <div><button type="button" className="secondary" onClick={() => setReviewConflict(null)}>取消并保留草稿</button>
            <button type="button" onClick={() => void submit(reviewConflict)}>继续修改原版本</button></div>
        </div>}
      </section>
    </div>
  )
}
