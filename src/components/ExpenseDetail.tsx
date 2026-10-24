import React, { useMemo, useState } from 'react'
import type { Expense, Group, MemberId } from '../types'
import { allocateSplit } from '../lib/splits'
import { formatPaise } from '../lib/money'
import { nameOf } from '../lib/balances'
import { Avatar, Sheet, StatusPill } from './ui'
import { IconAlert, IconCheck, IconEdit, IconTrash } from './Icons'
import { useStore } from '../lib/store'

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function mathLine(expense: Expense, group: Group): string {
  const split = expense.split
  const amount = expense.amountPaise
  if (split.mode === 'equal') {
    const n = split.participants?.length ?? 0
    return n > 0 ? `${formatPaise(amount)} split equally between ${n} ${n === 1 ? 'person' : 'people'}.` : ''
  }
  if (split.mode === 'exact') {
    return `Exact amounts entered that add up to ${formatPaise(amount)}.`
  }
  if (split.mode === 'percent') {
    const values = split.values ?? {}
    const pcts = Object.values(values)
    const equalish = pcts.length > 0 && pcts.every((p) => Math.abs(p - pcts[0]) < 0.001)
    if (equalish) {
      return `${formatPaise(amount)} split at ${pcts[0]}% each — the same as an even split.`
    }
    return `${formatPaise(amount)} allocated by percentage.`
  }
  const values = split.values ?? {}
  const totalParts = Object.values(values).reduce((s, v) => s + v, 0)
  return `${formatPaise(amount)} split into ${totalParts} part${totalParts === 1 ? '' : 's'} by share weight.`
}

export function ExpenseDetail({
  group,
  expense,
  currentMemberId,
  onClose,
  onEdit,
}: {
  group: Group
  expense: Expense
  currentMemberId?: MemberId
  onClose: () => void
  onEdit: () => void
}) {
  const { setAck, raiseDispute, resolveDispute, deleteExpense } = useStore()
  const [questioning, setQuestioning] = useState(false)
  const [reason, setReason] = useState('')
  const [resolving, setResolving] = useState(false)
  const [resolution, setResolution] = useState('')

  const allocations = useMemo(() => {
    try {
      return allocateSplit(expense.amountPaise, expense.split)
    } catch {
      return []
    }
  }, [expense])

  const members = group.members
  const acks = expense.acks ?? {}
  // Someone added by name has no app yet, so they cannot confirm anything. Keep
  // them visible in the list but out of the "confirmed" fraction.
  const confirmable = members.filter((m) => !m.isPlaceholder)
  const ackCount = confirmable.filter((m) => acks[m.id] === 'acknowledged').length
  const disputed = expense.dispute?.status === 'open'

  return (
    <Sheet
      open
      onClose={onClose}
      title={expense.description}
      subtitle={`${formatDate(expense.date)} · rev ${expense.revision}`}
      footer={
        <div className="detail-footer">
          <button
            className="btn btn--ghost btn--danger"
            onClick={() => {
              if (confirm('Remove this expense? It stays in history and can be restored.')) {
                deleteExpense(group.id, expense.id)
                onClose()
              }
            }}
          >
            <IconTrash size={17} /> Delete
          </button>
          <button className="btn btn--ghost" onClick={onEdit} disabled={group.status === 'closed'}>
            <IconEdit size={17} /> Edit
          </button>
        </div>
      }
    >
      <div className="detail-amount">
        <span>{formatPaise(expense.amountPaise)}</span>
        <span className="detail-amount__cat">{expense.category}</span>
      </div>

      <section className="detail-block">
        <h3>Paid by</h3>
        <ul className="detail-list">
          {expense.payers.map((p) => {
            const m = members.find((x) => x.id === p.memberId)
            return (
              <li key={p.memberId}>
                <span className="detail-person">
                  <Avatar name={m?.name ?? '?'} color={m?.color ?? 0} size={26} />
                  {nameOf(group, p.memberId)}
                </span>
                <strong>{formatPaise(p.amountPaise)}</strong>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="detail-block">
        <div className="detail-block__head">
          <h3>How it was split</h3>
          <StatusPill tone="muted">{expense.split.mode}</StatusPill>
        </div>
        <p className="detail-math">{mathLine(expense, group)}</p>
        <ul className="detail-list">
          {allocations.map((a) => {
            const m = members.find((x) => x.id === a.memberId)
            const pct = expense.amountPaise > 0 ? (a.amountPaise / expense.amountPaise) * 100 : 0
            return (
              <li key={a.memberId}>
                <span className="detail-person">
                  <Avatar name={m?.name ?? '?'} color={m?.color ?? 0} size={26} />
                  {nameOf(group, a.memberId)}
                </span>
                <span className="detail-share">
                  <strong>{formatPaise(a.amountPaise)}</strong>
                  <em>{pct.toFixed(pct % 1 === 0 ? 0 : 1)}%</em>
                </span>
              </li>
            )
          })}
          {allocations.length === 0 && (
            <li className="detail-warn">
              <IconAlert size={16} /> This split could not be calculated. Edit it to fix the values.
            </li>
          )}
        </ul>
      </section>

      {expense.notes && (
        <section className="detail-block">
          <h3>Note</h3>
          <p className="detail-note">{expense.notes}</p>
        </section>
      )}

      <section className="detail-block">
        <div className="detail-block__head">
          <h3>Acknowledgements</h3>
          <span className="muted-small">
            {ackCount}/{confirmable.length} confirmed
          </span>
        </div>
        <ul className="ack-list">
          {members.map((m) => {
            const status = acks[m.id] ?? 'pending'
            return (
              <li key={m.id}>
                <span className="detail-person">
                  <Avatar name={m.name} color={m.color} size={26} />
                  {m.name}
                  {m.id === currentMemberId && <span className="you-tag">you</span>}
                </span>
                {m.isPlaceholder ? (
                  <StatusPill tone="muted">Not joined yet</StatusPill>
                ) : status === 'acknowledged' ? (
                  <StatusPill tone="ok">
                    <IconCheck size={12} /> Confirmed
                  </StatusPill>
                ) : status === 'questioned' ? (
                  <StatusPill tone="warn">Questioned</StatusPill>
                ) : (
                  <StatusPill tone="muted">Pending</StatusPill>
                )}
              </li>
            )
          })}
        </ul>

        {currentMemberId && !disputed && acks[currentMemberId] !== 'acknowledged' && (
          <div className="ack-actions">
            <button
              className="btn btn--soft"
              onClick={() => setAck(group.id, expense.id, currentMemberId, 'acknowledged')}
            >
              <IconCheck size={16} /> This looks right
            </button>
            <button className="btn btn--ghost" onClick={() => setQuestioning(true)}>
              Question it
            </button>
          </div>
        )}

        {questioning && (
          <div className="inline-form">
            <label className="field">
              <span>What looks wrong?</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="e.g. I only stayed two nights"
                autoFocus
              />
            </label>
            <div className="form-actions">
              <button className="btn btn--ghost" onClick={() => setQuestioning(false)}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                disabled={!reason.trim()}
                onClick={() => {
                  if (currentMemberId) raiseDispute(group.id, expense.id, currentMemberId, reason)
                  setQuestioning(false)
                  setReason('')
                }}
              >
                Raise question
              </button>
            </div>
          </div>
        )}
      </section>

      {expense.dispute && (
        <section className={`detail-block dispute${disputed ? ' is-open' : ''}`}>
          <div className="detail-block__head">
            <h3>
              <IconAlert size={16} /> Dispute
            </h3>
            <StatusPill tone={disputed ? 'bad' : 'ok'}>{disputed ? 'Open' : 'Resolved'}</StatusPill>
          </div>
          <p className="detail-note">
            <strong>{nameOf(group, expense.dispute.raisedBy)}:</strong> {expense.dispute.reason}
          </p>
          {expense.dispute.resolution && (
            <p className="detail-note">Resolution: {expense.dispute.resolution}</p>
          )}
          {disputed &&
            (resolving ? (
              <div className="inline-form">
                <label className="field">
                  <span>How was it resolved?</span>
                  <textarea
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                    rows={2}
                    autoFocus
                  />
                </label>
                <div className="form-actions">
                  <button className="btn btn--ghost" onClick={() => setResolving(false)}>
                    Cancel
                  </button>
                  <button
                    className="btn btn--primary"
                    disabled={!resolution.trim()}
                    onClick={() => {
                      resolveDispute(group.id, expense.id, resolution)
                      setResolving(false)
                    }}
                  >
                    Mark resolved
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn btn--soft" onClick={() => setResolving(true)}>
                Resolve this
              </button>
            ))}
        </section>
      )}
    </Sheet>
  )
}
