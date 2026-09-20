import { useLayoutEffect, useRef, useState, type ReactNode, type UIEvent } from 'react'
import { ActivityRow, type ActivityItem } from './craft/components/TurnCard'

export type ActivityEvent = {
  serverSeq: number
  turnId?: string
  epoch?: number
  type: string
  payload: Record<string, unknown>
  occurredAt: string
}

export type ToolActivity = {
  id: string
  scopeId: string
  name: string
  status: 'running' | 'completed' | 'error'
  args?: unknown
  result?: unknown
  error?: string
  occurredAt: string
}

export async function readActivityPages<T extends ActivityEvent>(after: number, fetchPage: (after: number) => Promise<T[]>) {
  const events: T[] = []
  let cursor = after
  for (;;) {
    const page = await fetchPage(cursor)
    const fresh = page.filter(event => event.serverSeq > cursor)
    if (fresh.length) {
      cursor = fresh[fresh.length - 1].serverSeq
      events.push(...fresh)
    }
    if (page.length < 500 || !fresh.length) return { events, cursor }
  }
}

function eventScope(event: ActivityEvent) {
  return event.turnId ?? String(event.epoch ?? 'unknown')
}

export function buildToolActivities(events: ActivityEvent[]) {
  const activities = new Map<string, ToolActivity>()
  for (const event of events) {
    if (event.type !== 'tool.started' && event.type !== 'tool.completed') continue
    const callId = String(event.payload.toolCallId ?? '')
    if (!callId) continue
    const scopeId = eventScope(event)
    const id = `${scopeId}:${callId}`
    const previous = activities.get(id)
    if (event.type === 'tool.started') {
      activities.set(id, {
        id, scopeId, name: String(event.payload.name ?? '工具调用'), status: previous?.status ?? 'running',
        args: event.payload.args, result: previous?.result, error: previous?.error, occurredAt: previous?.occurredAt ?? event.occurredAt,
      })
    } else {
      activities.set(id, {
        id, scopeId, name: String(event.payload.name ?? previous?.name ?? '工具调用'),
        status: event.payload.isError === true ? 'error' : 'completed', args: previous?.args,
        result: event.payload.result, error: typeof event.payload.error === 'string' ? event.payload.error : undefined,
        occurredAt: previous?.occurredAt ?? event.occurredAt,
      })
    }
  }
  return [...activities.values()]
}

function structuredSummary(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const object = value as Record<string, unknown>
  const receipt = object.receipt && typeof object.receipt === 'object' ? object.receipt as Record<string, unknown> : null
  const status = receipt?.status ?? object.status
  if (typeof status === 'string') return `状态：${({ accepted: '已接收', completed: '已完成', failed: '失败', unexecuted: '未执行' } as Record<string, string>)[status] ?? status}`
  for (const key of ['results', 'items', 'matches']) {
    if (Array.isArray(object[key])) return `返回 ${object[key].length} 项结果`
  }
  for (const key of ['summary', 'message']) {
    if (typeof object[key] === 'string') return object[key] as string
  }
  return ''
}

function resultSummary(result: unknown): string {
  if (result && typeof result === 'object' && Array.isArray((result as Record<string, unknown>).content)) {
    const text = ((result as Record<string, unknown>).content as unknown[])
      .filter(part => part && typeof part === 'object' && (part as Record<string, unknown>).type === 'text')
      .map(part => String((part as Record<string, unknown>).text ?? '')).join(' ').trim()
    if (text) return resultSummary(text)
    return '已返回结果，展开查看'
  }
  if (typeof result !== 'string') return structuredSummary(result) || (result === undefined ? '' : '已返回结果，展开查看')
  const text = result.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  try {
    const parsed = JSON.parse(text)
    return structuredSummary(parsed) || '已返回结果，展开查看'
  } catch {
    return text.slice(0, 120) + (text.length > 120 ? '…' : '')
  }
}

export function summarizeToolActivity(activity: ToolActivity) {
  if (activity.status === 'running') return '执行中'
  const result = activity.error || resultSummary(activity.result) || (activity.status === 'error' ? '执行失败' : '完成')
  return activity.status === 'error' ? `失败 · ${result}` : `完成 · ${result}`
}

function storeScroll(storageKey: string, top: number, following: boolean) {
  try { sessionStorage.setItem(storageKey, JSON.stringify({ top, following })) } catch { /* reading remains usable when browser storage is unavailable */ }
}

export function ToolActivityList({ activities }: { activities: ToolActivity[] }) {
  if (!activities.length) return null
  return <div className="tool-activities">
    {activities.map(activity => {
      const item: ActivityItem = {
        id: activity.id,
        type: 'tool',
        status: activity.status,
        toolName: activity.name,
        displayName: activity.name,
        toolInput: activity.args,
        result: activity.result,
        error: activity.error,
        summary: summarizeToolActivity(activity),
        timestamp: Date.parse(activity.occurredAt) || 0,
      }
      return <ActivityRow activity={item} key={activity.id} />
    })}
  </div>
}

export function StableScroll({ storageKey, revision, className, children }: { storageKey: string; revision: string | number; className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const restored = useRef(false)
  const saved = useRef<{ top: number; following: boolean } | null>(null)
  const [away, setAway] = useState(false)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    let raw: string | null = null
    try { raw = sessionStorage.getItem(storageKey) } catch { /* use the default bottom position */ }
    try {
      const value = raw ? JSON.parse(raw) as { top?: unknown; following?: unknown } : null
      saved.current = value && typeof value.top === 'number' ? { top: value.top, following: value.following === true } : null
    } catch {
      const top = Number(raw)
      saved.current = Number.isFinite(top) ? { top, following: false } : null
    }
    restored.current = false
    following.current = true
    setAway(false)
    return () => storeScroll(storageKey, element.scrollTop, following.current)
  }, [storageKey])

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    if (!restored.current) {
      if (saved.current && !saved.current.following && element.scrollHeight <= element.clientHeight) return
      element.scrollTop = saved.current && !saved.current.following ? saved.current.top : element.scrollHeight
      following.current = saved.current?.following ?? element.scrollHeight - element.scrollTop - element.clientHeight <= 48
      setAway(!following.current)
      restored.current = true
    } else if (following.current) element.scrollTop = element.scrollHeight
  }, [revision])

  function remember(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget
    following.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 48
    setAway(!following.current)
    storeScroll(storageKey, element.scrollTop, following.current)
  }

  function latest() {
    const element = ref.current
    if (!element) return
    following.current = true
    setAway(false)
    const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    element.scrollTo({ top: element.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' })
  }

  return <div className="stable-scroll-region">
    <div ref={ref} className={className} onScroll={remember} aria-live="polite">{children}</div>
    {away && <button type="button" className="return-latest" onClick={latest}>回到最新内容 ↓</button>}
  </div>
}
