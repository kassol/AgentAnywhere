import type { ReactNode } from 'react'
import { ReceiptText } from 'lucide-react'
import { EntityRow } from './craft/components/EntityRow'
import { StatusBadge, type StatusBadgeValue } from './craft/components/StatusBadge'
import { QuickActions, type ReceiptAction } from './QuickActions'

type ReceiptTurns = { turnId: string; resumeTurnIds?: string[] }
export type ResearchOperation = ReceiptTurns & { operationId: string; status: string; taskId?: string; runId?: string; goal: string; modelId: string; protocol: string; reason: string; verification: string; sources?: Record<string, { source: string }>; failure?: string }
export type ControlOperation = ReceiptTurns & { operationId: string; kind: 'steer' | 'cancel'; status: string; taskId?: string; runId?: string; content?: string; messageStatus?: 'pending' | 'applied' | 'carried'; failure?: string }
export type InteractionOperation = ReceiptTurns & { operationId: string; status: string; taskId?: string; runId?: string; epoch?: number; interactionId?: string; interactionKind?: 'question' | 'limit'; answer?: string; decision?: 'continue' | 'finish'; failure?: string }
export type RetryOperation = ReceiptTurns & { operationId: string; mode: 'same' | 'replacement'; status: string; taskId?: string; sourceRunId?: string; runId?: string; modelId?: string; protocol?: string; failure?: string }
export type RevisionOperation = ReceiptTurns & { operationId: string; status: string; taskId?: string; sourceVersionId?: string; runId?: string; content: string; modelId: string; protocol: string; reason: string; verification: string; sources?: Record<string, { source: string }>; failure?: string }

type Props = {
  turnId?: string
  taskId?: string
  research: ResearchOperation[]
  controls: ControlOperation[]
  interactions: InteractionOperation[]
  retries: RetryOperation[]
  revisions: RevisionOperation[]
  onFill: (command: string) => void
  disabled?: boolean
}

const label: Record<string, string> = { planned: '待执行', accepted: '已接收', unexecuted: '未执行', failed: '失败', intent: '待明确目标' }
const receiptStatus: Record<string, StatusBadgeValue> = {
  planned: { label: '待执行', color: 'var(--muted)' },
  accepted: { label: '已接收', color: 'var(--success)' },
  unexecuted: { label: '未执行', color: 'var(--info)' },
  failed: { label: '失败', color: 'var(--danger)' },
  intent: { label: '待明确目标', color: 'var(--info)' },
}

function controlStatus(operation: ControlOperation) {
  if (operation.status === 'intent') return '待明确目标'
  if (operation.status === 'planned') return '待执行'
  if (operation.kind !== 'steer' || operation.status !== 'accepted') return label[operation.status] ?? operation.status
  if (operation.messageStatus === 'applied') return '已应用'
  if (operation.messageStatus === 'carried') return '已纳入后续执行'
  return '已接收，等待安全时机'
}

function Resume({ operationId, status, action, enabled, onFill, disabled }: { operationId: string; status: string; action: ReceiptAction; enabled: boolean; onFill: Props['onFill']; disabled?: boolean }) {
  if (!enabled || !['accepted', 'unexecuted'].includes(status)) return null
  return <QuickActions actions={[{ kind: 'resume', operationId, action }]} onFill={onFill} disabled={disabled} />
}

function ReceiptRow({ operationId, title, status, summary, detail, children }: {
  operationId: string
  title: string
  status: string
  summary: ReactNode
  detail?: ReactNode
  children?: ReactNode
}) {
  return <EntityRow className="turn-receipt overflow-hidden rounded-[8px] border border-border bg-background"
    icon={<ReceiptText />} title={title} subtitle={summary}
    badges={<StatusBadge status={receiptStatus[status] ?? { label: status, color: 'var(--muted)' }} />}
    trailing={<span className="font-mono text-xs text-muted-foreground" title={operationId}>Operation {operationId.slice(0, 8)}</span>}>
    {(detail || children) && <div className="turn-receipt-content grid gap-2 px-4 pb-3 pl-9 [overflow-wrap:anywhere]">
      {detail && <small className="text-muted-foreground leading-[1.5]">{detail}</small>}
      {children}
    </div>}
  </EntityRow>
}

export function StewardReceipts({ turnId, taskId, research, controls, interactions, retries, revisions, onFill, disabled }: Props) {
  const belongs = (item: ReceiptTurns & { taskId?: string }) => taskId
    ? item.taskId === taskId
    : !item.taskId && !!turnId && receiptBelongsToTurn(item, turnId)
  const ownResearch = research.filter(belongs)
  const ownControls = controls.filter(belongs)
  const ownInteractions = interactions.filter(belongs)
  const ownRetries = retries.filter(belongs)
  const ownRevisions = revisions.filter(belongs)
  if (![ownResearch, ownControls, ownInteractions, ownRetries, ownRevisions].some(items => items.length)) return null

  const receipts = <div className="turn-receipts">
    {ownResearch.map(operation => {
      const sources = [...new Set(Object.values(operation.sources ?? {}).map(source => source.source))]
      return <ReceiptRow key={operation.operationId} operationId={operation.operationId} title="调研派发" status={operation.status}
        summary={<>{operation.taskId ? <a href={`/tasks/${operation.taskId}`}>{operation.goal}</a> : operation.goal} · {operation.modelId}（{operation.protocol}） · {operation.verification === 'verified' ? '已有成功报告记录' : '尚未实测'}</>}
        detail={<>Operation {operation.operationId}{operation.taskId ? ` · Task ${operation.taskId}` : ''}{operation.runId ? ` · Run ${operation.runId}` : ''}<br />选择理由：{operation.reason}{sources.length ? ` · 依据：${sources.join('、')}` : ''}{operation.failure ? ` · ${operation.failure}` : ''}</>}>
        <Resume {...{ operationId: operation.operationId, status: operation.status, action: '调研', enabled: true, onFill, disabled }} />
      </ReceiptRow>
    })}
    {ownControls.map(operation => <ReceiptRow key={operation.operationId} operationId={operation.operationId}
      title={operation.kind === 'steer' ? '追加要求' : '取消工作'} status={operation.status}
      summary={operation.taskId ? <a href={`/tasks/${operation.taskId}`}>Task {operation.taskId}</a> : '目标未确定'}
      detail={<>Operation {operation.operationId}{operation.runId ? ` · Run ${operation.runId}` : ''} · {controlStatus(operation)}{operation.content ? <><br />{operation.content}</> : null}{operation.failure ? ` · ${operation.failure}` : ''}</>}>
      <Resume {...{ operationId: operation.operationId, status: operation.status, action: operation.kind === 'steer' ? '追加' : '取消', enabled: Boolean(operation.taskId && operation.runId), onFill, disabled }} />
    </ReceiptRow>)}
    {ownInteractions.map(operation => <ReceiptRow key={operation.operationId} operationId={operation.operationId}
      title={operation.interactionKind === 'limit' ? '额度决定' : '回答问题'} status={operation.status}
      summary={operation.taskId ? <a href={`/tasks/${operation.taskId}`}>Task {operation.taskId}</a> : '目标未确定'}
      detail={<>Operation {operation.operationId}{operation.runId ? ` · Run ${operation.runId}` : ''}{operation.interactionId ? ` · Interaction ${operation.interactionId}` : ''}{operation.epoch === undefined ? '' : ` · epoch ${operation.epoch}`}<br />{operation.answer ?? (operation.decision === 'continue' ? '继续工作' : operation.decision === 'finish' ? '结束工作' : label[operation.status] ?? operation.status)}{operation.failure ? ` · ${operation.failure}` : ''}</>}>
      <Resume {...{ operationId: operation.operationId, status: operation.status, action: '回答', enabled: Boolean(operation.taskId && operation.runId && operation.interactionId && operation.epoch !== undefined), onFill, disabled }} />
    </ReceiptRow>)}
    {ownRetries.map(operation => <ReceiptRow key={operation.operationId} operationId={operation.operationId}
      title={operation.mode === 'same' ? '同模型重试' : '替代模型重试'} status={operation.status}
      summary={operation.taskId ? <a href={`/tasks/${operation.taskId}`}>Task {operation.taskId}</a> : '目标未确定'}
      detail={<>Operation {operation.operationId}{operation.sourceRunId ? ` · 原 Run ${operation.sourceRunId}` : ''}{operation.runId ? ` · 新 Run ${operation.runId}` : ''}{operation.modelId ? ` · ${operation.modelId}${operation.protocol ? `（${operation.protocol}）` : ''}` : ''}{operation.failure ? ` · ${operation.failure}` : ''}</>}>
      <Resume {...{ operationId: operation.operationId, status: operation.status, action: '重试', enabled: Boolean(operation.taskId && operation.sourceRunId && operation.modelId), onFill, disabled }} />
    </ReceiptRow>)}
    {ownRevisions.map(operation => <ReceiptRow key={operation.operationId} operationId={operation.operationId} title="报告改稿" status={operation.status}
      summary={<>{operation.taskId ? <a href={`/tasks/${operation.taskId}`}>Task {operation.taskId}</a> : '目标未确定'} · {operation.modelId}（{operation.protocol}）</>}
      detail={<>Operation {operation.operationId}{operation.sourceVersionId ? ` · 源 Version ${operation.sourceVersionId}` : ''}{operation.runId ? ` · 新 Run ${operation.runId}` : ''}<br />修改要求：{operation.content} · 选择理由：{operation.reason}{operation.failure ? ` · ${operation.failure}` : ''}</>}>
      <Resume {...{ operationId: operation.operationId, status: operation.status, action: '改稿', enabled: Boolean(operation.taskId && operation.sourceVersionId && operation.modelId), onFill, disabled }} />
    </ReceiptRow>)}
  </div>
  return taskId ? receipts : <details className="steward-turn-details"><summary>未关联操作回执</summary>{receipts}</details>
}

export function receiptBelongsToTurn(operation: ReceiptTurns, turnId: string) {
  return operation.turnId === turnId || operation.resumeTurnIds?.includes(turnId) === true
}
