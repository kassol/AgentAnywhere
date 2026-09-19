import { useEffect, useState, type FormEvent } from 'react'

type Field = 'contextWindow' | 'maxTokens' | 'input' | 'reasoning' | 'tools' | 'inputPrice' | 'outputPrice'
type Values = { contextWindow?: number; maxTokens?: number; input?: ('text' | 'image')[]; reasoning?: boolean; tools?: boolean; inputPrice?: number; outputPrice?: number }
type Protocol = 'chat-completions' | 'responses'
type Model = Values & { id: string; protocol: Protocol; catalogId?: string; catalogMatch?: string; overrides?: Values; inputModalities?: string[]; priceNote?: string; sources?: Partial<Record<Field, { source: 'manual' | 'gateway' | 'models.dev'; updatedAt: string }>>; researchReadiness: { status: 'ready-to-try' | 'connection-missing' | 'missing-parameters' | 'tools-unsupported'; reasons: string[]; verification: 'unknown' } }
type State = { endpoint: string; hasCredential: boolean; catalog: { id: string; name: string; ownedBy?: string }[]; catalogSourceEndpoint: string | null; models: Model[]; defaultModel: string | null; stewardModel: { modelId: string; protocol: Protocol } | null; researchModelPool: string[]; researchPoolStatus: { status: 'empty' | 'ready' | 'partial' | 'no-eligible-models'; eligibleModels: number }; discovery: { status: string; updatedAt?: string }; directory: { status: string; updatedAt?: string; successAt?: string; cachedModels: number } }
const failure: Record<string, string> = { stale: '连接已更改，旧目录需要刷新。', unauthorized: '网关拒绝凭证（401）。请检查密钥。', timeout: '请求超时，请检查网络。', empty: '网关返回空模型列表。已有选择已保留。', error: '加载失败，请检查服务。' }
const labels: Record<Field, string> = { contextWindow: '上下文长度', maxTokens: '输出上限', input: '输入模态', reasoning: '推理能力', tools: '工具能力', inputPrice: '输入参考价（美元/百万 token）', outputPrice: '输出参考价（美元/百万 token）' }
const sources = { manual: '人工', gateway: '网关', 'models.dev': 'models.dev' }

export function ModelSettings() {
  const [state, setState] = useState<State | null>(null)
  const [endpoint, setEndpoint] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [search, setSearch] = useState('')
  const [manualId, setManualId] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirtyModels, setDirtyModels] = useState(false)

  useEffect(() => {
    fetch('/api/model-connection').then(async response => {
      if (response.status === 401) { location.assign('/login'); return }
      if (!response.ok) throw new Error('加载失败')
      const current = await response.json() as State
      setState(current)
      setEndpoint(current.endpoint)
    }).catch(() => setMessage('模型设置加载失败。'))
  }, [])

  async function send(path: string, method: string, body?: unknown) {
    const response = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (response.status === 401) { location.assign('/login'); throw new Error('登录已失效') }
    const result = await response.json() as State & { error?: string }
    if (result.endpoint !== undefined) setState(current => dirtyModels && current && path !== '/api/model-connection/models' ? { ...result, models: current.models, defaultModel: current.defaultModel, stewardModel: current.stewardModel, researchModelPool: current.researchModelPool } : result)
    if (!response.ok) throw new Error(result.error || (path.endsWith('/directory') ? `参考目录${failure[result.directory.status] ?? '刷新失败。'}` : failure[result.discovery?.status]) || '操作失败')
    return result
  }

  async function saveConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('')
    try { await send('/api/model-connection', 'PUT', { endpoint, apiKey }); setApiKey(''); setMessage('连接配置已保存。凭证不会回显。') }
    catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }

  async function refresh(path: string) {
    setBusy(true); setMessage('')
    try { await send(path, 'POST'); setMessage(path.endsWith('/directory') ? '参考目录已刷新。目录能力尚未经实际调用验证。' : '模型列表已刷新。列表仅表示网关列出，调用与能力尚未验证。') }
    catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }

  async function testModel(model: Model) {
    setBusy(true); setMessage('')
    try {
      await send('/api/model-connection/test', 'POST', { modelId: model.id, protocol: model.protocol })
      setMessage(`${model.id} 的 ${model.protocol} 连接测试成功。`)
    } catch (error) { setMessage(`${model.id} 连接测试失败：${(error as Error).message}`) } finally { setBusy(false) }
  }

  function addModel(id: string) {
    const trimmed = id.trim()
    if (!trimmed || !state || state.models.some(model => model.id === trimmed)) return
    setDirtyModels(true)
    setState({ ...state, models: [...state.models, { id: trimmed, protocol: 'chat-completions', overrides: {}, researchReadiness: { status: state.hasCredential ? 'missing-parameters' : 'connection-missing', reasons: [state.hasCredential ? '缺少运行参数：上下文长度、输出上限、文本输入、推理能力' : '模型连接未配置'], verification: 'unknown' } }] })
    setManualId('')
  }

  function changeModel(id: string, change: Partial<Model>) {
    setDirtyModels(true)
    setState(current => current && { ...current, models: current.models.map(model => model.id === id ? { ...model, ...change } : model) })
  }

  function override(model: Model, field: Field, value: unknown) {
    const next = { ...model.overrides, [field]: value === '' ? undefined : value }
    changeModel(model.id, { overrides: next })
  }

  async function saveModels() {
    if (!state) return
    setBusy(true); setMessage('')
    try {
      await send('/api/model-connection/models', 'PUT', {
        models: state.models.map(({ id, protocol, catalogId, overrides }) => ({ id, protocol, catalogId, overrides: overrides ?? {} })),
        defaultModel: state.defaultModel, stewardModel: state.stewardModel, researchModelPool: state.researchModelPool,
      })
      setDirtyModels(false)
      setMessage('模型配置已保存。来源与有效值已更新。')
    } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }

  const shown = state?.catalog.filter(model => `${model.id} ${model.name}`.toLowerCase().includes(search.toLowerCase())) ?? []
  const show = (model: Model, field: Field) => {
    const value = model[field]
    const display = value === undefined ? '未知' : Array.isArray(value) ? value.join('、') : typeof value === 'boolean' ? value ? '支持' : '不支持' : String(value)
    const source = model.sources?.[field]
    return `${labels[field]}：${display} · ${source ? `${sources[source.source]} ${source.updatedAt ? new Date(source.updatedAt).toLocaleString() : ''}` : '未知来源'}`
  }
  return <section className="settings-card model-settings" aria-labelledby="model-title">
    <h2 id="model-title">模型连接</h2>
    <p className="muted">配置一套 sub2api 网关。模型列表和运行能力分别记录。</p>
    <fieldset className="settings-controls" disabled={busy}>
      <form className="model-form" onSubmit={saveConnection}>
        <label>端点（以 /v1 结尾）<input type="url" value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="https://example.com/v1" required /></label>
        <label>API 密钥{state?.hasCredential ? '（已保存，留空则保留）' : ''}<input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="new-password" placeholder={state?.hasCredential ? '已保存，不回显' : ''} /></label>
        <button disabled={busy}>保存连接</button>
      </form>
      <div className="model-actions"><button type="button" className="secondary" onClick={() => refresh('/api/model-connection/refresh')} disabled={busy || !state?.hasCredential}>刷新模型列表</button><span className="muted">{state?.discovery.updatedAt ? `上次刷新：${new Date(state.discovery.updatedAt).toLocaleString()}` : '尚未刷新'}</span></div>
      <div className="model-actions"><button type="button" className="secondary" onClick={() => refresh('/api/model-connection/directory')}>刷新参考目录</button><span className="muted">{state?.directory.successAt ? `缓存：${new Date(state.directory.successAt).toLocaleString()} · ${state.directory.cachedModels} 项` : '尚无缓存'}{state?.directory.status && state.directory.status !== 'ok' && state.directory.status !== 'never' ? ` · 本次${failure[state.directory.status] ?? state.directory.status}` : ''}</span></div>
      {message && <p role="status">{message}</p>}
      {state && failure[state.discovery.status] && <p role="status" className="error">上次网关刷新：{failure[state.discovery.status]} 已保留上次有效模型列表与选择。</p>}
      {state && <>
        <h3>网关模型</h3>
        {state.catalogSourceEndpoint && <p className="muted">目录来源：{state.catalogSourceEndpoint}</p>}
        <p className="muted">列出模型不代表协议、工具或推理能力已验证。</p>
        <label className="search-label">搜索模型<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <ul className="catalog">{shown.map(model => <li key={model.id}><span>{model.name} <small>{model.id}{model.ownedBy ? ` · ${model.ownedBy}` : ''}</small></span><button type="button" className="secondary" onClick={() => addModel(model.id)} disabled={state.models.some(item => item.id === model.id)}>选择</button></li>)}</ul>
        {state.catalog.length === 0 && <p className="muted">暂无已加载列表，可使用下方手填入口。</p>}
        <form className="manual-add" onSubmit={event => { event.preventDefault(); addModel(manualId) }}><label>手填模型 ID（备用）<input value={manualId} onChange={event => setManualId(event.target.value)} /></label><button type="submit" className="secondary">添加</button></form>
        <h3>已选模型</h3>
        {state.models.map(model => <div className="selected-model" key={model.id}>
          <div className="model-heading"><strong>{model.id}</strong><button type="button" className="secondary" onClick={() => { setDirtyModels(true); setState({ ...state, models: state.models.filter(item => item.id !== model.id), defaultModel: state.defaultModel === model.id ? null : state.defaultModel, stewardModel: state.stewardModel?.modelId === model.id ? null : state.stewardModel, researchModelPool: state.researchModelPool.filter(id => id !== model.id) }) }}>移除</button></div>
          <label>默认协议（人工）<select value={model.protocol} onChange={event => changeModel(model.id, { protocol: event.target.value as Model['protocol'] })}><option value="chat-completions">Chat Completions</option><option value="responses">Responses</option></select></label>
          <button type="button" className="secondary" onClick={() => testModel(model)} disabled={busy || dirtyModels || !state.hasCredential || endpoint !== state.endpoint || apiKey.length > 0}>测试已保存连接与协议</button>
          <label className="mapping-label">目录显式映射（供应商/模型 ID；留空则仅按网关供应商与完整 ID 匹配）<input value={model.catalogId ?? ''} placeholder="openai/gpt-6-astra" onChange={event => changeModel(model.id, { catalogId: event.target.value || undefined })} /></label>
          <p className="muted">{model.catalogMatch ? `目录匹配：${model.catalogMatch}（${model.catalogId ? '显式映射' : '当前网关身份'}）` : '目录匹配：未知'}</p>
          <div className="model-fields">
            {(['contextWindow', 'maxTokens', 'inputPrice', 'outputPrice'] as const).map(field => <label key={field}>{labels[field]}（人工覆盖；留空撤销）<input type="number" min={field.includes('Price') ? '0' : '1'} step={field.includes('Price') ? 'any' : '1'} value={model.overrides?.[field] ?? ''} placeholder="使用其他来源" onChange={event => override(model, field, event.target.value === '' ? undefined : Number(event.target.value))} /></label>)}
            <label>输入模态（人工覆盖）<select value={model.overrides?.input?.join(',') ?? ''} onChange={event => override(model, 'input', event.target.value ? event.target.value.split(',') : undefined)}><option value="">使用其他来源</option><option value="text">文本</option><option value="text,image">文本与图片</option></select></label>
            {(['reasoning', 'tools'] as const).map(field => <label key={field}>{labels[field]}（人工覆盖）<select value={model.overrides?.[field] === undefined ? '' : String(model.overrides[field])} onChange={event => override(model, field, event.target.value === '' ? undefined : event.target.value === 'true')}><option value="">使用其他来源</option><option value="true">支持</option><option value="false">不支持</option></select></label>)}
          </div>
          <ul className="metadata-list">{(['contextWindow', 'maxTokens', 'input', 'reasoning', 'tools', 'inputPrice', 'outputPrice'] as const).map(field => <li key={field}>{show(model, field)}</li>)}</ul>
          {model.inputModalities && <p className="muted">目录输入模态：{model.inputModalities.join('、')}。上传能力尚未验证。</p>}
          {model.priceNote && <p className="muted">{model.priceNote}。</p>}
          {(!model.contextWindow || !model.maxTokens || !model.input || model.reasoning === undefined) && <p className="error">缺少运行所需参数，请补充上下文、输出上限、输入模态与推理能力。</p>}
          {model.researchReadiness.status === 'ready-to-try' ? <p className="muted">调研候选：允许尝试。实际调研验证尚未核验；连接测试不验证工具调用或调研结果。</p> : <p className="error">调研候选不可用：{model.researchReadiness.reasons.join('；')}。</p>}
          <p className="muted">协议为人工选择；目录价格仅供参考。实际费用与估算需由运行用量单独计算，价格或用量缺失时费用未知。</p>
        </div>)}
        <label className="default-model">默认模型<select value={state.defaultModel ?? ''} onChange={event => { setDirtyModels(true); setState({ ...state, defaultModel: event.target.value || null }) }}><option value="">未设置</option>{state.models.map(model => <option key={model.id} value={model.id}>{model.id}</option>)}</select></label>
        <h3>管家模型</h3>
        <p className="muted">新管家轮次使用这里保存的模型与协议。缺少配置时，管家入口将引导回来设置。</p>
        <div className="model-fields">
          <label>模型<select value={state.stewardModel?.modelId ?? ''} onChange={event => { setDirtyModels(true); setState({ ...state, stewardModel: event.target.value ? { modelId: event.target.value, protocol: state.stewardModel?.protocol ?? 'chat-completions' } : null }) }}><option value="">未设置</option>{state.models.map(model => <option key={model.id} value={model.id}>{model.id}</option>)}</select></label>
          <label>协议<select value={state.stewardModel?.protocol ?? 'chat-completions'} disabled={!state.stewardModel} onChange={event => { setDirtyModels(true); setState({ ...state, stewardModel: state.stewardModel && { ...state.stewardModel, protocol: event.target.value as Protocol } }) }}><option value="chat-completions">Chat Completions</option><option value="responses">Responses</option></select></label>
        </div>
        <h3>人工调研模型池</h3>
        <p className="muted">只有勾选并保存的模型可供管家选择。网关发现列表不会自动入池。</p>
        {state.models.length ? <div className="research-pool">{state.models.map(model => {
          const selected = state.researchModelPool.includes(model.id)
          return <label key={model.id}><input type="checkbox" checked={selected} onChange={event => { setDirtyModels(true); setState({ ...state, researchModelPool: event.target.checked ? [...state.researchModelPool, model.id] : state.researchModelPool.filter(id => id !== model.id) }) }} /><span><strong>{model.id}</strong><small>{model.researchReadiness.status === 'ready-to-try' ? '运行参数与工具支持依据完整；实际调研尚未核验' : model.researchReadiness.reasons.join('；')}</small></span></label>
        })}</div> : <p className="error">尚无已选模型，请先添加并补全运行参数。</p>}
        {state.researchModelPool.length === 0 && <p className="error">调研模型池为空。管家不能派发调研工作。</p>}
        {state.researchPoolStatus.status === 'no-eligible-models' && <p className="error">池内没有有效候选，请补全参数、工具支持依据或连接配置。</p>}
        <button type="button" onClick={saveModels} disabled={busy}>保存模型配置</button>
      </>}
    </fieldset>
  </section>
}
