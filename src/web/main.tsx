import './craft-theme.css'
import './craft/styles.css'
import './style.css'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { BriefcaseBusiness, ListChecks, MessageSquare, Monitor, Moon, Plus, Settings, Sun } from 'lucide-react'
import { ModelSettings } from './ModelSettings'
import { Work } from './Work'
import { Steward } from './Steward'
import { PreviewWorkspace } from './WorkPreview'
import { QuickActions, type QuickAction } from './QuickActions'
import { applyTheme, readTheme, saveTheme, type ThemeChoice } from './theme'
import { Button } from './craft/components/Button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './craft/components/Empty'
import { Panel } from './craft/components/Panel'
import { SettingsCard } from './craft/components/SettingsCard'
import { SettingsInput } from './craft/components/SettingsInput'
import { SettingsRow } from './craft/components/SettingsRow'
import { SettingsSection } from './craft/components/SettingsSection'
import { SidebarButton, type SidebarLinkItem } from './craft/components/SidebarButton'
import { EntityRow } from './craft/components/EntityRow'
import { InteractionStatusBadge } from './WorkStatus'

const threadStatusLabel: Record<string, string> = { queued: '排队中', running: '回复中', stopping: '停止中', stopped: '已停止', completed: '已完成', interrupted: '已中断', limited: '已达上限', failed: '失败' }

const themeOptions = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
] as const

function ThemeSettings() {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  function choose(next: ThemeChoice) {
    setTheme(next)
    saveTheme(next)
  }

  return <SettingsSection className="settings-card theme-settings" title="外观" description="主题选择保存在当前浏览器。">
    <SettingsCard divided={false} className="theme-options shadow-none bg-transparent" role="group" aria-label="主题">
      {themeOptions.map(option => <Button key={option.value} type="button" variant="outline"
        className={theme === option.value ? 'theme-option selected' : 'theme-option'}
        aria-pressed={theme === option.value} onClick={() => choose(option.value)}>
        <span className={`theme-swatch theme-swatch-${option.value}`}><option.icon aria-hidden="true" /></span>
        <span>{option.label}</span>
      </Button>)}
    </SettingsCard>
  </SettingsSection>
}

function Login() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (response.ok) {
        location.assign('/')
        return
      }
      setError(response.status === 429 ? '尝试次数过多，请稍后再试。' : response.status === 401 ? '密码错误，请重试。' : '登录服务暂时不可用。')
    } catch {
      setError('连接失败，请检查服务状态。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <span className="eyebrow">个人委托工作台</span>
        <h1 id="login-title">AgentAnywhere</h1>
        <p className="muted">登录后查看工作与成果。</p>
        <form onSubmit={submit}>
          <SettingsInput label="密码" name="password" type="password" value={password} onChange={setPassword} autoComplete="current-password" autoFocus required />
          <Button type="submit" disabled={busy}>{busy ? '正在登录…' : '登录'}</Button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </main>
  )
}

function Workbench() {
  const settings = location.pathname === '/settings'
  const work = location.pathname === '/tasks' || location.pathname.startsWith('/tasks/')
  const steward = !settings && !work
  const [error, setError] = useState('')
  const [pendingInteractions, setPendingInteractions] = useState<{ id: string; kind: 'question' | 'limit'; question: string; taskId: string; runId: string; goal: string; href: string }[]>([])
  const [threads, setThreads] = useState<{ id: string; title: string; status?: string }[]>([])
  const [fillRequest, setFillRequest] = useState<{ id: number; command: string }>()
  const fillRequestId = useRef(0)

  const pendingActions = (interaction: typeof pendingInteractions[number]): QuickAction[] => interaction.kind === 'limit'
    ? [
        { kind: 'limit', taskId: interaction.taskId, interactionId: interaction.id, decision: 'continue' },
        { kind: 'limit', taskId: interaction.taskId, interactionId: interaction.id, decision: 'finish' },
      ]
    : [{ kind: 'answer', taskId: interaction.taskId, interactionId: interaction.id }]

  useEffect(() => {
    let disposed = false
    async function refreshNavigation() {
      try {
        const [pendingResponse, threadsResponse] = await Promise.all([
          fetch('/api/interactions/pending'),
          steward ? fetch('/api/steward/threads') : Promise.resolve(null),
        ])
        if (pendingResponse.status === 401 || threadsResponse?.status === 401) return location.assign('/login')
        if (pendingResponse.ok && !disposed) setPendingInteractions(await pendingResponse.json())
        if (threadsResponse?.ok && !disposed) setThreads(await threadsResponse.json())
      } catch { /* keep the last persisted view during a transient disconnect */ }
    }
    void refreshNavigation()
    const timer = setInterval(refreshNavigation, 1000)
    return () => { disposed = true; clearInterval(timer) }
  }, [steward])

  async function logout() {
    const response = await fetch('/api/logout', { method: 'POST' })
    if (response.ok) location.assign('/login')
    else setError('退出失败，请重试。')
  }

  const primaryLinks: SidebarLinkItem[] = [
    { id: 'steward', title: '管家', href: '/', icon: MessageSquare, variant: steward ? 'default' : 'ghost' },
    { id: 'work', title: '工作', href: '/tasks', icon: BriefcaseBusiness, variant: work ? 'default' : 'ghost' },
    { id: 'todo', title: '待办', href: pendingInteractions[0]?.href ?? '/tasks', icon: ListChecks,
      label: pendingInteractions.length ? String(pendingInteractions.length) : undefined, variant: 'ghost' },
    { id: 'settings', title: '设置', href: '/settings', icon: Settings, variant: settings ? 'default' : 'ghost' },
  ]

  return (
    <div className="shell">
      <Panel as="aside" variant="shrink" className="sidebar" aria-label="主导航">
        <a className="brand" href="/" aria-label="AgentAnywhere 管家首页"><span className="brand-mark">A</span><span>AgentAnywhere<small>个人委托工作台</small></span></a>
        <nav className="sidebar-primary" aria-label="页面">
          {primaryLinks.map(link => <SidebarButton key={link.id} link={link} className="sidebar-primary-link" />)}
        </nav>
        {steward && <section className="sidebar-conversations" aria-label="管家对话">
          <div className="sidebar-conversations-header"><h2>对话</h2><Button asChild variant="ghost" size="icon" className="sidebar-new-thread">
            <a href="/" aria-label="新建管家对话"><Plus aria-hidden="true" /></a>
          </Button></div>
          {threads.length ? threads.map(thread => <SidebarButton key={thread.id} className="sidebar-thread-link" link={{
            id: thread.id,
            title: thread.title,
            href: `/steward/${thread.id}`,
            label: thread.status ? threadStatusLabel[thread.status] ?? thread.status : '尚未开始',
            icon: MessageSquare,
            compact: true,
            variant: location.pathname === `/steward/${thread.id}` ? 'default' : 'ghost',
          }} />) : <Empty className="sidebar-empty">
            <EmptyMedia variant="icon" className="sidebar-empty-media"><MessageSquare /></EmptyMedia>
            <EmptyHeader className="sidebar-empty-header"><EmptyTitle>暂无对话</EmptyTitle><EmptyDescription>从管家页开始新的讨论。</EmptyDescription></EmptyHeader>
          </Empty>}
        </section>}
        {!!pendingInteractions.length && <section className="pending-interactions" aria-label="全局待办"><h2>待回答</h2><ul>{pendingInteractions.map(interaction => <li key={interaction.id}>
          <EntityRow href={interaction.href} className="sidebar-pending-row" surfaceClassName="px-1.5 py-2"
            icon={<ListChecks />} title={interaction.goal} subtitle={interaction.question}
            badges={<InteractionStatusBadge status="pending" />}
            trailing={<span className="font-mono text-[9px] text-muted-foreground" title={interaction.id}>{interaction.id.slice(0, 8)}</span>}>
            {steward && <QuickActions actions={pendingActions(interaction)} onFill={command => setFillRequest({ id: ++fillRequestId.current, command })} />}
          </EntityRow>
        </li>)}</ul></section>}
        <div className="account-summary"><span>本机</span><div><strong>工作台所有者</strong><small>已登录</small></div></div>
      </Panel>
      <Panel as="main" variant="grow" className={settings ? 'content content-settings' : steward ? 'content content-steward' : 'content'}>
        <header className="page-header"><span>{settings ? '偏好与连接' : work ? '任务与成果' : '个人管家'}</span><h1>{settings ? '设置' : work ? '工作' : '管家'}</h1></header>
        {error && <p className="error" role="alert">{error}</p>}
        {settings ? (
          <><ThemeSettings /><ModelSettings /><SettingsSection className="settings-card account-card" title="账户" description="当前已登录。">
            <SettingsCard><SettingsRow label="工作台所有者" description="本机登录会话" action={<Button variant="outline" onClick={logout}>退出登录</Button>} /></SettingsCard>
          </SettingsSection></>
        ) : work ? <Work /> : <PreviewWorkspace><Steward fillRequest={fillRequest} onFillRequestHandled={() => setFillRequest(undefined)} /></PreviewWorkspace>}
      </Panel>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(location.pathname === '/login' ? <Login /> : <Workbench />)
