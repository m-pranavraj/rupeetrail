import React, { useMemo, useState } from 'react'
import type { Expense, Group, MemberId, Settlement, SettlementStatus, Transfer } from '../types'
import { computeBalances } from '../lib/balances'
import { formatPaise, parseRupees } from '../lib/money'
import { planSettlements } from '../lib/settlement'
import { useStore } from '../lib/store'
import { upiPayLink } from '../lib/upi'
import { Avatar, Sheet, StatusPill } from './ui'
import { IconArrowRight, IconCheck, IconClock, IconSpark } from './Icons'

const STATUS_META: Record<SettlementStatus, { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  pending: { label: 'Awaiting confirmation', tone: 'muted' },
  payer_confirmed: { label: 'Payer says paid', tone: 'warn' },
  receiver_confirmed: { label: 'Receiver says received', tone: 'warn' },
  confirmed: { label: 'Confirmed by both', tone: 'ok' },
  disputed: { label: 'Disputed', tone: 'bad' },
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 40)
}

export function SettleTab({
  group,
  expenses,
  settlements,
  currentMemberId,
}: {
  group: Group
  expenses: Expense[]
  settlements: Settlement[]
  currentMemberId?: MemberId
}) {
  const { recordSettlement, advanceSettlement } = useStore()
  const [paying, setPaying] = useState<{ from: string; to: string; amount?: number; manualFromName?: string; manualToName?: string } | null>(null)

  type PayingState = typeof paying

  const balances = useMemo(
    () => computeBalances({ group, expenses, settlements }),
    [group, expenses, settlements],
  )
  const plan = useMemo(() => planSettlements(balances), [balances])

  const name = (id: string) => {
    if (id.startsWith('manual:')) {
      const parts = id.split(':')
      return parts.length >= 3
        ? parts[2].replace(/-/g, ' ')
        : parts[1]?.replace(/-/g, ' ') || 'Someone'
    }
    return group.members.find((m) => m.id === id)?.name ?? 'Member'
  }
  const member = (id: string) => group.members.find((m) => m.id === id)
  const activeSettlements = [...settlements].sort((a, b) => b.updatedAt - a.updatedAt)
  const closed = group.status === 'closed'

  return (
    <div className="settle-tab">
      <section className="plan-card">
        <div className="plan-card__head">
          <h3>
            <IconSpark size={17} /> Suggested plan
          </h3>
          {plan.transfers.length > 0 && (
            <StatusPill tone="ok">
              <IconCheck size={12} /> {plan.minimal ? 'minimum transfers' : 'workable'}
            </StatusPill>
          )}
        </div>

        {plan.transfers.length === 0 ? (
          <div className="plan-empty">
            <IconCheck size={26} />
            <p>Everyone is square. Nothing needs to move.</p>
          </div>
        ) : (
          <>
            <ul className="transfer-list">
              {plan.transfers.map((t, i) => (
                <li key={`${t.from}-${t.to}-${i}`}>
                  <div className="transfer">
                    <span className="transfer__person">
                      <Avatar name={name(t.from)} color={member(t.from)?.color ?? 0} size={28} />
                      <span>{name(t.from)}</span>
                    </span>
                    <IconArrowRight size={16} />
                    <span className="transfer__person">
                      <Avatar name={name(t.to)} color={member(t.to)?.color ?? 0} size={28} />
                      <span>{name(t.to)}</span>
                    </span>
                    <strong className="transfer__amount">{formatPaise(t.amountPaise)}</strong>
                  </div>
                  <div className="transfer__actions">
                    <button
                      className="btn btn--tiny"
                      disabled={closed}
                      onClick={() => setPaying({ from: t.from, to: t.to, amount: t.amountPaise })}
                    >
                      Record payment
                    </button>
                    {member(t.to)?.upiId && (
                      <a
                        className="btn btn--tiny btn--soft"
                        href={upiPayLink({
                          upiId: member(t.to)!.upiId!,
                          payeeName: name(t.to),
                          amountPaise: t.amountPaise,
                          note: `${group.name} settlement`,
                        })}
                      >
                        Pay {name(t.to)} by UPI
                      </a>
                    )}
                  </div>
                  {member(t.to)?.upiId && (
                    <p className="transfer__upi">
                      UPI · <code>{member(t.to)!.upiId}</code>
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <ul className="plan-notes">
              {plan.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </>
        )}

        <p className="fineprint">
          These moves are calculated from confirmed balances. RupeeSplit never touches the money — record what
          actually moved.
        </p>
      </section>

      <div className="section-head section-head--tight">
        <h2>Payment history</h2>
        <button className="text-btn" onClick={() => setPaying({ from: currentMemberId ?? '', to: '', manualFromName: '', manualToName: '' })} disabled={closed}>
          Record manually
        </button>
      </div>

      {activeSettlements.length === 0 ? (
        <p className="hint">No payments recorded in this group yet.</p>
      ) : (
        <ul className="settlement-list">
          {activeSettlements.map((s) => {
            const meta = STATUS_META[s.status]
            const iAmPayer = currentMemberId === s.from
            const iAmReceiver = currentMemberId === s.to
            return (
              <li key={s.id} className="settlement-item">
                <div className="settlement-item__line">
                  <span className="settlement-item__people">
                    {name(s.from)} <IconArrowRight size={13} /> {name(s.to)}
                  </span>
                  <strong>{formatPaise(s.amountPaise)}</strong>
                </div>
                <div className="settlement-item__meta">
                  <StatusPill tone={meta.tone}>
                    {s.status === 'confirmed' ? <IconCheck size={12} /> : <IconClock size={12} />}
                    {meta.label}
                  </StatusPill>
                  <span className="muted-small">
                    {s.method.toUpperCase()} · {new Date(s.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
                {s.note && <p className="settlement-item__note">{s.note}</p>}

                {(iAmPayer || iAmReceiver) && s.status !== 'confirmed' && s.status !== 'disputed' && (
                  <div className="settlement-item__actions">
                    {iAmPayer && !s.payerConfirmedAt && (
                      <button
                        className="btn btn--tiny btn--soft"
                        onClick={() => advanceSettlement(s.id, s.from, 'payer_confirmed')}
                      >
                        I've paid
                      </button>
                    )}
                    {iAmReceiver && !s.receiverConfirmedAt && (
                      <button
                        className="btn btn--tiny btn--soft"
                        onClick={() => advanceSettlement(s.id, s.to, 'receiver_confirmed')}
                      >
                        I received it
                      </button>
                    )}
                    <button
                      className="btn btn--tiny btn--ghost"
                      onClick={() => advanceSettlement(s.id, currentMemberId ?? 'manual:payer', 'disputed')}
                    >
                      Something's off
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <RecordPaymentSheet
        open={!!paying}
        group={group}
        initial={paying}
        onClose={() => setPaying(null)}
        onSave={async (from: string, to: string, amountPaise: number, method: Settlement['method'], note?: string) => {
          const ok = await recordSettlement(group.id, from, to, amountPaise, method, note)
          if (ok) setPaying(null)
        }}
      />
    </div>
  )
}

function RecordPaymentSheet({
  open,
  group,
  initial,
  onClose,
  onSave,
}: {
  open: boolean
  group: Group
  initial: ({ from: string; to: string; amount?: number; manualFromName?: string; manualToName?: string }) | null
  onClose: () => void
  onSave: (
    from: string,
    to: string,
    amountPaise: number,
    method: Settlement['method'],
    note?: string,
  ) => Promise<void>
}) {
  const active = group.members.filter((m) => !m.leftAt)
  const [from, setFrom] = useState(initial?.from ?? active[0]?.id ?? '')
  const [to, setTo] = useState(initial?.to ?? '')
  const [amount, setAmount] = useState(initial?.amount ? String(initial.amount / 100) : '')
  const [method, setMethod] = useState<Settlement['method']>('upi')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [manualFromName, setManualFromName] = useState('')
  const [manualToName, setManualToName] = useState('')

  // Reset local state whenever a fresh sheet opens with new prefill data.
  const signature = `${open}-${initial?.from}-${initial?.to}-${initial?.amount}-${initial?.manualFromName ?? ''}-${initial?.manualToName ?? ''}`
  const [lastSignature, setLastSignature] = useState(signature)
  if (signature !== lastSignature) {
    setLastSignature(signature)
    setFrom(initial?.from ?? active[0]?.id ?? '')
    setTo(initial?.to ?? '')
    setAmount(initial?.amount ? String(initial.amount / 100) : '')
    setError('')
    setNote('')
    setMethod('upi')
    setManualFromName((initial as unknown as { manualFromName?: string }).manualFromName ?? '')
    setManualToName((initial as unknown as { manualToName?: string }).manualToName ?? '')
  }

  const fromManual = from === 'manual'
  const toManual = to === 'manual'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const paise = parseRupees(amount)
    if (fromManual && !manualFromName.trim()) return setError('Enter the name of the person who paid.')
    if (toManual && !manualToName.trim()) return setError('Enter the name of the person who received.')
    const resolvedFrom = fromManual ? `manual:from:${slugify(manualFromName.trim())}` : from
    const resolvedTo = toManual ? `manual:to:${slugify(manualToName.trim())}` : to
    if (resolvedFrom === resolvedTo) return setError('Payer and receiver must be different people.')
    if (paise === null || paise <= 0) return setError('Enter an amount greater than zero.')
    await onSave(resolvedFrom, resolvedTo, paise, method, note)
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Record a payment"
      subtitle="You can record a payment even if the person is not in the group yet — just type their name."
    >
      <form className="form" onSubmit={submit}>
        <div className="field-row">
          <label className="field">
            <span>From (payer)</span>
            <select value={from} onChange={(e) => { setFrom(e.target.value); setManualFromName('') }}>
              <option value="">Select who paid</option>
              {active.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              <option value="manual">Someone not in the group...</option>
            </select>
          </label>
          {fromManual && (
            <label className="field">
              <span>Name of person who paid</span>
              <input
                value={manualFromName}
                onChange={(e) => setManualFromName(e.target.value)}
                placeholder="e.g. Priya Sharma"
                autoFocus
              />
            </label>
          )}
        </div>

        <div className="field-row">
          <label className="field">
            <span>To (receiver)</span>
            <select value={to} onChange={(e) => { setTo(e.target.value); setManualToName('') }}>
              <option value="">Select who received</option>
              {active.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              <option value="manual">Someone not in the group...</option>
            </select>
          </label>
          {toManual && (
            <label className="field">
              <span>Name of person who received</span>
              <input
                value={manualToName}
                onChange={(e) => setManualToName(e.target.value)}
                placeholder="e.g. Rahul Kumar"
                autoFocus
              />
            </label>
          )}
        </div>

        <label className="field field--amount">
          <span>Amount</span>
          <div className="amount-input amount-input--small">
            <span className="amount-input__symbol">₹</span>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </div>
        </label>

        <div className="field">
          <span>How was it paid?</span>
          <div className="chip-row">
            {(['upi', 'cash', 'bank', 'other'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`chip${method === m ? ' is-active' : ''}`}
                onClick={() => setMethod(m)}
              >
                {m === 'upi' ? 'UPI' : m === 'bank' ? 'Bank transfer' : m === 'cash' ? 'Cash' : 'Other'}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>Note (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder='UPI ref, "paid in cash", etc.' />
        </label>

        {error && <p className="form-error">{error}</p>}

        <button className="btn btn--primary btn--block" type="submit">
          Record payment
        </button>
      </form>
    </Sheet>
  )
}
