export type ResearchOperation = { turnId: string; operationId: string; status: string; taskId?: string; runId?: string; goal: string; modelId: string; protocol: string; reason: string; verification: string; sources?: Record<string, { source: string }>; failure?: string }
export type ControlOperation = { turnId: string; operationId: string; kind: 'steer' | 'cancel'; status: string; taskId?: string; runId?: string; content?: string; messageStatus?: 'pending' | 'applied' | 'carried'; failure?: string }
export type InteractionOperation = { turnId: string; operationId: string; status: string; taskId?: string; runId?: string; epoch?: number; interactionId?: string; interactionKind?: 'question' | 'limit'; answer?: string; decision?: 'continue' | 'finish'; failure?: string }
export type RetryOperation = { turnId: string; operationId: string; mode: 'same' | 'replacement'; status: string; taskId?: string; sourceRunId?: string; runId?: string; modelId?: string; protocol?: string; failure?: string }
export type RevisionOperation = { turnId: string; operationId: string; status: string; taskId?: string; sourceVersionId?: string; runId?: string; content: string; modelId: string; protocol: string; reason: string; verification: string; sources?: Record<string, { source: string }>; failure?: string }

type Props = {
  turnId: string
  research: ResearchOperation[]
  controls: ControlOperation[]
  interactions: InteractionOperation[]
  retries: RetryOperation[]
  revisions: RevisionOperation[]
  onFill: (command: string) => void
  disabled?: boolean
}

const label: Record<string, string> = { planned: '待执行', accepted: '已接收', unexecuted: '未执行', failed: '失败', intent: '待明确目标' }

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

export function StewardReceipts({ turnId, research, controls, interactions, retries, revisions, onFill, disabled }: Props) {
  const ownResearch = research.filter(item => item.turnId === turnId)
  const ownControls = controls.filter(item => item.turnId === turnId)
  const ownInteractions = interactions.filter(item => item.turnId === turnId)
  const ownRetries = retries.filter(item => item.turnId === turnId)
  const ownRevisions = revisions.filter(item => item.turnId === turnId)
  if (![ownResearch, ownControls, ownInteractions, ownRetries, ownRevisions].some(items => items.length)) return null

  return <div className="turn-receipts">
    {ownResearch.map(operation => {
      const sources = [...new Set(Object.values(operation.sources ?? {}).map(source => source.source))]
      return <article className="turn-receipt" key={operation.operationId}><strong>调研派发 · {label[operation.status] ?? operation.status}</strong>
        <p>{operation.taskId ? <a href={`/tasks/${operation.taskId}`}>{operation.goal}</a> : operation.goal} · {operation.modelId}（{operation.protocol}） · {operation.verification === 'verified' ? '已有成功报告记录' : '尚未实测'}</p>
        <small>选择理由：{operation.reason}{sources.length ? ` · 依据：${sources.join('、')}` : ''}{operation.runId ? ` · Run ${operation.runId.slice(0, 8)}` : ''}{operation.failure ? ` · ${operation.failure}` : ''}</small>
        <Resume {...{ operationId: operation.operationId, status: operation.status, action: '调研', enabled: true, onFill, disabled }} />
      </article>
    })}
    {ownControls.map(operation => <article className="turn-receipt" key={operation.operationId}><strong>{operation.kind === 'steer' ? '追加要求' : '取消工作'} · {controlStatus(operation)}</strong>
      <p>{operation.taskId ? <a href={`/tasks/${operation.taskId}`}>工作 {operation.taskId.slice(0, 8)}</a> : '目标未确定'}{operation.runId ? ` · Run ${operation.runId.slice(0, 8)}` : ''}</p>
      {(operation.content || operation.failure) && <small>{operation.content}{operation.content && operation.failure ? ' · ' : ''}{operation.failure}</small>}
      <Resume {...{ operationId: operation.operationId, status: operation.status, action: operation.kind === 'steer' ? '追加' : '取消', enabled: Boolean(operation.taskId && operation.runId), onFill, disabled }} />
    </article>)}
    {ownInteractions.map(operation => <article className="turn-receipt" key={operation.operationId}><strong>{operation.interactionKind === 'limit' ? '额度决定' : '回答问题'} · {label[operation.status] ?? operation.status}</strong>
      <p>{operation.taskId ? <a href={`/tasks/${operation.taskId}`}>工作 {operation.taskId.slice(0, 8)}</a> : '目标未确定'}{operation.runId ? ` · Run ${operation.runId.slice(0, 8)}` : ''}{operation.epoch === undefined ? '' : ` · epoch ${operation.epoch}`}</p>
      {(operation.answer || operation.decision || operation.failure) && <small>{operation.answer ?? (operation.decision === 'continue' ? '继续工作' : operation.decision === 'finish' ? '结束工作' : '')}{operation.failure ? ` · ${operation.failure}` : ''}</small>}
      <Resume {...{ operationId: operation.operationId, status: operation.status, action: '回答', enabled: Boolean(operation.taskId && operation.runId && operation.interactionId && operation.epoch !== undefined), onFill, disabled }} />
    </article>)}
    {ownRetries.map(operation => <article className="turn-receipt" key={operation.operationId}><strong>{operation.mode === 'same' ? '同模型重试' : '替代模型重试'} · {label[operation.status] ?? operation.status}</strong>
      <p>{operation.taskId ? <a href={`/tasks/${operation.taskId}`}>工作 {operation.taskId.slice(0, 8)}</a> : '目标未确定'}{operation.modelId ? ` · ${operation.modelId}${operation.protocol ? `（${operation.protocol}）` : ''}` : ''}{operation.sourceRunId ? ` · 原 Run ${operation.sourceRunId.slice(0, 8)}` : ''}{operation.runId ? ` · 新 Run ${operation.runId.slice(0, 8)}` : ''}</p>
      {operation.failure && <small>{operation.failure}</small>}
      <Resume {...{ operationId: operation.operationId, status: operation.status, action: '重试', enabled: Boolean(operation.taskId && operation.sourceRunId && operation.modelId), onFill, disabled }} />
    </article>)}
    {ownRevisions.map(operation => <article className="turn-receipt" key={operation.operationId}><strong>报告改稿 · {label[operation.status] ?? operation.status}</strong>
      <p>{operation.taskId ? <a href={`/tasks/${operation.taskId}`}>工作 {operation.taskId.slice(0, 8)}</a> : '目标未确定'} · {operation.modelId}（{operation.protocol}）{operation.sourceVersionId && operation.taskId ? <> · <a href={`/tasks/${operation.taskId}?version=${operation.sourceVersionId}`}>源成果 {operation.sourceVersionId.slice(0, 8)}</a></> : null}{operation.runId ? ` · 新 Run ${operation.runId.slice(0, 8)}` : ''}</p>
      <small>修改要求：{operation.content} · 选择理由：{operation.reason}{operation.failure ? ` · ${operation.failure}` : ''}</small>
      <Resume {...{ operationId: operation.operationId, status: operation.status, action: '改稿', enabled: Boolean(operation.taskId && operation.sourceVersionId && operation.modelId), onFill, disabled }} />
    </article>)}
  </div>
}
import { QuickActions, type ReceiptAction } from './QuickActions'
