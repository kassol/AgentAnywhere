/**
 * Adapted from Craft Agents OSS v0.13.3 at e8963854c3679edcceb105a42537a06749e6cb64.
 * Original: apps/electron/src/renderer/components/settings/SettingsInput.tsx
 * Copyright 2026 Craft Docs Ltd. Licensed under Apache-2.0.
 * Local changes: relative imports; password reveal buttons are keyboard-labelled.
 */
import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from './Input'
import { Label } from './Label'
import { cn } from '../lib/utils'
import { settingsUI } from './SettingsUIConstants'

export interface SettingsInputProps { label?: string; description?: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: 'text' | 'password' | 'email' | 'url'; name?: string; autoComplete?: string; autoFocus?: boolean; required?: boolean; disabled?: boolean; error?: string; action?: React.ReactNode; className?: string; inCard?: boolean; onBlur?: () => void; onKeyDown?: (event: React.KeyboardEvent) => void }
export function SettingsInput({ label, description, value, onChange, placeholder, type = 'text', name, autoComplete, autoFocus, required, disabled, error, action, className, inCard = false, onBlur, onKeyDown }: SettingsInputProps) {
  const id = React.useId()
  const [showPassword, setShowPassword] = React.useState(false)
  const isPassword = type === 'password'
  return <div className={cn('space-y-2', inCard && 'px-4 py-3.5', className)}>
    {label && <div className={settingsUI.labelGroup}><Label htmlFor={id} className={settingsUI.label}>{label}</Label>{description && <p className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>{description}</p>}</div>}
    <div className="flex gap-2"><div className={cn('relative flex-1 rounded-md shadow-minimal has-[:focus-visible]:bg-background', error && 'ring-1 ring-destructive')}>
      <Input id={id} type={isPassword && showPassword ? 'text' : type} name={name} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} autoComplete={autoComplete} autoFocus={autoFocus} required={required} disabled={disabled} onBlur={onBlur} onKeyDown={onKeyDown} className={cn('bg-muted/50 border-0 shadow-none focus-visible:ring-0 focus-visible:outline-none focus-visible:bg-transparent', isPassword && 'pr-10')} />
      {isPassword && <button type="button" data-slot="settings-secret-toggle" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" aria-label={showPassword ? '隐藏密码' : '显示密码'}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>}
    </div>{action}</div>
    {error && <p className="text-sm text-destructive">{error}</p>}
  </div>
}

export interface SettingsInputRowProps { label: string; description?: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: 'text' | 'password' | 'email' | 'url'; disabled?: boolean; error?: string; className?: string; inCard?: boolean }
export function SettingsInputRow({ label, description, value, onChange, placeholder, type = 'text', disabled, error, className, inCard = true }: SettingsInputRowProps) {
  const id = React.useId()
  return <div data-layout="settings-row" className={cn('flex items-center justify-between', inCard ? 'px-4 py-3.5' : 'py-3', className)}>
    <div className="flex-1 min-w-0"><Label htmlFor={id} className={settingsUI.label}>{label}</Label>{description && <p className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>{description}</p>}{error && <p className={cn('text-sm text-destructive', settingsUI.labelDescriptionGap)}>{error}</p>}</div>
    <div data-layout="settings-control" className={cn('ml-4 shrink-0 rounded-md shadow-minimal has-[:focus-visible]:bg-background', error && 'ring-1 ring-destructive')}><Input id={id} type={type} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} disabled={disabled} className="w-[200px] bg-muted/50 border-0 shadow-none focus-visible:ring-0 focus-visible:outline-none focus-visible:bg-transparent" /></div>
  </div>
}

export type SettingsSecretInputProps = Omit<SettingsInputProps, 'type' | 'action' | 'onKeyDown'>
export function SettingsSecretInput({ label, description, value, onChange, placeholder = '请输入', name, autoComplete, autoFocus, required, disabled, error, className, inCard = false, onBlur }: SettingsSecretInputProps) {
  const id = React.useId()
  const [showValue, setShowValue] = React.useState(false)
  return <div className={cn('space-y-2', inCard && 'px-4 py-3.5', className)}>
    {label && <div className={settingsUI.labelGroup}><Label htmlFor={id} className={settingsUI.label}>{label}</Label>{description && <p className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>{description}</p>}</div>}
    <div className={cn('relative rounded-md shadow-minimal bg-muted/50 has-[:focus-visible]:bg-background', error && 'ring-1 ring-destructive')}>
      <Input id={id} type={showValue ? 'text' : 'password'} name={name} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} autoComplete={autoComplete} autoFocus={autoFocus} required={required} disabled={disabled} onBlur={onBlur} className="pr-10 bg-transparent border-0 shadow-none focus-visible:ring-0 focus-visible:outline-none" />
      <button type="button" data-slot="settings-secret-toggle" onClick={() => setShowValue(!showValue)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" aria-label={showValue ? '隐藏密码' : '显示密码'}>{showValue ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
    </div>
    {error && <p className="text-sm text-destructive">{error}</p>}
  </div>
}
