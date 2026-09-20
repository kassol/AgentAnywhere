import { StatusBadge, type StatusBadgeValue } from './craft/components/StatusBadge'

const workStatuses: Record<string, StatusBadgeValue> = {
  queued: { label: '待执行', color: 'var(--muted)' },
  provisioning: { label: '准备环境', color: 'var(--info)' },
  running: { label: '执行中', color: 'var(--accent)' },
  waiting: { label: '等待回答', color: 'var(--info)' },
  cancelling: { label: '正在取消', color: 'var(--info)' },
  cancelled: { label: '已取消', color: 'var(--muted)' },
  succeeded: { label: '已完成', color: 'var(--success)' },
  failed: { label: '失败', color: 'var(--danger)' },
  lost: { label: '执行中断', color: 'var(--danger)' },
  save_failed: { label: '成果保存失败', color: 'var(--danger)' },
}

const interactionStatuses: Record<string, StatusBadgeValue> = {
  pending: { label: '待回答', color: 'var(--info)' },
  answered: { label: '已回答', color: 'var(--success)' },
}

export function workStatusDefinition(status: string) {
  return workStatuses[status] ?? { label: status, color: 'var(--muted)' }
}

export function workStatusLabel(status: string) {
  return workStatusDefinition(status).label
}

export function WorkStatusBadge({ status, className }: { status: string; className?: string }) {
  return <StatusBadge status={workStatusDefinition(status)} live={['queued', 'provisioning', 'running', 'cancelling'].includes(status)} className={className} />
}

export function InteractionStatusBadge({ status, className }: { status: string; className?: string }) {
  return <StatusBadge status={interactionStatuses[status] ?? { label: status, color: 'var(--muted)' }} className={className} />
}
