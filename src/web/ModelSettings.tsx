import { useEffect, useState, type FormEvent } from 'react'
import { Badge } from './craft/components/Badge'
import { Button } from './craft/components/Button'
import { Input } from './craft/components/Input'
import { SettingsCard, SettingsCardContent, SettingsCardFooter } from './craft/components/SettingsCard'
import { SettingsInput, SettingsSecretInput } from './craft/components/SettingsInput'
import { SettingsRow } from './craft/components/SettingsRow'
import { SettingsSection } from './craft/components/SettingsSection'
import { SettingsSelect, SettingsSelectRow, type SettingsSelectOption } from './craft/components/SettingsSelect'
import { SettingsToggle } from './craft/components/SettingsToggle'
import './model-settings.css'

type Field = 'contextWindow' | 'maxTokens' | 'input' | 'reasoning' | 'tools' | 'inputPrice' | 'outputPrice'
type Values = { contextWindow?: number; maxTokens?: number; input?: ('text' | 'image')[]; reasoning?: boolean; tools?: boolean; inputPrice?: number; outputPrice?: number }
type Protocol = 'chat-completions' | 'responses'
type Model = Values & { id: string; protocol: Protocol; catalogId?: string; catalogMatch?: string; overrides?: Values; inputModalities?: string[]; priceNote?: string; sources?: Partial<Record<Field, { source: 'manual' | 'gateway' | 'models.dev'; updatedAt: string }>>; researchReadiness?: { status: 'ready-to-try' | 'connection-missing' | 'missing-parameters' | 'tools-unsupported'; reasons: string[]; verification: 'unknown' } }
export type ModelSettingsState = { endpoint: string; hasCredential: boolean; catalog: { id: string; name: string; ownedBy?: string }[]; catalogSourceEndpoint: string | null; models: Model[]; defaultModel: string | null; stewardModel: { modelId: string; protocol: Protocol } | null; researchModelPool: string[]; researchPoolStatus: { status: 'empty' | 'ready' | 'partial' | 'no-eligible-models'; eligibleModels: number }; discovery: { status: string; updatedAt?: string }; directory: { status: string; updatedAt?: string; successAt?: string; cachedModels: number } }
type State = ModelSettingsState

export const MODEL_SETTINGS_UNSET = '__unset__'.padEnd(201, '_')
const failure: Record<string, string> = { stale: '连接已更改，旧目录需要刷新。', unauthorized: '网关拒绝凭证（401）。请检查密钥。', timeout: '请求超时，请检查网络。', empty: '网关返回空模型列表。已有选择已保留。', error: '加载失败，请检查服务。' }
const labels: Record<Field, string> = { contextWindow: '上下文长度', maxTokens: '输出上限', input: '输入模态', reasoning: '推理能力', tools: '工具能力', inputPrice: '输入参考价（美元/百万 token）', outputPrice: '输出参考价（美元/百万 token）' }
const sources = { manual: '人工', gateway: '网关', 'models.dev': 'models.dev' }
const protocolOptions: SettingsSelectOption[] = [{ value: 'chat-completions', label: 'Chat Completions' }, { value: 'responses', label: 'Responses' }]
const inheritedOptions: SettingsSelectOption[] = [{ value: MODEL_SETTINGS_UNSET, label: '使用其他来源' }, { value: 'true', label: '支持' }, { value: 'false', label: '不支持' }]

export function optionalModelId(value: string) {
  return value === MODEL_SETTINGS_UNSET ? null : value
}

export function modelSelectionPayload(state: State) {
  return {
    models: state.models.map(({ id, protocol, catalogId, overrides }) => ({ id, protocol, catalogId, overrides: overrides ?? {} })),
    defaultModel: state.defaultModel,
    stewardModel: state.stewardModel,
    researchModelPool: state.researchModelPool,
  }
}

export function mergeConnectionState(result: State, current: State | null, dirtyModels: boolean, path: string) {
  if (!dirtyModels || !current || path === '/api/model-connection/models') return result
  return { ...result, models: current.models, defaultModel: current.defaultModel, stewardModel: current.stewardModel, researchModelPool: current.researchModelPool }
}

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
    if (result.endpoint !== undefined) setState(current => mergeConnectionState(result, current, dirtyModels, path))
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
    try { await send('/api/model-connection/test', 'POST', { modelId: model.id, protocol: model.protocol }); setMessage(`${model.id} 的 ${model.protocol} 连接测试成功。`) }
    catch (error) { setMessage(`${model.id} 连接测试失败：${(error as Error).message}`) } finally { setBusy(false) }
  }

  function addModel(id: string) {
    const trimmed = id.trim()
    if (!trimmed || !state || state.models.some(model => model.id === trimmed)) return
    setDirtyModels(true)
    setState({ ...state, models: [...state.models, { id: trimmed, protocol: 'chat-completions', overrides: {} }] })
    setManualId('')
  }

  function changeModel(id: string, change: Partial<Model>) {
    setDirtyModels(true)
    setState(current => current && { ...current, models: current.models.map(model => model.id === id ? { ...model, ...change, researchReadiness: undefined } : model) })
  }

  function override(model: Model, field: Field, value: unknown) {
    changeModel(model.id, { overrides: { ...model.overrides, [field]: value === '' ? undefined : value } })
  }

  async function saveModels() {
    if (!state) return
    setBusy(true); setMessage('')
    try { await send('/api/model-connection/models', 'PUT', modelSelectionPayload(state)); setDirtyModels(false); setMessage('模型配置已保存。来源与有效值已更新。') }
    catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }

  const shown = state?.catalog.filter(model => `${model.id} ${model.name}`.toLowerCase().includes(search.toLowerCase())) ?? []
  const modelOptions = state ? [{ value: MODEL_SETTINGS_UNSET, label: '未设置' }, ...state.models.map(model => ({ value: model.id, label: model.id }))] : []
  const show = (model: Model, field: Field) => {
    const value = model[field]
    const display = value === undefined ? '未知' : Array.isArray(value) ? value.join('、') : typeof value === 'boolean' ? value ? '支持' : '不支持' : String(value)
    const source = model.sources?.[field]
    return `${labels[field]}：${display} · ${source ? `${sources[source.source]} ${source.updatedAt ? new Date(source.updatedAt).toLocaleString() : ''}` : '未知来源'}`
  }

  function removeModel(modelId: string) {
    if (!state) return
    setDirtyModels(true)
    setState({ ...state, models: state.models.filter(item => item.id !== modelId), defaultModel: state.defaultModel === modelId ? null : state.defaultModel, stewardModel: state.stewardModel?.modelId === modelId ? null : state.stewardModel, researchModelPool: state.researchModelPool.filter(id => id !== modelId) })
  }

  return <section className="settings-card model-settings" aria-labelledby="model-title">
    <header className="model-settings-header"><div><h2 id="model-title">模型设置</h2><p>先设置日常使用的管家模型和人工调研模型池。连接、协议与能力依据收纳在详情中。</p></div>{dirtyModels && <Badge variant="secondary">有未保存更改</Badge>}</header>
    {!state && !message && <p className="model-message" role="status">正在读取模型配置…</p>}
    <fieldset className="settings-controls" disabled={busy}>
      {message && <p className="model-message" role="status">{message}</p>}
      {state && failure[state.discovery.status] && <p role="alert" className="model-message text-destructive">上次网关刷新：{failure[state.discovery.status]} 已保留上次有效模型列表与选择。</p>}
      {state && <div className="model-settings-content">
        <SettingsSection title="日常使用" description="保存只影响之后的新管家轮次和工作；进行中的模型快照保持不变。">
          <SettingsCard>
            <SettingsSelectRow label="管家模型" description="新管家轮次使用的模型。" value={state.stewardModel?.modelId ?? MODEL_SETTINGS_UNSET} options={modelOptions} onValueChange={value => { const modelId = optionalModelId(value); setDirtyModels(true); setState({ ...state, stewardModel: modelId === null ? null : { modelId, protocol: state.stewardModel?.protocol ?? 'chat-completions' } }) }} />
            <SettingsSelectRow label="管家协议" description="按模型连接实际支持的协议选择。" value={state.stewardModel?.protocol ?? 'chat-completions'} options={protocolOptions} disabled={!state.stewardModel} onValueChange={value => { setDirtyModels(true); setState({ ...state, stewardModel: state.stewardModel && { ...state.stewardModel, protocol: value as Protocol } }) }} />
            <SettingsCardFooter className="border-t-0"><Button onClick={saveModels} disabled={!dirtyModels}>保存日常设置</Button></SettingsCardFooter>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title="人工调研模型池" description="只有勾选并保存的模型可供管家选择。网关发现列表不会自动入池。" action={<Badge variant="secondary">{state.researchModelPool.length} 个已选</Badge>}>
          <SettingsCard>
            {state.models.length ? state.models.map(model => {
              const selected = state.researchModelPool.includes(model.id)
              const description = !model.researchReadiness ? '保存后校验' : model.researchReadiness.status === 'ready-to-try' ? '运行参数与工具支持依据完整；实际调研尚未核验' : model.researchReadiness.reasons.join('；')
              return <SettingsToggle key={model.id} className="research-model-toggle" label={model.id} description={description} checked={selected} onCheckedChange={checked => { setDirtyModels(true); setState({ ...state, researchModelPool: checked ? [...state.researchModelPool, model.id] : state.researchModelPool.filter(id => id !== model.id) }) }} />
            }) : <SettingsCardContent><p className="model-error">尚无已选模型，请在连接与模型详情中添加模型并补全运行参数。</p></SettingsCardContent>}
          </SettingsCard>
          {state.researchModelPool.length === 0 && <p className="model-error">调研模型池为空。管家不能派发调研工作。</p>}
          {!dirtyModels && state.researchPoolStatus.status === 'no-eligible-models' && <p className="model-error">池内没有有效候选，请补全参数、工具支持依据或连接配置。</p>}
        </SettingsSection>

        <details className="model-details">
          <summary><span>连接与模型详情</span><small>网关、凭证、模型发现、默认协议、能力来源和人工覆盖参数</small></summary>
          <div className="model-details-body">
            <SettingsSection title="模型连接" description="配置一套 sub2api 网关。凭证只写入服务端，页面不会回显。">
              <form onSubmit={saveConnection}><SettingsCard divided={false}>
                <SettingsInput label="端点" description="地址须以 /v1 结尾。" type="url" value={endpoint} onChange={setEndpoint} placeholder="https://example.com/v1" required inCard />
                <div className="settings-card-divider" />
                <SettingsSecretInput label={`API 密钥${state.hasCredential ? '（已保存，留空则保留）' : ''}`} value={apiKey} onChange={setApiKey} autoComplete="new-password" placeholder={state.hasCredential ? '已保存，不回显' : ''} inCard />
                <SettingsCardFooter><Button type="submit">保存连接</Button></SettingsCardFooter>
              </SettingsCard></form>
            </SettingsSection>

            <SettingsSection title="发现与参考目录" description="网关列表记录可见模型，参考目录补充公开能力信息。">
              <SettingsCard>
                <SettingsRow label="网关模型列表" description={state.discovery.updatedAt ? `上次刷新：${new Date(state.discovery.updatedAt).toLocaleString()}` : '尚未刷新'} action={<Button variant="outline" onClick={() => refresh('/api/model-connection/refresh')} disabled={!state.hasCredential}>刷新</Button>} />
                <SettingsRow label="参考目录" description={`${state.directory.successAt ? `缓存：${new Date(state.directory.successAt).toLocaleString()} · ${state.directory.cachedModels} 项` : '尚无缓存'}${state.directory.status && state.directory.status !== 'ok' && state.directory.status !== 'never' ? ` · 本次${failure[state.directory.status] ?? state.directory.status}` : ''}`} action={<Button variant="outline" onClick={() => refresh('/api/model-connection/directory')}>刷新</Button>} />
              </SettingsCard>
              {state.catalogSourceEndpoint && <p className="model-note">目录来源：{state.catalogSourceEndpoint}</p>}
              <p className="model-note">列出模型不代表协议、工具或推理能力已验证。</p>
              <SettingsInput label="搜索网关模型" type="text" value={search} onChange={setSearch} />
              {shown.length > 0 && <SettingsCard>{shown.map(model => <SettingsRow key={model.id} label={model.name} description={`${model.id}${model.ownedBy ? ` · ${model.ownedBy}` : ''}`} action={<Button variant="outline" onClick={() => addModel(model.id)} disabled={state.models.some(item => item.id === model.id)}>选择</Button>} />)}</SettingsCard>}
              {state.catalog.length === 0 && <p className="model-note">暂无已加载列表，可使用下方手填入口。</p>}
              <form onSubmit={event => { event.preventDefault(); addModel(manualId) }}><SettingsInput label="手填模型 ID（备用）" value={manualId} onChange={setManualId} action={<Button type="submit" variant="outline">添加</Button>} /></form>
            </SettingsSection>

            <SettingsSection title="已选模型" description="逐项核对协议、目录映射、能力来源和人工覆盖值。" action={<Badge variant="secondary">{state.models.length} 个模型</Badge>}>
              <SettingsCard><SettingsSelectRow label="默认工作模型" value={state.defaultModel ?? MODEL_SETTINGS_UNSET} options={modelOptions} onValueChange={value => { setDirtyModels(true); setState({ ...state, defaultModel: optionalModelId(value) }) }} /></SettingsCard>
              <div className="selected-models">{state.models.map(model => <details className="selected-model" key={model.id}>
                <summary><span><strong>{model.id}</strong><small>{model.protocol === 'responses' ? 'Responses' : 'Chat Completions'} · {!model.researchReadiness ? '待校验' : model.researchReadiness.status === 'ready-to-try' ? '可尝试调研' : '需补充配置'}</small></span></summary>
                <div className="selected-model-body">
                  <div className="model-heading"><strong>运行与能力详情</strong><Button variant="outline" onClick={() => removeModel(model.id)}>移除模型</Button></div>
                  <SettingsSelect label="默认协议（人工）" value={model.protocol} options={protocolOptions} onValueChange={value => changeModel(model.id, { protocol: value as Protocol })} />
                  <Button className="model-test-button" variant="outline" onClick={() => testModel(model)} disabled={dirtyModels || !state.hasCredential || endpoint !== state.endpoint || apiKey.length > 0}>测试已保存连接与协议</Button>
                  <SettingsInput className="mapping-field" label="目录显式映射" description="供应商/模型 ID；留空则仅按网关供应商与完整 ID 匹配。" value={model.catalogId ?? ''} placeholder="openai/gpt-6-astra" onChange={value => changeModel(model.id, { catalogId: value || undefined })} />
                  <p className="model-note">{model.catalogMatch ? `目录匹配：${model.catalogMatch}（${model.catalogId ? '显式映射' : '当前网关身份'}）` : '目录匹配：未知'}</p>
                  <div className="model-fields">
                    {(['contextWindow', 'maxTokens', 'inputPrice', 'outputPrice'] as const).map(field => <SettingsRow key={field} inCard={false} label={`${labels[field]}（人工覆盖；留空撤销）`}><Input aria-label={labels[field]} type="number" min={field.includes('Price') ? '0' : '1'} step={field.includes('Price') ? 'any' : '1'} value={model.overrides?.[field] ?? ''} placeholder="使用其他来源" onChange={event => override(model, field, event.target.value === '' ? undefined : Number(event.target.value))} /></SettingsRow>)}
                    <SettingsSelect label="输入模态（人工覆盖）" value={model.overrides?.input?.join(',') ?? MODEL_SETTINGS_UNSET} options={[{ value: MODEL_SETTINGS_UNSET, label: '使用其他来源' }, { value: 'text', label: '文本' }, { value: 'text,image', label: '文本与图片' }]} onValueChange={value => override(model, 'input', value === MODEL_SETTINGS_UNSET ? undefined : value.split(','))} />
                    {(['reasoning', 'tools'] as const).map(field => <SettingsSelect key={field} label={`${labels[field]}（人工覆盖）`} value={model.overrides?.[field] === undefined ? MODEL_SETTINGS_UNSET : String(model.overrides[field])} options={inheritedOptions} onValueChange={value => override(model, field, value === MODEL_SETTINGS_UNSET ? undefined : value === 'true')} />)}
                  </div>
                  <ul className="metadata-list">{(['contextWindow', 'maxTokens', 'input', 'reasoning', 'tools', 'inputPrice', 'outputPrice'] as const).map(field => <li key={field}>{show(model, field)}</li>)}</ul>
                  {model.inputModalities && <p className="model-note">目录输入模态：{model.inputModalities.join('、')}。上传能力尚未验证。</p>}
                  {model.priceNote && <p className="model-note">{model.priceNote}。</p>}
                  {!model.researchReadiness ? <p className="model-note">调研候选：保存后校验。</p> : model.researchReadiness.status === 'ready-to-try' ? <p className="model-note">调研候选：允许尝试。实际调研验证尚未核验；连接测试不验证工具调用或调研结果。</p> : <p className="model-error">调研候选不可用：{model.researchReadiness.reasons.join('；')}。</p>}
                  <p className="model-note">协议为人工选择；目录价格仅供参考。实际费用与估算需由运行用量单独计算，价格或用量缺失时费用未知。</p>
                </div>
              </details>)}</div>
              <div className="model-save-row"><Button onClick={saveModels} disabled={!dirtyModels}>保存全部模型设置</Button></div>
            </SettingsSection>
          </div>
        </details>
      </div>}
    </fieldset>
  </section>
}
