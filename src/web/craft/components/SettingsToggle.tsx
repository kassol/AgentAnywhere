/**
 * Adapted from Craft Agents OSS v0.13.3 at e8963854c3679edcceb105a42537a06749e6cb64.
 * Original: apps/electron/src/renderer/components/settings/SettingsToggle.tsx
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 * Local changes: use local relative imports, keep caller text, and explicitly associate the label/description.
 */
import * as React from 'react'
import { Switch } from './Switch'
import { cn } from '../lib/utils'
import { settingsUI } from './SettingsUIConstants'

export interface SettingsToggleProps {
  label: React.ReactNode
  description?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  inCard?: boolean
}

export function SettingsToggle({ label, description, checked, onCheckedChange, disabled, className, inCard = true }: SettingsToggleProps) {
  const id = React.useId()
  const labelId = `${id}-label`
  const descriptionId = `${id}-description`
  return <div data-layout="settings-row" className={cn(
    'flex items-center justify-between',
    inCard ? 'px-4 py-3.5' : 'py-3',
    disabled && 'opacity-50',
    className,
  )}>
    <label id={labelId} htmlFor={id} className="flex-1 min-w-0 cursor-pointer select-none">
      <div className={settingsUI.label}>{label}</div>
      {description && <div id={descriptionId} className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>{description}</div>}
    </label>
    <Switch id={id} aria-labelledby={labelId} aria-describedby={description ? descriptionId : undefined} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} data-layout="settings-control" className="ml-4 shrink-0" />
  </div>
}
