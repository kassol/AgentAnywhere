import { useEffect, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { EmptyStateCard } from './EmptyStateCard'
import './style.css'

type Task = { id: string; title: string; status: string }

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
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (settings) return
    fetch('/api/tasks').then(async response => {
      if (response.status === 401) {
        location.assign('/login')
        return
      }
      if (!response.ok) throw new Error('load failed')
      setTasks(await response.json() as Task[])
    }).catch(() => setError('工作列表加载失败，请刷新页面。'))
  }, [settings])

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
          <a href="/" aria-current={!settings ? 'page' : undefined}>工作</a>
          <a href="/settings" aria-current={settings ? 'page' : undefined}>设置</a>
        </nav>
      </aside>
      <main className="content">
        <header className="page-header"><h1>{settings ? '设置' : '工作'}</h1></header>
        {error && <p className="error" role="alert">{error}</p>}
        {settings ? (
          <section className="settings-card">
            <h2>账户</h2>
            <p className="muted">当前已登录。</p>
            <button type="button" className="secondary" onClick={logout}>退出登录</button>
          </section>
        ) : tasks === null ? (
          !error && <p className="muted" role="status">正在加载工作…</p>
        ) : tasks.length === 0 ? (
          <EmptyStateCard title="还没有工作" description="工作会显示在这里。" />
        ) : (
          <ul className="task-list">{tasks.map(task => <li key={task.id}>{task.title}<span>{task.status}</span></li>)}</ul>
        )}
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(location.pathname === '/login' ? <Login /> : <Workbench />)
