import './craft-theme.css'
import './style.css'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ModelSettings } from './ModelSettings'
import { Work } from './Work'
import { Steward } from './Steward'
import { PreviewWorkspace } from './WorkPreview'
import { QuickActions, type QuickAction } from './QuickActions'
import { applyTheme, readTheme, saveTheme, type ThemeChoice } from './theme'

type IconName = 'steward' | 'work' | 'todo' | 'settings' | 'sun'
const threadStatusLabel: Record<string, string> = { queued: '排队中', running: '回复中', stopping: '停止中', stopped: '已停止', completed: '已完成', interrupted: '已中断', limited: '已达上限', failed: '失败' }

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    steward: <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4.5A2.5 2.5 0 0 1 4 12.5z" />,
    work: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M8 6V4h8v2M3 11h18" /></>,
    todo: <path d="m4 7 2 2 4-4M12 7h8M4 15l2 2 4-4M12 15h8" />,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  }
  return <svg className="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

function ThemeSettings() {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  function choose(next: ThemeChoice) {
    setTheme(next)
    saveTheme(next)
  }

  return <section className="settings-card theme-settings" aria-labelledby="theme-title">
    <div>
      <h2 id="theme-title">外观</h2>
      <p className="muted">主题选择保存在当前浏览器。</p>
    </div>
    <div className="theme-options" role="group" aria-label="主题">
      {(['system', 'light', 'dark'] as const).map(value => <button key={value} type="button" className={theme === value ? 'theme-option selected' : 'theme-option'} aria-pressed={theme === value} onClick={() => choose(value)}>
        <span className={`theme-swatch theme-swatch-${value}`}><Icon name="sun" /></span>
        {value === 'system' ? '跟随系统' : value === 'light' ? '浅色' : '深色'}
      </button>)}
    </div>
  </section>
}

function Login() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const password = new FormData(event.currentTarget).get('password')
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
          <label htmlFor="password">密码</label>
          <input id="password" name="password" type="password" autoComplete="current-password" autoFocus required />
          <button type="submit" disabled={busy}>{busy ? '正在登录…' : '登录'}</button>
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

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="主导航">
        <a className="brand" href="/" aria-label="AgentAnywhere 管家首页"><span className="brand-mark">A</span><span>AgentAnywhere<small>个人委托工作台</small></span></a>
        <nav>
          <a href="/" aria-current={!settings && !work ? 'page' : undefined}><Icon name="steward" /><span>管家</span></a>
          <a href="/tasks" aria-current={work ? 'page' : undefined}><Icon name="work" /><span>工作</span></a>
          <a href={pendingInteractions[0]?.href ?? '/tasks'}><Icon name="todo" /><span>待办</span>{pendingInteractions.length > 0 && <b>{pendingInteractions.length}</b>}</a>
          <a href="/settings" aria-current={settings ? 'page' : undefined}><Icon name="settings" /><span>设置</span></a>
        </nav>
        {steward && <section className="sidebar-conversations" aria-label="管家对话">
          <div><h2>对话</h2><a href="/" aria-label="新建管家对话">＋</a></div>
          {threads.map(thread => <a key={thread.id} href={`/steward/${thread.id}`} aria-current={location.pathname === `/steward/${thread.id}` ? 'page' : undefined}>
            <span>{thread.title}</span><small>{thread.status ? threadStatusLabel[thread.status] ?? thread.status : '尚未开始'}</small>
          </a>)}
        </section>}
        {!!pendingInteractions.length && <section className="pending-interactions" aria-label="全局待办"><h2>待回答</h2><ul>{pendingInteractions.map(interaction => <li key={interaction.id}>
          <a href={interaction.href}>{interaction.goal}</a><small>{interaction.question}</small>
          {steward && <QuickActions actions={pendingActions(interaction)} onFill={command => setFillRequest({ id: ++fillRequestId.current, command })} />}
        </li>)}</ul></section>}
        <div className="account-summary"><span>本机</span><div><strong>工作台所有者</strong><small>已登录</small></div></div>
      </aside>
      <main className={steward ? 'content content-steward' : 'content'}>
        <header className="page-header"><span>{settings ? '偏好与连接' : work ? '任务与成果' : '个人管家'}</span><h1>{settings ? '设置' : work ? '工作' : '管家'}</h1></header>
        {error && <p className="error" role="alert">{error}</p>}
        {settings ? (
          <><ThemeSettings /><ModelSettings /><section className="settings-card account-card">
            <h2>账户</h2>
            <p className="muted">当前已登录。</p>
            <button type="button" className="secondary" onClick={logout}>退出登录</button>
          </section></>
        ) : work ? <Work /> : <PreviewWorkspace><Steward fillRequest={fillRequest} onFillRequestHandled={() => setFillRequest(undefined)} /></PreviewWorkspace>}
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(location.pathname === '/login' ? <Login /> : <Workbench />)
