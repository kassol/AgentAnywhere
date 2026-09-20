import { useEffect, useState, type FormEvent } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { Button } from './craft/components/Button'
import { Input } from './craft/components/Input'

export function TitleEditor<T extends { title: string }>({ title, endpoint, onSaved }: {
  title: string
  endpoint: string
  onSaved(value: T): void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (!editing) setValue(title) }, [title, editing])

  function cancel() {
    setValue(title)
    setError('')
    setEditing(false)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch(endpoint, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: value }) })
      if (response.status === 401) return location.assign('/login')
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '修改标题失败')
      onSaved(body as T)
      setEditing(false)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '修改标题失败') }
    finally { setBusy(false) }
  }

  if (editing) return <form className="grid gap-2" onSubmit={save}>
    <div className="flex items-center gap-2">
      <Input aria-label="标题" autoFocus value={value} onChange={event => setValue(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape') cancel() }} disabled={busy} />
      <Button type="submit" size="icon" aria-label="保存标题" title="保存标题" disabled={busy}><Check aria-hidden="true" /></Button>
      <Button type="button" size="icon" variant="ghost" aria-label="取消修改标题" title="取消修改标题" onClick={cancel} disabled={busy}><X aria-hidden="true" /></Button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </form>

  return <div className="flex min-w-0 items-center gap-2">
    <h2 className="min-w-0 break-words">{title}</h2>
    <Button type="button" size="icon" variant="ghost" aria-label="修改标题" title="修改标题" onClick={() => setEditing(true)}><Pencil aria-hidden="true" /></Button>
  </div>
}
