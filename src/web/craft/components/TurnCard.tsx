/*
 * Adapted from packages/ui/src/components/chat/TurnCard.tsx in Craft Agents
 * OSS v0.13.3 at e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 *
 * AgentAnywhere keeps TurnCard, ActivityStatusIcon, ActivityRow and ResponseCard
 * with their original collapsible activity/response structure. Task grouping,
 * Electron detail windows, plans, annotations and clipboard actions are removed.
 * Real tool arguments/results remain available through native details elements,
 * which replace Electron's onOpenDetails window at the browser boundary.
 */
import * as React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2, ChevronRight, Circle, LoaderCircle, XCircle } from 'lucide-react'
import { cn } from '../lib/utils'

export type ActivityStatus = 'pending' | 'running' | 'completed' | 'error'
export type ActivityType = 'tool' | 'thinking' | 'intermediate' | 'status'

export interface ActivityItem {
  id: string
  type: ActivityType
  status: ActivityStatus
  toolName?: string
  toolInput?: unknown
  result?: unknown
  content?: string
  intent?: string
  displayName?: string
  timestamp: number
  error?: string
  summary?: string
  depth?: number
}

export interface ResponseContent {
  text: string
  isStreaming: boolean
  streamStartTime?: number
}

export interface TurnCardProps {
  turnId: string
  activities: ActivityItem[]
  response?: ResponseContent
  intent?: string
  isStreaming: boolean
  isComplete: boolean
  defaultExpanded?: boolean
  isExpanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  renderMarkdown: (content: string) => React.ReactNode
}

function Spinner({ className }: { className?: string }) {
  return <LoaderCircle aria-hidden="true" className={cn('animate-spin', className)} />
}

export function ActivityStatusIcon({ status }: { status: ActivityStatus }) {
  const renderIcon = () => {
    switch (status) {
      case 'pending': return <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
      case 'running': return <div className="h-3.5 w-3.5 flex items-center justify-center shrink-0"><Spinner className="h-3 w-3" /></div>
      case 'completed': return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
      case 'error': return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
    }
  }

  return <AnimatePresence mode="wait" initial={false}>
    <motion.div
      key={status}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="shrink-0"
    >{renderIcon()}</motion.div>
  </AnimatePresence>
}

function formatDetail(value: unknown, empty: string) {
  if (value === undefined || value === '') return empty
  if (typeof value === 'string') return value
  try { return JSON.stringify(value, null, 2) }
  catch { return String(value) }
}

export function ActivityRow({ activity }: { activity: ActivityItem }) {
  const displayName = activity.displayName || activity.toolName || activity.content || '处理中'
  const detailId = `craft-activity-${activity.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`

  return <details className="group/activity" aria-labelledby={detailId}>
    <summary className="list-none cursor-pointer">
      <div className="group/row flex items-center gap-2 py-0.5 text-foreground/75 flex-1 min-w-0 text-xs">
        <ActivityStatusIcon status={activity.status} />
        <span id={detailId} className="truncate font-medium">{displayName}</span>
        {activity.summary && <span className="truncate flex-1 text-muted-foreground">· {activity.summary}</span>}
        <span className="ml-auto text-[10px] text-muted-foreground group-open/activity:hidden">详情</span>
      </div>
    </summary>
    <div className="ml-5 mt-1 mb-2 grid gap-2 rounded-[6px] bg-foreground/3 p-2 text-xs">
      <div><strong className="font-medium">参数</strong><pre className="mt-1 overflow-auto whitespace-pre-wrap break-words">{formatDetail(activity.toolInput, '未记录')}</pre></div>
      {activity.error && <div><strong className="font-medium text-destructive">错误</strong><pre className="mt-1 overflow-auto whitespace-pre-wrap break-words">{activity.error}</pre></div>}
      <div><strong className="font-medium">完整结果</strong><pre className="mt-1 overflow-auto whitespace-pre-wrap break-words">{formatDetail(activity.result, activity.status === 'running' ? '等待结果' : '无文本结果')}</pre></div>
    </div>
  </details>
}

const CONTENT_THROTTLE_MS = 300

export function ResponseCard({ text, isStreaming, renderMarkdown }: ResponseContent & { renderMarkdown: (content: string) => React.ReactNode }) {
  const [displayedText, setDisplayedText] = React.useState(text)
  const lastUpdateRef = React.useRef(Date.now())

  React.useEffect(() => {
    if (!isStreaming) {
      setDisplayedText(text)
      return
    }
    const elapsed = Date.now() - lastUpdateRef.current
    if (elapsed >= CONTENT_THROTTLE_MS) {
      lastUpdateRef.current = Date.now()
      setDisplayedText(text)
      return
    }
    const timer = setTimeout(() => {
      lastUpdateRef.current = Date.now()
      setDisplayedText(text)
    }, CONTENT_THROTTLE_MS - elapsed)
    return () => clearTimeout(timer)
  }, [isStreaming, text])

  return <div className="bg-background shadow-minimal rounded-[8px] overflow-hidden group">
    <div data-search-root="response" className="pl-[22px] pr-4 py-3 text-sm overflow-y-auto scrollbar-hover max-h-[540px]">
      <div className="relative">{renderMarkdown(displayedText)}</div>
    </div>
    {isStreaming && <div className="px-4 py-2 border-t border-border/30 flex items-center bg-foreground/2 text-xs">
      <div className="flex items-center gap-2 text-muted-foreground"><Spinner className="h-3 w-3" /><span>生成中…</span></div>
    </div>}
  </div>
}

function getPreviewText(activities: ActivityItem[], intent: string | undefined, isStreaming: boolean, hasResponse: boolean, isComplete: boolean) {
  if (intent) return intent
  const errorCount = activities.filter(activity => activity.status === 'error').length
  const allSettled = activities.length > 0 && activities.every(activity => ['completed', 'error'].includes(activity.status))
  if (allSettled) return `步骤已结束${errorCount ? ` · ${errorCount} 项失败` : ''}`
  if (activities.some(activity => activity.status === 'running')) return isComplete ? '轮次已结束' : '执行中'
  if (hasResponse) return '整理回复'
  return isStreaming ? '处理中' : '等待执行'
}

export const TurnCard = React.memo(function TurnCard({
  turnId,
  activities,
  response,
  intent,
  isStreaming,
  isComplete,
  defaultExpanded = false,
  isExpanded: externalIsExpanded,
  onExpandedChange,
  renderMarkdown,
}: TurnCardProps) {
  const [localExpandedTurns, setLocalExpandedTurns] = React.useState<Set<string>>(
    () => defaultExpanded ? new Set([turnId]) : new Set(),
  )
  const isExpanded = externalIsExpanded ?? localExpandedTurns.has(turnId)
  const activitiesContainerRef = React.useRef<HTMLDivElement>(null)

  const toggleExpanded = React.useCallback(() => {
    const newExpanded = !isExpanded
    if (onExpandedChange) onExpandedChange(newExpanded)
    else setLocalExpandedTurns(previous => {
      const next = new Set(previous)
      if (next.has(turnId)) next.delete(turnId)
      else next.add(turnId)
      return next
    })
  }, [isExpanded, onExpandedChange, turnId])

  const sortedActivities = React.useMemo(
    () => [...activities].sort((left, right) => left.timestamp - right.timestamp),
    [activities],
  )
  const previewText = React.useMemo(
    () => getPreviewText(activities, intent, isStreaming, Boolean(response), isComplete),
    [activities, intent, isComplete, isStreaming, response],
  )
  const hasActivities = sortedActivities.length > 0
  if (!hasActivities && !response && isComplete) return null

  return <div className="space-y-1">
    {hasActivities && <div className="group select-none" data-search-exclude="true">
      <button
        type="button"
        data-craft-button=""
        onClick={toggleExpanded}
        className="flex items-center gap-2 w-full pl-2.5 pr-1.5 py-1.5 rounded-[8px] text-left text-xs text-muted-foreground hover:bg-foreground/3 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
        aria-expanded={isExpanded}
      >
        <motion.div initial={false} animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.15, ease: 'easeOut' }} className="h-3.5 w-3.5 flex items-center justify-center shrink-0">
          <ChevronRight className="h-3.5 w-3.5" />
        </motion.div>
        <span className="-ml-0.5 shrink-0 px-1.5 py-0.5 rounded-[4px] bg-background shadow-minimal text-[10px] font-medium tabular-nums">{activities.length}</span>
        <span className="relative flex-1 min-w-0 h-5 flex items-center"><AnimatePresence initial={false}>
          <motion.span key={previewText} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="absolute inset-0 truncate">{previewText}</motion.span>
        </AnimatePresence></span>
      </button>
      <AnimatePresence initial={false}>
        {isExpanded && <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ height: { duration: 0.25, ease: [0.4, 0, 0.2, 1] }, opacity: { duration: 0.15 } }}
          className="overflow-hidden"
        >
          <div ref={activitiesContainerRef} className="pl-4 pr-2 py-0 space-y-0.5 border-l-2 border-border ml-[13px]">
            <AnimatePresence mode="sync">{sortedActivities.map((activity, index) => <motion.div
              key={activity.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(index, 8) * 0.03 }}
            ><ActivityRow activity={activity} /></motion.div>)}</AnimatePresence>
          </div>
        </motion.div>}
      </AnimatePresence>
    </div>}
    {!hasActivities && isStreaming && !response && <div className="flex items-center gap-2 px-3 py-1.5 text-muted-foreground text-xs"><Spinner className="h-3 w-3" /><span>处理中…</span></div>}
    {response && <div className={cn('select-text', hasActivities && 'mt-2')}><ResponseCard {...response} renderMarkdown={renderMarkdown} /></div>}
  </div>
})
