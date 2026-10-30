import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Expense, MemberId, Settlement, Transfer } from '../types'
import {
  buildPayback,
  PAYBACK_FILTERS,
  type PaybackFilter,
  type PaybackLine,
  type PaybackPerson,
} from '../lib/payback'
import { formatPaise } from '../lib/money'
import { isValidUpi, upiPayLink } from '../lib/upi'
import { Avatar, StatusPill } from './ui'
import { IconChevron, IconShare, IconUsers } from './Icons'

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'group'
  )
}

function shortName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

function downloadImage(dataUrl: string, filename: string) {
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  link.click()
}

function formatDay(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function countLine(person: PaybackPerson): string {
  const expenseIds = new Set(
    [...person.theyOwe, ...person.youOwe].map((line) => line.expenseId),
  )
  const parts = [
    `${expenseIds.size} ${expenseIds.size === 1 ? 'expense' : 'expenses'}`,
  ]
  if (person.payments.length > 0) {
    parts.push(`${person.payments.length} ${person.payments.length === 1 ? 'payment' : 'payments'}`)
  }
  return parts.join(' · ')
}

export function PaybackCard({
  expenses,
  settlements,
  groupName,
  currentMemberId,
  memberIds,
  nameOf,
  colorOf,
  upiOf,
  onRecord,
  closed,
}: {
  expenses: Expense[]
  settlements: Settlement[]
  groupName: string
  currentMemberId?: MemberId
  memberIds: MemberId[]
  nameOf: (id: MemberId) => string
  colorOf: (id: MemberId) => number
  upiOf: (id: MemberId) => string | undefined
  onRecord: (transfer: Transfer) => void
  closed: boolean
}) {
  const [filter, setFilter] = useState<PaybackFilter>('all')
  const [viewerId, setViewerId] = useState<MemberId>(currentMemberId ?? '')
  const [expanded, setExpanded] = useState<Set<MemberId>>(new Set())
  const [captureMode, setCaptureMode] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareNote, setShareNote] = useState('')
  const cardRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    setViewerId(currentMemberId ?? '')
  }, [currentMemberId])

  const activeViewerId = viewerId || currentMemberId || ''
  const viewerIsMe = !currentMemberId || activeViewerId === currentMemberId
  const viewerName = activeViewerId ? nameOf(activeViewerId) : ''
  const viewerShort = viewerIsMe ? 'you' : shortName(viewerName)

  const view = useMemo(
    () => buildPayback(expenses, settlements, { meId: activeViewerId, filter }),
    [expenses, settlements, activeViewerId, filter],
  )
  const filterLabel = PAYBACK_FILTERS.find((option) => option.id === filter)?.label ?? 'All amounts'
  const hasExpenses = expenses.some((expense) => !expense.deletedAt && expense.amountPaise > 0)
  const hasPayments = settlements.some(
    (settlement) =>
      settlement.status !== 'disputed' &&
      settlement.amountPaise > 0 &&
      (settlement.from === activeViewerId || settlement.to === activeViewerId),
  )
  const filteredOut = hasExpenses && view.people.length === 0 && filter !== 'all'
  const viewerOptions = useMemo(() => {
    const ids = [...memberIds]
    if (currentMemberId && !ids.includes(currentMemberId)) ids.unshift(currentMemberId)
    return ids
  }, [memberIds, currentMemberId])

  const toggle = (memberId: MemberId) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(memberId)) next.delete(memberId)
      else next.add(memberId)
      return next
    })
  }

  const resetFilters = () => setFilter('all')

  const shareImage = async () => {
    if (!cardRef.current || sharing || view.people.length === 0) return
    setSharing(true)
    setShareNote('')
    setCaptureMode(true)
    let dataUrl: string | null = null
    const viewerSlug = viewerIsMe ? 'you' : slugify(viewerName)
    const filename = `rupeetrail-${slugify(groupName)}-${viewerSlug}-${filter}.png`
    const heading = viewerIsMe ? 'who owes whom' : `${viewerName}'s dues`
    try {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
      await new Promise((resolve) => setTimeout(resolve, 40))
      const { toPng } = await import('html-to-image')
      dataUrl = await toPng(cardRef.current, {
        backgroundColor: '#0c332a',
        cacheBust: true,
        pixelRatio: 2,
        skipFonts: true,
      })
      const blob = await (await fetch(dataUrl)).blob()
      const file = new File([blob], filename, { type: 'image/png' })
      const canShareFiles =
        typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })

      if (canShareFiles) {
        await navigator.share({
          files: [file],
          title: `${groupName} · ${heading}`,
          text: `${groupName} · ${heading} · ${filterLabel}`,
        })
        setShareNote('Shared.')
      } else {
        downloadImage(dataUrl, filename)
        setShareNote('Image saved — share it with the group.')
      }
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        // The user closed the share sheet; nothing to report.
      } else if (dataUrl) {
        downloadImage(dataUrl, filename)
        setShareNote('Image saved — share it with the group.')
      } else {
        setShareNote('Could not prepare the image here. Try again.')
      }
    } finally {
      setCaptureMode(false)
      setSharing(false)
      window.setTimeout(() => setShareNote(''), 4200)
    }
  }

  const renderLine = (line: PaybackLine, person: PaybackPerson, direction: 'in' | 'out') => {
    const displayName = nameOf(person.memberId)
    const upiId = upiOf(person.memberId)
    const payLink =
      direction === 'out' && viewerIsMe && currentMemberId && upiId && isValidUpi(upiId)
        ? upiPayLink({
            upiId,
            payeeName: displayName,
            amountPaise: line.amountPaise,
            note: `${groupName} · ${line.description}`,
          })
        : null

    return (
      <li key={`${line.expenseId}-${line.amountPaise}`} className="payback-line-wrap">
        <div className="payback-line">
          <span className="payback-line__text">
            {line.description} <small>{formatDay(line.date)}</small>
          </span>
          <strong className="payback-line__amount">{formatPaise(line.amountPaise)}</strong>
        </div>
        {!captureMode && !closed && activeViewerId ? (
          <div className="payback-line__actions">
            {payLink ? (
              <a className="btn btn--tiny btn--soft" href={payLink}>
                Pay {displayName} by UPI
              </a>
            ) : null}
            <button
              type="button"
              className="btn btn--tiny"
              onClick={() =>
                onRecord(
                  direction === 'in'
                    ? { from: person.memberId, to: activeViewerId, amountPaise: line.amountPaise }
                    : { from: activeViewerId, to: person.memberId, amountPaise: line.amountPaise },
                )
              }
            >
              {direction === 'in' ? 'Record received' : 'Record payment'}
            </button>
          </div>
        ) : null}
      </li>
    )
  }

  return (
    <section className="plan-card payback-card" ref={cardRef}>
      <div className="plan-card__head">
        <h3>
          <IconUsers size={17} /> Who owes whom
        </h3>
        {view.people.length > 0 ? (
          <StatusPill tone="ok">
            {view.expenseCount} {view.expenseCount === 1 ? 'expense' : 'expenses'}
          </StatusPill>
        ) : null}
      </div>

      <p className="payback-sub">
        Every shared expense, person by person. Full totals include all expenses — payments are
        listed separately and never subtracted.
      </p>

      {captureMode ? (
        <p className="payback-capture-line">
          {viewerIsMe ? 'Your ledger' : `${viewerName}'s ledger`} · {filterLabel} ·{' '}
          {view.people.length} {view.people.length === 1 ? 'person' : 'people'}
        </p>
      ) : (
        <>
          {currentMemberId && viewerOptions.length > 1 ? (
            <div className="payback-viewer">
              <label className="payback-filter" htmlFor="payback-viewer-select">
                Whose ledger
              </label>
              <span className="payback-select payback-viewer__select">
                <Avatar name={viewerName} color={colorOf(activeViewerId)} size={22} />
                <select
                  id="payback-viewer-select"
                  aria-label="Choose whose ledger to view"
                  value={activeViewerId}
                  onChange={(event) => setViewerId(event.target.value as MemberId)}
                >
                  {viewerOptions.map((memberId) => (
                    <option key={memberId} value={memberId}>
                      {memberId === currentMemberId
                        ? `You — ${nameOf(memberId)}`
                        : nameOf(memberId)}
                    </option>
                  ))}
                </select>
                <IconChevron size={13} />
              </span>
              {!viewerIsMe ? (
                <span className="payback-viewer__note">
                  Recording here saves a payment between {viewerShort} and the person — not
                  between you and them.
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="payback-tools">
            <label className="payback-filter">
              <span>Share amount</span>
              <span className="payback-select">
                <select
                  aria-label="Filter expenses by share amount"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value as PaybackFilter)}
                >
                  {PAYBACK_FILTERS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <IconChevron size={13} />
              </span>
            </label>
            <button
              type="button"
              className="btn btn--tiny payback-share"
              onClick={() => void shareImage()}
              disabled={sharing || view.people.length === 0}
            >
              <IconShare size={13} /> {sharing ? 'Preparing…' : 'Share image'}
            </button>
          </div>
        </>
      )}

      {shareNote && !captureMode ? <p className="payback-share-note">{shareNote}</p> : null}

      {!currentMemberId ? (
        <div className="payback-empty">
          <p>Open this group as a member to see what each person owes.</p>
        </div>
      ) : view.people.length === 0 ? (
        <div className="payback-empty">
          <p>
            {filteredOut
              ? 'No expense shares match this filter.'
              : hasPayments
                ? 'No shared expenses yet. Payments between you are listed below.'
                : 'No shared expenses yet.'}
          </p>
          {filteredOut ? (
            <button type="button" className="btn btn--tiny btn--soft" onClick={resetFilters}>
              Show all amounts
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="payback-summary">
            <span className="payback-summary__stat is-get">
              {viewerIsMe ? 'Owed to you' : `Owed to ${viewerShort}`}{' '}
              <strong>{formatPaise(view.theyOwePaise)}</strong>
            </span>
            <span className="payback-summary__stat is-pay">
              {viewerIsMe ? 'You owe' : `${viewerShort} owes`}{' '}
              <strong>{formatPaise(view.youOwePaise)}</strong>
            </span>
            <span className="payback-summary__stat">
              {view.expenseCount} {view.expenseCount === 1 ? 'expense' : 'expenses'}
            </span>
            {view.receivedPaise > 0 || view.sentPaise > 0 ? (
              <span className="payback-summary__stat is-muted">
                {formatPaise(view.receivedPaise)} in · {formatPaise(view.sentPaise)} out in payments
                (not deducted)
              </span>
            ) : null}
          </div>

          <ul className="payback-people">
            {view.people.map((person) => {
              const open = captureMode || expanded.has(person.memberId)
              const displayName = nameOf(person.memberId)
              return (
                <li key={person.memberId} className={`payback-person${open ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="payback-person__head"
                    aria-expanded={open}
                    aria-label={`${displayName}, ${open ? 'hide' : 'show'} expenses`}
                    onClick={() => {
                      if (!captureMode) toggle(person.memberId)
                    }}
                  >
                    <Avatar name={displayName} color={colorOf(person.memberId)} size={32} />
                    <span className="payback-person__id">
                      <span className="payback-person__name">{displayName}</span>
                      <span className="payback-person__meta">{countLine(person)}</span>
                    </span>
                    <span className="payback-person__amounts">
                      {person.theyOwePaise > 0 ? (
                        <span className="payback-person__amount is-get">
                          <strong>{formatPaise(person.theyOwePaise)}</strong>
                          <span>{viewerIsMe ? 'owes you' : `owes ${viewerShort}`}</span>
                        </span>
                      ) : null}
                      {person.youOwePaise > 0 ? (
                        <span className="payback-person__amount is-pay">
                          <strong>{formatPaise(person.youOwePaise)}</strong>
                          <span>{viewerIsMe ? 'you owe' : `${viewerShort} owes`}</span>
                        </span>
                      ) : null}
                      {person.theyOwePaise === 0 && person.youOwePaise === 0 ? (
                        <span className="payback-person__amount is-even">
                          <strong>—</strong>
                          <span>payments only</span>
                        </span>
                      ) : null}
                    </span>
                    <IconChevron size={15} className="payback-person__chev" />
                  </button>

                  {open ? (
                    <div className="payback-person__body">
                      {person.theyOwe.length > 0 ? (
                        <div className="payback-group">
                          <p className="payback-group__label">
                            {viewerIsMe ? 'They owe you' : `They owe ${viewerShort}`}
                            <span>
                              {person.theyOwe.length} · {formatPaise(person.theyOwePaise)}
                            </span>
                          </p>
                          <ul className="payback-lines">
                            {person.theyOwe.map((line) => renderLine(line, person, 'in'))}
                          </ul>
                        </div>
                      ) : null}

                      {person.youOwe.length > 0 ? (
                        <div className="payback-group">
                          <p className="payback-group__label">
                            {viewerIsMe ? 'You owe them' : `${viewerShort} owes them`}
                            <span>
                              {person.youOwe.length} · {formatPaise(person.youOwePaise)}
                            </span>
                          </p>
                          <ul className="payback-lines">
                            {person.youOwe.map((line) => renderLine(line, person, 'out'))}
                          </ul>
                        </div>
                      ) : null}

                      {person.payments.length > 0 ? (
                        <div className="payback-group">
                          <p className="payback-group__label">
                            {viewerIsMe
                              ? 'Payments between you'
                              : `Payments between ${viewerShort} and them`}
                            <span>not deducted</span>
                          </p>
                          <ul className="payback-lines">
                            {person.payments.map((payment) => (
                              <li
                                key={payment.settlementId}
                                className="payback-line-wrap payback-line-wrap--payment"
                              >
                                <div className="payback-line">
                                  <span className="payback-line__text">
                                    {payment.direction === 'in'
                                      ? `${displayName} paid ${viewerIsMe ? 'you' : viewerShort}`
                                      : `${viewerIsMe ? 'You' : viewerShort} paid ${displayName}`}{' '}
                                    <small>{formatDay(payment.date)}</small>
                                  </span>
                                  <strong className="payback-line__amount">
                                    {formatPaise(payment.amountPaise)}
                                  </strong>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </>
      )}

      {captureMode ? (
        <div className="payback-capture-foot">
          <span>
            RupeeSplit · {groupName} · {viewerIsMe ? 'you' : viewerShort}
          </span>
          <span>{filterLabel}</span>
        </div>
      ) : (
        <p className="fineprint">
          Built from the actual expenses, not a netted settlement plan. Record payments below when
          money moves — the totals here always show what each expense cost.
        </p>
      )}
    </section>
  )
}
