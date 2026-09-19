// PROTOTYPE: Three R3 workbench layouts, switchable with ?variant=A|B|C.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CraftSpinner, CraftSurface } from './prototype-craft/CraftPrimitives'
import './prototype-craft/craft-primitives.css'
import './r3-prototype.css'

type Variant = 'A' | 'B' | 'C'
type Page = 'steward' | 'work' | 'todo' | 'settings'
type Scenario = 'discussion' | 'research' | 'waiting' | 'failure'
type ThemeChoice = 'system' | 'light' | 'dark'
type MobilePanel = 'nav' | 'main' | 'report'

type Annotation = {
  id: string
  version: 'v1' | 'v2'
  quote: string
  comment: string
}

const VARIANTS: { key: Variant; name: string }[] = [
  { key: 'A', name: '经典侧栏' },
  { key: 'B', name: '导航轨 + 分段会话' },
  { key: 'C', name: '工作队列侧栏' },
]

const scenarioMeta: Record<Scenario, { label: string; title: string; subtitle: string }> = {
  discussion: { label: '普通讨论', title: '规划下一阶段', subtitle: '今天 10:24 · 管家' },
  research: { label: '调研执行', title: '评估 Agent UI 方案', subtitle: '运行中 · 2 项工作' },
  waiting: { label: '等待回答', title: '竞品定价调研', subtitle: '等待你的回答' },
  failure: { label: '失败恢复', title: '模型能力核查', subtitle: '执行失败 · 可恢复' },
}

const reports = {
  v1: `# Agent UI 方案评估

## 初步结论

Craft 的三栏结构适合需要持续对话和阅读成果的工作台。主要优势是上下文保持稳定，用户打开报告时不会离开当前对话。

## 观察

- 工具调用保持为消息流的一部分。
- 报告在右侧按需出现，并保留独立入口。
- 输入框承担大部分动作的最终确认。

## 风险

窄屏无法同时容纳三栏，需要退化为带返回路径的单面板。`,
  v2: `# Agent UI 方案评估

## 建议

采用**稳定对话 + 按需报告**的桌面结构。侧栏负责定位，中间区域保留对话，右侧承载当前报告或工作详情。

## 设计原则

1. 工具过程收进可展开的消息卡，默认只显示名称、阶段和结果。
2. 快捷操作先生成可检查的聊天内容，再由用户发送。
3. 报告批注绑定原始版本；改稿生成新版本并保留旧版。

## 小屏策略

小屏一次只显示一个面板。用户从对话打开报告后，可以明确返回原对话，草稿和阅读位置继续保留。

## 待确认

工作队列应强调执行状态，还是优先显示最近活动。`,
}

const CHAT_KEY_PREFIX = 'agentanywhere:r3-prototype:chat:'
const ANNOTATION_KEY = 'agentanywhere:r3-prototype:annotations'

function readAnnotations(): Annotation[] {
  try {
    const value = JSON.parse(localStorage.getItem(ANNOTATION_KEY) ?? '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function Icon({ name }: { name: 'chat' | 'work' | 'todo' | 'settings' | 'report' | 'search' | 'sun' | 'plus' | 'menu' | 'arrow' }) {
  const paths: Record<typeof name, ReactNode> = {
    chat: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4.5A2.5 2.5 0 0 1 4 12.5z" /></>,
    work: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M8 6V4h8v2M3 11h18" /></>,
    todo: <><path d="m4 7 2 2 4-4M12 7h8M4 15l2 2 4-4M12 15h8" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    report: <><path d="M6 3h9l3 3v15H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
    search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    arrow: <><path d="m9 18 6-6-6-6" /></>,
  }
  return <svg className="r3-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

function Logo() {
  return <div className="r3-logo" aria-label="AgentAnywhere"><span>A</span></div>
}

function NavItems({ page, setPage, compact = false }: { page: Page; setPage: (page: Page) => void; compact?: boolean }) {
  const items: { key: Page; label: string; icon: 'chat' | 'work' | 'todo' | 'settings'; badge?: string }[] = [
    { key: 'steward', label: '管家', icon: 'chat' },
    { key: 'work', label: '工作', icon: 'work' },
    { key: 'todo', label: '待办', icon: 'todo', badge: '1' },
    { key: 'settings', label: '设置', icon: 'settings' },
  ]
  return <nav className={compact ? 'r3-nav r3-nav-compact' : 'r3-nav'} aria-label="主导航">
    {items.map(item => <button key={item.key} type="button" className={page === item.key ? 'is-active' : ''} onClick={() => setPage(item.key)} title={compact ? item.label : undefined}>
      <Icon name={item.icon} /><span>{item.label}</span>{item.badge && <b>{item.badge}</b>}
    </button>)}
  </nav>
}

function ConversationList({ scenario, setScenario }: { scenario: Scenario; setScenario: (scenario: Scenario) => void }) {
  return <div className="r3-conversation-list">
    <div className="r3-list-heading"><span>对话</span><button type="button" aria-label="新建对话" onClick={() => setScenario('discussion')}><Icon name="plus" /></button></div>
    {(Object.keys(scenarioMeta) as Scenario[]).map(key => <button key={key} type="button" className={scenario === key ? 'is-active' : ''} onClick={() => setScenario(key)}>
      <span>{scenarioMeta[key].title}</span><small>{scenarioMeta[key].subtitle}</small>
    </button>)}
  </div>
}

function ClassicSidebar(props: { page: Page; setPage: (page: Page) => void; scenario: Scenario; setScenario: (scenario: Scenario) => void; active: boolean }) {
  return <aside className={`r3-classic-sidebar r3-mobile-panel ${props.active ? 'is-active' : ''}`}>
    <div className="r3-brand"><Logo /><span>AgentAnywhere</span></div>
    <NavItems page={props.page} setPage={props.setPage} />
    {props.page === 'steward' && <ConversationList scenario={props.scenario} setScenario={props.setScenario} />}
    <div className="r3-account"><span>K</span><div><strong>Kassol</strong><small>本机工作台</small></div></div>
  </aside>
}

function ScenarioTabs({ scenario, setScenario }: { scenario: Scenario; setScenario: (scenario: Scenario) => void }) {
  return <div className="r3-segmented" aria-label="演示场景">
    {(Object.keys(scenarioMeta) as Scenario[]).map(key => <button type="button" key={key} className={scenario === key ? 'is-active' : ''} onClick={() => setScenario(key)}>{scenarioMeta[key].label}</button>)}
  </div>
}

function ToolCard({ failed = false }: { failed?: boolean }) {
  return <CraftSurface kind="tool" className="r3-tool-surface"><details className={`r3-tool ${failed ? 'is-failed' : ''}`}>
    <summary><span className="r3-tool-symbol">{failed ? '!' : '✓'}</span><span><strong>{failed ? '读取模型能力失败' : '搜索公开资料'}</strong><small>{failed ? '连接在 30 秒后超时' : '完成 · 找到 8 个结果'}</small></span><span className="r3-disclosure">⌄</span></summary>
    <div className="r3-tool-detail"><dl><div><dt>输入</dt><dd>{failed ? 'GET /v1/models' : 'Craft Agents UI interaction patterns'}</dd></div><div><dt>结果</dt><dd>{failed ? 'Gateway timeout' : '已读取 5 个公开页面，3 个结果因重复被忽略。'}</dd></div></dl></div>
  </details></CraftSurface>
}

function Receipt({ tone = 'neutral', children, action }: { tone?: 'neutral' | 'warning' | 'danger'; children: ReactNode; action?: ReactNode }) {
  return <div className={`r3-receipt r3-receipt-${tone}`}><span className="r3-receipt-dot" /><div>{children}</div>{action}</div>
}

function MessageFlow({ scenario, stopped, sentMessages, onOpenReport, onRetry, onAnswer }: { scenario: Scenario; stopped: boolean; sentMessages: string[]; onOpenReport: () => void; onRetry: () => void; onAnswer: (answer: string) => void }) {
  return <div className="r3-message-flow">
    <div className="r3-message r3-message-user"><div className="r3-avatar">K</div><div><span className="r3-message-author">你</span><p>{scenario === 'discussion' ? 'R3 应该怎样组织管家、工作和报告？' : scenario === 'research' ? '调研 Craft 的交互，给我一份可以落地的建议。' : scenario === 'waiting' ? '对比几款同类产品的定价和能力。' : '核查当前网关的模型能力，然后整理结果。'}</p></div></div>
    {scenario === 'discussion' && <>
      <div className="r3-message r3-message-assistant"><div className="r3-avatar r3-avatar-agent">A</div><div><span className="r3-message-author">管家</span><p>建议保留稳定的中间对话，把工作详情和报告放到按需出现的右侧面板。这样打开成果时不会打断当前思路，返回后草稿也还在。</p><div className="r3-inline-actions"><button type="button" onClick={onOpenReport}><Icon name="report" />打开示例报告</button></div></div></div>
    </>}
    {scenario === 'research' && <>
      <div className="r3-message r3-message-assistant"><div className="r3-avatar r3-avatar-agent">A</div><div><span className="r3-message-author">管家</span><p>我已派发两项独立调研，先核对布局和批注链路，再汇总结果。</p><ToolCard /><Receipt><strong>布局调研已完成</strong><small>工作 #R3-18 · 生成报告 v2</small><button type="button" onClick={onOpenReport}>查看报告</button></Receipt>{stopped ? <Receipt tone="warning"><strong>当前轮次已停止</strong><small>已完成的工作和报告仍然保留。</small></Receipt> : <div className="r3-thinking"><CraftSpinner label="正在核对窄屏交互" /><span>正在核对窄屏交互</span></div>}</div></div>
    </>}
    {scenario === 'waiting' && <>
      <div className="r3-message r3-message-assistant"><div className="r3-avatar r3-avatar-agent">A</div><div><span className="r3-message-author">管家</span><p>调研范围会显著影响结果，我需要你确认目标市场。</p><Receipt tone="warning"><strong>等待回答</strong><small>竞品定价调研 · 问题 1/1</small><p>重点看国内自托管产品，还是海外 SaaS？</p><div className="r3-choice-row"><button type="button" onClick={() => onAnswer('国内自托管产品')}>国内自托管</button><button type="button" onClick={() => onAnswer('海外 SaaS')}>海外 SaaS</button></div></Receipt></div></div>
    </>}
    {scenario === 'failure' && <>
      <div className="r3-message r3-message-assistant"><div className="r3-avatar r3-avatar-agent">A</div><div><span className="r3-message-author">管家</span><p>网关在能力发现阶段超时。本轮保留了失败检查点，可以从这里恢复。</p><ToolCard failed /><Receipt tone="danger"><strong>模型能力核查失败</strong><small>检查点已保存 · 未生成报告</small><button type="button" onClick={onRetry}>使用同一模型重试</button></Receipt></div></div>
    </>}
    {sentMessages.map((message, index) => <div className="r3-message r3-message-user" key={`${index}-${message}`}><div className="r3-avatar">K</div><div><span className="r3-message-author">你 · 刚刚</span><p>{message}</p></div></div>)}
  </div>
}

function Composer({ draft, setDraft, onSend, running, onStop, sendError, failNext, setFailNext }: { draft: string; setDraft: (value: string) => void; onSend: () => void; running: boolean; onStop: () => void; sendError: string; failNext: boolean; setFailNext: (value: boolean) => void }) {
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      onSend()
    }
  }
  return <div className="r3-composer-wrap">
    {sendError && <div className="r3-send-error" role="alert">{sendError} 草稿已保留。</div>}
    <CraftSurface kind="input" className="r3-composer">
      <textarea aria-label="给管家发消息" rows={3} placeholder="给管家发消息…" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={handleKeyDown} />
      <div className="r3-composer-bar">
        <div><span>Enter 发送 · Shift+Enter 换行</span></div>
        <div className="r3-composer-submit">{running && <button type="button" className="r3-stop" onClick={onStop}><span />停止</button>}<button type="button" className="r3-send" onClick={onSend} disabled={!draft.trim()} aria-label={running ? '追加消息' : '发送'}><span>↑</span></button></div>
      </div>
    </CraftSurface>
    <label className="r3-fail-toggle"><input type="checkbox" checked={failNext} onChange={event => setFailNext(event.target.checked)} />模拟下次发送失败</label>
  </div>
}

function ChatView(props: {
  scenario: Scenario
  setScenario: (scenario: Scenario) => void
  draft: string
  setDraft: (value: string) => void
  onSend: () => void
  running: boolean
  stopped: boolean
  onStop: () => void
  onOpenReport: () => void
  sendError: string
  failNext: boolean
  setFailNext: (value: boolean) => void
  sentMessages: string[]
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const previousMessageCount = useRef(props.sentMessages.length)
  const [awayFromBottom, setAwayFromBottom] = useState(false)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = Number(sessionStorage.getItem(`r3-prototype-scroll-${props.scenario}`) || 0)
  }, [props.scenario])
  useEffect(() => {
    if (previousMessageCount.current === props.sentMessages.length) return
    previousMessageCount.current = props.sentMessages.length
    const el = scrollRef.current
    if (el && !awayFromBottom) el.scrollTop = el.scrollHeight
  }, [props.sentMessages.length])
  const quick = ['整理为执行清单', '引用当前报告继续', '拆成两项独立调研']
  return <section className="r3-chat-view">
    <header className="r3-chat-header"><div><span>管家</span><h1>{scenarioMeta[props.scenario].title}</h1></div><ScenarioTabs scenario={props.scenario} setScenario={props.setScenario} /></header>
    <div className="r3-chat-scroll" ref={scrollRef} onScroll={event => { const el = event.currentTarget; sessionStorage.setItem(`r3-prototype-scroll-${props.scenario}`, String(el.scrollTop)); setAwayFromBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 60) }}>
      <div className="r3-date-rule"><span>今天</span></div>
      <MessageFlow scenario={props.scenario} stopped={props.stopped} sentMessages={props.sentMessages} onOpenReport={props.onOpenReport} onRetry={() => props.setDraft('请从失败检查点使用同一模型重试，并保留原失败记录。')} onAnswer={answer => props.setDraft(`范围确认：重点调研${answer}。`)} />
    </div>
    {awayFromBottom && <button className="r3-latest" onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })}>回到最新消息 ↓</button>}
    <div className="r3-quick-actions">{quick.map(item => <button key={item} type="button" onClick={() => props.setDraft(item)}>{item}</button>)}</div>
    <Composer draft={props.draft} setDraft={props.setDraft} onSend={props.onSend} running={props.running} onStop={props.onStop} sendError={props.sendError} failNext={props.failNext} setFailNext={props.setFailNext} />
  </section>
}

function WorkView({ openReport }: { openReport: () => void }) {
  const [filter, setFilter] = useState('全部')
  const [selected, setSelected] = useState(0)
  const rows = [
      ['评估 Agent UI 方案', '运行中', '正在核对窄屏交互', '2 分钟前'],
      ['竞品定价调研', '等待回答', '需要确认目标市场', '18 分钟前'],
      ['Craft 批注链路核查', '已完成', '报告 v2', '今天 09:42'],
      ['模型能力核查', '失败', '网关连接超时', '昨天'],
    ]
  const visible = rows.filter(row => filter === '全部' || row[1] === filter || (filter === '等待' && row[1] === '等待回答'))
  return <section className="r3-page"><header><span>工作</span><h1>全部工作</h1></header><div className="r3-filter-row">{[['全部', '4'], ['运行中', '1'], ['等待', '1'], ['已完成', '1'], ['失败', '1']].map(([key, count]) => <button type="button" key={key} className={filter === key ? 'is-active' : ''} onClick={() => setFilter(key)}>{key} {count}</button>)}</div><div className="r3-work-table">
    {visible.map((row, index) => <button type="button" key={row[0]} className={rows.indexOf(row) === selected ? 'is-selected' : ''} onClick={() => { const absoluteIndex = rows.indexOf(row); setSelected(absoluteIndex); if (row[1] === '已完成') openReport() }}><span className="r3-work-icon"><Icon name="work" /></span><span><strong>{row[0]}</strong><small>{row[2]}</small></span><span className={`r3-status r3-status-${row[1]}`}>{row[1]}</span><time>{row[3]}</time><Icon name="arrow" /></button>)}
  </div><div className="r3-work-selection"><span>当前选择</span><strong>{rows[selected][0]}</strong><small>{rows[selected][1]} · {rows[selected][2]}</small>{rows[selected][1] === '已完成' && <button type="button" onClick={openReport}>查看报告</button>}</div></section>
}

function TodoView({ goChat }: { goChat: () => void }) {
  return <section className="r3-page"><header><span>待办</span><h1>需要你处理</h1></header><div className="r3-todo-item"><div className="r3-todo-mark">?</div><div><span>等待回答</span><h2>竞品定价调研</h2><p>重点看国内自托管产品，还是海外 SaaS？</p><small>18 分钟前 · 工作 #R3-21</small></div><button type="button" className="r3-primary" onClick={goChat}>去回答</button></div><div className="r3-empty-line">没有其他待办</div></section>
}

function SettingsView({ theme, setTheme }: { theme: ThemeChoice; setTheme: (theme: ThemeChoice) => void }) {
  return <section className="r3-page r3-settings"><header><span>设置</span><h1>模型与外观</h1></header><section><div className="r3-setting-copy"><h2>日常模型</h2><p>选择管家使用的模型，以及可派发调研的人工模型池。</p></div><div className="r3-setting-control"><label>管家模型<select defaultValue="gpt-6-astra"><option value="gpt-6-astra">gpt-6-astra</option></select></label><fieldset><legend>调研模型池</legend><label><input type="checkbox" defaultChecked />gpt-6-astra <small>Responses</small></label></fieldset></div></section><section><div className="r3-setting-copy"><h2>外观</h2><p>主题选择只保存在当前浏览器。</p></div><div className="r3-theme-choice">{(['system', 'light', 'dark'] as ThemeChoice[]).map(value => <button key={value} type="button" className={theme === value ? 'is-active' : ''} onClick={() => setTheme(value)}><span className={`r3-theme-swatch r3-theme-${value}`}><Icon name="sun" /></span>{value === 'system' ? '跟随系统' : value === 'light' ? '浅色' : '深色'}</button>)}</div></section><details className="r3-gateway"><summary><span><strong>网关与能力来源</strong><small>sub2api · 已连接 · 1 个模型</small></span><span>详情</span></summary><div><label>网关地址<input value="https://gateway.example.test/v1" readOnly /></label><label>凭证<input value="••••••••••••••••" readOnly /></label><p>演示数据。原型不会读取或写入真实配置。</p></div></details></section>
}

function ReportPanel(props: {
  active: boolean
  version: 'v1' | 'v2'
  setVersion: (version: 'v1' | 'v2') => void
  annotations: Annotation[]
  onAdd: (quote: string, comment: string) => void
  onDelete: (id: string) => void
  onAggregate: () => void
  onClose: () => void
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [quote, setQuote] = useState('')
  const [comment, setComment] = useState('')
  const current = props.annotations.filter(item => item.version === props.version)

  function captureSelection() {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.anchorNode || !contentRef.current?.contains(selection.anchorNode)) return
    const text = selection.toString().trim().slice(0, 240)
    if (text) setQuote(text)
  }

  function add() {
    if (!quote || !comment.trim()) return
    props.onAdd(quote, comment.trim())
    setQuote('')
    setComment('')
    window.getSelection()?.removeAllRanges()
  }

  function download() {
    const blob = new Blob([reports[props.version]], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `agent-ui-report-${props.version}.md`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return <aside className={`r3-report-panel r3-mobile-panel ${props.active ? 'is-active' : ''}`} aria-label="报告预览">
    <header><div><span>报告</span><h2>Agent UI 方案评估</h2></div><button type="button" className="r3-icon-button r3-report-close" onClick={props.onClose} aria-label="关闭报告">×</button></header>
    <div className="r3-report-toolbar"><div className="r3-version-select"><button type="button" className={props.version === 'v2' ? 'is-active' : ''} onClick={() => props.setVersion('v2')}>v2 <small>最新</small></button><button type="button" className={props.version === 'v1' ? 'is-active' : ''} onClick={() => props.setVersion('v1')}>v1</button></div><button type="button" onClick={download}>下载 .md</button></div>
    <div className="r3-report-scroll">
      <div ref={contentRef} onMouseUp={captureSelection} className="r3-report-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{reports[props.version]}</ReactMarkdown></div>
      <div className={`r3-annotation-compose ${quote ? 'is-visible' : ''}`}>
        <span>引用自 {props.version}</span><blockquote>{quote || '在报告中选中文字后添加批注'}</blockquote><textarea rows={2} aria-label="批注意见" value={comment} onChange={event => setComment(event.target.value)} placeholder="写下修改意见…" disabled={!quote} /><div><button type="button" onClick={() => { setQuote(''); setComment('') }}>取消</button><button type="button" className="r3-primary" onClick={add} disabled={!quote || !comment.trim()}>添加批注</button></div>
      </div>
      <section className="r3-annotations"><header><h3>未发送批注</h3><span>{current.length}</span></header>{current.length ? current.map(item => <article key={item.id}><span>{item.version}</span><blockquote>{item.quote}</blockquote><p>{item.comment}</p><button type="button" onClick={() => props.onDelete(item.id)}>删除</button></article>) : <p className="r3-annotation-empty">选中报告文字即可写意见。</p>}{current.length > 0 && <button type="button" className="r3-aggregate" onClick={props.onAggregate}>汇总 {current.length} 条到聊天框</button>}</section>
    </div>
  </aside>
}

function PrototypeSwitcher({ variant, setVariant }: { variant: Variant; setVariant: (variant: Variant) => void }) {
  const index = VARIANTS.findIndex(item => item.key === variant)
  const cycle = (delta: number) => setVariant(VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length].key)
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable]')) return
      if (event.key === 'ArrowLeft') cycle(-1)
      if (event.key === 'ArrowRight') cycle(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  if (!import.meta.env.DEV) return null
  return <div className="r3-prototype-switcher" aria-label="原型方案切换"><button type="button" onClick={() => cycle(-1)} aria-label="上一个方案">←</button><span><b>{variant}</b>{VARIANTS[index].name}<small>演示数据</small></span><button type="button" onClick={() => cycle(1)} aria-label="下一个方案">→</button></div>
}

function MobileHeader({ panel, setPanel, reportOpen }: { panel: MobilePanel; setPanel: (panel: MobilePanel) => void; reportOpen: boolean }) {
  return <header className="r3-mobile-header"><button type="button" onClick={() => panel === 'main' ? setPanel('nav') : setPanel('main')}><Icon name={panel === 'main' ? 'menu' : 'arrow'} />{panel === 'main' ? '菜单' : '返回'}</button><Logo /><button type="button" disabled={!reportOpen} onClick={() => setPanel('report')}><Icon name="report" />报告</button></header>
}

function DevState({ state }: { state: Record<string, unknown> }) {
  return <details className="r3-state-inspector"><summary>原型状态</summary><pre>{JSON.stringify(state, null, 2)}</pre></details>
}

export default function R3Prototype() {
  const initialVariant = new URLSearchParams(location.search).get('variant')
  const [variant, setVariantState] = useState<Variant>(initialVariant === 'B' || initialVariant === 'C' ? initialVariant : 'A')
  const [page, setPageState] = useState<Page>('steward')
  const [scenario, setScenarioState] = useState<Scenario>('research')
  const [reportOpen, setReportOpen] = useState(true)
  const [reportVersion, setReportVersion] = useState<'v1' | 'v2'>('v2')
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('main')
  const [draft, setDraftState] = useState(() => localStorage.getItem(`${CHAT_KEY_PREFIX}research`) ?? '')
  const [annotations, setAnnotations] = useState<Annotation[]>(readAnnotations)
  const [theme, setTheme] = useState<ThemeChoice>(() => (localStorage.getItem('r3-prototype-theme') as ThemeChoice) || 'system')
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const [stopped, setStopped] = useState(false)
  const [sendError, setSendError] = useState('')
  const [failNext, setFailNext] = useState(false)
  const [confirmOldVersion, setConfirmOldVersion] = useState(false)
  const [sentMessages, setSentMessages] = useState<Record<Scenario, string[]>>({ discussion: [], research: [], waiting: [], failure: [] })
  const [aggregatedIds, setAggregatedIds] = useState<string[]>(() => JSON.parse(localStorage.getItem('r3-prototype-aggregate-research') || '{}').ids || [])
  const [aggregatedVersion, setAggregatedVersion] = useState<'v1' | 'v2' | null>(() => JSON.parse(localStorage.getItem('r3-prototype-aggregate-research') || '{}').version || null)

  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
  const running = page === 'steward' && scenario === 'research' && !stopped

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    console.info('[R3 prototype state]', { variant, page, scenario, reportOpen, reportVersion, annotationCount: annotations.length, theme: resolvedTheme })
  }, [variant, page, scenario, reportOpen, reportVersion, annotations.length, resolvedTheme])

  useEffect(() => localStorage.setItem('r3-prototype-theme', theme), [theme])
  useEffect(() => localStorage.setItem(`r3-prototype-aggregate-${scenario}`, JSON.stringify({ ids: aggregatedIds, version: aggregatedVersion })), [scenario, aggregatedIds, aggregatedVersion])

  useEffect(() => localStorage.setItem(ANNOTATION_KEY, JSON.stringify(annotations)), [annotations])

  function setVariant(next: Variant) {
    setVariantState(next)
    const url = new URL(location.href)
    url.searchParams.set('prototype', 'r3')
    url.searchParams.set('variant', next)
    history.replaceState({}, '', url)
  }

  function setPage(next: Page) {
    setPageState(next)
    setMobilePanel('main')
    if (next !== 'steward') setReportOpen(false)
  }

  function setScenario(next: Scenario) {
    localStorage.setItem(`${CHAT_KEY_PREFIX}${scenario}`, draft)
    const saved = JSON.parse(localStorage.getItem(`r3-prototype-aggregate-${next}`) || '{}')
    setAggregatedIds(saved.ids || [])
    setAggregatedVersion(saved.version || null)
    setScenarioState(next)
    setDraftState(localStorage.getItem(`${CHAT_KEY_PREFIX}${next}`) ?? '')
    setStopped(false)
    setSendError('')
    if (next !== 'research') setReportOpen(false)
  }

  function setDraft(value: string) {
    setDraftState(value)
    localStorage.setItem(`${CHAT_KEY_PREFIX}${scenario}`, value)
    setSendError('')
  }

  function openReport() {
    setReportOpen(true)
    if (matchMedia('(max-width: 820px)').matches) setMobilePanel('report')
  }

  function completeSend() {
    setSentMessages(items => ({ ...items, [scenario]: [...items[scenario], draft.trim()] }))
    if (aggregatedIds.length) setAnnotations(items => items.filter(item => !(aggregatedIds.includes(item.id) && draft.includes(item.quote) && draft.includes(item.comment))))
    setAggregatedIds([])
    setAggregatedVersion(null)
    setDraft('')
    setSendError('')
  }

  function send() {
    if (!draft.trim()) return
    if (failNext) {
      setFailNext(false)
      setSendError('模拟网络错误，消息没有发送。')
      return
    }
    if (aggregatedVersion === 'v1' && annotations.some(item => aggregatedIds.includes(item.id) && draft.includes(item.quote) && draft.includes(item.comment))) {
      setConfirmOldVersion(true)
      return
    }
    completeSend()
  }

  function aggregateAnnotations() {
    const current = annotations.filter(item => item.version === reportVersion)
    if (!current.length) return
    fillAnnotationDraft(current)
  }

  function fillAnnotationDraft(items: Annotation[]) {
    const text = [`请根据报告 ${reportVersion} 的以下批注改稿，并保留旧版本：`, ...items.flatMap((item, index) => [`\n${index + 1}. 引用：${item.quote}`, `意见：${item.comment}`])].join('\n')
    setAggregatedIds(items.map(item => item.id))
    setAggregatedVersion(reportVersion)
    setDraft(text)
    setMobilePanel('main')
  }

  const mainContent = page === 'steward' ? <ChatView scenario={scenario} setScenario={setScenario} draft={draft} setDraft={setDraft} onSend={send} running={running} stopped={stopped} onStop={() => setStopped(true)} onOpenReport={openReport} sendError={sendError} failNext={failNext} setFailNext={setFailNext} sentMessages={sentMessages[scenario]} /> : page === 'work' ? <WorkView openReport={() => { setPageState('steward'); openReport() }} /> : page === 'todo' ? <TodoView goChat={() => { setPageState('steward'); setScenario('waiting') }} /> : <SettingsView theme={theme} setTheme={setTheme} />

  const report = reportOpen && <ReportPanel active={mobilePanel === 'report'} version={reportVersion} setVersion={setReportVersion} annotations={annotations} onAdd={(quote, comment) => setAnnotations(items => [...items, { id: crypto.randomUUID(), version: reportVersion, quote, comment }])} onDelete={id => setAnnotations(items => items.filter(item => item.id !== id))} onAggregate={aggregateAnnotations} onClose={() => { setReportOpen(false); setMobilePanel('main') }} />

  const state = useMemo(() => ({ variant, page, scenario, reportOpen, reportVersion, mobilePanel, running, stopped, failNext, chatDraftLength: draft.length, annotations: annotations.map(({ id: _id, ...item }) => item), persistence: { chat: `${CHAT_KEY_PREFIX}${scenario}`, annotations: ANNOTATION_KEY } }), [variant, page, scenario, reportOpen, reportVersion, mobilePanel, running, stopped, failNext, draft.length, annotations])

  return <div className="r3-prototype craft-prototype" data-theme={resolvedTheme} data-variant={variant}>
    <MobileHeader panel={mobilePanel} setPanel={setMobilePanel} reportOpen={reportOpen} />
    {variant === 'A' && <div className={`r3-shell r3-shell-a ${reportOpen ? 'has-report' : ''}`}>
      <ClassicSidebar page={page} setPage={setPage} scenario={scenario} setScenario={setScenario} active={mobilePanel === 'nav'} />
      <main className={`r3-main-panel r3-mobile-panel ${mobilePanel === 'main' ? 'is-active' : ''}`}>{mainContent}</main>{report}
    </div>}
    {variant === 'B' && <div className={`r3-shell r3-shell-b ${reportOpen ? 'has-report' : ''}`}>
      <aside className={`r3-rail r3-mobile-panel ${mobilePanel === 'nav' ? 'is-active' : ''}`}><Logo /><NavItems compact page={page} setPage={setPage} /><div className="r3-rail-account">K</div></aside>
      <section className="r3-b-workspace"><header className="r3-b-topbar"><div><strong>AgentAnywhere</strong><span>个人委托工作台</span></div>{page === 'steward' && <div className="r3-b-conversations">{(Object.keys(scenarioMeta) as Scenario[]).map(key => <button key={key} type="button" className={scenario === key ? 'is-active' : ''} onClick={() => setScenario(key)}><span>{scenarioMeta[key].title}</span><small>{scenarioMeta[key].label}</small></button>)}</div>}</header><div className="r3-b-content"><main className={`r3-main-panel r3-mobile-panel ${mobilePanel === 'main' ? 'is-active' : ''}`}>{mainContent}</main>{report}</div></section>
    </div>}
    {variant === 'C' && <div className="r3-shell r3-shell-c">
      <header className={`r3-c-topnav r3-mobile-panel ${mobilePanel === 'nav' ? 'is-active' : ''}`}><div className="r3-brand"><Logo /><span>AgentAnywhere</span></div><NavItems page={page} setPage={setPage} /><div className="r3-rail-account">K</div></header>
      <div className={`r3-c-body ${reportOpen ? 'has-report' : ''}`}>
        {page === 'steward' && <aside className="r3-queue"><div className="r3-list-heading"><span>工作队列</span></div><div className="r3-queue-summary"><span><b>2</b>进行中</span><span><b>1</b>等待</span></div>{(Object.keys(scenarioMeta) as Scenario[]).map((key, index) => <button type="button" key={key} className={scenario === key ? 'is-active' : ''} onClick={() => setScenario(key)}><i className={`r3-queue-dot r3-queue-dot-${key}`} /><span><strong>{scenarioMeta[key].title}</strong><small>{scenarioMeta[key].subtitle}</small></span><time>{index ? `${index + 3}m` : '现在'}</time></button>)}</aside>}
        <main className={`r3-main-panel r3-mobile-panel ${mobilePanel === 'main' ? 'is-active' : ''}`}>{mainContent}</main>{report}
      </div>
    </div>}
    {confirmOldVersion && <div className="r3-dialog-backdrop" role="presentation"><div className="r3-dialog" role="dialog" aria-modal="true" aria-labelledby="old-version-title"><span className="r3-dialog-icon">!</span><h2 id="old-version-title">报告已有新版本</h2><p>这些批注绑定 v1。继续后，管家会按原版本改稿，并保留当前 v2。</p><div><button type="button" onClick={() => setConfirmOldVersion(false)}>取消</button><button type="button" className="r3-primary" onClick={() => { setConfirmOldVersion(false); completeSend() }}>继续使用 v1</button></div></div></div>}
    <DevState state={state} />
    <PrototypeSwitcher variant={variant} setVariant={setVariant} />
  </div>
}
