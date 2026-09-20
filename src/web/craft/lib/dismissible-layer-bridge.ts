/*
 * Adapted from packages/ui/src/lib/dismissible-layer-bridge.ts in Craft Agents OSS v0.13.3 at
 * e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 * Local changes: none; copied with its original browser layer registry.
 */
export type DismissibleLayerType = 'radix-dialog' | 'radix-popover' | 'island' | 'modal' | 'custom'

export interface DismissibleLayerRegistration {
  id: string
  type: DismissibleLayerType
  priority?: number
  isOpen?: boolean
  close: () => void
  canBack?: () => boolean
  back?: () => boolean
}

export interface DismissibleLayerSnapshot {
  id: string
  type: DismissibleLayerType
  priority: number
}

export interface DismissibleLayerBridge {
  registerLayer: (layer: DismissibleLayerRegistration) => () => void
  hasOpenLayers: () => boolean
  getTopLayer: () => DismissibleLayerSnapshot | null
  closeTop: () => boolean
  handleEscape: () => boolean
}

const BRIDGE_KEY = '__craftAgentDismissibleLayerBridge__'

type BridgeHost = typeof globalThis & {
  [BRIDGE_KEY]?: DismissibleLayerBridge | null
}

function getBridgeHost(): BridgeHost {
  return globalThis as BridgeHost
}

export function setDismissibleLayerBridge(bridge: DismissibleLayerBridge | null): void {
  getBridgeHost()[BRIDGE_KEY] = bridge
}

export function getDismissibleLayerBridge(): DismissibleLayerBridge | null {
  return getBridgeHost()[BRIDGE_KEY] ?? null
}
