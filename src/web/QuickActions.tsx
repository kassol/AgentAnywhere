import { ActionBar } from './craft/components/ActionBar'
import { Button } from './craft/components/Button'
import { cn } from './craft/lib/utils'

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
  return <ActionBar className="quick-actions mt-2 flex-wrap border-t-0 px-0 py-0 max-[520px]:grid max-[520px]:grid-cols-1" role="group" aria-label={label}>
    {actions.map((action, index) => {
      const command = quickActionCommand(action)
      const isInteraction = action.kind === 'answer' || (action.kind === 'limit' && action.decision === 'continue')
      const isDestructive = action.kind === 'cancel' || (action.kind === 'limit' && action.decision === 'finish')
      return <Button type="button" variant="outline" size="sm"
        className={cn(
          'quick-action h-auto min-h-[30px] max-w-full gap-2 px-2.5 py-1.5 text-left transition-colors max-[520px]:min-h-11 max-[520px]:w-full max-[520px]:justify-between',
          isInteraction && 'border-accent/40 bg-accent/5 hover:bg-accent/10 hover:border-accent text-foreground font-medium',
          isDestructive && 'hover:border-destructive/50 hover:text-destructive hover:bg-destructive/5',
        )}
        key={`${action.kind}:${quickActionIdentity(action)}:${index}`}
        disabled={disabled} aria-label={`${quickActionLabel(action)}，${quickActionIdentity(action)}`}
        title={`填入：${command}`} onClick={() => onFill(command)}>
        <span className="truncate">{quickActionLabel(action)}</span>
        <small className="truncate text-xs font-normal text-muted-foreground">{quickActionIdentity(action)}</small>
      </Button>
    })}
  </ActionBar>
}
