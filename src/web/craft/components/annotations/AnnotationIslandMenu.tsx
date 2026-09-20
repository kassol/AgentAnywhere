/*
 * Adapted from packages/ui/src/components/annotations/AnnotationIslandMenu.tsx in Craft Agents OSS v0.13.3 at
 * e8963854c3679edcceb105a42537a06749e6cb64.
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 * Local changes: use relative imports and Chinese labels, remove save-and-send, use the local shadow token, and clamp the expanded Island to the viewport.
 */
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { CornerDownRight } from 'lucide-react'
import { Island, IslandContentView, type IslandTransitionConfig } from '../Island'
import { IslandFollowUpContentView } from '../IslandFollowUpContentView'
import { cn } from '../../lib/utils'
import { clampIslandAnchorX, getDefaultIslandWidthEstimate } from './island-motion'

export type AnnotationIslandView = 'compact' | 'confirm-follow-up'
export type AnnotationIslandMode = 'edit' | 'view'

export interface AnnotationIslandMenuProps {
  anchor: { x: number; y: number } | null
  sourceKey: string
  replayNonce: number
  isVisible: boolean
  /** Render via React portal to document.body (default). Disable inside modal/dialog contexts. */
  usePortal?: boolean
  activeView: AnnotationIslandView
  mode: AnnotationIslandMode
  draft: string
  onDraftChange: (next: string) => void
  onOpenFollowUp: () => void
  onCancel: () => void
  onRequestBack?: () => boolean
  onRequestEdit: () => void
  onSubmit: (value: string) => void
  onDelete?: () => void
  sendMessageKey?: 'enter' | 'cmd-enter'
  transitionConfig: IslandTransitionConfig
  onExitComplete?: () => void
  zIndex?: React.CSSProperties['zIndex']
  overlayZIndex?: React.CSSProperties['zIndex']
}

export function AnnotationIslandMenu({
  anchor,
  sourceKey,
  replayNonce,
  isVisible,
  activeView,
  mode,
  draft,
  onDraftChange,
  onOpenFollowUp,
  onCancel,
  onRequestBack,
  onRequestEdit,
  onSubmit,
  onDelete,
  sendMessageKey = 'enter',
  transitionConfig,
  onExitComplete,
  zIndex = 'var(--z-island, 400)',
  overlayZIndex,
  usePortal = true,
}: AnnotationIslandMenuProps) {
  const menuRef = React.useRef<HTMLDivElement>(null)
  const [activeViewSize, setActiveViewSize] = React.useState<{ width: number; height: number } | null>(null)

  // Keep blocker behind the island menu when consumers pass a custom numeric zIndex
  // (for example TurnCard uses zIndex=50). Otherwise fall back to the semantic island token.
  const resolvedOverlayZIndex = React.useMemo<React.CSSProperties['zIndex']>(() => {
    if (overlayZIndex != null) return overlayZIndex
    if (typeof zIndex === 'number') return zIndex - 1
    return 'var(--z-island-overlay, 390)'
  }, [overlayZIndex, zIndex])

  const anchorX = React.useMemo(() => {
    if (typeof window === 'undefined') return 0
    if (!anchor) return window.innerWidth / 2

    const width = activeViewSize?.width ?? getDefaultIslandWidthEstimate()
    return clampIslandAnchorX(anchor.x, width)
  }, [anchor, activeViewSize])

  const anchorY = React.useMemo(() => {
    if (typeof window === 'undefined' || !anchor) return 36
    const minimum = (activeViewSize?.height ?? 28) + 8
    return Math.min(Math.max(minimum, anchor.y), window.innerHeight - 8)
  }, [anchor, activeViewSize])

  if (!anchor) return null

  const menuNode = (
    <div
      ref={menuRef}
      data-ca-annotation-island="true"
      className="fixed"
      style={{
        zIndex,
        left: anchorX,
        top: anchorY,
        transform: 'translate(-50%, -100%)',
      }}
    >
      <Island
        key={sourceKey}
        activeViewId={activeView}
        radius={12}
        className="border-border/40 bg-background/75 backdrop-blur-xl backdrop-saturate-150 shadow-middle"
        onActiveViewSizeChange={setActiveViewSize}
        isVisible={isVisible}
        onExitComplete={onExitComplete}
        replayEntryKey={`${sourceKey}:${replayNonce}`}
        replayOnVisible="always"
        transitionConfig={transitionConfig}
        dialogBehavior="back-or-close"
        onRequestBack={onRequestBack}
        onRequestClose={onCancel}
        overlayZIndex={resolvedOverlayZIndex}
      >
        <IslandContentView id="compact" anchorX="center" anchorY="bottom">
          <div className="p-1 flex items-center gap-1">
            <button
              data-craft-button
              type="button"
              onClick={onOpenFollowUp}
              className={cn(
                'h-[30px] px-2.5 rounded-[8px] text-[13px] font-medium inline-flex items-center gap-1.5',
                'text-foreground/85 hover:text-foreground hover:bg-foreground/5',
                'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring'
              )}
            >
              <CornerDownRight className="h-3.5 w-3.5" />
              <span>添加批注</span>
            </button>
          </div>
        </IslandContentView>

        <IslandFollowUpContentView
          id="confirm-follow-up"
          mode={mode}
          value={draft}
          onValueChange={onDraftChange}
          onCancel={onCancel}
          onRequestEdit={onRequestEdit}
          onSubmit={onSubmit}
          onDelete={onDelete}
          title="批注意见"
          submitLabel="保存批注"
          placeholder="写下希望如何修改"
          maxInputHeight={320}
          sendMessageKey={sendMessageKey}
          lockScroll
          blockOutsideInteraction
        />
      </Island>
    </div>
  )

  return usePortal ? ReactDOM.createPortal(menuNode, document.body) : menuNode
}
