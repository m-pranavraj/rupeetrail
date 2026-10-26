import React, { useCallback, useMemo, useState } from 'react'
import { useStore, type GroupSummary } from '../lib/store'
import { formatPaise } from '../lib/money'
import { isValidUpi } from '../lib/upi'
import { Avatar, AvatarStack, EmptyState, Sheet } from './ui'
import { IconArrowRight, IconPlus, IconShare, IconSpark, IconUsers, IconMic, IconMapPin } from './Icons'
import { parseVoiceCommand } from '../lib/ondevice-ai'
import { TextVoiceInput } from './TextVoiceInput'
import { MicButton } from './MicButton'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(HomeScreen as any).default = 'ic802344172_home_screen';

const EMOJI_CHOICES = ['🏖️', '🏠', '✈️', '🎉', '🍻', '🏏', '🎓', '🚗', '🎿', '🍕', '💼', '🌮']

const AVATAR_COLORS = 8

export function HomeScreen({ onOpenGroup }: { onOpenGroup: (id: string) => void }) {
  const { identity, summaries, createGroup, joinGroup, updateIdentity, signOut } = useStore()
  const identityId = identity?.id ?? ''
  const identityName = identity?.name ?? ''
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const [editingIdentity, setEditingIdentity] = useState(false)
  const [voiceCommand, setVoiceCommand] = useState('')
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const [voiceTranscript, setVoiceTranscript] = useState('')
  const [pendingVoiceAction, setPendingVoiceAction] = useState<{ action: string; confirm: () => void; cancel: () => void } | null>(null)

  const startVoice = useCallback(() => {
    if (typeof window === 'undefined') {
      setVoiceError('Voice input is not supported in this browser.')
      return
    }
    const rawCtor = ((window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ?? (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).webkitSpeechRecognition) as typeof globalThis.SpeechRecognition | undefined
    if (!rawCtor) {
      setVoiceError('Voice input is not supported in this browser.')
      return
    }
    const recognition = new rawCtor() as unknown as {
      lang: string
      continuous: boolean
      interimResults: boolean
      maxAlternatives: number
      start: () => void
      stop: () => void
      onresult: ((event: unknown) => void) | null
      onerror: ((event: unknown) => void) | null
      onend: (() => void) | null
    }
    recognition.lang = 'en-IN'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    setVoiceBusy(true)
    setVoiceError('')
    setVoiceTranscript('')
    recognition.onresult = (event: unknown) => {
      const e = event as unknown as { results: { 0: { 0: { transcript: string } } }[] }
      const transcript = Array.from(e.results)
        .map((result) => (result[0] as unknown as { transcript: string }).transcript)
        .join('')
      setVoiceTranscript(transcript)

      // Use the general-purpose AI command engine
      const ctx = {
        myId: identityId,
        myName: identityName,
        groups: summaries.map((s) => ({ id: s.groupId, name: s.name })),
        members: [],
        currentGroupId: undefined,
      }
      const parsed = parseVoiceCommand(transcript, ctx)

      if (parsed.command?.type === 'create_group') {
        setCreating(true)
        createGroup(parsed.command.name, parsed.command.emoji)
          .then(() => {
            setVoiceCommand(`Created “${parsed.command.name}” — share the invite link to add people.`)
            setVoiceBusy(false)
          })
          .catch((cause) => {
            setVoiceError(cause instanceof Error ? cause.message : 'Could not create group.')
            setVoiceBusy(false)
          })
      } else if (parsed.command?.type === 'join_group') {
        setJoining(true)
        joinGroup(parsed.command.code)
          .then(() => {
            setVoiceCommand(`Joined the group — you're in.`)
            setVoiceBusy(false)
          })
          .catch((cause) => {
            setVoiceError(cause instanceof Error ? cause.message : 'Could not join.')
            setVoiceBusy(false)
          })
      } else if (parsed.command?.type === 'add_expense' && parsed.command.amountPaise >= 100) {
        const confirmedDesc = parsed.command.description
        const confirmedAmount = parsed.command.amountPaise
        const confirmedSplitMode = parsed.command.splitMode
        const confirmedPayerId = parsed.command.payerId
        const confirmedParticipantIds = parsed.command.participantIds
        const confirmedSplitModeStr = confirmedSplitMode === 'equal' ? 'equally' : confirmedSplitMode === 'exact' ? 'by exact amounts' : 'by percentage'

        setPendingVoiceAction({
          action: `Add expense “${confirmedDesc}” for ₹${(confirmedAmount / 100).toFixed(2)} split ${confirmedSplitModeStr} among ${confirmedParticipantIds.length} person${confirmedParticipantIds.length === 1 ? '' : 's'}?`,          confirm: async () => {
                    setPendingVoiceAction(null)
                    setVoiceCommand('Adding expense now...')
                    try {
                      const store = useStore.getState()
                      const group = summaries.length > 0 ? summaries[0] : null
                      if (!group) throw new Error('No group open')
                      const payerId = confirmedPayerId || store.identity.id

                      // If the payer isn't a group member yet, add them on the fly so the
                      // balance actually moves against someone real.
                      let finalPayerId = payerId
                      if (group.members.every((m) => m.id !== payerId)) {              finalPayerId = await store.enrollAsMember(group.groupId, payerId, confirmedDesc)
                      }

                      await store.addExpense(group.groupId, {
                        description: confirmedDesc,
                        amountPaise: confirmedAmount,
                        date: Date.now(),
                        category: 'other',
                        payers: [{ memberId: finalPayerId, amountPaise: confirmedAmount }],
                        split: { mode: confirmedSplitMode, participants: confirmedParticipantIds },
                      })
                      setVoiceCommand(`Expense added — ₹${(confirmedAmount / 100).toFixed(2)} split among ${confirmedParticipantIds.length} people.`)
                    } catch (cause) {
                      setVoiceError(cause instanceof Error ? cause.message : 'Could not add expense.')
                    }

                    // Refetch group summaries right after so the home list and any voice
                    // confirmation reflect the newly-enrolled member immediately.
                    void store.fetchGroupSummaries()
            setVoiceBusy(false)
          },
          cancel: () => {
            setPendingVoiceAction(null)
            setVoiceCommand('Cancelled. Try a different command.')
            setVoiceBusy(false)
          },
        })
      } else if (parsed.command?.type === 'delete_expense') {
        const targetExpenseId = parsed.command.expenseId

        setPendingVoiceAction({
          action: `Delete the most recent expense? This cannot be undone.`,
          confirm: async () => {
            setPendingVoiceAction(null)
            setVoiceCommand('Deleting expense...')
            try {
              const store = useStore.getState()
              const theGroup = summaries[0] ?? null
              if (!theGroup) throw new Error('No group open')
              const expenses = store.expensesByGroup[theGroup.groupId] ?? []
              const sorted = [...expenses].sort((a, b) => b.date - a.date)
              const target = targetExpenseId === '__last__' ? sorted[0] : expenses.find((e) => e.id === targetExpenseId)
              if (!target) throw new Error('Expense not found')
              await store.deleteExpense(theGroup.groupId, target.id)
              setVoiceCommand('Expense deleted.')
            } catch (cause) {
              setVoiceError(cause instanceof Error ? cause.message : 'Could not delete expense.')
            }
            setVoiceBusy(false)
          },
          cancel: () => {
            setPendingVoiceAction(null)
            setVoiceCommand('Cancelled.')
            setVoiceBusy(false)
          },
        })
      } else if (parsed.command?.type === 'record_settlement') {
        const fromId = parsed.command.fromId
        const toId = parsed.command.toId
        const amountPaise = parsed.command.amountPaise
        const groupId = parsed.command.groupId
        const method = parsed.command.method

        setPendingVoiceAction({
          action: `Record ₹${(amountPaise / 100).toFixed(2)} ${fromId.startsWith('manual:') ? 'from someone' : ''} to you?`,
          confirm: async () => {
            setPendingVoiceAction(null)
            setVoiceCommand('Recording settlement...')
            try {
              const store = useStore.getState()
              await store.recordSettlement(
                groupId,
                fromId,
                toId,
                amountPaise,
                method,
              )
              // Refresh summaries so balances update immediately after settlement
              void store.fetchGroupSummaries()
              setVoiceCommand(parsed.reply)
            } catch (cause) {
              setVoiceError(cause instanceof Error ? cause.message : 'Could not record settlement.')
            }
            setVoiceBusy(false)
          },
          cancel: () => {
            setPendingVoiceAction(null)
            setVoiceCommand('Cancelled.')
            setVoiceBusy(false)
          },
        })
      } else if (parsed.ok) {
        setVoiceCommand(parsed.reply)
        setVoiceBusy(false)
      } else {
        setVoiceCommand(parsed.reply)
        setVoiceBusy(false)
      }
    }
    recognition.onerror = () => {
      setVoiceError('Could not listen. Try again.')
      setVoiceBusy(false)
    }
    recognition.onend = () => {
      setVoiceBusy(false)
    }
    recognition.start()
  }, [identityId, identityName, summaries, createGroup, joinGroup])

  const totals = useMemo(() => {
    let owed = 0
    let owedBy = 0
    let groups = 0
    let members = 0
    let pending = 0
    for (const s of summaries) {
      groups++
      members += s.memberCount
      if (s.netPaise !== null) {
        if (s.netPaise > 0) owed += s.netPaise
        else owedBy -= s.netPaise
      }
      if (s.hasPendingPayment) pending++
    }
    return { owed, owedBy, groups, members, pending }
  }, [summaries])

  const codeCell = (s: GroupSummary) => {
    const cut = (phone: string) => {
      const digits = phone.replace(/\D/g, '').slice(-10)
      if (digits.length < 4) return phone
      return `${digits.slice(0, 4)} **${digits.slice(-2)}`
    }
    return (
      <span className="home__code">
        <IconShare size={13} />
        <code>{s.code}</code>
      </span>
    )
  }

  return (
    <div className="home">
      <header className="home__bar">
        <div className="home__brand">
          <span className="home__brand-mark">₹</span>
          <span className="home__brand-name">RupeeSplit</span>
        </div>
        <nav className="home__nav">
          {identity && (
            <button className="avatar" title={identity.name} onClick={() => setEditingIdentity(true)}>
              <Avatar name={identity.name} color={0} size={34} />
            </button>
          )}
        </nav>
      </header>

      <div className="home__voice-banner">
        <span>🎙️</span>
        <div>
          <strong>Control the app with your voice</strong>
          <p>
            Say things like “Create a group called Goa trip”, “Dinner 1256 split between 5 of us”, “I got 500 rupees
            from Priya”, “AI split this bill”, “Show me balances”, or “Delete the last expense”.
            The AI understands natural language and can smart-split bills, record payments, and manage everything by voice.
          </p>
        </div>
      </div>

      {voiceCommand && (
        <div className={`voice-feedback ${voiceBusy ? ' voice-feedback--busy' : ''}`} role="status" aria-live="polite">
          {voiceBusy ? (
            <>
              <span className="voice-feedback__dot" />
              Listening…
            </>
          ) : (
            <>
              <span className="voice-feedback__dot" />
              <span className="voice-feedback__transcript">“{voiceTranscript}”</span>
            </>
          )}
          <button className="voice-feedback__close" onClick={() => setVoiceCommand('')} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {pendingVoiceAction && (
        <div className="voice-confirm" role="alertdialog" aria-modal="true">
          <div className="voice-confirm__backdrop" onClick={pendingVoiceAction.cancel} />
          <div className="voice-confirm__card">
            <h3>Confirm action</h3>
            <p>{pendingVoiceAction.action}</p>
            <div className="voice-confirm__actions">
              <button className="btn btn--primary" onClick={pendingVoiceAction.confirm}>
                Confirm
              </button>
              <button className="btn btn--ghost" onClick={pendingVoiceAction.cancel}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}        {!identity ? (
        <section className="hero">
          <div className="hero__text">
            <h1>Split bills without the spreadsheet.</h1>
            <p>
              Track who paid for what, see who owes what, and settle up in the fewest possible transfers.
              Everything you add is explained in plain language — and you can do it all by voice.
            </p>
            <div className="hero__row">
              <button className="btn btn--primary btn--lg" onClick={() => setEditingIdentity(true)}>
                Add your name to get started
              </button>
              <a className="btn btn--ghost btn--lg" href="https://govira.tech" target="_blank" rel="noopener noreferrer">
                Powered by Govira Technologies
              </a>
            </div>
            <p className="tiny-muted">No bank account, no UPI access, no money ever touches this app.</p>
          </div>
          <div className="hero__art" aria-hidden>
            <svg viewBox="0 0 240 160" className="hero__illustration">
              <rect x="20" y="40" width="82" height="100" rx="6" fill="var(--color-surface)" stroke="var(--color-line)" />
              <rect x="30" y="52" width="62" height="8" rx="2" fill="var(--color-muted)" />
              <rect x="30" y="66" width="48" height="6" rx="2" fill="var(--color-muted)" />
              <rect x="30" y="78" width="56" height="6" rx="2" fill="var(--color-muted)" />
              <rect x="30" y="90" width="30" height="6" rx="2" fill="var(--color-muted)" />
              <rect x="138" y="40" width="82" height="100" rx="6" fill="var(--color-surface)" stroke="var(--color-line)" />
              <rect x="148" y="52" width="62" height="8" rx="2" fill="var(--color-muted)" />
              <rect x="148" y="66" width="48" height="6" rx="2" fill="var(--color-muted)" />
              <rect x="148" y="78" width="56" height="6" rx="2" fill="var(--color-muted)" />
              <rect x="148" y="90" width="30" height="6" rx="2" fill="var(--color-muted)" />
              <circle cx="60" cy="128" r="10" fill="var(--color-surface)" stroke="var(--color-line)" />
              <circle cx="180" cy="128" r="10" fill="var(--color-surface)" stroke="var(--color-line)" />
              <path d="M68 128 H172" stroke="var(--color-line)" strokeLinecap="round" />
            </svg>
          </div>
        </section>
      ) : summaries.length === 0 ? (
        <section className="home__empty">
          <AvatarStack members={[]} size={64} />
          <h2>No groups yet</h2>
          <p>
            Create one from the voice button above, or tap the button below and share the invite link so others can
            join.
          </p>
          <div className="home__empty-actions">
            <button className="btn btn--primary btn--block" onClick={startVoice}>
              <IconMic size={18} />
              Start a group with your voice
            </button>
            <button className="btn btn--ghost btn--block" onClick={() => setCreating(true)}>
              <IconPlus size={18} />
              Create a group manually
            </button>
          </div>
          <p className="tiny-muted">A group is one trip, one dinner, one house — any shared set of expenses.</p>
        </section>
      ) : (
        <section className="groups">
          <div className="groups__head">
            <h2>Your groups</h2>
            <div className="groups__actions">
              <button className="btn btn--ghost" onClick={startVoice}>
                <IconMic size={16} />
                Voice command
              </button>
              <button className="btn btn--ghost" onClick={() => setCreating(true)}>
                <IconPlus size={16} />
                New group
              </button>
            </div>
          </div>

          <ul className="groups__list">
            {summaries.map((s) => (
              <li key={s.groupId} className="group-card">
                <button className="group-card__inner" onClick={() => onOpenGroup(s.groupId)}>                    <AvatarStack
                    members={s.members}
                    size={44}
                    max={4}
                    overflow={s.memberCount - 4}
                  />
                  <div className="group-card__info">
                    <div className="group-card__title">
                      <span className="group-card__emoji" aria-hidden>{s.emoji}</span>
                      <div>
                        <span className="group-card__name">{s.name}</span>
                        <span className="group-card__meta">
                          {s.memberCount} {s.memberCount === 1 ? 'person' : 'people'}
                          {s.hasOpenQuestion ? ' · question open' : ''}
                          {s.hasPendingPayment ? ' · payment pending' : ''}
                        </span>
                      </div>
                    </div>
                    {s.code && (
                      <span className="group-card__code">
                        <IconShare size={12} />
                        Code: <code>{s.code}</code>
                      </span>
                    )}
                  </div>
                  <div className="group-card__right">
                    {typeof s.netPaise === 'number' && s.netPaise !== 0 && (
                      <div className={`group-card__net ${s.netPaise > 0 ? 'group-card__net--positive' : 'group-card__net--negative'}`}>
                        <span className="group-card__net-label">
                          {s.netPaise > 0 ? 'You get' : 'You owe'}
                        </span>
                        <span className="group-card__net-amount">{formatPaise(s.netPaise)}</span>
                      </div>
                    )}
                    <span className="group-card__chevron" aria-hidden>
                      <IconArrowRight size={18} />
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          <div className="groups__footer">
            <p className="tiny-muted">
              {totals.groups} {totals.groups === 1 ? 'group' : 'groups'} · {totals.members} {totals.members === 1 ? 'person' : 'people'}
              {totals.owed ? ` · you're owed ${formatPaise(totals.owed)}` : ''}
              {totals.owedBy ? ` · you owe ${formatPaise(totals.owedBy)}` : ''}
              {totals.pending ? ` · ${totals.pending} pending` : ''}
            </p>
          </div>
        </section>
      )}

      {creating && (
        <CreateGroupSheet
          open
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            onOpenGroup(id)
          }}
        />
      )}

      {joining && (
        <JoinGroupSheet
          open
          onClose={() => setJoining(false)}
          onJoined={(id) => {
            setJoining(false)
            onOpenGroup(id)
          }}
        />
      )}

      {editingIdentity && (
        <IdentitySheet
          open
          name={identity.name}
          upiId={identity.upiId}
          onClose={() => setEditingIdentity(false)}
          onSave={updateIdentity}
          onSignOut={() => {
            setEditingIdentity(false)
            signOut()
          }}
        />
      )}
    </div>
  )
}

function CreateGroupSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState(EMOJI_CHOICES[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { createGroup, identity } = useStore()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!identity) return setError('Add your name first.')
    if (!name.trim()) return setError('Give the group a name.')
    setBusy(true)
    setError('')
    try {
      const id = await createGroup(name.trim(), emoji)
      onCreated(id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the group.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Create a group" subtitle="One group per trip, dinner, house, or project.">
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Group name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mumbai weekend, Rohan’s birthday, House expenses…"
            autoFocus
          />
        </label>

        <label className="field">
          <span>Emoji</span>
          <div className="chip-row">
            {EMOJI_CHOICES.map((e) => (
              <button
                key={e}
                type="button"
                className={`chip${emoji === e ? ' is-active' : ''}`}
                onClick={() => setEmoji(e)}
              >
                {e}
              </button>
            ))}
          </div>
        </label>

        {error && <p className="form-error">{error}</p>}

        <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create group'}
        </button>
      </form>
    </Sheet>
  )
}

function JoinGroupSheet({
  open,
  onClose,
  onJoined,
}: {
  open: boolean
  onClose: () => void
  onJoined: (id: string) => void
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { joinGroup, identity } = useStore()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!identity) return setError('Add your name first.')
    if (!code.trim()) return setError('Paste the invite code.')
    setBusy(true)
    setError('')
    try {
      const id = await joinGroup(code.trim().toUpperCase())
      onJoined(id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not join that group.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Join a group" subtitle="Enter the invite code you were given.">
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Invite code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. AB73K9"
            autoFocus
            className="code-input"
          />
        </label>

        {error && <p className="form-error">{error}</p>}

        <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
          {busy ? 'Joining…' : 'Join group'}
        </button>
      </form>
    </Sheet>
  )
}

function IdentitySheet({
  open,
  name,
  upiId,
  onClose,
  onSave,
  onSignOut,
}: {
  open: boolean
  name: string
  upiId: string
  onClose: () => void
  onSave: (name: string, upiId: string) => Promise<void>
  onSignOut: () => void
}) {
  const [editedName, setEditedName] = useState(name)
  const [editedUpi, setEditedUpi] = useState(upiId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const validUpi = isValidUpi(editedUpi)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editedName.trim()) return setError('Your name is required.')
    setBusy(true)
    setError('')
    try {
      await onSave(editedName.trim(), editedUpi.trim())
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Your profile" subtitle="This is how others see you in groups.">
      <form className="form" onSubmit={save}>
        <label className="field">
          <span>Your name</span>
          <input value={editedName} onChange={(e) => setEditedName(e.target.value)} autoFocus />
        </label>

        <label className="field">
          <span>
            UPI ID
            <span className="field__hint">
              {validUpi
                ? ' Looks right — others will see this as a payment button.'
                : ' Optional. Must look like name@bank.'}
            </span>
          </span>
          <input
            value={editedUpi}
            onChange={(e) => setEditedUpi(e.target.value.toLowerCase())}
            placeholder="yourname@okhdfc"
          />
        </label>

        {error && <p className="form-error">{error}</p>}

        <div className="form__row">
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button className="btn btn--ghost" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </form>
    </Sheet>
  )
}
