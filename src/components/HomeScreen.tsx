import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, type GroupSummary } from '../lib/store'
import { formatPaise } from '../lib/money'
import { isValidUpi } from '../lib/upi'
import { Avatar, AvatarStack, Sheet } from './ui'
import { IconArrowRight, IconMic, IconPlus, IconShare, IconUsers } from './Icons'
import { parseVoiceCommand } from '../lib/ondevice-ai'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(HomeScreen as any).default = 'ic802344172_home_screen'

const EMOJI_CHOICES = ['🏖️', '🏠', '✈️', '🎉', '🍻', '🏏', '🎓', '🚀', '🎿', '🍕', '💼', '🌮']

type PendingAction = { action: string; confirm: () => void; cancel: () => void }

/** Turn a SpeechRecognition error code into something a person can act on. */
function messageForSpeechError(code?: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'The microphone is blocked for this site. Allow mic access in the address bar, or type the command below.'
    case 'audio-capture':
      return 'No microphone was found. Plug one in, or type the command below.'
    case 'network':
      return 'This browser needs a network connection for speech. Type the command below instead.'
    case 'no-speech':
      return 'I did not hear anything. Try again, or type the command below.'
    case 'language-not-supported':
      return 'This browser cannot recognise Indian English. Type the command below instead.'
    default:
      return `Voice input failed${code ? ` (${code})` : ''}. Type the command below instead.`
  }
}

export function HomeScreen({ onOpenGroup }: { onOpenGroup: (id: string) => void }) {
  const store = useStore()
  const { identity, summaries, createGroup, joinGroup, updateIdentity, signOut } = store
  const identityId = identity?.id ?? ''
  const identityName = identity?.name ?? ''
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const [editingIdentity, setEditingIdentity] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState('')
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const [voiceTranscript, setVoiceTranscript] = useState('')
  const [typed, setTyped] = useState('')
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const watchdogRef = useRef<number | null>(null)
  const recognitionRef = useRef<any>(null)

  const fetchSummaries = store.fetchGroupSummaries
  useEffect(() => {
    void fetchSummaries()
  }, [fetchSummaries])

  useEffect(() => {
    return () => {
      if (watchdogRef.current !== null) window.clearTimeout(watchdogRef.current)
      try {
        recognitionRef.current?.abort?.()
      } catch {
        /* already stopped */
      }
    }
  }, [])

  const cancelPending = () => {
    setPendingAction(null)
    setVoiceStatus('Cancelled.')
    setVoiceBusy(false)
  }

  /** One place that understands a command, whether it was spoken or typed. */
  const runTranscript = (transcript: string) => {
    const text = transcript.trim()
    if (!text) {
      setVoiceError('Type a command first, like “Dinner 1200 split between 5”.')
      return
    }
    setVoiceTranscript(text)

    const parsed = parseVoiceCommand(text, {
      myId: identityId,
      myName: identityName,
      groups: summaries.map((s) => ({ id: s.groupId, name: s.name })),
      members: summaries.find((s) => s.groupId === (summaries[0]?.groupId ?? ''))?.members.map((m) => ({
        id: m.id,
        name: m.name,
      })) ?? [],
      currentGroupId: summaries[0]?.groupId,
    })
    const command = parsed.command

    if (command?.type === 'create_group') {
      const { name, emoji } = command
      setPendingAction({
        action: `Create a group called “${name}”?`,
        confirm: async () => {
          setPendingAction(null)
          try {
            const id = await createGroup(name, emoji)
            setVoiceStatus(`Created “${name}” — share the invite so people can join.`)
            onOpenGroup(id)
          } catch (cause) {
            setVoiceError(cause instanceof Error ? cause.message : 'Could not create the group.')
          }
        },
        cancel: cancelPending,
      })
      return
    }

    if (command?.type === 'join_group') {
      const { code } = command
      setPendingAction({
        action: `Join the group with code ${code}?`,
        confirm: async () => {
          setPendingAction(null)
          try {
            const id = await joinGroup(code)
            setVoiceStatus('Joined — you’re in.')
            onOpenGroup(id)
          } catch (cause) {
            setVoiceError(cause instanceof Error ? cause.message : 'Could not join that group.')
          }
        },
        cancel: cancelPending,
      })
      return
    }

    if (command?.type === 'add_expense' && command.amountPaise >= 100) {
      const target = summaries[0] as GroupSummary | undefined
      if (!target) {
        setVoiceError('Create a group first, then I can add expenses to it.')
        return
      }
      const { description, amountPaise, splitMode, payerId, participantIds } = command
      const finalPayerId = target.members.some((m) => m.id === payerId) ? payerId : identityId
      setPendingAction({
        action: `Add “${description}” for ₹${(amountPaise / 100).toFixed(2)} to ${target.name}?`,
        confirm: async () => {
          setPendingAction(null)
          try {
            const ok = await store.addExpense(target.groupId, {
              description,
              amountPaise,
              date: Date.now(),
              category: 'other',
              payers: [{ memberId: finalPayerId, amountPaise }],
              split:
                command.splitMode === 'exact' || command.splitMode === 'percent'
                  ? { mode: command.splitMode, values: command.splitValues ?? {} }
                  : { mode: splitMode, participants: participantIds },
              notes: command.notes || undefined,
            })
            if (!ok) throw new Error('The expense was not saved.')
            await store.fetchGroupSummaries()
            setVoiceStatus(`Added “${description}” to ${target.name}.`)
          } catch (cause) {
            setVoiceError(cause instanceof Error ? cause.message : 'Could not add the expense.')
          }
        },
        cancel: cancelPending,
      })
      return
    }

    if (command?.type === 'delete_expense') {
      const active = store.active
      if (!active) {
        setVoiceError('Open the group first, then ask me to delete an expense.')
        return
      }
      const newest = [...active.expenses].sort((a, b) => b.date - a.date)[0]
      if (!newest) {
        setVoiceError('That group has no expenses yet.')
        return
      }
      setPendingAction({
        action: `Delete “${newest.description}” from ${active.group.name}? This cannot be undone.`,
        confirm: async () => {
          setPendingAction(null)
          try {
            const ok = await store.deleteExpense(active.group.id, newest.id)
            if (!ok) throw new Error('The expense was not deleted.')
            await store.fetchGroupSummaries()
            setVoiceStatus('Expense deleted.')
          } catch (cause) {
            setVoiceError(cause instanceof Error ? cause.message : 'Could not delete that expense.')
          }
        },
        cancel: cancelPending,
      })
      return
    }

    if (command?.type === 'record_settlement') {
      const { fromId, toId, amountPaise, method } = command
      const targetGroupId = command.groupId || store.active?.group.id || summaries[0]?.groupId
      if (!targetGroupId) {
        setVoiceError('Open a group first, then I can record a payment.')
        return
      }
      setPendingAction({
        action: `Record a ₹${(amountPaise / 100).toFixed(2)} ${method} payment?`,
        confirm: async () => {
          setPendingAction(null)
          try {
            const ok = await store.recordSettlement(targetGroupId, fromId, toId, amountPaise, method)
            if (!ok) throw new Error('The payment was not recorded.')
            await store.fetchGroupSummaries()
            setVoiceStatus(parsed.reply)
          } catch (cause) {
            setVoiceError(cause instanceof Error ? cause.message : 'Could not record the payment.')
          }
        },
        cancel: cancelPending,
      })
      return
    }

    setVoiceStatus(parsed.reply)
  }

  const clearWatchdog = () => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current)
      watchdogRef.current = null
    }
  }

  const startVoice = async () => {
    const SpeechRecognition: any =
      typeof window === 'undefined'
        ? null
        : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setVoiceError('This browser has no speech recognition. Type the command below instead.')
      return
    }

    // Check the permission before starting: some browsers never fire onerror
    // when the mic is blocked, which used to leave the button stuck forever.
    try {
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
      if (status.state === 'denied') {
        setVoiceError(messageForSpeechError('not-allowed'))
        return
      }
    } catch {
      // Permission query is not supported everywhere; carry on and let the
      // recognition error tell us what happened.
    }

    const recognition = new SpeechRecognition()
    recognitionRef.current = recognition
    recognition.lang = 'en-IN'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    setVoiceBusy(true)
    setVoiceError('')
    setVoiceStatus('')
    setVoiceTranscript('')

    recognition.onresult = (event: any) => {
      clearWatchdog()
      setVoiceBusy(false)
      const transcript = Array.from(event.results as ArrayLike<any>)
        .map((result: any) => result[0]?.transcript ?? '')
        .join(' ')
        .trim()
      runTranscript(transcript)
    }

    recognition.onerror = (event: any) => {
      clearWatchdog()
      setVoiceBusy(false)
      if (event?.error !== 'aborted') setVoiceError(messageForSpeechError(event?.error))
    }

    recognition.onend = () => {
      clearWatchdog()
      setVoiceBusy(false)
    }

    watchdogRef.current = window.setTimeout(() => {
      clearWatchdog()
      setVoiceBusy(false)
      setVoiceError('The microphone did not respond. Type the command below instead.')
      try {
        recognition.abort()
      } catch {
        /* already stopped */
      }
    }, 12000)

    try {
      recognition.start()
    } catch (cause) {
      clearWatchdog()
      setVoiceBusy(false)
      setVoiceError(cause instanceof Error ? messageForSpeechError(cause.message) : messageForSpeechError())
    }
  }

  const submitTyped = (event: React.FormEvent) => {
    event.preventDefault()
    const text = typed.trim()
    if (!text) return
    setTyped('')
    setVoiceStatus('')
    setVoiceError('')
    runTranscript(text)
  }

  const totals = useMemo(() => {
    let owed = 0
    let owedBy = 0
    let members = 0
    let pending = 0
    for (const s of summaries) {
      members += s.memberCount
      if (s.netPaise !== null) {
        if (s.netPaise > 0) owed += s.netPaise
        else owedBy -= s.netPaise
      }
      if (s.hasPendingPayment) pending++
    }
    return { owed, owedBy, net: owed - owedBy, groups: summaries.length, members, pending }
  }, [summaries])

  const feedback = voiceBusy ? 'Listening… say a command' : voiceStatus || voiceTranscript

  return (
    <div className="home">
      <header className="home__masthead">
        <div className="brand">
          <span className="brand__mark">₹</span>
          <div>
            <div className="brand__name">RupeeSplit</div>
            <div className="brand__tag">Split bills without the spreadsheet</div>
          </div>
        </div>
        {identity ? (
          <button className="identity" onClick={() => setEditingIdentity(true)} title="Edit your profile">
            <Avatar name={identity.name} color={0} size={30} />
            <span className="identity__text">
              <span className="identity__label">You</span>
              <span className="identity__name">{identity.name}</span>
            </span>
          </button>
        ) : (
          <button className="btn btn--primary" onClick={() => setEditingIdentity(true)}>
            Add your name
          </button>
        )}
      </header>

      {!identity ? (
        <div className="empty">
          <div className="empty__icon">
            <IconUsers size={26} />
          </div>
          <h3>Two things, then you’re in</h3>
          <p>
            Add your name and a UPI id. Then create a group for a trip, a dinner or a house — and
            invite the people who share it.
          </p>
          <button className="btn btn--primary" onClick={() => setEditingIdentity(true)}>
            Add your details
          </button>
          <p className="fineprint">
            No bank account, no UPI access, no money ever touches this app.
          </p>
        </div>
      ) : (
        <>
          <div className="summary-card">
            <div className="summary-card__row">
              <div>
                <div className="summary-card__label">
                  Net across {totals.groups} {totals.groups === 1 ? 'group' : 'groups'}
                </div>
                <div className="summary-card__value">{formatPaise(totals.net)}</div>
                <div className="summary-card__spark">
                  {totals.net > 0
                    ? 'You are owed more than you owe.'
                    : totals.net < 0
                      ? 'You owe more than you are owed.'
                      : 'Everything is square.'}
                </div>
              </div>
              <button className="text-btn" onClick={() => void startVoice()} disabled={voiceBusy}>
                <IconMic size={15} />
                {voiceBusy ? 'Listening…' : 'Speak'}
              </button>
            </div>
            <div className="summary-card__split">
              <span>
                <em>Owed to you</em>
                <strong className="pos">{formatPaise(totals.owed)}</strong>
              </span>
              <span className="summary-card__divider" />
              <span>
                <em>You owe</em>
                <strong className="neg">{formatPaise(totals.owedBy)}</strong>
              </span>
              <span className="summary-card__divider" />
              <span>
                <em>People</em>
                <strong>{totals.members}</strong>
              </span>
            </div>
          </div>

          <div className="voice-strip">
            <div className="voice-strip__icon">
              <IconMic size={16} />
            </div>
            <div>
              <strong>Tell it what happened</strong>
              <p>
                Speak or type: “Create a group called Goa trip”, “Dinner 1256 split between 5 of
                us”, “I got 500 from Priya”, “Delete the last expense”.
              </p>
              <form className="voice-form" onSubmit={submitTyped}>
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="Type a command…"
                  aria-label="Type a command"
                />
                <button className="btn btn--primary btn--tiny" type="submit" disabled={!typed.trim()}>
                  Run
                </button>
              </form>
            </div>
          </div>

          {feedback ? (
            <div
              className={`voice-feedback${voiceBusy ? ' voice-feedback--busy' : ''}`}
              role="status"
              aria-live="polite"
            >
              <span className="voice-feedback__dot" />
              <span className="voice-feedback__text">{feedback}</span>
              <button
                className="voice-feedback__close"
                onClick={() => {
                  setVoiceStatus('')
                  setVoiceTranscript('')
                  setVoiceError('')
                }}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          ) : null}

          {voiceError ? <p className="form-error">{voiceError}</p> : null}

          <div className="section-head">
            <h2>Your groups</h2>
            <div>
              <button className="text-btn text-btn--quiet" onClick={() => setJoining(true)}>
                <IconShare size={14} />
                Join with a code
              </button>
              <button className="text-btn" onClick={() => setCreating(true)}>
                <IconPlus size={14} />
                New group
              </button>
            </div>
          </div>

          {summaries.length === 0 ? (
            <div className="empty">
              <div className="empty__icon">
                <IconUsers size={26} />
              </div>
              <h3>No groups yet</h3>
              <p>
                A group is one trip, one dinner, one house — any shared set of expenses. Create one
                and share the invite link.
              </p>
              <button className="btn btn--primary" onClick={() => setCreating(true)}>
                Create a group
              </button>
              <button className="btn btn--ghost" onClick={() => setJoining(true)}>
                Join with a code
              </button>
            </div>
          ) : (
            <div className="group-list">
              {summaries.map((s) => {
                const net = s.netPaise
                return (
                  <button
                    key={s.groupId}
                    className="group-card"
                    onClick={() => onOpenGroup(s.groupId)}
                  >
                    <span className="group-card__emoji" aria-hidden>
                      {s.emoji}
                    </span>
                    <span className="group-card__main">
                      <span className="group-card__name">{s.name}</span>
                      <span className="group-card__meta">
                        <AvatarStack members={s.members} max={3} />
                        {s.memberCount} {s.memberCount === 1 ? 'person' : 'people'}
                        {s.hasOpenQuestion ? ' · question open' : ''}
                        {s.hasPendingPayment ? ' · payment pending' : ''}
                      </span>
                      {s.code ? (
                        <span className="group-card__meta">
                          <code>{s.code}</code>
                        </span>
                      ) : null}
                    </span>
                    {typeof net === 'number' && net !== 0 ? (
                      <span className="group-card__net">
                        <em>{net > 0 ? 'gets back' : 'you owe'}</em>
                        <strong className={net > 0 ? 'pos' : 'neg'}>
                          {formatPaise(Math.abs(net))}
                        </strong>
                        <span className="group-card__chev" aria-hidden>
                          <IconArrowRight size={16} />
                        </span>
                      </span>
                    ) : (
                      <span className="group-card__chev" aria-hidden>
                        <IconArrowRight size={16} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          <div className="home__footer">
            <span className="save-note">
              {totals.groups} {totals.groups === 1 ? 'group' : 'groups'} · {totals.members}{' '}
              {totals.members === 1 ? 'person' : 'people'}
              {totals.pending ? ` · ${totals.pending} pending` : ''}
            </span>
            <a
              className="govira-link"
              href="https://govira.tech"
              target="_blank"
              rel="noopener noreferrer"
            >
              Powered by Govira Technologies ↗
            </a>
          </div>
        </>
      )}

      {pendingAction ? (
        <div className="voice-confirm" role="alertdialog" aria-modal="true">
          <div className="voice-confirm__backdrop" onClick={pendingAction.cancel} />
          <div className="voice-confirm__card">
            <h3>Confirm action</h3>
            <p>{pendingAction.action}</p>
            <div className="voice-confirm__actions">
              <button className="btn btn--primary" onClick={pendingAction.confirm}>
                Confirm
              </button>
              <button className="btn btn--ghost" onClick={pendingAction.cancel}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {creating ? (
        <CreateGroupSheet
          open
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            onOpenGroup(id)
          }}
        />
      ) : null}

      {joining ? (
        <JoinGroupSheet
          open
          onClose={() => setJoining(false)}
          onJoined={(id) => {
            setJoining(false)
            onOpenGroup(id)
          }}
        />
      ) : null}

      {editingIdentity ? (
        <IdentitySheet
          open
          name={identity?.name ?? ''}
          upiId={identity?.upiId ?? ''}
          onClose={() => setEditingIdentity(false)}
          onSave={async (name, upiId) => {
            if (!identity) {
              store.start(name, upiId)
              return
            }
            await updateIdentity(name, upiId)
          }}
          onSignOut={() => {
            setEditingIdentity(false)
            if (identity) void signOut()
          }}
        />
      ) : null}
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
    <Sheet
      open={open}
      onClose={onClose}
      title="Create a group"
      subtitle="One group per trip, dinner, house, or project."
    >
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Group name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mumbai weekend, Rohan's birthday, House expenses…"
            autoFocus
          />
        </label>

        <label className="field">
          <span>Emoji</span>
          <div className="chip-row">
            {EMOJI_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                className={`chip${emoji === choice ? ' is-active' : ''}`}
                onClick={() => setEmoji(choice)}
              >
                {choice}
              </button>
            ))}
          </div>
        </label>

        {error ? <p className="form-error">{error}</p> : null}

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
    <Sheet
      open={open}
      onClose={onClose}
      title="Join a group"
      subtitle="Enter the invite code you were given."
    >
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

        {error ? <p className="form-error">{error}</p> : null}

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
    <Sheet
      open={open}
      onClose={onClose}
      title="Your profile"
      subtitle="This is how others see you in groups."
    >
      <form className="form" onSubmit={save}>
        <label className="field">
          <span>Your name</span>
          <input
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            placeholder="e.g. Arjun"
            autoFocus
          />
        </label>

        <label className="field">
          <span>UPI ID</span>
          <input
            value={editedUpi}
            onChange={(e) => setEditedUpi(e.target.value.toLowerCase())}
            placeholder="name@okhdfcbank"
          />
          <small>
            {validUpi
              ? 'Looks right — others will see this as a payment button.'
              : 'Optional. Must look like name@bank.'}
          </small>
        </label>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="field-row">
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
