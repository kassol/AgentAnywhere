import type { SQL } from 'bun'

export type StewardBudgetReason = 'time' | 'calls' | 'creates'

export function stewardBudgetFailure(reason: StewardBudgetReason) {
  return reason === 'creates' ? '本轮已达到 3 项工作创建额度'
    : reason === 'time' ? '管家轮次活跃时间已用尽' : '管家轮次额度已用尽'
}
export type StewardTurnBudget = {
  id: string
  threadId: string
  status: string
  active: boolean
  activeMs: number
  activeLimitMs: number
  activeSince: string | Date | null
  budgetReason: StewardBudgetReason | null
  modelCalls: number
  modelCallLimit: number
  modelSnapshot: unknown
  credentialRef: string
}

export async function lockStewardTurnBudget(sql: SQL, turnId: string): Promise<StewardTurnBudget | null> {
  const [turn] = await sql`SELECT id, thread_id AS "threadId", status, active, active_ms AS "activeMs",
    active_limit_ms AS "activeLimitMs", active_since AS "activeSince", budget_reason AS "budgetReason",
    model_calls AS "modelCalls", model_call_limit AS "modelCallLimit", model_snapshot AS "modelSnapshot",
    credential_ref AS "credentialRef" FROM steward_turns WHERE id=${turnId} FOR UPDATE`
  return turn ?? null
}

export async function stewardOperationBudget(sql: SQL, turn: StewardTurnBudget | null, currentTime: () => number) {
  if (!turn || !turn.active || turn.status !== 'running') return { reason: 'stopped' as const, createCount: 0 }
  const [usage] = await sql`SELECT COUNT(*)::integer AS count FROM steward_research_operations
    WHERE accepted_turn_id=${turn.id} AND status='accepted'`
  const createCount = Number(usage.count)
  const elapsed = Number(turn.activeMs) + (turn.activeSince ? Math.max(0, currentTime() - new Date(turn.activeSince).getTime()) : 0)
  const reason: StewardBudgetReason | null = turn.budgetReason ?? (elapsed >= Number(turn.activeLimitMs) ? 'time'
    : Number(turn.modelCalls) >= Number(turn.modelCallLimit) ? 'calls' : createCount >= 3 ? 'creates' : null)
  if (reason && turn.budgetReason !== reason) await sql`UPDATE steward_turns SET budget_reason=${reason} WHERE id=${turn.id}`
  return { reason, createCount }
}
