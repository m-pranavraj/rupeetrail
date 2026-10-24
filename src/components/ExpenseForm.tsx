import React, { useMemo, useState, useCallback } from 'react'
import type { Expense, ExpenseCategory, Group, MemberId, Split, SplitMode } from '../types'
import { allocateSplit, SplitError } from '../lib/splits'
import { formatPaise, paiseToInput, parseRupees } from '../lib/money'
import { Avatar, Segmented } from './ui'
import { IconCheck } from './Icons'
import type { NewExpenseInput } from '../lib/store'
import { BillCapture } from './BillCapture'

const CATEGORIES: { value: ExpenseCategory; label: string; emoji: string }[] = [
  { value: 'food', label: 'Food', emoji: '🍽️' },
  { value: 'travel', label: 'Travel', emoji: '🚕' },
  { value: 'stay', label: 'Stay', emoji: '🛏️' },
  { value: 'groceries', label: 'Groceries', emoji: '🛒' },
  { value: 'entertainment', label: 'Fun', emoji: '🎟️' },
  { value: 'utilities', label: 'Bills', emoji: '💡' },
  { value: 'shopping', label: 'Shopping', emoji: '🛍️' },
  { value: 'other', label: 'Other', emoji: '📦' },
]

const MODES: { value: SplitMode; label: string }[] = [
  { value: 'equal', label: 'Equally' },
  { value: 'exact', label: 'Exact ₹' },
  { value: 'percent', label: '%' },
  { value: 'shares', label: 'Shares' },
]

function todayInput(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dateInput(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function noonOf(value: string): number {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0).getTime()
}

export function ExpenseForm({
  group,
  currentMemberId,
  expense,
  onSave,
  onCancel,
}: {
  group: Group
  currentMemberId: MemberId | undefined
  expense?: Expense
  onSave: (input: NewExpenseInput) => void | Promise<void>
  onCancel: () => void
}) {
  const activeMembers = group.members.filter((m) => !m.leftAt)
  const defaultPayer = currentMemberId && activeMembers.some((m) => m.id === currentMemberId)
    ? currentMemberId
    : activeMembers[0]?.id ?? ''

  const [description, setDescription] = useState(expense?.description ?? '')
  const [amountInput, setAmountInput] = useState(expense ? paiseToInput(expense.amountPaise) : '')
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? 'food')
  const [dateValue, setDateValue] = useState(dateInput(expense?.date ?? Date.now()))
  const [notes, setNotes] = useState(expense?.notes ?? '')

  const [payerIds, setPayerIds] = useState<string[]>(
    expense ? expense.payers.map((p) => p.memberId) : defaultPayer ? [defaultPayer] : [],
  )
  const [payerAmounts, setPayerAmounts] = useState<Record<string, string>>(() => {
    if (expense) {
      return Object.fromEntries(expense.payers.map((p) => [p.memberId, paiseToInput(p.amountPaise)]))
    }
    return {}
  })

  const [mode, setMode] = useState<SplitMode>(expense?.split.mode ?? 'equal')
  const [participants, setParticipants] = useState<string[]>(() => {
    if (!expense) return activeMembers.map((m) => m.id)
    if (expense.split.mode === 'equal') return expense.split.participants ?? []
    return Object.keys(expense.split.values ?? {}).filter((id) => (expense.split.values?.[id] ?? 0) > 0)
  })
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    if (expense && expense.split.mode !== 'equal') {
      for (const [id, v] of Object.entries(expense.split.values ?? {})) init[id] = String(v)
    }
    return init
  })

  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [isCapturingBill, setIsCapturingBill] = useState(false)
  const [billCaptureResult, setBillCaptureResult] = useState<Partial<Expense> | null>(null)
  const totalPaise = parseRupees(amountInput)

  /** Keep single-payer amount in sync with the total. */
  const effectivePayerAmounts = useMemo(() => {
    if (payerIds.length === 1 && totalPaise !== null) {
      return { ...payerAmounts, [payerIds[0]]: paiseToInput(totalPaise) }
    }
    return payerAmounts
  }, [payerIds, payerAmounts, totalPaise])

  const payerTotal = payerIds.reduce((sum, id) => {
    const p = parseRupees(effectivePayerAmounts[id] ?? '0')
    return sum + (p ?? 0)
  }, 0)
  const unassigned = totalPaise === null ? null : totalPaise - payerTotal

  const togglePayer = (id: string) => {
    setPayerIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev // always keep one payer
        return prev.filter((x) => x !== id)
      }
      return [...prev, id]
    })
  }

  const toggleParticipant = (id: string) => {
    setParticipants((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  /** Seed sensible values when switching split modes. */
  const switchMode = (next: SplitMode) => {
    if (next === mode) return
    const ids = participants.length ? participants : activeMembers.map((m) => m.id)
    const amount = totalPaise ?? 0
    const nextValues: Record<string, string> = {}
    if (next === 'exact' && amount > 0) {
      try {
        const alloc = allocateSplit(amount, { mode: 'equal', participants: ids })
        for (const a of alloc) nextValues[a.memberId] = paiseToInput(a.amountPaise)
      } catch {
        for (const id of ids) nextValues[id] = '0'
      }
    } else if (next === 'percent') {
      for (const id of ids) nextValues[id] = String(Math.floor(10000 / ids.length) / 100)
    } else if (next === 'shares') {
      for (const id of ids) nextValues[id] = '1'
    }
    setValues(nextValues)
    setMode(next)
    setError('')
  }

  /** Build the Split object for the current form state. */
  const buildSplit = (): Split => {
    if (mode === 'equal') return { mode, participants }
    const parsed: Record<string, number> = {}
    for (const id of participants) {
      const raw = values[id] ?? ''
      if (mode === 'exact') {
        const p = parseRupees(raw)
        parsed[id] = p ?? 0
      } else {
        const n = Number(raw)
        parsed[id] = Number.isFinite(n) && n > 0 ? n : 0
      }
    }
    return { mode, values: parsed }
  }

  const preview = useMemo(() => {
    if (!totalPaise || totalPaise <= 0 || participants.length === 0) return null
    try {
      return allocateSplit(totalPaise, buildSplit())
    } catch {
      return null
    }
  }, [totalPaise, mode, participants, values]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    setError('')
    if (!description.trim()) return setError('What was this expense for?')
    if (totalPaise === null || totalPaise <= 0) return setError('Enter an amount greater than zero.')
    if (payerIds.length === 0) return setError('Choose who paid.')
    if (unassigned !== 0) {
      return setError(
        unassigned !== null && unassigned > 0
          ? `Assign the remaining ${formatPaise(unassigned)} to a payer.`
          : `Payer amounts exceed the total by ${formatPaise(Math.abs(unassigned ?? 0))}.`,
      )
    }
    if (participants.length === 0) return setError('Choose at least one person to share this.')

    const split = buildSplit()
    try {
      allocateSplit(totalPaise, split)
    } catch (err) {
      return setError(err instanceof SplitError ? err.message : 'Check the split values.')
    }

    const payers = payerIds.map((id) => ({
      memberId: id,
      amountPaise: parseRupees(effectivePayerAmounts[id] ?? '0') ?? 0,
    }))

    setSaving(true)
    try {
      await onSave({
        description: description.trim(),
        amountPaise: totalPaise,
        date: noonOf(dateValue),
        category,
        payers,
        split,
        notes,
      })
    } finally {
      setSaving(false)
    }
  }

  /** Handle bill capture result — pre-fill form fields. */
  const handleBillCaptureResult = useCallback((extracted: Partial<Expense>) => {
    setBillCaptureResult(extracted)
    const amount = extracted.amountPaise
    const payers = extracted.payers
    const split = extracted.split

    // Pre-fill: description, amount, category, and the payer/split when present.
    if (extracted.description) setDescription(extracted.description)
    if (amount !== undefined && amount > 0) setAmountInput(paiseToInput(amount))
    if (extracted.category) setCategory(extracted.category)

    if (payers && payers.length > 0) {
      setPayerIds(payers.map((p) => p.memberId))
      if (amount !== undefined) {
        const firstPayer = payers[0]
        setPayerAmounts((prev) => ({ ...prev, [firstPayer.memberId]: paiseToInput(amount) }))
      }
    }

    if (split) {
      setMode(split.mode ?? 'equal')
      if (split.mode === 'equal') {
        setParticipants(split.participants ?? activeMembers.map((m) => m.id))
      } else if (split.mode === 'exact') {
        const values = split.values ?? {}
        const ids = Object.keys(values).filter((id) => activeMembers.some((m) => m.id === id))
        setParticipants(ids)
        setValues(Object.fromEntries(ids.map((id) => [id, String(values[id] ?? 0)])))
      }
    }
  }, [activeMembers])

  /** Reset the bill-capture banner state. */
  const resetBillCapture = useCallback(() => {
    setBillCaptureResult(null)
    setDescription(description) // revert to prior description
    setAmountInput(amountInput) // revert to prior amount
    setCategory(category) // revert to prior category
    setPayerIds(defaultPayer ? [defaultPayer] : [])
    setPayerAmounts(defaultPayer ? { [defaultPayer]: paiseToInput(totalPaise ?? 0) } : {})
    setMode('equal')
    setParticipants(activeMembers.map((m) => m.id))
    setValues({})
  }, [description, amountInput, category, defaultPayer])

  return (
    <form className="form expense-form" onSubmit={submit}>
      <label className="field field--amount">
        <span>Amount</span>
        <div className="amount-input">
          <span className="amount-input__symbol">₹</span>
          <input
            inputMode="decimal"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            placeholder="0"
            autoFocus={!expense}
            aria-label="Amount in rupees"
          />
          <button
            type="button"
            className="bill-capture-trigger"
            onClick={() => setIsCapturingBill(true)}
            aria-label="Capture bill with photo or voice"
            style={{ marginLeft: '8px', height: '32', fontSize: '12px' }}
          >
            Capture Bill
          </button>
        </div>
      </label>

      <BillCapture
        open={isCapturingBill}
        onClose={() => {
          setIsCapturingBill(false)
          resetBillCapture()
        }}
        groupMembers={activeMembers}
        meMemberId={defaultPayer}
        onSave={handleBillCaptureResult}
      />

      <label className="field">
        <span>What for?</span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Beach shack dinner"
          maxLength={80}
        />
      </label>

      <div className="field">
        <span>Category</span>
        <div className="chip-row">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`chip${category === c.value ? ' is-active' : ''}`}
              onClick={() => setCategory(c.value)}
            >
              <span aria-hidden>{c.emoji}</span> {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Paid by</span>
        <div className="chip-row">
          {activeMembers.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`chip chip--person${payerIds.includes(m.id) ? ' is-active' : ''}`}
              onClick={() => togglePayer(m.id)}
            >
              <Avatar name={m.name} color={m.color} size={22} />
              {m.name}
            </button>
          ))}
        </div>
        {payerIds.length > 1 && (
          <div className="payer-amounts">
            {payerIds.map((id) => {
              const m = activeMembers.find((x) => x.id === id)
              if (!m) return null
              return (
                <label key={id} className="payer-amount">
                  <span>{m.name} paid</span>
                  <div className="prefix-input">
                    <span>₹</span>
                    <input
                      inputMode="decimal"
                      value={payerAmounts[id] ?? ''}
                      onChange={(e) => setPayerAmounts((prev) => ({ ...prev, [id]: e.target.value }))
                      }
                      placeholder="0"
                    />
                  </div>
                </label>
              )
            })}
            <p className={`assign-note${unassigned === 0 ? ' is-ok' : ''}`}>
              {unassigned === null
                ? 'Enter the total amount first.'
                : unassigned === 0
                  ? 'Fully assigned.'
                  : unassigned > 0
                    ? `${formatPaise(unassigned)} left to assign.`
                    : `${formatPaise(-unassigned)} over the total.`}
            </p>
          </div>
        )}
      </div>

      <div className="field">
        <span>Split</span>
        <Segmented value={mode} options={MODES} onChange={switchMode} />

        <div className="chip-row chip-row--wrap">
          {activeMembers.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`chip chip--person${participants.includes(m.id) ? ' is-active' : ''}`}
              onClick={() => toggleParticipant(m.id)}
            >
              <Avatar name={m.name} color={m.color} size={22} />
              {m.name}
            </button>
          ))}
        </div>

        {mode !== 'equal' && (
          <div className="split-values">
            {participants.length === 0 && <p className="hint">Pick who shared this expense.</p>}
            {participants.map((id) => {
              const m = activeMembers.find((x) => x.id === id)
              if (!m) return null
              return (
                <label key={id} className="split-value">
                  <Avatar name={m.name} color={m.color} size={26} />
                  <span className="split-value__name">{m.name}</span>
                  <div className="prefix-input prefix-input--suffix">
                    {mode !== 'shares' && <span>{mode === 'percent' ? '%' : '₹'}</span>}
                    <input
                      inputMode="decimal"
                      value={values[id] ?? ''}
                      onChange={(e) => setValues((prev) => ({ ...prev, [id]: e.target.value }))}
                      placeholder={mode === 'shares' ? '1' : '0'}
                      aria-label={`${m.name} ${mode}`}
                    />
                    {mode === 'shares' && <span className="suffix">parts</span>}
                  </div>
                </label>
              )
            })}
            {mode === 'shares' && (
              <p className="hint">
                Shares are proportional — {participants.length} people with 1 part each is the same as an equal
                split.
              </p>
            )}
          </div>
        )}

        <div className="preview">
          <p className="preview__title">
            <IconCheck size={15} /> Each person’s share
          </p>
          {preview ? (
            <ul>
              {preview.map((a) => {
                const m = activeMembers.find((x) => x.id === a.memberId)
                return (
                  <li key={a.memberId}>
                    <span>{m?.name ?? 'Member'}</span>
                    <strong>{formatPaise(a.amountPaise)}</strong>
                  </li>
                )
              })}
              <li className="preview__total">
                <span>Total</span>
                <strong>{formatPaise(preview.reduce((s, a) => s + a.amountPaise, 0))}</strong>
              </li>
            </ul>
          ) : (
            <p className="hint">
              {mode === 'exact'
                ? 'Enter shares that add up to the total.'
                : mode === 'percent'
                  ? 'Percentages must add up to 100%.'
                  : 'Enter an amount to preview shares.'}
            </p>
          )}
        </div>
      </div>

      <div className="field-row">
        <label className="field">
          <span>Date</span>
          <input type="date" value={dateValue} onChange={(e) => setDateValue(e.target.value)} />
        </label>
      </div>

      <label className="field">
        <span>Note (optional)</span>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add context others might need"
          maxLength={200}
        />
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Saving…' : expense ? 'Save changes' : 'Add expense'}
        </button>
      </div>
    </form>
  )
}

