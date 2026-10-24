import React, { useEffect } from 'react'
import { initials } from '../lib/balances'
import { IconClose } from './Icons'

const AVATAR_COLORS = [
  '#2f6b57',
  '#c8553d',
  '#3d6fa8',
  '#b07a2a',
  '#7a4fa0',
  '#2d7a8a',
  '#a54e75',
  '#5c6b3a',
]

export function Avatar({
  name,
  color,
  size = 34,
  ring,
}: {
  name: string
  color: number
  size?: number
  ring?: boolean
}) {
  return (
    <span
      className={`avatar${ring ? ' avatar--ring' : ''}`}
      style={{
        width: size,
        height: size,
        background: AVATAR_COLORS[color % AVATAR_COLORS.length],
        fontSize: Math.max(10, size * 0.36),
      }}
      title={name}
    >
      {initials(name)}
    </span>
  )
}

export function AvatarStack({
  members,
  max = 4,
}: {
  members: { name: string; color: number }[]
  max?: number
}) {
  const shown = members.slice(0, max)
  const extra = members.length - shown.length
  return (
    <span className="avatar-stack">
      {shown.map((m, i) => (
        <Avatar key={`${m.name}-${i}`} name={m.name} color={m.color} size={26} ring />
      ))}
      {extra > 0 && <span className="avatar avatar--more">+{extra}</span>}
    </span>
  )
}

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <section
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet__head">
          <div>
            <h2 className="sheet__title">{title}</h2>
            {subtitle && <p className="sheet__subtitle">{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconClose size={20} />
          </button>
        </header>
        <div className="sheet__body">{children}</div>
        {footer && <footer className="sheet__footer">{footer}</footer>}
      </section>
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          className={`segmented__item${value === o.value ? ' is-active' : ''}`}
          onClick={() => onChange(o.value)}
          type="button"
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  )
}

export function StatusPill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'muted'; children: React.ReactNode }) {
  return <span className={`pill pill--${tone}`}>{children}</span>
}
