import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Plus, Search, X } from 'lucide-react'
import { Button } from './craft/components/Button'

export type ConversationThread = { id: string; title: string; status?: string }

const statusLabel: Record<string, string> = {
  queued: '排队中', running: '回复中', stopping: '停止中', stopped: '已停止', completed: '已完成',
  interrupted: '已中断', limited: '已达上限', failed: '失败',
}

function filterConversationThreads(threads: ConversationThread[], query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  return normalized ? threads.filter(thread => thread.title.toLocaleLowerCase().includes(normalized)) : threads
}

export function ConversationNavigation({ threads, activeId, error }: {
  threads: ConversationThread[] | null
  activeId: string | null
  error?: string
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const visible = filterConversationThreads(threads ?? [], query)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return <section className="conversation-navigation" aria-label="管家对话">
    <header><h2>对话</h2><Button asChild variant="ghost" size="icon"><a href="/" aria-label="新建管家对话"><Plus aria-hidden="true" /></a></Button></header>
    <label className="conversation-search">
      <Search aria-hidden="true" />
      <input ref={inputRef} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索 (⌘K)" aria-label="搜索对话" />
      {query && <Button type="button" variant="ghost" size="icon" aria-label="清空搜索" onClick={() => setQuery('')}><X aria-hidden="true" /></Button>}
    </label>
    <div className="conversation-thread-list">
      {threads === null && !error && <p role="status">正在加载对话…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {threads !== null && !error && visible.map(thread => <a key={thread.id} href={`/steward/${thread.id}`}
        className={thread.id === activeId ? 'conversation-thread active' : 'conversation-thread'} aria-current={thread.id === activeId ? 'page' : undefined}>
        <strong>{thread.title}</strong>
        <span className="conversation-thread-status">
          {thread.status === 'running' && <span className="status-dot status-dot-running" aria-hidden="true" />}
          {thread.status === 'failed' && <span className="status-dot status-dot-failed" aria-hidden="true" />}
          {thread.status ? statusLabel[thread.status] ?? thread.status : '尚未开始'}
        </span>
      </a>)}
      {threads !== null && !error && !visible.length && <div className="conversation-thread-empty"><MessageSquare aria-hidden="true" />
        <p>{query ? '没有匹配的对话' : '暂无对话'}</p>{query && <button type="button" onClick={() => setQuery('')}>清空搜索</button>}</div>}
    </div>
  </section>
}
