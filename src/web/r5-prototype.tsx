// Three full-page Craft-adjacent variants, switchable with ?variant=A|B|C.
import {
  ArrowDownToLine,
  ArrowLeft,
  BookOpen,
  BriefcaseBusiness,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileText,
  ListChecks,
  LogIn,
  Menu,
  MessageSquare,
  Moon,
  PanelRightOpen,
  Pencil,
  Plus,
  Quote,
  RotateCcw,
  Search,
  Settings,
  Square,
  Sun,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from './craft/components/Button'
import { FreeFormInput } from './craft/components/FreeFormInput'
import { PermissionRequest } from './craft/components/PermissionRequest'
import { PreviewHeader, PreviewHeaderBadge } from './craft/components/PreviewHeader'
import { SettingsCard, SettingsCardFooter } from './craft/components/SettingsCard'
import { SettingsInput } from './craft/components/SettingsInput'
import { SettingsSelectRow } from './craft/components/SettingsSelect'
import { SettingsSection } from './craft/components/SettingsSection'
import { SettingsToggle } from './craft/components/SettingsToggle'
import { SidebarButton, type SidebarLinkItem } from './craft/components/SidebarButton'
import { StatusBadge } from './craft/components/StatusBadge'
import { UserMessageBubble } from './craft/components/UserMessageBubble'

type Variant = 'A' | 'B' | 'C'
type View = 'conversation' | 'works' | 'pending' | 'settings' | 'login' | 'report'
type WorkState = 'completed' | 'waiting' | 'failed' | 'running'
type ThemeChoice = 'light' | 'dark' | 'system'
type Scenario = 'history' | 'empty' | 'running' | 'waiting' | 'failed' | 'long'

interface WorkItem {
  key: string
  title: string
  original: string
  state: WorkState
  summary: string
}

interface Annotation {
  quote: string
  note: string
  workKey: string
  version: number
}

interface SettingsDraft {
  endpoint: string
  protocol: string
  stewardModel: string
  researchModel: string
  includeSecondaryModel: boolean
  theme: string
}

const variants: Variant[] = ['A', 'B', 'C']
const variantNames: Record<Variant, string> = {
  A: '三段工作台',
  B: '紧凑总览',
  C: '专注切换',
}

const viewLabels: Record<View, string> = {
  conversation: '管家对话',
  works: '工作',
  pending: '待办',
  settings: '设置',
  login: '登录',
  report: '报告',
}

const scenarioLabels: Record<Scenario, string> = {
  history: '历史对话',
  empty: '空对话',
  running: '执行中',
  waiting: '等待回答',
  failed: '执行失败',
  long: '长内容',
}

const initialWorks: WorkItem[] = [
  {
    key: 'landscape',
    title: 'Agent 产品格局',
    original: '梳理 2026 年面向个人知识工作者的 Agent 与 LLM 产品格局。覆盖任务拆分、工具调用、长任务恢复、成果审阅和定价，并区分已发布能力与公开演示。',
    state: 'completed',
    summary: '已交付 18 页报告 · 12 个一手来源',
  },
  {
    key: 'interviews',
    title: '用户访谈证据',
    original: '从公开访谈和产品社区中寻找用户采用 Agent 产品的真实阻力，优先记录具体工作流、替代方案和失败原因。',
    state: 'waiting',
    summary: '需要确认是否纳入企业采购样本',
  },
  {
    key: 'pricing',
    title: '模型成本复核',
    original: '核对主流模型套餐与 API 价格，按同一组任务估算月成本，并记录汇率、缓存和批处理假设。',
    state: 'failed',
    summary: '价格页访问超时 · 可重新执行',
  },
]

const reportBodies: Record<number, { title: string; date: string; intro: string }> = {
  1: {
    title: '个人 Agent 产品格局：能力正在从聊天框外溢',
    date: '2026 年 9 月 20 日 · 初稿',
    intro: '第一版把产品按入口分成对话、编辑器与自动化三类。这个划分便于浏览，但会低估长任务恢复和成果审阅对真实采用的影响。',
  },
  2: {
    title: '个人 Agent 产品格局：工作闭环比入口更重要',
    date: '2026 年 9 月 20 日 · 当前版本',
    intro: '个人 Agent 产品的竞争中心正在从“能否调用工具”转向“能否让一项工作被放心地交出去”。差异集中在目标澄清、执行可见性、人工介入和成果复用四个环节。',
  },
  3: {
    title: '个人 Agent 产品格局：审阅闭环修订版',
    date: '刚刚生成 · 修订版本',
    intro: '这一版吸收了报告批注，进一步区分公开演示、已发布能力与用户长期使用后的稳定体验，并补充了企业采购样本的范围说明。',
  },
}

const reportTitleByWork: Record<string, string> = {
  landscape: '个人 Agent 产品格局',
  interviews: 'Agent 产品采用阻力：用户证据',
  pricing: '主流模型成本复核',
}

function safeVariant(): Variant {
  const value = new URLSearchParams(location.search).get('variant')?.toUpperCase()
  return value === 'B' || value === 'C' ? value : 'A'
}

function stateMeta(state: WorkState) {
  if (state === 'completed') return { label: '已完成', color: 'var(--success)', icon: Check }
  if (state === 'waiting') return { label: '待回答', color: 'var(--info)', icon: Clock3 }
  if (state === 'failed') return { label: '失败', color: 'var(--danger)', icon: CircleAlert }
  return { label: '执行中', color: 'var(--accent)', icon: RotateCcw }
}

function shouldSubmitKey(event: React.KeyboardEvent<HTMLDivElement>) {
  return event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229
}

function R5Prototype() {
  const [variant, setVariantState] = useState<Variant>(safeVariant)
  const [view, setView] = useState<View>('conversation')
  const [scenario, setScenario] = useState<Scenario>('history')
  const [theme, setTheme] = useState<ThemeChoice>('light')
  const [reportOpen, setReportOpen] = useState(false)
  const [reportVersion, setReportVersion] = useState(2)
  const [versions, setVersions] = useState([1, 2])
  const [works, setWorks] = useState(initialWorks)
  const [selectedWorkKey, setSelectedWorkKey] = useState('landscape')
  const [composer, setComposer] = useState('')
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([])
  const [processing, setProcessing] = useState(false)
  const [threadTitle, setThreadTitle] = useState('Agent 产品如何走出聊天框')
  const [editingThread, setEditingThread] = useState(false)
  const [selectedQuote, setSelectedQuote] = useState('')
  const [annotationNote, setAnnotationNote] = useState('')
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>({
    endpoint: 'https://gateway.example.com/v1',
    protocol: 'responses',
    stewardModel: 'claude-sonnet-4-5',
    researchModel: 'gpt-5',
    includeSecondaryModel: true,
    theme: 'light',
  })
  const [savedSettings, setSavedSettings] = useState(settingsDraft)
  const [saveFeedback, setSaveFeedback] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginFeedback, setLoginFeedback] = useState('')
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const reportRef = useRef<HTMLDivElement>(null)
  const processingTimer = useRef<number | null>(null)

  const setVariant = useCallback((next: Variant) => {
    const url = new URL(location.href)
    url.searchParams.set('variant', next)
    history.replaceState(null, '', url)
    setVariantState(next)
  }, [])

  const cycleVariant = useCallback((delta: number) => {
    setVariantState(current => {
      const next = variants[(variants.indexOf(current) + delta + variants.length) % variants.length]
      const url = new URL(location.href)
      url.searchParams.set('variant', next)
      history.replaceState(null, '', url)
      return next
    })
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, button, [contenteditable="true"], [role="slider"]')) return
      if (event.key === 'ArrowLeft') cycleVariant(-1)
      if (event.key === 'ArrowRight') cycleVariant(1)
    }
    const handlePopState = () => setVariantState(safeVariant())
    window.addEventListener('keydown', handleKey)
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('popstate', handlePopState)
    }
  }, [cycleVariant])

  useEffect(() => {
    console.info('[R5 prototype] variant', variant)
  }, [variant])

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
    }
    apply()
    if (theme === 'system') media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => () => {
    if (processingTimer.current !== null) window.clearTimeout(processingTimer.current)
  }, [])

  function navigate(next: View) {
    setView(next)
    setReportOpen(next === 'report')
  }

  function submitMessage() {
    const text = composer.trim()
    if (!text || processing) return
    const submittedAnnotationCount = annotations.filter(item => item.workKey === selectedWorkKey && item.version === reportVersion).length
    setMessages(current => [...current, { role: 'user', text }])
    setComposer('')
    setProcessing(true)
    processingTimer.current = window.setTimeout(() => {
      const revising = text.includes('报告') && (text.includes('批注') || text.includes('修改'))
      if (revising) {
        setVersions(current => current.includes(3) ? current : [...current, 3])
        setReportVersion(3)
        setReportOpen(true)
        setAnnotations(current => current.filter(item => item.workKey !== selectedWorkKey || item.version !== reportVersion))
      }
      setMessages(current => [...current, {
        role: 'assistant',
        text: revising
          ? `已按 ${submittedAnnotationCount} 条批注生成报告 v3。原版本保持不变，可以继续对照审阅。`
          : '我已把要求拆成可核对的研究步骤。三项工作会分别保留进度与成果入口。',
      }])
      setProcessing(false)
      processingTimer.current = null
    }, 780)
  }

  function stopProcessing() {
    if (processingTimer.current !== null) window.clearTimeout(processingTimer.current)
    processingTimer.current = null
    setProcessing(false)
    setMessages(current => [...current, { role: 'assistant', text: '已停止本次回复，现有工作和报告不受影响。' }])
  }

  function answerQuestion(answer: string) {
    setWorks(current => current.map(work => work.key === 'interviews'
      ? { ...work, state: 'completed', summary: `已采用“${answer}”并完成补充调研` }
      : work))
  }

  function retryFailed() {
    setWorks(current => current.map(work => work.key === 'pricing' ? { ...work, state: 'running', summary: '正在重新核对价格页' } : work))
  }

  function finishRunning(workKey: string) {
    setWorks(current => current.map(work => work.key === workKey
      ? { ...work, state: 'completed', summary: workKey === 'pricing' ? '重试完成 · 成本表已附在报告后' : '执行完成 · 已生成结果' }
      : work))
  }

  function downloadReport() {
    const body = Array.from(reportRef.current?.querySelectorAll('h1, h2, h3, p, blockquote') ?? []).map(node => {
      const prefix = /^H[1-3]$/.test(node.tagName) ? '#'.repeat(Number(node.tagName[1])) + ' ' : node.tagName === 'BLOCKQUOTE' ? '> ' : ''
      return prefix + (node as HTMLElement).innerText
    }).join('\n\n') + '\n'
    const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${selectedWorkKey}-v${reportVersion}.md`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function captureSelection() {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !reportRef.current) return
    const anchor = selection.anchorNode
    const focus = selection.focusNode
    if (!anchor || !focus || !reportRef.current.contains(anchor) || !reportRef.current.contains(focus)) return
    const quote = selection.toString().trim().replace(/\s+/g, ' ').slice(0, 180)
    if (quote) setSelectedQuote(quote)
  }

  function addAnnotation() {
    if (!selectedQuote || !annotationNote.trim()) return
    setAnnotations(current => [...current, { quote: selectedQuote, note: annotationNote.trim(), workKey: selectedWorkKey, version: reportVersion }])
    setSelectedQuote('')
    setAnnotationNote('')
    window.getSelection()?.removeAllRanges()
  }

  function putRevisionInComposer() {
    const currentAnnotations = annotations.filter(item => item.workKey === selectedWorkKey && item.version === reportVersion)
    if (!currentAnnotations.length) return
    const workTitle = works.find(work => work.key === selectedWorkKey)?.title ?? '当前工作'
    setComposer(`请修改工作“${workTitle}”的报告 v${reportVersion}，根据以下批注：\n${currentAnnotations.map((item, index) => `${index + 1}. “${item.quote}” — ${item.note}`).join('\n')}`)
    setView('conversation')
    setReportOpen(false)
  }

  const context = {
    changeConversation: (title?: string) => {
      setThreadTitle(title ?? '新对话')
      setScenario(title ? 'history' : 'empty')
      setMessages([])
      setComposer('')
      navigate('conversation')
    },
    variant,
    view,
    navigate,
    reportOpen,
    setReportOpen,
    works,
    setWorks,
    selectedWorkKey,
    setSelectedWorkKey,
    threadTitle,
    setThreadTitle,
    editingThread,
    setEditingThread,
    scenario,
    composer,
    setComposer,
    messages,
    processing,
    submitMessage,
    stopProcessing,
    answerQuestion,
    retryFailed,
    finishRunning,
    reportVersion,
    setReportVersion,
    versions,
    reportRef,
    captureSelection,
    downloadReport,
    selectedQuote,
    setSelectedQuote,
    annotationNote,
    setAnnotationNote,
    annotations,
    setAnnotations,
    addAnnotation,
    putRevisionInComposer,
    settingsDraft,
    setSettingsDraft,
    savedSettings,
    setSavedSettings,
    saveFeedback,
    setSaveFeedback,
    setTheme,
    loginPassword,
    setLoginPassword,
    loginFeedback,
    setLoginFeedback,
  }

  return <div className={`r5-prototype r5-variant-${variant.toLowerCase()}`}>
    {variant === 'A' && <VariantA {...context} />}
    {variant === 'B' && <VariantB {...context} />}
    {variant === 'C' && <VariantC {...context} />}
    <PrototypeInspector open={inspectorOpen} onToggle={() => setInspectorOpen(value => !value)} state={{ variant, view, scenario, theme, reportVersion, versions, processing, works: works.map(({ title, state }) => ({ title, state })), annotations: annotations.length }} />
    <PrototypeSwitcher
      variant={variant}
      onVariant={setVariant}
      onCycle={cycleVariant}
      scenario={scenario}
      onScenario={next => {
        setScenario(next)
        setMessages([])
        setComposer('')
        setReportOpen(false)
        setWorks(initialWorks.map(work => next === 'running' && work.key === 'pricing'
          ? { ...work, state: 'running', summary: '正在重新核对价格页' }
          : work))
        setThreadTitle(next === 'long' ? '个人 Agent 产品的可靠委托、执行恢复与成果审阅如何形成长期使用闭环' : 'Agent 产品如何走出聊天框')
        setView(next === 'waiting' ? 'pending' : next === 'failed' ? 'works' : 'conversation')
      }}
      theme={theme}
      onTheme={setTheme}
    />
  </div>
}

type PrototypeContext = Parameters<typeof VariantA>[0]

function VariantA(props: {
  changeConversation: (title?: string) => void
  variant: Variant
  view: View
  navigate: (view: View) => void
  reportOpen: boolean
  setReportOpen: (open: boolean) => void
  works: WorkItem[]
  setWorks: React.Dispatch<React.SetStateAction<WorkItem[]>>
  selectedWorkKey: string
  setSelectedWorkKey: (workKey: string) => void
  threadTitle: string
  setThreadTitle: (title: string) => void
  editingThread: boolean
  setEditingThread: (editing: boolean) => void
  scenario: Scenario
  composer: string
  setComposer: (value: string) => void
  messages: Array<{ role: 'user' | 'assistant'; text: string }>
  processing: boolean
  submitMessage: () => void
  stopProcessing: () => void
  answerQuestion: (answer: string) => void
  retryFailed: () => void
  finishRunning: (workKey: string) => void
  reportVersion: number
  setReportVersion: (version: number) => void
  versions: number[]
  reportRef: React.RefObject<HTMLDivElement>
  captureSelection: () => void
  downloadReport: () => void
  selectedQuote: string
  setSelectedQuote: (quote: string) => void
  annotationNote: string
  setAnnotationNote: (note: string) => void
  annotations: Annotation[]
  setAnnotations: React.Dispatch<React.SetStateAction<Annotation[]>>
  addAnnotation: () => void
  putRevisionInComposer: () => void
  settingsDraft: SettingsDraft
  setSettingsDraft: React.Dispatch<React.SetStateAction<SettingsDraft>>
  savedSettings: SettingsDraft
  setSavedSettings: React.Dispatch<React.SetStateAction<SettingsDraft>>
  saveFeedback: string
  setSaveFeedback: (feedback: string) => void
  setTheme: (theme: ThemeChoice) => void
  loginPassword: string
  setLoginPassword: (password: string) => void
  loginFeedback: string
  setLoginFeedback: (feedback: string) => void
}) {
  return <div className={`r5-shell r5-shell-a ${props.reportOpen && props.view !== 'report' ? 'has-report' : ''}`}>
    <NavigationPane active={props.view} onNavigate={props.navigate} mode="full" />
    <ConversationList title="对话" activeTitle={props.threadTitle} onSelect={props.changeConversation} />
    <main className="r5-main-panel">
      <MobileHeader active={props.view} onNavigate={props.navigate} />
      <Surface {...props} />
    </main>
    {props.reportOpen && props.view !== 'report' && <aside className="r5-report-drawer" aria-label="报告预览"><ReportView {...props} onClose={() => props.navigate('conversation')} /></aside>}
  </div>
}

function VariantB(props: PrototypeContext) {
  return <div className="r5-shell r5-shell-b">
    <aside className="r5-combined-sidebar">
      <Brand compact={false} />
      <NavigationLinks active={props.view} onNavigate={props.navigate} />
      <ConversationList title="最近对话" activeTitle={props.threadTitle} embedded onSelect={props.changeConversation} />
      <AccountStrip onLogin={() => props.navigate('login')} />
    </aside>
    <main className="r5-main-panel r5-broad-main">
      <MobileHeader active={props.view} onNavigate={props.navigate} />
      {props.reportOpen ? <ReportView {...props} onClose={() => props.navigate('conversation')} /> : <Surface {...props} />}
    </main>
    <aside className="r5-work-overview" aria-label="工作总览">
      <header><div><span>当前对话</span><h2>工作进度</h2></div><strong>{props.works.filter(item => item.state === 'completed').length}/3</strong></header>
      <WorkRows {...props} compact />
      <Button variant="outline" size="sm" onClick={() => props.navigate('works')}>查看全部工作</Button>
    </aside>
  </div>
}

function VariantC(props: PrototypeContext) {
  const focusView = props.reportOpen ? 'report' : props.view
  return <div className="r5-shell r5-shell-c">
    <NavigationPane active={focusView} onNavigate={view => {
      if (view === 'report') props.setReportOpen(true)
      else {
        props.setReportOpen(false)
        props.navigate(view)
      }
    }} mode="rail" />
    <main className="r5-focus-main">
      <MobileHeader active={focusView} onNavigate={view => { props.setReportOpen(false); props.navigate(view) }} />
      <div className="r5-focus-tabs" role="tablist" aria-label="当前内容">
        <Button variant={focusView === 'conversation' ? 'secondary' : 'ghost'} size="sm" role="tab" aria-selected={focusView === 'conversation'} onClick={() => { props.setReportOpen(false); props.navigate('conversation') }}>对话</Button>
        <Button variant={focusView === 'works' ? 'secondary' : 'ghost'} size="sm" role="tab" aria-selected={focusView === 'works'} onClick={() => { props.setReportOpen(false); props.navigate('works') }}>工作</Button>
        <Button variant={focusView === 'report' ? 'secondary' : 'ghost'} size="sm" role="tab" aria-selected={focusView === 'report'} onClick={() => props.setReportOpen(true)}>报告</Button>
      </div>
      {focusView === 'report' ? <ReportView {...props} onClose={() => props.navigate('conversation')} /> : <Surface {...props} />}
    </main>
  </div>
}

function Surface(props: PrototypeContext) {
  if (props.view === 'works') return <WorkList {...props} />
  if (props.view === 'pending') return <PendingView {...props} />
  if (props.view === 'settings') return <SettingsView {...props} />
  if (props.view === 'login') return <LoginView {...props} />
  if (props.view === 'report') return <ReportView {...props} onClose={() => props.navigate('conversation')} />
  return <ConversationView {...props} />
}

function Brand({ compact }: { compact: boolean }) {
  return <div className={`r5-brand ${compact ? 'compact' : ''}`}><span aria-hidden="true">A</span>{!compact && <div><strong>AgentAnywhere</strong><small>个人委托工作台</small></div>}</div>
}

function navItems(active: View): SidebarLinkItem[] {
  return [
    { id: 'conversation', title: '管家对话', href: '#conversation', icon: MessageSquare, variant: active === 'conversation' ? 'default' : 'ghost' },
    { id: 'works', title: '工作', href: '#works', icon: BriefcaseBusiness, label: '3', variant: active === 'works' ? 'default' : 'ghost' },
    { id: 'pending', title: '待办', href: '#pending', icon: ListChecks, variant: active === 'pending' ? 'default' : 'ghost' },
    { id: 'report', title: '报告', href: '#report', icon: FileText, variant: active === 'report' ? 'default' : 'ghost' },
    { id: 'settings', title: '设置', href: '#settings', icon: Settings, variant: active === 'settings' ? 'default' : 'ghost' },
  ]
}

function NavigationLinks({ active, onNavigate }: { active: View; onNavigate: (view: View) => void }) {
  return <nav className="r5-nav-links" aria-label="页面">{navItems(active).map(link => <SidebarButton
    key={link.id}
    link={link}
    onClick={event => {
      event.preventDefault()
      onNavigate(link.id as View)
    }}
  />)}</nav>
}

function NavigationPane({ active, onNavigate, mode }: { active: View; onNavigate: (view: View) => void; mode: 'full' | 'rail' }) {
  return <aside className={`r5-navigation r5-navigation-${mode}`}>
    <Brand compact={mode === 'rail'} />
    <NavigationLinks active={active} onNavigate={onNavigate} />
    <AccountStrip compact={mode === 'rail'} onLogin={() => onNavigate('login')} />
  </aside>
}

function AccountStrip({ compact = false, onLogin }: { compact?: boolean; onLogin: () => void }) {
  return <button type="button" className={`r5-account ${compact ? 'compact' : ''}`} onClick={onLogin} aria-label="退出登录并预览登录页"><span>K</span>{!compact && <div><strong>工作台所有者</strong><small>本机 · 退出登录</small></div>}</button>
}

function ConversationList({ title, activeTitle, embedded = false, onSelect }: { title: string; activeTitle: string; embedded?: boolean; onSelect: (title?: string) => void }) {
  const [query, setQuery] = useState('')
  const items = [
    [activeTitle, '3 项工作 · 刚刚'],
    ['本地模型怎样进入日常工作', '报告 v2 · 昨天'],
    ['研究工具的可信来源边界', '已完成 · 周四'],
    ['长任务中断后如何恢复', '1 项待办 · 9 月 17 日'],
  ]
  const visibleItems = items.filter(([name]) => name.toLowerCase().includes(query.trim().toLowerCase()))
  return <section className={`r5-conversation-list ${embedded ? 'embedded' : ''}`} aria-label={title}>
    <header><h2>{title}</h2><Button variant="ghost" size="icon" aria-label="新建对话" onClick={() => onSelect()}><Plus /></Button></header>
    <label className="r5-search"><Search aria-hidden="true" /><input aria-label="搜索对话" placeholder="搜索" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className="r5-thread-items">{visibleItems.map(([name, meta], index) => <button key={name} type="button" className={index === 0 && !query ? 'active' : ''} onClick={() => onSelect(name)}>
      <span>{name}</span><small>{meta}</small>
    </button>)}</div>
  </section>
}

function MobileHeader({ active, onNavigate }: { active: View; onNavigate: (view: View) => void }) {
  const [open, setOpen] = useState(false)
  function choose(view: View) {
    onNavigate(view)
    setOpen(false)
  }
  return <header className="r5-mobile-header">
    <Brand compact />
    <span>{viewLabels[active]}</span>
    <Button variant="ghost" size="icon" aria-label={open ? '关闭导航' : '打开导航'} aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? <X /> : <Menu />}</Button>
    {open && <div className="r5-mobile-menu" role="dialog" aria-label="移动导航">
      <NavigationLinks active={active} onNavigate={choose} />
      <div className="r5-mobile-conversations"><h2>最近对话</h2><button type="button" onClick={() => choose('conversation')}><strong>Agent 产品如何走出聊天框</strong><span>3 项工作 · 刚刚</span></button><button type="button" onClick={() => choose('conversation')}><strong>本地模型怎样进入日常工作</strong><span>报告 v2 · 昨天</span></button></div>
      <Button variant="ghost" size="sm" onClick={() => choose('login')}><LogIn />退出登录</Button>
    </div>}
  </header>
}

function ConversationView(props: PrototypeContext) {
  return <section className="r5-conversation" aria-labelledby="r5-thread-title">
    <header className="r5-topbar">
      <div className="r5-title-edit">
        {props.editingThread
          ? <input aria-label="对话标题" value={props.threadTitle} maxLength={42} autoFocus onChange={event => props.setThreadTitle(event.target.value)} onBlur={() => props.setEditingThread(false)} onKeyDown={event => { if (event.key === 'Enter') props.setEditingThread(false) }} />
          : <><h1 id="r5-thread-title">{props.threadTitle}</h1><Button variant="ghost" size="icon" aria-label="编辑对话标题" onClick={() => props.setEditingThread(true)}><Pencil /></Button></>}
      </div>
      <div className="r5-topbar-actions"><span>3 项工作</span><Button variant="ghost" size="sm" onClick={() => props.navigate('works')}>查看工作</Button></div>
    </header>
    <div className="r5-conversation-scroll">
      <div className="r5-thread-body">
        {props.scenario === 'empty' ? <EmptyConversation onChoose={props.setComposer} /> : <>
          <UserMessageBubble content="帮我看清个人 Agent 产品接下来真正会在哪里拉开差距。不要只汇总功能，要找用户愿意长期交付工作的条件。" />
          <article className="r5-assistant-message">
            <span className="r5-assistant-mark">A</span>
            <div><p>我会把问题拆成产品格局、用户证据和模型成本三条线。每项工作独立推进，遇到范围选择会停下来等你。</p><p>现在已有一份可读报告。用户证据还差一个范围决定，成本复核可以直接重试。</p></div>
          </article>
          {props.variant === 'B' ? <>
            <section className="r5-b-result"><div><strong>三项工作已经派发</strong><span>进度集中在右侧工作总览，当前有一项需要回答。</span></div><Button variant="ghost" size="sm" onClick={() => props.navigate('works')}>打开工作</Button></section>
            <section className="r5-inline-work r5-b-mobile-work" aria-label="本轮工作"><header><h2>本轮工作</h2><span>{props.works.filter(work => work.state === 'completed').length} 完成 · {props.works.filter(work => work.state === 'waiting').length} 待回答 · {props.works.filter(work => work.state === 'failed').length} 失败</span></header><WorkRows {...props} /></section>
          </> : <section className="r5-inline-work" aria-label="本轮工作"><header><h2>本轮工作</h2><span>{props.works.filter(work => work.state === 'completed').length} 完成 · {props.works.filter(work => work.state === 'waiting').length} 待回答 · {props.works.filter(work => work.state === 'failed').length} 失败</span></header><WorkRows {...props} /></section>}
          {(props.scenario === 'waiting' || props.scenario === 'history') && <InlineQuestion {...props} />}
          {props.scenario === 'running' && <div className="r5-state-line"><span className="r5-pulse" />正在读取产品发布说明和价格页… <Button variant="ghost" size="sm" onClick={props.stopProcessing}>停止</Button></div>}
          {props.scenario === 'failed' && <div className="r5-state-line danger"><CircleAlert />价格页访问失败，已保留前两项结果。<Button variant="outline" size="sm" onClick={props.retryFailed}>重试失败工作</Button></div>}
          {props.scenario === 'long' && <article className="r5-assistant-message long"><span className="r5-assistant-mark">A</span><div><p>长期使用的门槛来自连续性。用户需要知道系统理解了什么、正在做什么、何时需要介入，以及最终产物能否继续修改。</p><p>产品会在四个位置拉开差距：目标能否被准确冻结；执行过程能否只暴露有用进度；失败后能否从可信检查点恢复；成果能否保持版本并进入下一轮工作。</p><p>这使“对话”更像控制面，“工作”负责事实状态，“报告”承担可审阅成果。三者需要互相可达，又不能挤在同一张总览卡里。</p></div></article>}
        </>}
        {props.messages.map((message, index) => message.role === 'user'
          ? <UserMessageBubble key={index} content={message.text} />
          : <article key={index} className="r5-assistant-message"><span className="r5-assistant-mark">A</span><p>{message.text}</p></article>)}
          {props.processing && <div className="r5-thinking" role="status"><span className="r5-pulse" />正在生成回复…</div>}
      </div>
    </div>
    <div className="r5-composer-wrap"><FreeFormInput
      label="给管家发消息"
      value={props.composer}
      onChange={props.setComposer}
      onSubmit={props.submitMessage}
      shouldSubmitKey={shouldSubmitKey}
      isProcessing={props.processing}
      placeholder="继续讨论，或给当前工作追加要求…"
      actions={props.processing ? <Button type="button" variant="ghost" size="sm" onClick={props.stopProcessing}><Square />停止</Button> : undefined}
      status={props.annotations.filter(item => item.workKey === props.selectedWorkKey && item.version === props.reportVersion).length ? `输入框可提交当前报告的批注` : undefined}
    /></div>
  </section>
}

function EmptyConversation({ onChoose }: { onChoose: (value: string) => void }) {
  return <div className="r5-empty"><div className="r5-empty-icon"><MessageSquare /></div><h2>从一个真实问题开始</h2><p>描述想得到的结果。管家会把工作拆开，并在需要你决定时停下来。</p><div><Button variant="outline" size="sm" onClick={() => onChoose('比较三款个人 Agent 产品的长期使用体验')}>比较三款 Agent 产品</Button><Button variant="outline" size="sm" onClick={() => onChoose('调研个人 AI 助手市场，并给出可验证的进入机会')}>调研一个市场</Button></div></div>
}

function InlineQuestion(props: PrototypeContext) {
  const waiting = props.works.find(work => work.key === 'interviews')?.state === 'waiting'
  if (!waiting) return null
  return <PermissionRequest
    title="需要你确认范围"
    identity="用户访谈证据"
    description="企业采购样本会增加约 20 分钟，但能补充团队协作和合规阻力。"
    actions={<><Button size="sm" onClick={() => props.answerQuestion('纳入企业样本')}>纳入企业样本</Button><Button size="sm" variant="outline" onClick={() => props.answerQuestion('只看个人用户')}>只看个人用户</Button></>}
    hint="回答后继续当前工作"
  />
}

function WorkRows(props: PrototypeContext & { compact?: boolean }) {
  return <div className={`r5-work-rows ${props.compact ? 'compact' : ''}`}>{props.works.map(work => {
    const meta = stateMeta(work.state)
    return <article key={work.key} className="r5-work-row">
      <meta.icon aria-hidden="true" />
      <div className="r5-work-copy"><strong>{work.title}</strong><span>{work.summary}</span></div>
      <StatusBadge status={{ label: meta.label, color: meta.color }} live={work.state === 'running'} />
      <div className="r5-work-actions">
        {work.state === 'completed' && <Button variant="ghost" size="sm" onClick={() => { props.setSelectedWorkKey(work.key); props.setReportOpen(true) }}><BookOpen />报告</Button>}
        {work.state === 'waiting' && <Button variant="ghost" size="sm" onClick={() => props.navigate('pending')}>回答</Button>}
        {work.state === 'failed' && <Button variant="ghost" size="sm" onClick={props.retryFailed}>重试</Button>}
        {work.state === 'running' && <Button variant="ghost" size="sm" onClick={() => props.finishRunning(work.key)}>生成结果</Button>}
      </div>
    </article>
  })}</div>
}

function WorkList(props: PrototypeContext) {
  const [editing, setEditing] = useState<string | null>(null)
  return <section className="r5-page r5-work-page">
    <PageHeader title="工作" description="围绕当前对话派发的三项独立工作。" />
    <div className="r5-page-content"><div className="r5-work-list-head"><span>当前对话</span><strong>{props.threadTitle}</strong></div>
      {props.works.map(work => {
        const meta = stateMeta(work.state)
        return <article key={work.key} className="r5-work-detail">
          <div className="r5-work-detail-main"><meta.icon /><div>
            {editing === work.key
              ? <input aria-label="工作标题" autoFocus value={work.title} maxLength={32} onChange={event => props.setWorks(current => current.map(item => item.key === work.key ? { ...item, title: event.target.value } : item))} onBlur={() => setEditing(null)} onKeyDown={event => { if (event.key === 'Enter') setEditing(null) }} />
              : <h2>{work.title}<Button variant="ghost" size="icon" aria-label={`编辑“${work.title}”标题`} onClick={() => setEditing(work.key)}><Pencil /></Button></h2>}
            <p>{work.summary}</p>
          </div></div>
          <StatusBadge status={{ label: meta.label, color: meta.color }} live={work.state === 'running'} />
          <details><summary>原始要求</summary><p>{work.original}</p></details>
          <div className="r5-work-detail-actions">
            {work.state === 'completed' && <Button variant="outline" size="sm" onClick={() => { props.setSelectedWorkKey(work.key); props.setReportOpen(true) }}><BookOpen />打开报告</Button>}
            {work.state === 'waiting' && <Button variant="outline" size="sm" onClick={() => props.navigate('pending')}>前往回答</Button>}
            {work.state === 'failed' && <Button variant="outline" size="sm" onClick={props.retryFailed}><RotateCcw />重新执行</Button>}
            {work.state === 'running' && <Button variant="outline" size="sm" onClick={() => props.finishRunning(work.key)}><Check />生成结果</Button>}
          </div>
        </article>
      })}
    </div>
  </section>
}

function PendingView(props: PrototypeContext) {
  const waiting = props.works.find(work => work.key === 'interviews')?.state === 'waiting'
  return <section className="r5-page">
    <PageHeader title="待办" description="只保留需要你介入后才能继续的事项。" />
    <div className="r5-page-content r5-pending-content">{waiting ? <InlineQuestion {...props} /> : <div className="r5-empty"><div className="r5-empty-icon"><Check /></div><h2>当前没有待办</h2><p>“用户访谈证据”已恢复执行，回答已记录在工作上下文中。</p><Button variant="outline" onClick={() => props.navigate('conversation')}>返回对话</Button></div>}</div>
  </section>
}

function SettingsView(props: PrototypeContext) {
  const dirty = JSON.stringify(props.settingsDraft) !== JSON.stringify(props.savedSettings)
  function save() {
    props.setSavedSettings(props.settingsDraft)
    props.setTheme(props.settingsDraft.theme as ThemeChoice)
    props.setSaveFeedback('设置已保存')
    window.setTimeout(() => props.setSaveFeedback(''), 1600)
  }
  return <section className="r5-page r5-settings-page">
    <PageHeader title="设置" description="模型连接和工作台偏好。" action={<span className="r5-save-state" role="status">{dirty ? '有未保存修改' : props.saveFeedback || '已保存'}</span>} />
    <div className="r5-settings-content">
      <SettingsSection title="模型连接" description="一套网关连接供管家和人工调研模型池使用。">
        <SettingsCard>
          <SettingsInput label="API 地址" description="模型网关的兼容端点。" value={props.settingsDraft.endpoint} onChange={endpoint => props.setSettingsDraft(current => ({ ...current, endpoint }))} inCard />
          <SettingsSelectRow label="协议" description="按模型网关支持情况选择。" value={props.settingsDraft.protocol} onValueChange={protocol => props.setSettingsDraft(current => ({ ...current, protocol }))} options={[{ value: 'responses', label: 'Responses API' }, { value: 'chat', label: 'Chat Completions' }]} />
          <SettingsSelectRow label="管家模型" description="用于对话、工作拆分和报告解读。" value={props.settingsDraft.stewardModel} onValueChange={stewardModel => props.setSettingsDraft(current => ({ ...current, stewardModel }))} options={[{ value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' }, { value: 'gpt-5', label: 'GPT-5' }, { value: 'qwen3.5', label: 'Qwen 3.5' }]} />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="人工调研模型池" description="管家只会从明确加入池中的模型派发独立调研。">
        <SettingsCard>
          <SettingsSelectRow label="池内模型" value={props.settingsDraft.researchModel} onValueChange={researchModel => props.setSettingsDraft(current => ({ ...current, researchModel }))} options={[{ value: 'gpt-5', label: 'GPT-5' }, { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' }, { value: 'qwen3.5', label: 'Qwen 3.5' }]} />
          <SettingsToggle label="加入另一模型" description="将管家模型同时加入调研池；派发时从已加入的模型中选择。" checked={props.settingsDraft.includeSecondaryModel} onCheckedChange={includeSecondaryModel => props.setSettingsDraft(current => ({ ...current, includeSecondaryModel }))} />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="外观" description="保存后立即应用到当前原型。">
        <SettingsCard><SettingsSelectRow label="主题" value={props.settingsDraft.theme} onValueChange={theme => props.setSettingsDraft(current => ({ ...current, theme }))} options={[{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }, { value: 'system', label: '跟随系统' }]} /></SettingsCard>
      </SettingsSection>
      <SettingsCardFooter><Button variant="outline" disabled={!dirty} onClick={() => props.setSettingsDraft(props.savedSettings)}>撤销</Button><Button disabled={!dirty} onClick={save}>保存设置</Button></SettingsCardFooter>
    </div>
  </section>
}

function LoginView(props: PrototypeContext) {
  return <section className="r5-login"><div className="r5-login-panel"><Brand compact={false} /><div><h1>回到你的工作台</h1><p>输入本机工作台密码。</p></div><SettingsInput label="密码" type="password" value={props.loginPassword} onChange={props.setLoginPassword} placeholder="演示密码，至少 12 位" autoComplete="current-password" /><Button onClick={() => props.setLoginFeedback(props.loginPassword.length >= 12 ? '登录成功，可以返回工作台' : '请输入至少 12 位密码')}><LogIn />登录</Button>{props.loginFeedback && <p className="r5-login-feedback" role="status">{props.loginFeedback}</p>}<Button variant="ghost" onClick={() => props.navigate('conversation')}>返回工作台</Button></div></section>
}

function ReportView(props: PrototypeContext & { onClose: () => void }) {
  const report = reportBodies[props.reportVersion] ?? reportBodies[2]
  const selectedWork = props.works.find(work => work.key === props.selectedWorkKey) ?? props.works[0]
  const currentAnnotations = props.annotations.filter(item => item.workKey === props.selectedWorkKey && item.version === props.reportVersion)
  return <section className="r5-report" aria-labelledby="r5-report-title">
    <PreviewHeader
      onClose={props.onClose}
      leftActions={<Button variant="ghost" size="sm" onClick={() => props.navigate('works')}><ArrowLeft />工作</Button>}
      rightActions={<Button variant="ghost" size="sm" onClick={props.downloadReport}><ArrowDownToLine />下载</Button>}
    ><PreviewHeaderBadge icon={FileText} label={`${selectedWork.title} · v${props.reportVersion}`} /></PreviewHeader>
    <div className="r5-report-versionbar"><span>{props.versions.length} 个版本</span><div>{props.versions.map(version => <Button key={version} variant={props.reportVersion === version ? 'secondary' : 'ghost'} size="sm" onClick={() => props.setReportVersion(version)}>v{version}</Button>)}</div></div>
    <div className="r5-report-scroll">
      <article className="r5-report-document" ref={props.reportRef} onMouseUp={props.captureSelection}>
        <header><p>{report.date} · {selectedWork.title}</p><h1 id="r5-report-title">{reportTitleByWork[props.selectedWorkKey] ?? report.title}</h1><p className="r5-report-deck">{report.intro}</p></header>
        <hr />
        <h2>工作闭环决定长期价值</h2>
        <p>工具调用已经快速普及，单次任务的能力差距因此收窄。用户真正承担的成本发生在任务之前和之后：他们要把模糊目标说清楚，要判断执行是否偏航，还要把结果接回自己的工作。</p>
        <p>当产品只展示一段连续对话时，长任务会失去边界。问题、运行状态和最终成果混在消息流中，用户需要反复寻找“现在该做什么”。稳定的产品把对话当作入口，把工作状态单独保存，再让报告成为可以审阅和继续修改的版本。</p>
        <blockquote>用户愿意交付工作的前提，是随时知道系统理解了什么、正在做什么、何时需要自己介入。</blockquote>
        <Button variant="ghost" size="sm" onClick={() => props.setSelectedQuote('用户愿意交付工作的前提，是随时知道系统理解了什么、正在做什么、何时需要自己介入。')}><Quote />批注这段判断</Button>
        <h2>四个差异正在形成</h2>
        <h3>1. 目标能否被准确冻结</h3>
        <p>高质量产品会保留原始要求，同时生成简短、可编辑的显示标题。标题帮助浏览，原文继续承担执行约束。用户修改标题时，不会无意中改变工作目标。</p>
        <h3>2. 进度能否支持判断</h3>
        <p>有用的进度集中在结果、阻塞和需要介入的选择。完整工具参数仍然可查，但默认收起。这样既保留可追溯性，也避免把内部运行日志当作产品信息架构。</p>
        <h3>3. 失败能否从可信位置恢复</h3>
        <p>长任务失败后，重新开始会浪费时间，也容易产生无法解释的新结果。检查点、固定模型和清晰的重试入口共同构成恢复能力。旧报告应继续可读，新执行产生独立版本。</p>
        <h3>4. 成果能否进入下一轮工作</h3>
        <p>报告不是聊天回复的放大版。它需要稳定链接、版本历史、下载能力和对原文的批注。用户选中句子留下意见，再把多条批注汇总成一次明确改稿，能显著降低反复描述上下文的成本。</p>
        <h2>产品判断</h2>
        <p>未来的领先者会让委托、介入和审阅形成连续体验。聊天仍是自然入口，但工作事实和成果版本会成为产品的长期记忆。可靠性来自这些对象之间清晰、可恢复的关系。</p>
        <footer><p>资料范围：官方产品文档、公开发布说明、定价页与用户访谈。公开演示未计为稳定发布能力。</p></footer>
      </article>
    </div>
    {(props.selectedQuote || currentAnnotations.length > 0) && <aside className="r5-annotation-panel" aria-label="报告批注">
      <header><h2>{selectedWork.title} · v{props.reportVersion} 批注</h2><span>{currentAnnotations.length}</span></header>
      {currentAnnotations.map((item, index) => <div className="r5-annotation" key={`${item.quote}-${index}`}><Quote /><div><blockquote>{item.quote}</blockquote><p>{item.note}</p></div><Button variant="ghost" size="icon" aria-label={`删除批注 ${index + 1}`} onClick={() => props.setAnnotations(current => current.filter(annotation => annotation !== item))}><X /></Button></div>)}
      {props.selectedQuote && <div className="r5-annotation-draft"><blockquote>“{props.selectedQuote}”</blockquote><textarea aria-label="批注意见" value={props.annotationNote} onChange={event => props.setAnnotationNote(event.target.value)} placeholder="这段需要怎样修改？" /><div><Button variant="ghost" size="sm" onClick={() => props.setSelectedQuote('')}>取消</Button><Button size="sm" disabled={!props.annotationNote.trim()} onClick={props.addAnnotation}>添加批注</Button></div></div>}
      {!!currentAnnotations.length && <Button className="r5-revision-button" onClick={props.putRevisionInComposer}>汇总到输入框</Button>}
    </aside>}
  </section>
}

function PageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <header className="r5-page-header"><div><h1>{title}</h1><p>{description}</p></div>{action}</header>
}

function PrototypeInspector({ open, onToggle, state }: { open: boolean; onToggle: () => void; state: unknown }) {
  return <aside className={`r5-inspector ${open ? 'open' : ''}`}><Button variant="secondary" size="sm" aria-label="查看原型状态" onClick={onToggle}>{open ? <X /> : <PanelRightOpen />}{open ? '关闭状态' : '状态'}</Button>{open && <pre>{JSON.stringify(state, null, 2)}</pre>}</aside>
}

function PrototypeSwitcher({ variant, onVariant, onCycle, scenario, onScenario, theme, onTheme }: {
  variant: Variant
  onVariant: (variant: Variant) => void
  onCycle: (delta: number) => void
  scenario: Scenario
  onScenario: (scenario: Scenario) => void
  theme: ThemeChoice
  onTheme: (theme: ThemeChoice) => void
}) {
  const toggleTheme = () => onTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light')
  return <div className="r5-switcher" aria-label="PROTOTYPE 原型切换器" title="页面与业务状态均为内存模拟，不会写入后端">
    <span className="r5-prototype-label">PROTOTYPE</span>
    <Button variant="ghost" size="icon" aria-label="上一个方案" onClick={() => onCycle(-1)}><ChevronLeft /></Button>
    <div className="r5-variant-buttons" role="group" aria-label="页面方案">{variants.map(item => <button key={item} type="button" className={variant === item ? 'active' : ''} onClick={() => onVariant(item)} aria-pressed={variant === item}>{item}</button>)}</div>
    <strong>{variantNames[variant]}</strong>
    <Button variant="ghost" size="icon" aria-label="下一个方案" onClick={() => onCycle(1)}><ChevronRight /></Button>
    <span className="r5-switcher-separator" />
    <select aria-label="原型场景" value={scenario} onChange={event => onScenario(event.target.value as Scenario)}>{Object.entries(scenarioLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    <Button variant="ghost" size="icon" aria-label={`切换主题，当前${theme}`} onClick={toggleTheme}>{theme === 'dark' ? <Moon /> : theme === 'light' ? <Sun /> : <span className="r5-system-theme">A</span>}</Button>
  </div>
}

export default R5Prototype
