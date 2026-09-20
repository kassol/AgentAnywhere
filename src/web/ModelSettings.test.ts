import { describe, expect, test } from 'bun:test'
import { MODEL_SETTINGS_UNSET, mergeConnectionState, modelSelectionPayload, optionalModelId, type ModelSettingsState } from './ModelSettings'

function state(overrides: Partial<ModelSettingsState> = {}): ModelSettingsState {
  return {
    endpoint: 'https://gateway.example/v1',
    hasCredential: true,
    catalog: [],
    catalogSourceEndpoint: null,
    models: [{
      id: 'research-model',
      protocol: 'responses',
      catalogId: 'provider/research-model',
      overrides: { contextWindow: 128_000, tools: true },
    }],
    defaultModel: 'research-model',
    stewardModel: { modelId: 'research-model', protocol: 'responses' },
    researchModelPool: ['research-model'],
    researchPoolStatus: { status: 'ready', eligibleModels: 1 },
    discovery: { status: 'ok' },
    directory: { status: 'ok', cachedModels: 1 },
    ...overrides,
  }
}

describe('model settings persistence', () => {
  test('daily changes keep unedited protocol, mapping, and overrides in the full payload', () => {
    const current = state({ stewardModel: null, researchModelPool: [] })

    expect(modelSelectionPayload(current)).toEqual({
      models: [{
        id: 'research-model',
        protocol: 'responses',
        catalogId: 'provider/research-model',
        overrides: { contextWindow: 128_000, tools: true },
      }],
      defaultModel: 'research-model',
      stewardModel: null,
      researchModelPool: [],
    })
  })

  test('refresh keeps unsaved daily and detailed edits until the model save succeeds', () => {
    const dirty = state({ stewardModel: null, researchModelPool: [] })
    const refreshed = state({
      endpoint: 'https://new-gateway.example/v1',
      models: [{ id: 'gateway-model', protocol: 'chat-completions', overrides: {} }],
      defaultModel: 'gateway-model',
      stewardModel: { modelId: 'gateway-model', protocol: 'chat-completions' },
      researchModelPool: ['gateway-model'],
    })

    expect(mergeConnectionState(refreshed, dirty, true, '/api/model-connection/refresh')).toMatchObject({
      endpoint: 'https://new-gateway.example/v1',
      models: dirty.models,
      defaultModel: 'research-model',
      stewardModel: null,
      researchModelPool: [],
    })
    expect(mergeConnectionState(refreshed, dirty, true, '/api/model-connection/models')).toBe(refreshed)
  })

  test('a valid model named like the old unset sentinel remains selectable and persists', () => {
    const modelId = '__unset__'
    const current = state({
      models: [{ id: modelId, protocol: 'responses', overrides: {} }],
      defaultModel: modelId,
      stewardModel: { modelId, protocol: 'responses' },
      researchModelPool: [modelId],
    })

    expect(MODEL_SETTINGS_UNSET.length).toBeGreaterThan(200)
    expect(optionalModelId(modelId)).toBe(modelId)
    expect(optionalModelId(MODEL_SETTINGS_UNSET)).toBeNull()
    expect(modelSelectionPayload(current)).toMatchObject({
      models: [{ id: modelId }],
      defaultModel: modelId,
      stewardModel: { modelId },
      researchModelPool: [modelId],
    })
  })
})
