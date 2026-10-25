import React, { useCallback, useMemo, useState } from 'react'
import { useStore, type GroupSummary } from '../lib/store'
import { formatPaise } from '../lib/money'
import { isValidUpi } from '../lib/upi'
import { Avatar, AvatarStack, EmptyState, Sheet } from './ui'
import { IconArrowRight, IconPlus, IconShare, IconSpark, IconUsers, Mic } from './Icons'

const EMOJI_CHOICES = ['🏖️', '🏠', '✈️', '🎉', '🍻', '🏏', '🎓', '🚗', '🎿', '🍕', '💼', '🌮']

const AVATAR_COLORS = 8

export function HomeScreen({ onOpenGroup }: { onOpenGroup: (id: string) => void }) {
  const { identity, summaries, createGroup, joinGroup, updateIdentity, signOut } = useStore()
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const [editingIdentity, setEditingIdentity] = useState(false)
  const [voiceCommand, setVoiceCommand] = useState('')
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const [voiceTranscript, setVoiceTranscript] = useState('')

  const loadVoiceRecognition = useCallback(() => {
    // Load speech recognition lazily
    if (typeof webkitSpeechRecognition !== 'undefined') {
      const recognition = new webkitSpeechRecognition()
      recognition.continuous = false
      recognition.interimResults = true
      recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map((result) => result[0].transcript)
          .join('')
        setVoiceTranscript(transcript)
        setVoiceCommand(transcript)
        // Process the voice transcript to extract group info
        processVoiceTrip(transcript)
      }
      recognition.onerror = (event) => {
        setVoiceError('Could not listen. Try again.')
        setVoiceBusy(false)
      }
      recognition.onend = () => {
        setVoiceBusy(false)
      }
      recognition.start()
      setVoiceBusy(true)
      return recognition
    } else {
      setVoiceError('Speech not supported in this browser.')
      return null
    }
  }, [])

  const processVoiceTrip = useCallback((transcript: string) => {
    const lower = transcript.toLowerCase()
    // Look for group name patterns like "Goa trip", "Goa long weekend"
    const groupNameMatch = lower.match(/([a-z\s]+)\s*(trip|weekend|tour|vacation|dinner|party)/i)
    const potentialName = groupNameMatch ? groupNameMatch[1].trim() : 'New Trip'
    
    // Look for expense patterns: "Dinner 2000, Priya 500"
    const expenseMatch = lower.match(/(\d+[\s,]*)+(rupees?|rs|₹)/i)
    
    // Look for member names that might be mentioned
    const knownMembers = membersFromGroups(summaries)
    
    // Create a new group with the parsed name
    createGroup(potentialName, '🏖️').then((id) => {
      // Could add initial expenses here based on the transcript
      setVoiceError(`Group '${potentialName}' created. Share the link to add expenses.`)
      setVoiceBusy(false)
    }).catch((cause) => {
      setVoiceError(cause instanceof Error ? cause.message : 'Could not create group.')
      setVoiceBusy(false)
    })
  }, [createGroup, summaries])

  const totals = useMemo(() => {
    let owed = 0
    let owe = 0
    let unknown = 0
    for (const s of summaries) {
      if (s.netPaise === null) {
        unknown += 1
        continue
      }
      if (s.netPaise > 0) owed += s.netPaise
      else owe += -s.netPaise
    }
    return { owed, owe, unknown }
  }, [summaries])

  const openQuestions = summaries.filter((s) => s.hasOpenQuestion).length

  return (
    <div className="screen home">
      <header className="home__masthead">
        <div className="brand">
          <span className="brand__mark" aria-hidden>
            ₹
          </span>
          <div>
            <p className="brand__name">RupeeSplit</p>
            <p className="brand__tag">Every rupee, accounted for.</p>
          </div>
        </div>
        <button className="identity" onClick={() => setEditingIdentity(true)}>
          <Avatar name={identity?.name ?? 'You'} color={0} size={34} />
          <span className="identity__text">
            <span className="identity__label">You are</span>
            <span className="identity__name">{identity?.name ?? 'Set up'}</span>
          </span>
        </button>
      </header>

      <section className="summary-card" aria-label="Your overall position">
        <div className="summary-card__row">
          <div>
            <p className="summary-card__label">
              Across {summaries.length} group{summaries.length === 1 ? '' : 's'}
            </p>
            <p className="summary-card__value">
              {totals.owed >= totals.owe && totals.owed > 0
                ? `You get back ${formatPaise(totals.owed - totals.owe)}`
                : totals.owe > 0
                  ? `You owe ${formatPaise(totals.owe - totals.owed)}`
                  : totals.unknown > 0
                    ? 'Open a group to sync'
                    : 'All square'}
            </p>
          </div>
          <div className="summary-card__spark" aria-hidden>
            <IconSpark size={26} />
          </div>
        </div>
        <div className="summary-card__split">
          <span>
            <em>Owed to you</em>
            <strong className="pos">{formatPaise(totals.owed)}</strong>
          </span>
          <span className="summary-card__divider" aria-hidden />
          <span>
            <em>You owe</em>
            <strong className="neg">{formatPaise(totals.owe)}</strong>
          </span>
        </div>
      </section>

      <div className="home__actions">
        <button className="action-card" onClick={() => setCreating(true)}>
          <span className="action-card__icon">
            <IconPlus size={18} />
          </span>
          <span>
            <strong>New group</strong>
            <em>Start a trip, flat or dinner</em>
          </span>
        </button>
        <button className="action-card" onClick={() => setJoining(true)}>
          <span className="action-card__icon">
            <IconShare size={18} />
          </span>
          <span>
            <strong>Join group</strong>
            <em>Use an invite code</em>
          </span>
        </button>
        <button className="action-card" onClick={() => void loadVoiceRecognition()}>
          <span className="action-card__icon">
            <Mic size={18} />
          </span>
          <span>
            <strong>Voice trip</strong>
            <em>Describe your trip and expenses</em>
          </span>
        </button>
      </div>

      <div className="section-head">
        <h2>Your groups</h2>
        {openQuestions > 0 && <span className="pill pill--warn">{openQuestions} open question{openQuestions === 1 ? '' : 's'}</span>}
      </div>

      {summaries.length === 0 ? (
        <EmptyState
          icon={<IconUsers size={26} />}
          title="No groups yet"
          body="Create a group and send the invite link to your people. Everyone joins with their name and UPI id, and every expense shows up on all phones."
          action={
            <div className="empty__actions">
              <button className="btn btn--primary" onClick={() => setCreating(true)}>
                <IconPlus size={18} /> Create a group
              </button>
              <button className="btn btn--ghost" onClick={() => setJoining(true)}>
                I have a code
              </button>
            </div>
          }
        />
      ) : (
        <ul className="group-list">
          {summaries.map((g) => (
            <li key={g.groupId}>
              <GroupCard summary={g} onOpen={() => onOpenGroup(g.groupId)} />
            </li>
          ))}
        </ul>
      )}

      <footer className="home__footer">
        <p className="save-note">
          <span className="dot dot--ok" />
          Shared ledger · updates live across everyone’s phones
        </p>
        <a
          className="govira-link"
          href="https://govira.tech"
          target="_blank"
          rel="noreferrer noopener"
        >
          Powered by Govira Technologies ↗
        </a>
      </footer>

      <CreateGroupSheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={async (name, emoji) => {
          const id = await createGroup(name, emoji)
          setCreating(false)
          onOpenGroup(id)
        }}
      />

      <JoinGroupSheet
        open={joining}
        onClose={() => setJoining(false)}
        onJoin={async (code) => {
          const id = await joinGroup(code)
          setJoining(false)
          onOpenGroup(id)
        }}
      />

      <IdentitySheet
        open={editingIdentity}
        onClose={() => setEditingIdentity(false)}
        initialName={identity?.name ?? ''}
        initialUpi={identity?.upiId ?? ''}
        phone={identity?.phone ?? ''}
        onSave={async (name, upiId) => {
          await updateIdentity(name, upiId)
          setEditingIdentity(false)
        }}
        onSignOut={async () => {
          await signOut()
          setEditingIdentity(false)
        }}
      />
    </div>
  )
}

function GroupCard({ summary, onOpen }: { summary: GroupSummary; onOpen: () => void }) {
  const net = summary.netPaise
  return (
    <button className="group-card" onClick={onOpen}>
      <span className="group-card__emoji" aria-hidden>
        {summary.emoji}
      </span>
      <span className="group-card__main">
        <span className="group-card__name">
          {summary.name}
          {summary.status === 'closed' && <span className="pill pill--muted">Closed</span>}
          {summary.status === 'reconciling' && <span className="pill pill--warn">Reconciling</span>}
          {summary.hasOpenQuestion && <span className="pill pill--bad">Question</span>}
        </span>
        <span className="group-card__meta">
          <AvatarStack
            members={summary.members.map((m) => ({ name: m.name, color: m.color % AVATAR_COLORS }))}
            max={3}
          />
          <span>
            {summary.memberCount} {summary.memberCount === 1 ? 'member' : 'members'}
            {summary.hasPendingPayment && !summary.hasOpenQuestion ? ' · payment pending' : ''}
          </span>
        </span>
      </span>
      <span className="group-card__net">
        <em>{net === null ? 'not synced' : net > 0 ? 'gets back' : net < 0 ? 'you owe' : 'settled'}</em>
        <strong className={net && net > 0 ? 'pos' : net && net < 0 ? 'neg' : 'muted'}>
          {net === null || net === 0 ? '—' : formatPaise(Math.abs(net))}
        </strong>
        <IconArrowRight size={16} className="group-card__chev" />
      </span>
    </button>
  )
}

function CreateGroupSheet({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (name: string, emoji: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🏖️')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return setError('Give the group a name.')
    setError('')
    setSaving(true)
    try {
      await onCreate(name.trim(), emoji)
      setName('')
      setEmoji('🏖️')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the group.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        onClose()
        setError('')
      }}
      title="New group"
      subtitle="You’ll get an invite link to send to the others."
    >
      <form onSubmit={submit} className="form">
        <label className="field">
          <span>Group name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Goa long weekend"
            autoFocus
            maxLength={60}
          />
        </label>

        <div className="field">
          <span>Icon</span>
          <div className="emoji-grid">
            {EMOJI_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                className={`emoji-choice${emoji === choice ? ' is-active' : ''}`}
                onClick={() => setEmoji(choice)}
                aria-label={`Choose ${choice}`}
              >
                {choice}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="form-error">{error}</p>}

        <button className="btn btn--primary btn--block" type="submit" disabled={saving}>
          {saving ? 'Creating…' : 'Create group'}
        </button>
      </form>
    </Sheet>
  )
}

function JoinGroupSheet({
  open,
  onClose,
  onJoin,
}: {
  open: boolean
  onClose: () => void
  onJoin: (code: string) => Promise<void>
}) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const clean = code.trim().toUpperCase()
    if (clean.length < 4) return setError('Invite codes are six characters, like 7KQ4M2.')
    setError('')
    setSaving(true)
    try {
      await onJoin(clean)
      setCode('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not join that group.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        onClose()
        setError('')
      }}
      title="Join a group"
      subtitle="Paste the code a friend sent you."
    >
      <form onSubmit={submit} className="form">
        <label className="field">
          <span>Invite code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="7KQ4M2"
            className="code-input"
            autoFocus
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={12}
          />
        </label>

        {error && <p className="form-error">{error}</p>}

        <button className="btn btn--primary btn--block" type="submit" disabled={saving}>
          {saving ? 'Joining…' : 'Join group'}
        </button>
        <p className="hint">Or just open the invite link — it fills this in for you.</p>
      </form>
    </Sheet>
  )
}

function IdentitySheet({
  open,
  onClose,
  initialName,
  initialUpi,
  phone,
  onSave,
  onSignOut,
}: {
  open: boolean
  onClose: () => void
  initialName: string
  initialUpi: string
  phone: string
  onSave: (name: string, upiId: string) => Promise<void>
  onSignOut: () => Promise<void>
}) {
  const [name, setName] = useState(initialName)
  const [upiId, setUpi] = useState(initialUpi)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [signature, setSignature] = useState(`${open}-${initialName}-${initialUpi}`)

  if (signature !== `${open}-${initialName}-${initialUpi}`) {
    setSignature(`${open}-${initialName}-${initialUpi}`)
    setName(initialName)
    setUpi(initialUpi)
    setError('')
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return setError('Your name is how friends see you.')
    if (upiId.trim() && !isValidUpi(upiId)) return setError('That UPI id does not look right.')
    setError('')
    setSaving(true)
    try {
      await onSave(name.trim(), upiId.trim())
    } catch {
      setError('Could not save your details.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Your details" subtitle="Friends see this in every group you’re in.">
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </label>
        <label className="field">
          <span>UPI id</span>
          <input
            value={upiId}
            onChange={(e) => setUpi(e.target.value)}
            placeholder="name@okhdfcbank"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={100}
          />
          <small>Others use this to pay you from the settle screen.</small>
        </label>

        {error && <p className="form-error">{error}</p>}

        <button className="btn btn--primary btn--block" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>

      {phone && (
        <div className="identity-account">
          <p className="hint">Signed in with +91 {phone}. Your groups follow this number.</p>
          <button className="btn btn--ghost btn--block" type="button" onClick={() => void onSignOut()}>
            Sign out of this number
          </button>
        </div>
      )}
    </Sheet>
  )
}
