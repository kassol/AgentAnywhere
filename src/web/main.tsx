import { useEffect, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { ModelSettings } from './ModelSettings'
import { Work } from './Work'
import { Steward } from './Steward'
import './style.css'

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
  const [error, setError] = useState('')
  const [pendingInteractions, setPendingInteractions] = useState<{ id: string; question: string; goal: string; href: string }[]>([])

  useEffect(() => {
    let disposed = false
    async function refreshPending() {
      try {
        const response = await fetch('/api/interactions/pending')
        if (response.status === 401) return location.assign('/login')
        if (response.ok && !disposed) setPendingInteractions(await response.json())
      } catch { /* keep the last persisted view during a transient disconnect */ }
    }
    void refreshPending()
    const timer = setInterval(refreshPending, 1000)
    return () => { disposed = true; clearInterval(timer) }
  }, [])

  async function logout() {
    const response = await fetch('/api/logout', { method: 'POST' })
    if (response.ok) location.assign('/login')
    else setError('退出失败，请重试。')
  }

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="主导航">
        <div className="brand">AgentAnywhere<span>个人委托工作台</span></div>
        <nav>
          <a href="/" aria-current={!settings && !work ? 'page' : undefined}>管家</a>
          <a href="/tasks" aria-current={work ? 'page' : undefined}>工作</a>
          <a href={pendingInteractions[0]?.href ?? '/tasks'}>待办 {pendingInteractions.length}</a>
          <a href="/settings" aria-current={settings ? 'page' : undefined}>设置</a>
        </nav>
        {!!pendingInteractions.length && <section className="pending-interactions" aria-label="全局待办"><h2>待回答</h2><ul>{pendingInteractions.map(interaction => <li key={interaction.id}>
          <a href={interaction.href}>{interaction.goal}</a><small>{interaction.question}</small>
        </li>)}</ul></section>}
      </aside>
      <main className="content">
        <header className="page-header"><h1>{settings ? '设置' : work ? '工作' : '管家'}</h1></header>
        {error && <p className="error" role="alert">{error}</p>}
        {settings ? (
          <><ModelSettings /><section className="settings-card account-card">
            <h2>账户</h2>
            <p className="muted">当前已登录。</p>
            <button type="button" className="secondary" onClick={logout}>退出登录</button>
          </section></>
        ) : work ? <Work /> : <Steward />}
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(location.pathname === '/login' ? <Login /> : <Workbench />)
