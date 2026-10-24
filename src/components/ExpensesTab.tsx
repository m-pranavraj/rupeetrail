import React from 'react'
import type { Expense, Group, MemberId } from '../types'
import { formatPaise } from '../lib/money'
import { nameOf } from '../lib/balances'
import { Avatar, EmptyState } from './ui'
import { IconAlert, IconPlus, IconReceipt } from './Icons'

const CATEGORY_EMOJI: Record<string, string> = {
  food: '🍽️',
  travel: '🚕',
  stay: '🛏️',
  groceries: '🛒',
  entertainment: '🎟️',
  utilities: '💡',
  shopping: '🛍️',
  other: '📦',
}

function dayLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const same = (a: Date, b: Date) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
  if (same(d, today)) return 'Today'
  if (same(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function ExpensesTab({
  group,
  expenses,
  currentMemberId,
  onOpenExpense,
  onAdd,
}: {
  group: Group
  expenses: Expense[]
  currentMemberId?: MemberId
  onOpenExpense: (id: string) => void
  onAdd: () => void
}) {
  const live = expenses.filter((e) => !e.deletedAt).sort((a, b) => b.date - a.date || b.createdAt - a.createdAt)
  const removed = expenses.filter((e) => e.deletedAt)
  const openDisputes = live.filter((e) => e.dispute?.status === 'open').length

  if (live.length === 0) {
    return (
      <EmptyState
        icon={<IconReceipt size={26} />}
        title="No expenses yet"
        body="Log the first thing someone paid for. You can split it equally or by exact amounts, percentages or shares."
        action={
          <button className="btn btn--primary" onClick={onAdd}>
            <IconPlus size={18} /> Add an expense
          </button>
        }
      />
    )
  }

  let lastDay = ''
  return (
    <div className="expenses-tab">
      {openDisputes > 0 && (
        <div className="notice notice--warn">
          <IconAlert size={16} />
          {openDisputes} expense{openDisputes === 1 ? ' has' : 's have'} an open question. Balances include them
          until resolved.
        </div>
      )}

      <ul className="expense-list">
        {live.map((e) => {
          const showDay = dayLabel(e.date) !== lastDay
          lastDay = dayLabel(e.date)
          const myShare = myShareOf(e, currentMemberId)
          return (
            <React.Fragment key={e.id}>
              {showDay && <li className="day-label">{lastDay}</li>}
              <li>
                <button className="expense-row" onClick={() => onOpenExpense(e.id)}>
                  <span className="expense-row__emoji" aria-hidden>
                    {CATEGORY_EMOJI[e.category] ?? '📦'}
                  </span>
                  <span className="expense-row__main">
                    <span className="expense-row__desc">
                      {e.description}
                      {e.dispute?.status === 'open' && (
                        <span className="tiny-warn" title="Open question">
                          <IconAlert size={13} />
                        </span>
                      )}
                    </span>
                    <span className="expense-row__meta">
                      {payerSummary(e, group)}
                      {myShare !== null && <> · your share {formatPaise(myShare)}</>}
                      {e.pendingSync && (
                        <>
                          {' · '}
                          <em className="pending-tag" title="Saved on this device">
                            syncing…
                          </em>
                        </>
                      )}
                    </span>
                  </span>
                  <span className="expense-row__amount">{formatPaise(e.amountPaise)}</span>
                </button>
              </li>
            </React.Fragment>
          )
        })}
      </ul>

      {removed.length > 0 && (
        <details className="removed">
          <summary>{removed.length} removed {removed.length === 1 ? 'expense' : 'expenses'}</summary>
          <ul>
            {removed.map((e) => (
              <li key={e.id}>
                <span>{e.description}</span>
                <span>{formatPaise(e.amountPaise)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function myShareOf(expense: Expense, memberId?: MemberId): number | null {
  if (!memberId) return null
  const split = expense.split
  if (split.mode === 'equal') {
    const parts = split.participants ?? []
    if (!parts.includes(memberId)) return 0
    // rough preview only; detail view has exact numbers
    return Math.round(expense.amountPaise / Math.max(1, parts.length))
  }
  const v = split.values?.[memberId] ?? 0
  if (split.mode === 'exact') return v
  const total = Object.values(split.values ?? {}).reduce((s, x) => s + x, 0)
  if (total <= 0) return 0
  return Math.round((expense.amountPaise * v) / total)
}

function payerSummary(expense: Expense, group: Group): string {
  const names = expense.payers.map((p) => nameOf(group, p.memberId))
  if (names.length === 1) return `${names[0]} paid`
  if (names.length === 2) return `${names[0]} & ${names[1]} paid`
  return `${names[0]} +${names.length - 1} paid`
}
