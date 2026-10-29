import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { MemberId, Transfer } from '../types'
import {
  buildPayback,
  PAYBACK_FILTERS,
  type PaybackFilter,
  type PaybackPerson,
} from '../lib/payback'
import { formatPaise } from '../lib/money'
import { isValidUpi, upiPayLink } from '../lib/upi'
import { Avatar, StatusPill } from './ui'
import { IconCheck, IconChevron, IconShare, IconUsers } from './Icons'

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'group'
  )
}

function downloadImage(dataUrl: string, filename: string) {
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  link.click()
}

function activityLabel(person: PaybackPerson, isMe: boolean): string {
  const incoming = person.incoming.length
  const outgoing = person.outgoing.length
  if (isMe) {
    if (incoming && outgoing) return `${incoming} in · ${outgoing} out`
    if (incoming) return `${incoming} ${incoming === 1 ? 'person pays' : 'people pay'} you`
    if (outgoing) return `You pay ${outgoing} ${outgoing === 1 ? 'person' : 'people'}`
    return 'Nothing to move'
  }
  if (incoming && outgoing) return `${incoming} in · ${outgoing} out`
  if (incoming) return `${incoming} to receive`
  if (outgoing) return `${outgoing} to pay`
  return 'Settled'
}

export function PaybackCard({
  transfers,
  groupName,
  currentMemberId,
  nameOf,
  colorOf,
  upiOf,
  onRecord,
  closed,
}: {
  transfers: Transfer[]
  groupName: string
  currentMemberId?: MemberId
  nameOf: (id: MemberId) => string
  colorOf: (id: MemberId) => number
  upiOf: (id: MemberId) => string | undefined
  onRecord: (transfer: Transfer) => void
  closed: boolean
}) {
  const [filter, setFilter] = useState<PaybackFilter>('all')
  const [onlyMine, setOnlyMine] = useState(false)
  const [expanded, setExpanded] = useState<Set<MemberId>>(new Set())
  const [captureMode, setCaptureMode] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareNote, setShareNote] = useState('')
  const seeded = useRef(false)
  const cardRef = useRef<HTMLElement | null>(null)

  const view = useMemo(
    () =>
      buildPayback(transfers, {
        filter,
        onlyMember: onlyMine ? currentMemberId : null,
        priorityMember: currentMemberId,
      }),
    [transfers, filter, onlyMine, currentMemberId],
  )
  const filterLabel = PAYBACK_FILTERS.find((option) => option.id === filter)?.label ?? 'All amounts'
  const me = view.people.find((person) => person.memberId === currentMemberId)

  useEffect(() => {
    if (seeded.current || !currentMemberId) return
    if (view.people.some((person) => person.memberId === currentMemberId)) {
      seeded.current = true
      setExpanded(new Set([currentMemberId]))
    }
  }, [view.people, currentMemberId])

  const toggle = (memberId: MemberId) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(memberId)) next.delete(memberId)
      else next.add(memberId)
      return next
    })
  }

  const resetFilters = () => {
    setFilter('all')
    setOnlyMine(false)
  }

  const shareImage = async () => {
    if (!cardRef.current || sharing || view.people.length === 0) return
    setSharing(true)
    setShareNote('')
    setCaptureMode(true)
    let dataUrl: string | null = null
    const filename = `rupeetrail-${slugify(groupName)}-${filter}.png`
    try {
      // Let the expanded capture layout paint before the clone is taken.
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
          title: `${groupName} · who pays whom`,
          text: `${groupName} · ${filterLabel}${onlyMine ? ' · only mine' : ''}`,
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

  const renderActions = (transfer: Transfer) => {
    if (captureMode || closed || !currentMemberId) return null
    const involved = transfer.from === currentMemberId || transfer.to === currentMemberId
    if (!involved) return null
    const upiId = upiOf(transfer.to)
    const payLink =
      transfer.from === currentMemberId && upiId && isValidUpi(upiId)
        ? upiPayLink({
            upiId,
            payeeName: nameOf(transfer.to),
            amountPaise: transfer.amountPaise,
            note: `${groupName} settlement`,
          })
        : null

    return (
      <div className="payback-line__actions">
        {payLink ? (
          <a className="btn btn--tiny btn--soft" href={payLink}>
            Pay {nameOf(transfer.to)} by UPI
          </a>
        ) : null}
        <button type="button" className="btn btn--tiny" onClick={() => onRecord(transfer)}>
          {transfer.from === currentMemberId ? 'Record payment' : 'Record received'}
        </button>
      </div>
    )
  }

  return (
    <section className="plan-card payback-card" ref={cardRef}>
      <div className="plan-card__head">
        <h3>
          <IconUsers size={17} /> Who pays whom
        </h3>
        {view.people.length > 0 ? (
          <StatusPill tone="ok">
            {view.transfers.length} {view.transfers.length === 1 ? 'transfer' : 'transfers'}
          </StatusPill>
        ) : null}
      </div>

      <p className="payback-sub">Tap a person to see exactly who pays them and whom they pay.</p>

      {captureMode ? (
        <p className="payback-capture-line">
          {filterLabel}
          {onlyMine ? ' · only mine' : ''} · {view.people.length}{' '}
          {view.people.length === 1 ? 'person' : 'people'}
        </p>
      ) : (
        <div className="payback-tools">
          <label className="payback-filter">
            <span>Amount</span>
            <span className="payback-select">
              <select
                aria-label="Filter transfers by amount"
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
          {currentMemberId ? (
            <button
              type="button"
              className={`chip${onlyMine ? ' is-active' : ''}`}
              aria-pressed={onlyMine}
              onClick={() => {
                const next = !onlyMine
                setOnlyMine(next)
                if (next && currentMemberId) {
                  setExpanded((previous) => new Set(previous).add(currentMemberId))
                }
              }}
            >
              Only mine
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--tiny payback-share"
            onClick={() => void shareImage()}
            disabled={sharing || view.people.length === 0}
          >
            <IconShare size={13} /> {sharing ? 'Preparing…' : 'Share image'}
          </button>
        </div>
      )}

      {shareNote && !captureMode ? <p className="payback-share-note">{shareNote}</p> : null}

      {transfers.length === 0 ? (
        <div className="plan-empty">
          <IconCheck size={26} />
          <p>Everyone is settled up. Nothing needs to move.</p>
        </div>
      ) : view.people.length === 0 ? (
        <div className="payback-empty">
          <p>No transfers match this filter.</p>
          {captureMode ? null : (
            <button type="button" className="btn btn--tiny btn--soft" onClick={resetFilters}>
              Show all amounts
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="payback-summary">
            <span className="payback-summary__stat">
              <strong>{formatPaise(view.totalPaise)}</strong> moving
            </span>
            <span className="payback-summary__stat">
              {view.transfers.length} {view.transfers.length === 1 ? 'transfer' : 'transfers'}
            </span>
            {me && me.incomingPaise > 0 ? (
              <span className="payback-summary__stat is-get">
                You receive <strong>{formatPaise(me.incomingPaise)}</strong>
              </span>
            ) : null}
            {me && me.outgoingPaise > 0 ? (
              <span className="payback-summary__stat is-pay">
                You pay <strong>{formatPaise(me.outgoingPaise)}</strong>
              </span>
            ) : null}
          </div>

          <ul className="payback-people">
            {view.people.map((person) => {
              const isMe = person.memberId === currentMemberId
              const open = captureMode || expanded.has(person.memberId)
              const net = person.incomingPaise - person.outgoingPaise
              const netTone = net > 0 ? 'is-get' : net < 0 ? 'is-pay' : 'is-even'
              const displayName = nameOf(person.memberId)
              return (
                <li key={person.memberId} className={`payback-person${open ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="payback-person__head"
                    aria-expanded={open}
                    onClick={() => {
                      if (!captureMode) toggle(person.memberId)
                    }}
                  >
                    <Avatar name={displayName} color={colorOf(person.memberId)} size={32} />
                    <span className="payback-person__id">
                      <span className="payback-person__name">
                        {displayName}
                        {isMe ? <em>you</em> : null}
                      </span>
                      <span className="payback-person__meta">
                        {activityLabel(person, isMe)}
                      </span>
                    </span>
                    <span className={`payback-person__net ${netTone}`}>
                      <strong>{net === 0 ? '—' : formatPaise(Math.abs(net))}</strong>
                      <span>{net > 0 ? 'gets back' : net < 0 ? 'pays' : 'even'}</span>
                    </span>
                    <IconChevron size={15} className="payback-person__chev" />
                  </button>

                  {open ? (
                    <div className="payback-person__body">
                      {person.incoming.length > 0 ? (
                        <div className="payback-group">
                          <p className="payback-group__label">
                            {isMe ? 'Coming to you' : `Coming to ${displayName}`}
                            <span>
                              {person.incoming.length} · {formatPaise(person.incomingPaise)}
                            </span>
                          </p>
                          <ul className="payback-lines">
                            {person.incoming.map((transfer, index) => (
                              <li
                                key={`${transfer.from}-${transfer.to}-${index}`}
                                className="payback-line-wrap"
                              >
                                <div className="payback-line">
                                  <span className="payback-line__text">
                                    {nameOf(transfer.from)} should pay {isMe ? 'you' : displayName}
                                  </span>
                                  <strong className="payback-line__amount">
                                    {formatPaise(transfer.amountPaise)}
                                  </strong>
                                </div>
                                {renderActions(transfer)}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {person.outgoing.length > 0 ? (
                        <div className="payback-group">
                          <p className="payback-group__label">
                            {isMe ? 'Going out' : `${displayName} pays out`}
                            <span>
                              {person.outgoing.length} · {formatPaise(person.outgoingPaise)}
                            </span>
                          </p>
                          <ul className="payback-lines">
                            {person.outgoing.map((transfer, index) => (
                              <li
                                key={`${transfer.from}-${transfer.to}-${index}`}
                                className="payback-line-wrap"
                              >
                                <div className="payback-line">
                                  <span className="payback-line__text">
                                    {isMe ? 'You' : displayName} should pay {nameOf(transfer.to)}
                                  </span>
                                  <strong className="payback-line__amount">
                                    {formatPaise(transfer.amountPaise)}
                                  </strong>
                                </div>
                                {renderActions(transfer)}
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
          <span>RupeeSplit · {groupName}</span>
          <span>
            {filterLabel}
            {onlyMine ? ' · only mine' : ''}
          </span>
        </div>
      ) : (
        <p className="fineprint">
          Calculated from confirmed balances. RupeeSplit never touches the money — record what
          actually moved.
        </p>
      )}
    </section>
  )
}
