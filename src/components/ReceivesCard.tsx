import React, { useMemo, useState } from 'react'
import type { Expense, MemberId } from '../types'
import { buildGroupDues, type DuesMember } from '../lib/payback'
import { formatPaise } from '../lib/money'
import { Avatar, StatusPill } from './ui'
import { IconChevron, IconWallet } from './Icons'

/**
 * Every person's incoming total in one place: what each of them takes in from
 * the rest of the group. Amounts are gross, so they never shrink when a payment
 * is recorded elsewhere.
 */
export function ReceivesCard({
  expenses,
  memberIds,
  meId,
  nameOf,
  colorOf,
}: {
  expenses: Expense[]
  memberIds: MemberId[]
  meId?: MemberId
  nameOf: (id: MemberId) => string
  colorOf: (id: MemberId) => number
}) {
  const view = useMemo(() => buildGroupDues(expenses, { memberIds }), [expenses, memberIds])
  const [open, setOpen] = useState<Set<MemberId>>(() => new Set())

  const receivers = useMemo(
    () =>
      view.members
        .filter((member) => member.owedByPaise > 0)
        .slice()
        .sort(
          (a, b) =>
            b.owedByPaise - a.owedByPaise || a.memberId.localeCompare(b.memberId),
        ),
    [view],
  )

  const toggle = (memberId: MemberId) => {
    setOpen((previous) => {
      const next = new Set(previous)
      if (next.has(memberId)) next.delete(memberId)
      else next.add(memberId)
      return next
    })
  }

  return (
    <section className="plan-card gets-card">
      <div className="plan-card__head">
        <h3>
          <IconWallet size={17} /> What everyone gets
        </h3>
        <StatusPill tone={receivers.length > 0 ? 'ok' : 'muted'}>
          {receivers.length > 0
            ? `${receivers.length} ${receivers.length === 1 ? 'person' : 'people'} collecting`
            : 'nobody is owed'}
        </StatusPill>
      </div>

      <p className="payback-sub">
        The total each person takes in from the group, all in one place. Tap a name to see who pays
        them. What that person has to pay out is in “What each person pays”.
      </p>

      {receivers.length === 0 ? (
        <div className="payback-empty">
          <p>
            {expenses.some((expense) => !expense.deletedAt && expense.amountPaise > 0)
              ? 'Nobody is collecting from anyone right now.'
              : 'No shared expenses yet.'}
          </p>
        </div>
      ) : (
        <>
          <div className="dues-totals">
            <span>
              <strong>{formatPaise(view.totalPaise)}</strong> to collect across {receivers.length}{' '}
              {receivers.length === 1 ? 'person' : 'people'}
            </span>
            <span>
              {view.expenseCount} {view.expenseCount === 1 ? 'expense' : 'expenses'}
            </span>
            <span>payments not deducted</span>
          </div>

          <ul className="gets-list">
            {receivers.map((member: DuesMember) => {
              const label = nameOf(member.memberId)
              const isOpen = open.has(member.memberId)
              return (
                <li key={member.memberId} className={`gets-row${isOpen ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="gets-row__head"
                    aria-expanded={isOpen}
                    aria-label={`${label} gets ${formatPaise(
                      member.owedByPaise,
                    )}, ${isOpen ? 'hide' : 'show'} who pays`}
                    onClick={() => toggle(member.memberId)}
                  >
                    <Avatar name={label} color={colorOf(member.memberId)} size={30} />
                    <span className="gets-row__id">
                      <span className="gets-row__name">
                        {label}
                        {member.memberId === meId ? <em>you</em> : null}
                      </span>
                      <span className="gets-row__meta">
                        from {member.owedBy.length} {member.owedBy.length === 1 ? 'person' : 'people'}
                        {' · '}
                        {member.expenseCount} {member.expenseCount === 1 ? 'expense' : 'expenses'}
                      </span>
                    </span>
                    <span className="gets-row__amount">{formatPaise(member.owedByPaise)}</span>
                    <IconChevron size={14} className="gets-row__chev" />
                  </button>

                  {isOpen ? (
                    <ul className="payback-lines gets-row__body">
                      {member.owedBy.map((edge) => (
                        <li key={edge.memberId} className="payback-line-wrap">
                          <div className="payback-line">
                            <span className="payback-line__text">
                              From {nameOf(edge.memberId)}{' '}
                              <small>
                                {edge.expenseCount} {edge.expenseCount === 1 ? 'expense' : 'expenses'}
                              </small>
                            </span>
                            <strong className="payback-line__amount">
                              {formatPaise(edge.amountPaise)}
                            </strong>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>

          <p className="dues-legend">
            The same money the dues table adds up, read from the receiving side. These are gross
            totals — recording a payment does not shrink them.
          </p>
        </>
      )}
    </section>
  )
}
