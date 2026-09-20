/**
 * Adapted from Craft Agents OSS v0.13.3 at e8963854c3679edcceb105a42537a06749e6cb64.
 * Original: apps/electron/src/renderer/components/settings/SettingsSelect.tsx
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 * Local changes: use local relative imports and explicitly associate visible labels/descriptions with triggers.
 */
import * as React from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './Select'
import { Label } from './Label'
import { cn } from '../lib/utils'
import { settingsUI } from './SettingsUIConstants'

export interface SettingsSelectOption { value: string; label: string }
export interface SettingsSelectProps { label?: string; description?: string; value: string; onValueChange: (value: string) => void; options: SettingsSelectOption[]; placeholder?: string; disabled?: boolean; className?: string; inCard?: boolean }
export function SettingsSelect({ label, description, value, onValueChange, options, placeholder = '请选择', disabled, className, inCard = false }: SettingsSelectProps) {
  const id = React.useId()
  const labelId = `${id}-label`
  const descriptionId = `${id}-description`
  return <div className={cn('space-y-2', inCard && 'px-4 py-3.5', className)}>
    {label && <div className={settingsUI.labelGroup}><Label id={labelId} htmlFor={id} className={settingsUI.label}>{label}</Label>{description && <p id={descriptionId} className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>{description}</p>}</div>}
    <Select value={value} onValueChange={onValueChange} disabled={disabled}><SelectTrigger id={id} aria-label={label ? undefined : placeholder} aria-labelledby={label ? labelId : undefined} aria-describedby={label && description ? descriptionId : undefined} className="w-full bg-muted/50"><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>
  </div>
}

export interface SettingsSelectRowProps extends Omit<SettingsSelectProps, 'label' | 'inCard'> { label: string; inCard?: boolean }
export function SettingsSelectRow({ label, description, value, onValueChange, options, placeholder = '请选择', disabled, className, inCard = true }: SettingsSelectRowProps) {
  const id = React.useId()
  const labelId = `${id}-label`
  const descriptionId = `${id}-description`
  return <div data-layout="settings-row" className={cn('flex items-center justify-between', inCard ? 'px-4 py-3.5' : 'py-3', className)}>
    <div className="flex-1 min-w-0"><Label id={labelId} htmlFor={id} className={settingsUI.label}>{label}</Label>{description && <p id={descriptionId} className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>{description}</p>}</div>
    <div data-layout="settings-control" className="ml-4 shrink-0"><Select value={value} onValueChange={onValueChange} disabled={disabled}><SelectTrigger id={id} aria-labelledby={labelId} aria-describedby={description ? descriptionId : undefined} className="w-[180px] bg-muted/50"><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
  </div>
}
