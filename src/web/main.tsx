import './craft-theme.css'
import './craft/styles.css'
import './style.css'
import { useEffect, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { BriefcaseBusiness, ListChecks, Menu, MessageSquare, Monitor, Moon, Settings, Sun, X } from 'lucide-react'
import { ModelSettings } from './ModelSettings'
import { Work } from './Work'
import { Steward } from './Steward'
import { TitleEditor } from './TitleEditor'
import { PreviewWorkspace } from './WorkPreview'
import { applyTheme, readTheme, saveTheme, type ThemeChoice } from './theme'
import { Button } from './craft/components/Button'
import { Panel } from './craft/components/Panel'
import { SettingsCard } from './craft/components/SettingsCard'
import { SettingsInput } from './craft/components/SettingsInput'
import { SettingsRow } from './craft/components/SettingsRow'
import { SettingsSection } from './craft/components/SettingsSection'
import { SidebarButton, type SidebarLinkItem } from './craft/components/SidebarButton'
import { ConversationNavigation, type ConversationThread } from './ConversationNavigation'

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
  const [navigationError, setNavigationError] = useState('')
  const [pendingInteractions, setPendingInteractions] = useState<{ id: string; kind: 'question' | 'limit'; question: string; taskId: string; runId: string; goal: string; href: string }[]>([])
  const [threads, setThreads] = useState<ConversationThread[] | null>(steward ? null : [])
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
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
        if (threadsResponse && !threadsResponse.ok) throw new Error('对话列表加载失败，请稍后重试。')
        if (threadsResponse?.ok && !disposed) { setThreads(await threadsResponse.json()); setNavigationError('') }
      } catch (caught) {
        if (!disposed && steward) setNavigationError(caught instanceof Error ? caught.message : '对话列表加载失败，请稍后重试。')
      }
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
  const activeThreadId = /^\/steward\/([0-9a-f-]{36})$/i.exec(location.pathname)?.[1] ?? null
  const activeThread = threads?.find(thread => thread.id === activeThreadId)

  return (
    <div className={steward ? 'shell shell-steward' : 'shell'}>
      <Panel as="aside" variant="shrink" className="sidebar" aria-label="主导航">
        <a className="brand" href="/" aria-label="AgentAnywhere 管家首页"><span className="brand-mark">A</span><span>AgentAnywhere<small>个人委托工作台</small></span></a>
        <nav className="sidebar-primary" aria-label="页面">
          {primaryLinks.map(link => <SidebarButton key={link.id} link={link} className="sidebar-primary-link" />)}
        </nav>
        <a className="account-summary" href="/settings"><span>K</span><div><strong>工作台所有者</strong><small>本机 · 已登录</small></div></a>
      </Panel>
      {steward && <ConversationNavigation threads={threads} activeId={activeThreadId} error={navigationError} />}
      <Panel as="main" variant="grow" className={settings ? 'content content-settings' : steward ? 'content content-steward' : 'content'}>
        <header className="mobile-header"><a className="brand-mark" href="/" aria-label="AgentAnywhere 管家首页">A</a>
          <strong>{settings ? '设置' : work ? '工作' : '管家对话'}</strong>
          <Button type="button" variant="ghost" size="icon" aria-label={mobileMenuOpen ? '关闭导航' : '打开导航'} aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(open => !open)}>{mobileMenuOpen ? <X /> : <Menu />}</Button>
          {mobileMenuOpen && <div className="mobile-menu" role="dialog" aria-label="移动导航">
            <nav aria-label="页面">{primaryLinks.map(link => <SidebarButton key={link.id} link={link} onClick={() => setMobileMenuOpen(false)} />)}</nav>
            {steward && <ConversationNavigation threads={threads} activeId={activeThreadId} error={navigationError} />}
          </div>}
        </header>
        <header className="page-header"><div>{!steward && <span>{settings ? '偏好与连接' : '任务与成果'}</span>}
          {steward && activeThread ? <TitleEditor title={activeThread.title} endpoint={`/api/steward/threads/${activeThread.id}`} onSaved={value => setThreads(current => current?.map(thread => thread.id === activeThread.id ? { ...thread, title: value.title } : thread) ?? null)} /> : <h1>{settings ? '设置' : work ? '工作' : '新对话'}</h1>}</div>
          {steward && <a href="/tasks">查看工作</a>}
        </header>
        {error && <p className="error" role="alert">{error}</p>}
        {settings ? (
          <><ThemeSettings /><ModelSettings /><SettingsSection className="settings-card account-card" title="账户" description="当前已登录。">
            <SettingsCard><SettingsRow label="工作台所有者" description="本机登录会话" action={<Button variant="outline" onClick={logout}>退出登录</Button>} /></SettingsCard>
          </SettingsSection></>
        ) : work ? <Work /> : <PreviewWorkspace><Steward /></PreviewWorkspace>}
      </Panel>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(location.pathname === '/login' ? <Login /> : <Workbench />)
