import React, { useMemo, useState } from 'react'
import type { Expense, MemberId } from '../types'
import { buildGroupDues, type DuesEdge } from '../lib/payback'
import { formatPaise } from '../lib/money'
import { isValidUpi, upiPayLink } from '../lib/upi'
import { Avatar, StatusPill } from './ui'
import { IconChevron, IconSend } from './Icons'

function shortName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

function formatDay(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function countExpenses(edges: DuesEdge[]): number {
  const ids = new Set<string>()
  for (const edge of edges) for (const line of edge.lines) ids.add(line.expenseId)
  return ids.size
}

/**
 * One person at a time, only the payments they have to make. Each row is a
 * sentence — "Pay Priya ₹1,660" — that opens to show the expenses behind it.
 * Amounts are gross, so a row never shrinks because money already moved.
 */
export function SendListCard({
  expenses,
  memberIds,
  meId,
  groupName,
  nameOf,
  colorOf,
  upiOf,
}: {
  expenses: Expense[]
  memberIds: MemberId[]
  meId?: MemberId
  groupName: string
  nameOf: (id: MemberId) => string
  colorOf: (id: MemberId) => number
  upiOf: (id: MemberId) => string | undefined
}) {
  const view = useMemo(() => buildGroupDues(expenses, { memberIds }), [expenses, memberIds])
  const [picked, setPicked] = useState<MemberId>('')
  const [open, setOpen] = useState<Set<MemberId>>(() => new Set())

  const options = useMemo(() => {
    const ids = [...memberIds]
    if (meId && !ids.includes(meId)) ids.unshift(meId)
    return ids
  }, [memberIds, meId])
  const byId = useMemo(
    () => new Map(view.members.map((member) => [member.memberId, member])),
    [view],
  )

  const senderId =
    picked && byId.has(picked) ? picked : meId && byId.has(meId) ? meId : (options[0] ?? '')
  const sender = byId.get(senderId)
  const sends = sender?.owes ?? []
  const senderName = senderId ? nameOf(senderId) : ''
  const senderIsMe = Boolean(meId) && senderId === meId
  const senderShort = senderIsMe ? 'you' : shortName(senderName)
  const expenseCount = countExpenses(sends)

  const toggle = (memberId: MemberId) => {
    setOpen((previous) => {
      const next = new Set(previous)
      if (next.has(memberId)) next.delete(memberId)
      else next.add(memberId)
      return next
    })
  }

  return (
    <section className="plan-card send-card">
      <div className="plan-card__head">
        <h3>
          <IconSend size={17} /> What each person pays
        </h3>
        <StatusPill tone={sends.length > 0 ? 'warn' : 'muted'}>
          {sends.length > 0
            ? `${senderIsMe ? 'You pay' : `${senderName} pays`} ${sends.length} ${
                sends.length === 1 ? 'person' : 'people'
              }`
            : 'nothing to pay'}
        </StatusPill>
      </div>

      <p className="payback-sub">
        Tap a name and you get one line per payment that person makes — nothing they receive is
        listed here. Tap <em>why</em> to see the expenses behind an amount.
      </p>

      <div className="send-people">
        {options.map((memberId) => {
          const amount = byId.get(memberId)?.owesPaise ?? 0
          const label = nameOf(memberId)
          return (
            <button
              type="button"
              key={memberId}
              className={`send-person${memberId === senderId ? ' is-active' : ''}${
                amount === 0 ? ' is-clear' : ''
              }`}
              aria-label={
                memberId === meId
                  ? 'Show your payments'
                  : `Show payments ${label} makes`
              }
              aria-pressed={memberId === senderId}
              onClick={() => setPicked(memberId)}
            >
              <Avatar name={label} color={colorOf(memberId)} size={22} />
              <span className="send-person__name">
                {shortName(label)}
                {memberId === meId ? <em>you</em> : null}
              </span>
              <span className="send-person__amount">
                {amount > 0 ? formatPaise(amount) : '—'}
              </span>
            </button>
          )
        })}
      </div>

      {sends.length === 0 ? (
        <div className="payback-empty">
          <p>
            {senderIsMe
              ? 'You have nothing to pay anyone.'
              : `${senderName} has nothing to pay anyone.`}
          </p>
        </div>
      ) : (
        <>
          <div className="dues-totals">
            <span>
              <strong>{formatPaise(sender?.owesPaise ?? 0)}</strong>{' '}
              {senderIsMe ? 'for you to pay' : `for ${senderShort} to pay`}
            </span>
            <span>
              {sends.length} {sends.length === 1 ? 'person' : 'people'}
            </span>
            <span>
              {expenseCount} {expenseCount === 1 ? 'expense' : 'expenses'}
            </span>
          </div>

          <ul className="send-lines">
            {sends.map((edge) => {
              const payeeName = nameOf(edge.memberId)
              const isOpen = open.has(edge.memberId)
              const upiId = upiOf(edge.memberId)
              const payLink =
                senderIsMe && upiId && isValidUpi(upiId)
                  ? upiPayLink({
                      upiId,
                      payeeName,
                      amountPaise: edge.amountPaise,
                      note: `${groupName} · total to ${payeeName}`,
                    })
                  : null

              return (
                <li key={edge.memberId} className={`send-line${isOpen ? ' is-open' : ''}`}>
                  <div className="send-line__main">
                    <span className="send-line__text">
                      {senderIsMe ? `Pay ${payeeName}` : `${senderShort} pays ${payeeName}`}
                    </span>
                    <strong className="send-line__amount">{formatPaise(edge.amountPaise)}</strong>
                  </div>

                  <div className="send-line__actions">
                    <button
                      type="button"
                      className="send-line__why"
                      aria-expanded={isOpen}
                      onClick={() => toggle(edge.memberId)}
                    >
                      <IconChevron size={11} /> why {formatPaise(edge.amountPaise)}?
                    </button>
                    {payLink ? (
                      <a className="btn btn--tiny btn--soft" href={payLink}>
                        Send to {shortName(payeeName)} by UPI
                      </a>
                    ) : null}
                  </div>

                  {isOpen ? (
                    <div className="send-line__why-body">
                      <p className="payback-group__label">
                        From these expenses
                        <span>
                          {edge.lines.length} · {formatPaise(edge.amountPaise)}
                        </span>
                      </p>
                      <ul className="payback-lines">
                        {edge.lines.map((line, index) => (
                          <li
                            key={`${line.expenseId}-${index}`}
                            className="payback-line-wrap"
                          >
                            <div className="payback-line">
                              <span className="payback-line__text">
                                {line.description} <small>{formatDay(line.date)}</small>
                              </span>
                              <strong className="payback-line__amount">
                                {formatPaise(line.amountPaise)}
                              </strong>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </>
      )}

      <p className="dues-legend">
        Every amount is the full expense total for that pair of people. Recorded payments never
        reduce these lines — they are listed in “Who owes whom”.
      </p>
    </section>
  )
}
