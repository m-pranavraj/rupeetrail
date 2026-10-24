import React, { useState } from 'react'
import type { Group } from '../types'
import { inviteUrl } from '../lib/useHashRoute'
import { isValidUpi } from '../lib/upi'
import { Avatar, Sheet } from './ui'
import { IconCheck, IconCopy, IconShare, IconUsers } from './Icons'

export function InviteSheet({
  open,
  onClose,
  group,
  code,
  currentMemberId,
  onAddMember,
  onRemoveMember,
}: {
  open: boolean
  onClose: () => void
  group: Group
  code: string
  currentMemberId?: string
  onAddMember: (name: string, upiId: string) => Promise<boolean>
  onRemoveMember: (memberId: string) => Promise<boolean>
}) {
  const [copied, setCopied] = useState<'link' | 'code' | 'upi' | null>(null)
  const [name, setName] = useState('')
  const [upiId, setUpi] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const submitMember = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmedName = name.trim()
    const trimmedUpi = upiId.trim()
    if (!trimmedName) return setError('Give them a name — that is how they appear in the split.')
    if (trimmedUpi && !isValidUpi(trimmedUpi)) {
      return setError('UPI ids look like name@bank. Fix it or leave it blank.')
    }

    setError('')
    setAdding(true)
    try {
      const ok = await onAddMember(trimmedName, trimmedUpi)
      if (ok) {
        setName('')
        setUpi('')
      }
    } finally {
      setAdding(false)
    }
  }
  const link = code ? inviteUrl(code) : ''
  const message = `Join “${group.name}” on RupeeTrail — log what each of us paid and settle up without arguments: ${link}`

  const copy = async (value: string, which: 'link' | 'code' | 'upi') => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Older browsers: a hidden textarea works well enough for a one-off copy.
      const area = document.createElement('textarea')
      area.value = value
      document.body.appendChild(area)
      area.select()
      try {
        document.execCommand('copy')
      } catch {
        // ignore
      }
      document.body.removeChild(area)
    }
    setCopied(which)
    window.setTimeout(() => setCopied(null), 1800)
  }

  const share = async () => {
    if (!link) return
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${group.name}`, text: message, url: link })
        return
      } catch {
        // User cancelled or the platform refused; fall through to WhatsApp.
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener')
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="People & invites"
      subtitle="Share the link, or add someone by name now — they can join later with the same name."
    >
      {code ? (
        <>
          <div className="invite-code">
            <span className="invite-code__label">Invite code</span>
            <span className="invite-code__value">{code}</span>
            <button className="text-btn" onClick={() => copy(code, 'code')}>
              {copied === 'code' ? <IconCheck size={15} /> : <IconCopy size={15} />}
              {copied === 'code' ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div className="invite-link">
            <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
            <button className="btn btn--soft btn--tiny" onClick={() => copy(link, 'link')}>
              {copied === 'link' ? <IconCheck size={15} /> : <IconCopy size={15} />}
              {copied === 'link' ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div className="invite-actions">
            <button className="btn btn--primary" onClick={share}>
              <IconShare size={17} /> Share link
            </button>
            <a
              className="btn btn--ghost"
              href={`https://wa.me/?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp
            </a>
          </div>
        </>
      ) : (
        <p className="hint">Reconnect to load this group’s invite code.</p>
      )}

      <div className="invite-members">
        <p className="field-label">
          <IconUsers size={14} /> In this group
        </p>
        <ul>
          {group.members
            .filter((m) => !m.leftAt)
            .map((m) => (
              <li key={m.id}>
                <Avatar name={m.name} color={m.color} size={28} />
                <span className="invite-members__name">
                  {m.name}
                  {m.id === currentMemberId && <span className="you-tag">you</span>}
                  {m.isPlaceholder && <span className="invited-tag">not joined</span>}
                </span>
                {m.upiId ? (
                  <button
                    className="invite-members__upi"
                    title="Copy UPI id"
                    onClick={() => copy(m.upiId!, 'upi')}
                  >
                    {m.upiId}
                  </button>
                ) : (
                  <span className="muted-small">no UPI id</span>
                )}
                {m.isPlaceholder && (
                  <button
                    className="text-btn invite-members__remove"
                    type="button"
                    title="Remove this person"
                    onClick={() => void onRemoveMember(m.id)}
                  >
                    remove
                  </button>
                )}
              </li>
            ))}
        </ul>
      </div>

      <div className="invite-add">
        <p className="field-label">Add someone who hasn’t joined</p>
        <p className="hint">
          They show up in splits straight away. If they join later with the same name, they take over
          this entry and keep their history.
        </p>
        <form className="form" onSubmit={submitMember}>
          <label className="field">
            <span>Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Priya"
              maxLength={40}
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>UPI id (optional)</span>
            <input
              value={upiId}
              onChange={(event) => setUpi(event.target.value)}
              placeholder="name@okhdfcbank"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={100}
              autoComplete="off"
            />
          </label>

          {error && <p className="form-error">{error}</p>}

          <button className="btn btn--soft btn--block" type="submit" disabled={adding}>
            {adding ? 'Adding…' : 'Add to group'}
          </button>
        </form>
      </div>

      <p className="fineprint">
        The link is the only key. Everyone who joins sees the same ledger, and every expense records who added
        it. Share it only with the people who are actually in.
      </p>
    </Sheet>
  )
}
