import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type Protocol = 'chat-completions' | 'responses'
type Input = 'text' | 'image'
type Field = 'contextWindow' | 'maxTokens' | 'input' | 'reasoning' | 'tools' | 'inputPrice' | 'outputPrice'
type Metadata = { contextWindow?: number; maxTokens?: number; input?: Input[]; inputModalities?: string[]; reasoning?: boolean; tools?: boolean; inputPrice?: number; outputPrice?: number; priceNote?: string }
export type ModelSelection = Metadata & { id: string; protocol: Protocol; catalogId?: string; catalogMatch?: string; overrides?: Partial<Metadata>; sources?: Partial<Record<Field, { source: 'manual' | 'gateway' | 'models.dev'; updatedAt: string }>> }
type CatalogModel = { id: string; name: string; ownedBy?: string; type?: string; created?: number; metadata?: Metadata }
type Discovery = { status: 'never' | 'ok' | 'stale' | 'unauthorized' | 'timeout' | 'empty' | 'error'; updatedAt?: string; successAt?: string }
type Directory = { status: 'never' | 'ok' | 'stale' | 'timeout' | 'error'; updatedAt?: string; successAt?: string; models: Record<string, Metadata> }
type StoredModel = { id: string; protocol: Protocol; catalogId?: string; overrides: Partial<Metadata>; overrideUpdatedAt?: Partial<Record<Field, string>>; updatedAt?: string }
type Stored = { endpoint: string; apiKey: string; credentialVersion?: string; credentialVersions?: Record<string, { endpoint: string; apiKey: string }>; catalog: CatalogModel[]; catalogSourceEndpoint: string | null; catalogCurrent?: boolean; models: StoredModel[]; defaultModel: string | null; discovery: Discovery; directory?: Directory }

const fields: Field[] = ['contextWindow', 'maxTokens', 'input', 'reasoning', 'tools', 'inputPrice', 'outputPrice']
const initial: Stored = { endpoint: '', apiKey: '', catalog: [], catalogSourceEndpoint: null, models: [], defaultModel: null, discovery: { status: 'never' }, directory: { status: 'never', models: {} } }
const positive = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
const price = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
const boolean = (value: unknown) => typeof value === 'boolean' ? value : undefined
const input = (value: unknown): Input[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const supported = value.filter((item): item is Input => item === 'text' || item === 'image')
  return supported.length ? [...new Set(supported)] : undefined
}
function metadata(value: Record<string, unknown>): Metadata {
  const modalities = value.modalities as Record<string, unknown> | undefined
  const limits = value.limit as Record<string, unknown> | undefined
  const cost = value.cost as Record<string, unknown> | undefined
  const rawInput = Array.isArray(modalities?.input) ? modalities.input : value.input
  return {
    ...(positive(value.context_window ?? limits?.context) !== undefined ? { contextWindow: positive(value.context_window ?? limits?.context) } : {}),
    ...(positive(value.max_output_tokens ?? limits?.output) !== undefined ? { maxTokens: positive(value.max_output_tokens ?? limits?.output) } : {}),
    ...(input(rawInput) ? { input: input(rawInput) } : {}),
    ...(Array.isArray(rawInput) && rawInput.every(x => typeof x === 'string') ? { inputModalities: rawInput } : {}),
    ...(boolean(value.reasoning) !== undefined ? { reasoning: boolean(value.reasoning) } : {}),
    ...(boolean(value.tool_call ?? value.tools) !== undefined ? { tools: boolean(value.tool_call ?? value.tools) } : {}),
    ...(price(cost?.input ?? value.input_price) !== undefined ? { inputPrice: price(cost?.input ?? value.input_price) } : {}),
    ...(price(cost?.output ?? value.output_price) !== undefined ? { outputPrice: price(cost?.output ?? value.output_price) } : {}),
    ...(cost?.tiers || cost?.context_over_200k ? { priceNote: '目录含阶梯价格；显示基础参考价' } : {}),
  }
}

export function createModelConnectionStore(dataDir: string, timeoutMs = 10_000, directoryUrl = 'https://models.dev/api.json') {
  const path = join(dataDir, 'model-connection.json')
  let state: Stored
  let pending = Promise.resolve()

  async function load() {
    try { state = JSON.parse(await readFile(path, 'utf8')) as Stored }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      state = structuredClone(initial)
    }
    state.directory ??= structuredClone(initial.directory!)
    state.catalogCurrent ??= state.discovery.status === 'ok' && state.catalogSourceEndpoint === state.endpoint
    // R1-02 saved effective fields directly; those values were entered by the owner.
    state.models = state.models.map(model => {
      const legacy = model as StoredModel & Metadata
      const overrides = model.overrides ?? Object.fromEntries(fields.filter(field => legacy[field] !== undefined).map(field => [field, legacy[field]]))
      const overrideUpdatedAt = model.overrideUpdatedAt ?? Object.fromEntries(fields.filter(field => overrides[field] !== undefined && model.updatedAt).map(field => [field, model.updatedAt]))
      return { ...model, overrides, overrideUpdatedAt }
    })
    if (state.endpoint && state.apiKey && !state.credentialVersion) await update(current => {
      const credentialVersion = crypto.randomUUID()
      return { ...current, credentialVersion, credentialVersions: { ...current.credentialVersions, [credentialVersion]: { endpoint: current.endpoint, apiKey: current.apiKey } } }
    })
  }

  function visible() {
    const { apiKey, credentialVersion, credentialVersions, models, directory, catalogCurrent, ...rest } = state
    const selected: ModelSelection[] = models.map(model => {
      const gateway = catalogCurrent && state.catalogSourceEndpoint === state.endpoint ? state.catalog.find(entry => entry.id === model.id) : undefined
      const catalogId = model.catalogId ?? (gateway?.ownedBy && directory?.models[`${gateway.ownedBy}/${model.id}`] ? `${gateway.ownedBy}/${model.id}` : undefined)
      const source = catalogId ? directory?.models[catalogId] : undefined
      const result: ModelSelection = { id: model.id, protocol: model.protocol, ...(model.catalogId ? { catalogId: model.catalogId } : {}), ...(source ? { catalogMatch: catalogId } : {}), overrides: model.overrides, sources: {} }
      for (const field of fields) {
        const candidate = model.overrides[field] !== undefined ? [model.overrides[field], 'manual', model.overrideUpdatedAt?.[field]] as const
          : gateway?.metadata?.[field] !== undefined ? [gateway.metadata[field], 'gateway', state.discovery.successAt] as const
          : source?.[field] !== undefined ? [source[field], 'models.dev', directory?.successAt] as const : undefined
        if (candidate) {
          Object.assign(result, { [field]: candidate[0] })
          result.sources![field] = { source: candidate[1], updatedAt: candidate[2] ?? '' }
        }
      }
      if (model.overrides.input === undefined && source?.inputModalities) result.inputModalities = source.inputModalities
      if (source?.priceNote && (result.sources?.inputPrice?.source === 'models.dev' || result.sources?.outputPrice?.source === 'models.dev')) result.priceNote = source.priceNote
      return result
    })
    return { ...rest, models: selected, directory: { status: directory!.status, updatedAt: directory!.updatedAt, successAt: directory!.successAt, cachedModels: Object.keys(directory!.models).length }, hasCredential: apiKey.length > 0 }
  }

  function forRun() {
    return { ...visible(), credentialRef: state.credentialVersion ?? null }
  }

  function resolveCredential(ref: string) {
    const credential = state.credentialVersions?.[ref]
    if (!credential) throw new Error('Run 凭证版本不存在')
    return { ...credential }
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
      const credentialVersion = changed ? crypto.randomUUID() : current.credentialVersion
      return {
        ...current, endpoint, apiKey: nextKey,
        credentialVersion,
        credentialVersions: changed ? { ...current.credentialVersions, [credentialVersion!]: { endpoint, apiKey: nextKey } } : current.credentialVersions,
        catalogCurrent: changed ? false : current.catalogCurrent,
        catalogSourceEndpoint: current.catalogSourceEndpoint ?? (current.catalog.length ? current.endpoint : null),
        discovery: changed ? { ...current.discovery, status: current.catalog.length || current.models.length ? 'stale' : 'never' } : current.discovery,
      }
    })
  }

  function selections(body: unknown) {
    if (!body || typeof body !== 'object') throw new Error('无效的模型配置')
    const value = body as Record<string, unknown>
    if (!Array.isArray(value.models) || value.models.length > 200) throw new Error('模型数量无效')
    const models: StoredModel[] = value.models.map(raw => {
      if (!raw || typeof raw !== 'object') throw new Error('模型配置无效')
      const item = raw as Record<string, unknown>
      if (typeof item.id !== 'string' || !item.id.trim() || item.id.length > 200 || !['chat-completions', 'responses'].includes(String(item.protocol))) throw new Error('模型 ID 或协议无效')
      if (item.catalogId !== undefined && (typeof item.catalogId !== 'string' || !/^[a-z0-9_-]+\/[a-zA-Z0-9._:/-]+$/.test(item.catalogId))) throw new Error('目录映射无效')
      const rawOverrides = item.overrides === undefined ? item : item.overrides
      if (!rawOverrides || typeof rawOverrides !== 'object' || Array.isArray(rawOverrides)) throw new Error('人工覆盖无效')
      const overrides: Partial<Metadata> = {}
      for (const field of fields) {
        const v = (rawOverrides as Record<string, unknown>)[field]
        if (v === undefined || v === null || v === '') continue
        if (field === 'contextWindow' || field === 'maxTokens') { if (positive(v) === undefined) throw new Error(`${field} 无效`); Object.assign(overrides, { [field]: v }) }
        else if (field === 'inputPrice' || field === 'outputPrice') { if (price(v) === undefined) throw new Error(`${field} 无效`); Object.assign(overrides, { [field]: v }) }
        else if (field === 'input') { if (!Array.isArray(v) || !v.length || !v.every(x => x === 'text' || x === 'image')) throw new Error('输入模态无效'); overrides.input = input(v) }
        else { if (typeof v !== 'boolean') throw new Error(`${field} 无效`); Object.assign(overrides, { [field]: v }) }
      }
      return { id: item.id.trim(), protocol: item.protocol as Protocol, ...(item.catalogId ? { catalogId: item.catalogId as string } : {}), overrides }
    })
    if (new Set(models.map(model => model.id)).size !== models.length) throw new Error('模型 ID 重复')
    const defaultModel = value.defaultModel
    if (defaultModel !== null && (typeof defaultModel !== 'string' || !models.some(model => model.id === defaultModel))) throw new Error('默认模型必须已选择')
    return update(current => {
      const now = new Date().toISOString()
      return { ...current, models: models.map(model => {
        const previous = current.models.find(item => item.id === model.id)
        const overrideUpdatedAt = Object.fromEntries(fields.flatMap(field => {
          const value = model.overrides[field]
          if (value === undefined) return []
          const unchanged = JSON.stringify(value) === JSON.stringify(previous?.overrides[field])
          const timestamp = unchanged ? previous?.overrideUpdatedAt?.[field] : now
          return timestamp ? [[field, timestamp]] : []
        })) as Partial<Record<Field, string>>
        return { ...model, overrideUpdatedAt }
      }), defaultModel: defaultModel as string | null }
    })
  }

  async function refresh() {
    if (!state.endpoint || !state.apiKey) throw new Error('请先保存端点和凭证')
    const { endpoint, apiKey } = state
    let status: Discovery['status'] = 'error'
    let catalog: CatalogModel[] | undefined
    try {
      const response = await fetch(`${endpoint}/models`, { headers: { authorization: `Bearer ${apiKey}` }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
      if (response.status === 401) status = 'unauthorized'
      else if (response.ok) {
        const data = await response.json() as { data?: unknown }
        if (!Array.isArray(data.data)) throw new Error('invalid models response')
        catalog = data.data.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && typeof entry.id === 'string' && !!entry.id)
          .map(entry => ({ id: entry.id as string, name: typeof entry.display_name === 'string' ? entry.display_name : entry.id as string,
            ...(typeof entry.owned_by === 'string' ? { ownedBy: entry.owned_by } : {}),
            ...(typeof entry.type === 'string' ? { type: entry.type } : {}),
            ...(typeof entry.created === 'number' && Number.isFinite(entry.created) ? { created: entry.created } : {}),
            metadata: metadata(entry) }))
        status = catalog.length ? 'ok' : 'empty'
      }
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) status = 'timeout'
    }
    let applied = false
    await update(current => {
      if (current.endpoint !== endpoint || current.apiKey !== apiKey) return current
      applied = true
      const now = new Date().toISOString()
      return { ...current, ...(status === 'ok' ? { catalog, catalogSourceEndpoint: endpoint, catalogCurrent: true } : {}), discovery: { ...current.discovery, status, updatedAt: now, ...(status === 'ok' ? { successAt: now } : {}) } }
    })
    return applied ? status : 'stale'
  }

  async function refreshDirectory() {
    let status: Directory['status'] = 'error'
    let models: Directory['models'] | undefined
    try {
      const response = await fetch(directoryUrl, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
      if (response.ok) {
        const data = await response.json() as Record<string, { models?: Record<string, Record<string, unknown>> }>
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid directory')
        models = {}
        for (const [supplier, group] of Object.entries(data)) {
          if (!group || typeof group !== 'object' || !group.models || typeof group.models !== 'object') continue
          for (const [id, entry] of Object.entries(group.models)) if (entry && typeof entry === 'object') models[`${supplier}/${id}`] = metadata(entry)
        }
        if (!Object.keys(models).length) throw new Error('empty directory')
        status = 'ok'
      }
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) status = 'timeout'
    }
    await update(current => {
      const now = new Date().toISOString()
      return { ...current, directory: { ...current.directory!, ...(status === 'ok' ? { models, successAt: now } : {}), status, updatedAt: now } }
    })
    return status
  }

  return { load, visible, forRun, resolveCredential, connection, selections, refresh, refreshDirectory }
}
