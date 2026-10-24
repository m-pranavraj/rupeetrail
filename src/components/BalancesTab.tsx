import React, { useMemo, useState } from 'react'
import type { Expense, Group, MemberId, Settlement } from '../types'
import { computeBalances, isReconciled } from '../lib/balances'
import { formatPaise } from '../lib/money'
import { Avatar, StatusPill } from './ui'
import { IconAlert, IconCheck, IconChevron, IconDownload, IconLock } from './Icons'

export function BalancesTab({
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
  const [openMember, setOpenMember] = useState<MemberId | null>(null)
  const balances = useMemo(
    () => computeBalances({ group, expenses, settlements }),
    [group, expenses, settlements],
  )
  const reconciled = isReconciled(balances)

  const live = expenses.filter((e) => !e.deletedAt)
  const openDisputes = live.filter((e) => e.dispute?.status === 'open').length
  // People added by name have no app to confirm in, so they are not part of the
  // confirmation count — otherwise an expense could never look settled.
  const unacknowledged = live.filter(
    (e) =>
      group.members.some((m) => !m.isPlaceholder && (e.acks?.[m.id] ?? 'pending') === 'pending'),
  ).length
  const pendingSettlements = settlements.filter((s) => s.status !== 'confirmed' && s.status !== 'disputed').length
  const missingNotes = live.filter((e) => !e.notes).length

  const mine = balances.find((b) => b.memberId === currentMemberId)

  const exportCsv = () => {
    const rows: string[][] = [['date', 'description', 'category', 'amount_inr', 'paid_by', 'split_mode', 'notes']]
    for (const e of [...live].sort((a, b) => a.date - b.date)) {
      rows.push([
        new Date(e.date).toISOString().slice(0, 10),
        e.description,
        e.category,
        (e.amountPaise / 100).toFixed(2),
        e.payers
          .map((p) => `${group.members.find((m) => m.id === p.memberId)?.name ?? p.memberId} ${(p.amountPaise / 100).toFixed(2)}`)
          .join(' + '),
        e.split.mode,
        e.notes ?? '',
      ])
    }
    rows.push([])
    rows.push(['member', 'net_inr'])
    for (const b of balances) {
      rows.push([group.members.find((m) => m.id === b.memberId)?.name ?? b.memberId, (b.netPaise / 100).toFixed(2)])
    }
    const csv = rows
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${group.name.replace(/[^\w]+/g, '-').toLowerCase()}-ledger.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="balances-tab">
      {mine && (
        <div className={`net-card ${mine.netPaise > 0 ? 'is-pos' : mine.netPaise < 0 ? 'is-neg' : ''}`}>
          <p className="net-card__label">Your position</p>
          <p className="net-card__value">
            {mine.netPaise === 0
              ? 'All settled'
              : mine.netPaise > 0
                ? `${formatPaise(mine.netPaise)} due to you`
                : `${formatPaise(-mine.netPaise)} you owe`}
          </p>
          <p className="net-card__sub">
            You paid {formatPaise(mine.paidPaise)} · your share {formatPaise(mine.sharePaise)}
            {mine.settledOutPaise > 0 && <> · repaid {formatPaise(mine.settledOutPaise)}</>}
            {mine.settledInPaise > 0 && <> · received {formatPaise(mine.settledInPaise)}</>}
          </p>
          {mine.entries.length > 0 && (
            <button className="net-card__explain" onClick={() => setOpenMember(mine.memberId)}>
              Show the math →
            </button>
          )}
        </div>
      )}

      <section className="panel">
        <div className="panel__head">
          <h3>Ledger health</h3>
          <StatusPill tone={reconciled ? 'ok' : 'bad'}>
            {reconciled ? <><IconCheck size={12} /> reconciles</> : 'does not reconcile'}
          </StatusPill>
        </div>
        <ul className="health-list">
          <li className={openDisputes ? 'is-warn' : 'is-ok'}>
            {openDisputes ? <IconAlert size={15} /> : <IconCheck size={15} />}
            {openDisputes === 0 ? 'No open disputes' : `${openDisputes} open dispute${openDisputes === 1 ? '' : 's'}`}
          </li>
          <li className={unacknowledged ? 'is-warn' : 'is-ok'}>
            {unacknowledged ? <IconAlert size={15} /> : <IconCheck size={15} />}
            {unacknowledged === 0
              ? 'Every expense confirmed by all members'
              : `${unacknowledged} expense${unacknowledged === 1 ? '' : 's'} awaiting confirmation`}
          </li>
          <li className={pendingSettlements ? 'is-warn' : 'is-ok'}>
            {pendingSettlements ? <IconAlert size={15} /> : <IconCheck size={15} />}
            {pendingSettlements === 0
              ? 'No payments awaiting confirmation'
              : `${pendingSettlements} payment${pendingSettlements === 1 ? '' : 's'} awaiting dual confirmation`}
          </li>
          <li className={missingNotes ? 'is-muted' : 'is-ok'}>
            {missingNotes ? <IconLock size={15} /> : <IconCheck size={15} />}
            {missingNotes === 0
              ? 'All expenses have a note'
              : `${missingNotes} of ${live.length} without a note (optional)`}
          </li>
        </ul>
      </section>

      <section className="panel">
        <div className="panel__head">
          <h3>Everyone</h3>
          <button className="text-btn text-btn--quiet" onClick={exportCsv}>
            <IconDownload size={15} /> CSV
          </button>
        </div>
        <ul className="member-balance-list">
          {balances.map((b) => {
            const m = group.members.find((x) => x.id === b.memberId)
            if (!m) return null
            const open = openMember === b.memberId
            return (
              <li key={b.memberId} className={open ? 'is-open' : ''}>
                <button className="member-balance" onClick={() => setOpenMember(open ? null : b.memberId)}>
                  <Avatar name={m.name} color={m.color} />
                  <span className="member-balance__name">
                    {m.name}
                    {m.id === currentMemberId && <span className="you-tag">you</span>}
                    {m.isPlaceholder && <span className="pill pill--muted">not joined</span>}
                    {m.leftAt && <span className="pill pill--muted">left</span>}
                  </span>
                  <span className={`member-balance__net ${b.netPaise > 0 ? 'pos' : b.netPaise < 0 ? 'neg' : 'muted'}`}>
                    {b.netPaise === 0 ? '—' : `${b.netPaise > 0 ? '+' : '−'}${formatPaise(Math.abs(b.netPaise))}`}
                  </span>
                  <IconChevron size={15} className="member-balance__chev" />
                </button>
                {open && (
                  <div className="explain">
                    <p className="explain__title">
                      How {m.name}’s {b.netPaise >= 0 ? 'credit' : 'debt'} is built
                    </p>
                    {b.entries.length === 0 ? (
                      <p className="hint">No activity yet.</p>
                    ) : (
                      <ul>
                        {b.entries.map((entry, i) => (
                          <li key={`${entry.refId}-${entry.kind}-${i}`}>
                            <span className="explain__label">{entry.label}</span>
                            <span className={entry.amountPaise >= 0 ? 'pos' : 'neg'}>
                              {entry.amountPaise >= 0 ? '+' : '−'}
                              {formatPaise(Math.abs(entry.amountPaise))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="explain__total">
                      <span>Net</span>
                      <strong className={b.netPaise >= 0 ? 'pos' : 'neg'}>
                        {b.netPaise >= 0 ? '+' : '−'}
                        {formatPaise(Math.abs(b.netPaise))}
                      </strong>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <p className="fineprint">
        Balances use integer paise end to end, so shares always add back to the bill. Only payments confirmed by
        both sides reduce a balance.
      </p>
    </div>
  )
}
