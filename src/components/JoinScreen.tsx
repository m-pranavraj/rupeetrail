import React, { useEffect, useState } from 'react'
import { invitePreview, type InvitePreview } from '../lib/api'
import { useStore } from '../lib/store'
import { Onboarding } from './Onboarding'
import { AvatarStack, StatusPill } from './ui'
import { IconArrowRight, IconBack, IconUsers } from './Icons'

export function JoinScreen({
  code,
  onJoined,
  onHome,
  onEditIdentity,
}: {
  code: string
  onJoined: (groupId: string) => void
  onHome: () => void
  onEditIdentity: () => void
}) {
  const { identity, memberships, joinGroup } = useStore()
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    invitePreview(code)
      .then((result) => {
        if (!cancelled) setPreview(result)
      })
      .catch((cause: { message?: string }) => {
        if (!cancelled) setError(cause.message ?? 'That invite link is not valid.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [code])

  const doJoin = async () => {
    setJoining(true)
    setError('')
    try {
      const groupId = await joinGroup(code)
      onJoined(groupId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not join this group.')
    } finally {
      setJoining(false)
    }
  }

  if (!identity) {
    return (
      <Onboarding
        title={preview ? `Join “${preview.name}”` : 'Join a group'}
        subtitle="Add your name and UPI id, and you’re in. The link you opened is the invite."
        submitLabel={preview ? 'Join group' : 'Continue'}
        onDone={() => {
          void doJoin()
        }}
      />
    )
  }

  const existing = preview ? memberships.find((m) => m.groupId === preview.id) : undefined

  return (
    <div className="screen join">
      <header className="join__head">
        <button className="icon-btn" onClick={onHome} aria-label="Back to groups">
          <IconBack size={22} />
        </button>
        <span className="join__brand">RupeeSplit</span>
      </header>

      {loading && <p className="hint join__loading">Opening the invite…</p>}

      {!loading && error && !preview && (
        <div className="join__card">
          <h1 className="join__title">This invite doesn’t work</h1>
          <p className="join__sub">{error}</p>
          <p className="hint">Ask for a fresh link, or join with the group’s code.</p>
          <button className="btn btn--primary btn--block" onClick={onHome}>
            Go to my groups
          </button>
        </div>
      )}

      {preview && (
        <div className="join__card">
          <span className="join__emoji" aria-hidden>
            {preview.emoji}
          </span>
          <p className="join__kicker">You’re invited to</p>
          <h1 className="join__title">{preview.name}</h1>
          <p className="join__sub">
            <IconUsers size={15} /> {preview.memberCount} {preview.memberCount === 1 ? 'person' : 'people'} sharing
            expenses
          </p>

          {preview.closed ? (
            <StatusPill tone="muted">This group is closed</StatusPill>
          ) : (
            <>
              <div className="join__identity">
                <AvatarStack members={[{ name: identity.name, color: 0 }]} max={1} />
                <div>
                  <p className="join__as">
                    Joining as <strong>{identity.name}</strong>
                  </p>
                  <p className="join__upi">{identity.upiId || 'No UPI id yet'}</p>
                </div>
                <button className="link-btn" onClick={onEditIdentity}>
                  Change
                </button>
              </div>

              {error && <p className="form-error">{error}</p>}

              {existing ? (
                <button className="btn btn--primary btn--block" onClick={() => onJoined(existing.groupId)}>
                  Open the group <IconArrowRight size={18} />
                </button>
              ) : (
                <button className="btn btn--primary btn--block" onClick={doJoin} disabled={joining}>
                  {joining ? 'Joining…' : 'Join group'} {!joining && <IconArrowRight size={18} />}
                </button>
              )}
            </>
          )}

          <p className="join__code">
            Invite code <code>{preview.code}</code>
          </p>
        </div>
      )}
    </div>
  )
}
