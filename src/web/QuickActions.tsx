import './quick-actions.css'

export type ReceiptAction = '调研' | '追加' | '取消' | '回答' | '重试' | '改稿'

export type QuickAction =
  | { kind: 'append'; taskId: string; runId: string; content?: string }
  | { kind: 'answer'; taskId: string; interactionId: string; answer?: string }
  | { kind: 'limit'; taskId: string; interactionId: string; decision: 'continue' | 'finish' }
  | { kind: 'cancel'; taskId: string; runId: string }
  | { kind: 'same-retry'; taskId: string; sourceRunId: string }
  | { kind: 'replacement-retry'; taskId: string; sourceRunId: string; modelId: string }
  | { kind: 'revision'; taskId: string; versionId: string; content?: string }
  | { kind: 'resume'; operationId: string; action: ReceiptAction }

export function quickActionCommand(action: QuickAction) {
  switch (action.kind) {
    case 'append': return `给工作 ${action.taskId} 的 Run ${action.runId} 追加要求：${action.content ?? ''}`
    case 'answer': return `回答工作 ${action.taskId} 的 Interaction ${action.interactionId}：${action.answer ?? ''}`
    case 'limit': return `${action.decision === 'continue' ? '继续' : '结束'}工作 ${action.taskId} 的 Interaction ${action.interactionId}`
    case 'cancel': return `取消工作 ${action.taskId} 的 Run ${action.runId}`
    case 'same-retry': return `同模型重试工作 ${action.taskId} 的 Run ${action.sourceRunId}`
    case 'replacement-retry': return `把工作 ${action.taskId} 的 Run ${action.sourceRunId} 改用模型：${action.modelId} 重试`
    case 'revision': return `请修改工作 ${action.taskId} 的报告 ${action.versionId}：${action.content ?? ''}`
    case 'resume': return `继续${action.action}回执 ${action.operationId}`
  }
}

export function quickActionLabel(action: QuickAction) {
  switch (action.kind) {
    case 'append': return '追加要求'
    case 'answer': return '填写回答'
    case 'limit': return action.decision === 'continue' ? '增加额度并继续' : '结束工作'
    case 'cancel': return '取消工作'
    case 'same-retry': return '同模型重试'
    case 'replacement-retry': return `改用 ${action.modelId} 重试`
    case 'revision': return '填写改稿要求'
    case 'resume': return `继续${action.action}`
  }
}

export function quickActionIdentity(action: QuickAction) {
  const short = (id: string) => id.slice(0, 8)
  switch (action.kind) {
    case 'append':
    case 'cancel': return `工作 ${short(action.taskId)} · Run ${short(action.runId)}`
    case 'answer':
    case 'limit': return `工作 ${short(action.taskId)} · Interaction ${short(action.interactionId)}`
    case 'same-retry':
    case 'replacement-retry': return `工作 ${short(action.taskId)} · Run ${short(action.sourceRunId)}`
    case 'revision': return `工作 ${short(action.taskId)} · 报告 ${short(action.versionId)}`
    case 'resume': return `回执 ${short(action.operationId)}`
  }
}

export function QuickActions({ actions, onFill, label = '快捷操作', disabled = false }: {
  actions: QuickAction[]
  onFill(command: string): void
  label?: string
  disabled?: boolean
}) {
  if (!actions.length) return null
  return <div className="quick-actions" role="group" aria-label={label}>
    {actions.map((action, index) => {
      const command = quickActionCommand(action)
      return <button type="button" className="quick-action" key={`${action.kind}:${quickActionIdentity(action)}:${index}`}
        disabled={disabled} aria-label={`${quickActionLabel(action)}，${quickActionIdentity(action)}`}
        title={`填入：${command}`} onClick={() => onFill(command)}>
        <span>{quickActionLabel(action)}</span>
        <small>{quickActionIdentity(action)}</small>
      </button>
    })}
  </div>
}
