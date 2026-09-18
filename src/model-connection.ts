import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type Protocol = 'chat-completions' | 'responses'
export type ModelSelection = {
  id: string
  protocol: Protocol
  contextWindow?: number
  maxTokens?: number
  input?: ('text' | 'image')[]
  reasoning?: boolean
  tools?: boolean
  inputPrice?: number
  outputPrice?: number
}
type CatalogModel = { id: string; name: string; ownedBy?: string; type?: string; created?: number }
type Discovery = { status: 'never' | 'ok' | 'stale' | 'unauthorized' | 'timeout' | 'empty' | 'error'; updatedAt?: string }
type Stored = { endpoint: string; apiKey: string; catalog: CatalogModel[]; catalogSourceEndpoint: string | null; models: ModelSelection[]; defaultModel: string | null; discovery: Discovery }

const initial: Stored = { endpoint: '', apiKey: '', catalog: [], catalogSourceEndpoint: null, models: [], defaultModel: null, discovery: { status: 'never' } }

export function createModelConnectionStore(dataDir: string, timeoutMs = 10_000) {
  const path = join(dataDir, 'model-connection.json')
  let state: Stored
  let pending = Promise.resolve()

  async function load() {
    try { state = JSON.parse(await readFile(path, 'utf8')) as Stored }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      state = structuredClone(initial)
    }
  }

  function visible() {
    const { apiKey, ...rest } = state
    return { ...rest, hasCredential: apiKey.length > 0 }
  }

  function update(change: (current: Stored) => Stored) {
    const write = pending.then(async () => {
      const next = change(state)
      await mkdir(dataDir, { recursive: true, mode: 0o700 })
      const temporary = `${path}.${crypto.randomUUID()}.tmp`
      try {
        await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' })
        await rename(temporary, path)
      } catch (error) {
        await Bun.file(temporary).delete().catch(() => {})
        throw error
      }
      state = next
    })
    pending = write.catch(() => {})
    return write
  }

  function connection(body: unknown) {
    if (!body || typeof body !== 'object') throw new Error('无效的连接配置')
    const value = body as Record<string, unknown>
    if (typeof value.endpoint !== 'string' || typeof value.apiKey !== 'string') throw new Error('请填写端点和凭证')
    let url: URL
    try { url = new URL(value.endpoint.trim()) } catch { throw new Error('端点 URL 无效') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/v1')) throw new Error('端点须为以 /v1 结尾的 HTTP 地址')
    const apiKey = value.apiKey.trim()
    const endpoint = url.toString().replace(/\/$/, '')
    return update(current => {
      if (!apiKey && (!current.apiKey || (current.endpoint && new URL(current.endpoint).origin !== url.origin))) throw new Error('更换端点主机时请重新填写凭证')
      const nextKey = apiKey || current.apiKey
      const changed = endpoint !== current.endpoint || nextKey !== current.apiKey
      return {
        ...current, endpoint, apiKey: nextKey,
        catalogSourceEndpoint: current.catalogSourceEndpoint ?? (current.catalog.length ? current.endpoint : null),
        discovery: changed ? { ...current.discovery, status: current.catalog.length || current.models.length ? 'stale' : 'never' } : current.discovery,
      }
    })
  }

  function selections(body: unknown) {
    if (!body || typeof body !== 'object') throw new Error('无效的模型配置')
    const value = body as Record<string, unknown>
    if (!Array.isArray(value.models) || value.models.length > 200) throw new Error('模型数量无效')
    const models: ModelSelection[] = value.models.map(raw => {
      if (!raw || typeof raw !== 'object') throw new Error('模型配置无效')
      const item = raw as Record<string, unknown>
      if (typeof item.id !== 'string' || !item.id.trim() || item.id.length > 200 || !['chat-completions', 'responses'].includes(String(item.protocol))) throw new Error('模型 ID 或协议无效')
      const model: ModelSelection = { id: item.id.trim(), protocol: item.protocol as Protocol }
      for (const field of ['contextWindow', 'maxTokens', 'inputPrice', 'outputPrice'] as const) {
        const number = item[field]
        if (number === undefined || number === null || number === '') continue
        if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || (field !== 'inputPrice' && field !== 'outputPrice' && (!Number.isInteger(number) || number === 0))) throw new Error(`${field} 无效`)
        model[field] = number
      }
      if (item.input !== undefined) {
        if (!Array.isArray(item.input) || item.input.length === 0 || item.input.some(x => x !== 'text' && x !== 'image')) throw new Error('输入模态无效')
        model.input = [...new Set(item.input)] as ('text' | 'image')[]
      }
      for (const field of ['reasoning', 'tools'] as const) {
        if (item[field] !== undefined) {
          if (typeof item[field] !== 'boolean') throw new Error(`${field} 无效`)
          model[field] = item[field] as boolean
        }
      }
      return model
    })
    if (new Set(models.map(model => model.id)).size !== models.length) throw new Error('模型 ID 重复')
    const defaultModel = value.defaultModel
    if (defaultModel !== null && (typeof defaultModel !== 'string' || !models.some(model => model.id === defaultModel))) throw new Error('默认模型必须已选择')
    return update(current => ({ ...current, models, defaultModel: defaultModel as string | null }))
  }

  async function refresh() {
    if (!state.endpoint || !state.apiKey) throw new Error('请先保存端点和凭证')
    const { endpoint, apiKey } = state
    let status: Discovery['status'] = 'error'
    let catalog: CatalogModel[] | undefined
    try {
      const response = await fetch(`${endpoint}/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
        redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
      })
      if (response.status === 401) status = 'unauthorized'
      else if (response.ok) {
        const data = await response.json() as { data?: unknown }
        if (!Array.isArray(data.data)) throw new Error('invalid models response')
        catalog = data.data.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && typeof entry.id === 'string' && !!entry.id)
          .map(entry => ({
            id: entry.id as string,
            name: typeof entry.display_name === 'string' ? entry.display_name : entry.id as string,
            ...(typeof entry.owned_by === 'string' ? { ownedBy: entry.owned_by } : {}),
            ...(typeof entry.type === 'string' ? { type: entry.type } : {}),
            ...(typeof entry.created === 'number' && Number.isFinite(entry.created) ? { created: entry.created } : {}),
          }))
        status = catalog.length ? 'ok' : 'empty'
      }
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) status = 'timeout'
    }
    let applied = false
    await update(current => {
      if (current.endpoint !== endpoint || current.apiKey !== apiKey) return current
      applied = true
      return { ...current, ...(status === 'ok' ? { catalog, catalogSourceEndpoint: endpoint } : {}), discovery: { status, updatedAt: new Date().toISOString() } }
    })
    return applied ? status : 'stale'
  }

  return { load, visible, connection, selections, refresh }
}
