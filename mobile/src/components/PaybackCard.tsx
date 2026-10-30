/**
 * "Who owes whom" — every shared expense, person by person.
 *
 * Totals here are gross on purpose: each expense line is listed in full and
 * recorded payments sit beside them without ever being subtracted. A partial
 * payment must never make an expense look cheaper than it was. The visible card
 * can also be captured as an image so it can leave the app in a chat.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View, type ViewInstance } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Sharing from 'expo-sharing'
import { captureRef, type CaptureOptions } from 'react-native-view-shot'
import { Avatar, Card, Divider, Muted, PressableScale } from './ui'
import {
  PAYBACK_FILTERS,
  buildPayback,
  type PaybackFilter,
  type PaybackLine,
  type PaybackPerson,
} from '../lib/payback'
import { formatPaise } from '../lib/money'
import { isValidUpi } from '../lib/upi'
import { colors, radius, spacing, tints } from '../theme'
import type { Expense, MemberId, Settlement, Transfer } from '../lib/types'

export interface PaybackCardProps {
  expenses: Expense[]
  settlements: Settlement[]
  groupName: string
  meId: MemberId
  memberIds: MemberId[]
  nameOf: (id: MemberId) => string
  colorOf: (id: MemberId) => number
  upiOf: (id: MemberId) => string | undefined
  onRecord: (transfer: Transfer) => void
  onPayUpi: (toId: MemberId, amountPaise: number) => void
  payingKey: string | null
  closed: boolean
  onNotify: (message: string, tone?: 'ok' | 'error') => void
}

type Direction = 'in' | 'out'

const formatDay = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

function shortName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

/** Counts that explain a person row without making the reader do arithmetic. */
function countLine(person: PaybackPerson): string {
  const expenseIds = new Set([...person.theyOwe, ...person.youOwe].map((line) => line.expenseId))
  const parts = [`${expenseIds.size} ${expenseIds.size === 1 ? 'expense' : 'expenses'}`]
  if (person.payments.length > 0) {
    parts.push(`${person.payments.length} ${person.payments.length === 1 ? 'payment' : 'payments'}`)
  }
  return parts.join(' · ')
}

/** A share sheet the user closed on purpose is not an error worth a toast. */
function isCancellation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const name = 'name' in error ? String((error as { name?: unknown }).name ?? '') : ''
  const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : ''
  return /cancel/i.test(name) || /cancel/i.test(code)
}

/** A frame, then a beat: enough for capture mode to lay out every open row. */
const waitForLayout = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 120)
    })
  })

export function PaybackCard({
  expenses,
  settlements,
  groupName,
  meId,
  memberIds,
  nameOf,
  colorOf,
  upiOf,
  onRecord,
  onPayUpi,
  payingKey,
  closed,
  onNotify,
}: PaybackCardProps) {
  const [filter, setFilter] = useState<PaybackFilter>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [viewerId, setViewerId] = useState<MemberId>(meId)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [captureMode, setCaptureMode] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareNote, setShareNote] = useState('')
  const [expanded, setExpanded] = useState<Set<MemberId>>(() => new Set())
  const cardRef = useRef<ViewInstance>(null)
  const sharingRef = useRef(false)

  useEffect(() => {
    setViewerId(meId)
  }, [meId])

  const activeViewerId = viewerId || meId
  const viewerIsMe = activeViewerId === meId
  const viewerName = nameOf(activeViewerId)
  const viewerShort = viewerIsMe ? 'you' : shortName(viewerName)
  const viewerOptions = useMemo(() => {
    const ids = [...memberIds]
    if (!ids.includes(meId)) ids.unshift(meId)
    return ids
  }, [memberIds, meId])

  const view = useMemo(
    () => buildPayback(expenses, settlements, { meId: activeViewerId, filter }),
    [expenses, settlements, activeViewerId, filter],
  )

  const activeFilter = PAYBACK_FILTERS.find((option) => option.id === filter) ?? PAYBACK_FILTERS[0]
  const filterLabel = activeFilter.label
  const peopleCount = view.people.length
  const hasExpenses = expenses.some((expense) => !expense.deletedAt && expense.amountPaise > 0)
  const filteredOut = hasExpenses && peopleCount === 0 && filter !== 'all'
  const hasPayments = view.receivedPaise > 0 || view.sentPaise > 0
  const actionsBlocked = payingKey !== null || closed
  const canShare = peopleCount > 0 && !sharing

  const togglePerson = (memberId: MemberId) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(memberId)) next.delete(memberId)
      else next.add(memberId)
      return next
    })
  }

  const resetFilters = () => {
    setFilter('all')
    setFilterOpen(false)
  }

  const shareView = async () => {
    if (sharingRef.current || peopleCount === 0) return
    sharingRef.current = true
    setSharing(true)
    setFilterOpen(false)
    setShareNote('')
    setCaptureMode(true)
    try {
      await waitForLayout()
      // react-native-view-shot 6 has no backgroundColor option; the wrapper View
      // paints colors.bg while captureMode is on so PNG corners stay solid.
      const options: CaptureOptions = { format: 'png', quality: 1, result: 'tmpfile' }
      const uri = await captureRef(cardRef, options)
      if (!(await Sharing.isAvailableAsync())) {
        onNotify('Sharing is not available on this device.', 'error')
        return
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        dialogTitle: viewerIsMe ? 'Share who owes whom' : `Share ${viewerName}'s dues`,
      })
      setShareNote('Shared.')
    } catch (error) {
      if (!isCancellation(error)) onNotify('Could not share that image. Try again.', 'error')
    } finally {
      // Expanded is derived from captureMode, so leaving it restores folded rows.
      setCaptureMode(false)
      setSharing(false)
      sharingRef.current = false
      setTimeout(() => setShareNote(''), 4_200)
    }
  }

  const renderLine = (
    line: PaybackLine,
    person: PaybackPerson,
    direction: Direction,
    index: number,
  ) => {
    const displayName = nameOf(person.memberId)
    const from = direction === 'in' ? person.memberId : activeViewerId
    const to = direction === 'in' ? activeViewerId : person.memberId
    const key = `${from}-${to}-${line.amountPaise}`
    const upiId = upiOf(person.memberId)
    const canPayUpi =
      direction === 'out' && viewerIsMe && Boolean(upiId) && isValidUpi(upiId ?? '')

    return (
      <View key={`${line.expenseId}-${index}`} style={styles.line}>
        <View style={styles.lineTop}>
          <View style={styles.lineText}>
            <Text style={styles.lineTitle} numberOfLines={2}>
              {line.description}
            </Text>
            <Text style={styles.lineDate}>{formatDay(line.date)}</Text>
          </View>
          <Text style={styles.lineAmount}>{formatPaise(line.amountPaise)}</Text>
        </View>
        {!captureMode && !closed ? (
          <View style={styles.actions}>
            {canPayUpi ? (
              <PressableScale
                onPress={() => onPayUpi(person.memberId, line.amountPaise)}
                disabled={actionsBlocked}
                scaleTo={0.94}
                accessibilityLabel={`Pay ${displayName} via UPI`}
              >
                <View style={[styles.action, styles.actionUpi]}>
                  <Text style={styles.actionUpiText}>Pay UPI</Text>
                </View>
              </PressableScale>
            ) : null}
            <PressableScale
              onPress={() => onRecord({ from, to, amountPaise: line.amountPaise })}
              disabled={actionsBlocked}
              scaleTo={0.94}
              accessibilityLabel={`${
                direction === 'in' ? 'Record received' : 'Record payment'
              } of ${formatPaise(line.amountPaise)}`}
            >
              <View style={[styles.action, styles.actionRecord]}>
                {payingKey === key ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Text style={styles.actionRecordText}>
                    {direction === 'in' ? 'Record received' : 'Record payment'}
                  </Text>
                )}
              </View>
            </PressableScale>
          </View>
        ) : null}
      </View>
    )
  }

  return (
    <View
      ref={cardRef}
      collapsable={false}
      style={captureMode ? styles.captureSurface : undefined}
    >
      <Card style={[styles.card, captureMode && styles.cardCapture]}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            Who owes whom
          </Text>
          {!captureMode ? (
            <PressableScale
              onPress={() => void shareView()}
              disabled={!canShare}
              scaleTo={0.92}
              accessibilityLabel="Share who owes whom"
            >
              <View style={[styles.shareButton, sharing && styles.shareButtonBusy]}>
                {sharing ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Ionicons
                    name="share-outline"
                    size={16}
                    color={canShare ? colors.accent : colors.mutedDim}
                  />
                )}
              </View>
            </PressableScale>
          ) : null}
        </View>

        <Text style={styles.subtitle}>
          Every shared expense, person by person. Full totals include all expenses — payments are
          listed separately and never subtracted.
        </Text>

        {captureMode ? (
          <View style={styles.captureFilter}>
            <Ionicons name="funnel-outline" size={11} color={colors.accent} />
            <Text style={styles.captureFilterText}>
              {viewerIsMe ? 'Your ledger' : `${viewerName}'s ledger`} · {filterLabel} · {peopleCount}{' '}
              {peopleCount === 1 ? 'person' : 'people'}
            </Text>
          </View>
        ) : (
          <>
            {viewerOptions.length > 1 ? (
              <View style={styles.viewerBar}>
                <Text style={styles.viewerLabel}>Whose ledger</Text>
                <PressableScale
                  onPress={() => {
                    setViewerOpen((previous) => !previous)
                    setFilterOpen(false)
                  }}
                  scaleTo={0.96}
                  accessibilityLabel="Choose whose ledger to view"
                >
                  <View style={[styles.viewerChip, viewerOpen && styles.chipOpen]}>
                    <Avatar name={viewerName} color={colorOf(activeViewerId)} size={20} />
                    <Text style={styles.viewerChipText} numberOfLines={1}>
                      {viewerIsMe ? `You — ${viewerName}` : viewerName}
                    </Text>
                    <Ionicons
                      name={viewerOpen ? 'chevron-up' : 'chevron-down'}
                      size={12}
                      color={colors.mutedDim}
                    />
                  </View>
                </PressableScale>
              </View>
            ) : null}
            {!viewerIsMe ? (
              <Text style={styles.viewerNote}>
                Recording here saves a payment between {viewerShort} and the person — not between
                you and them.
              </Text>
            ) : null}
            {viewerOpen ? (
              <View style={styles.dropdown}>
                {viewerOptions.map((memberId) => {
                  const active = memberId === activeViewerId
                  const memberName = nameOf(memberId)
                  return (
                    <PressableScale
                      key={memberId}
                      onPress={() => {
                        setViewerId(memberId)
                        setViewerOpen(false)
                      }}
                      scaleTo={0.98}
                      accessibilityLabel={`View ${memberName}'s ledger`}
                    >
                      <View style={[styles.dropdownRow, active && styles.dropdownRowActive]}>
                        <View style={styles.viewerOption}>
                          <Avatar name={memberName} color={colorOf(memberId)} size={22} />
                          <Text
                            style={[styles.dropdownText, active && styles.dropdownTextActive]}
                            numberOfLines={1}
                          >
                            {memberId === meId ? `You — ${memberName}` : memberName}
                          </Text>
                        </View>
                        {active ? <Ionicons name="checkmark" size={15} color={colors.accent} /> : null}
                      </View>
                    </PressableScale>
                  )
                })}
              </View>
            ) : null}
            <View style={styles.controls}>
              <PressableScale
                onPress={() => {
                  setFilterOpen((previous) => !previous)
                  setViewerOpen(false)
                }}
                scaleTo={0.96}
                accessibilityLabel="Filter expenses by share amount"
              >
                <View style={[styles.chip, filterOpen && styles.chipOpen]}>
                  <Ionicons
                    name="funnel-outline"
                    size={12}
                    color={filter === 'all' ? colors.mutedDim : colors.accent}
                  />
                  <Text style={[styles.chipText, filter !== 'all' && styles.chipTextActive]}>
                    {filterLabel}
                  </Text>
                  <Ionicons
                    name={filterOpen ? 'chevron-up' : 'chevron-down'}
                    size={12}
                    color={colors.mutedDim}
                  />
                </View>
              </PressableScale>
            </View>
          </>
        )}

        {filterOpen && !captureMode ? (
          <View style={styles.dropdown}>
            {PAYBACK_FILTERS.map((option) => {
              const active = option.id === filter
              return (
                <PressableScale
                  key={option.id}
                  onPress={() => {
                    setFilter(option.id)
                    setFilterOpen(false)
                  }}
                  scaleTo={0.98}
                  accessibilityLabel={option.label}
                >
                  <View style={[styles.dropdownRow, active && styles.dropdownRowActive]}>
                    <Text style={[styles.dropdownText, active && styles.dropdownTextActive]}>
                      {option.label}
                    </Text>
                    {active ? <Ionicons name="checkmark" size={15} color={colors.accent} /> : null}
                  </View>
                </PressableScale>
              )
            })}
          </View>
        ) : null}

        {shareNote && !captureMode ? <Muted small>{shareNote}</Muted> : null}

        {peopleCount === 0 ? (
          <View style={styles.empty}>
            <Ionicons
              name={filteredOut ? 'funnel-outline' : 'receipt-outline'}
              size={22}
              color={colors.mutedDim}
            />
            <Text style={styles.emptyTitle}>
              {filteredOut ? 'No expense shares match this filter.' : 'No shared expenses yet.'}
            </Text>
            <Muted small>
              {filteredOut
                ? 'Try a wider amount band — every expense line shows up here, in full.'
                : 'Log who paid for what and every person’s share appears here, expense by expense.'}
            </Muted>
            {filteredOut ? (
              <PressableScale
                onPress={resetFilters}
                scaleTo={0.94}
                accessibilityLabel="Show all amounts"
              >
                <View style={styles.resetButton}>
                  <Text style={styles.resetText}>Show all amounts</Text>
                </View>
              </PressableScale>
            ) : null}
          </View>
        ) : (
          <>
            <View style={styles.summary}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>
                    {viewerIsMe ? 'You paid for others' : `${viewerShort} paid for others`}
                  </Text>
                  <Text style={[styles.summaryValue, { color: colors.accent }]}>
                    {formatPaise(view.theyOwePaise)}
                  </Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>
                    {viewerIsMe ? 'Others paid for you' : `Others paid for ${viewerShort}`}
                  </Text>
                  <Text style={[styles.summaryValue, { color: colors.coral }]}>
                    {formatPaise(view.youOwePaise)}
                  </Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Expenses</Text>
                  <Text style={styles.summaryValue}>{view.expenseCount}</Text>
                </View>
              </View>
              {hasPayments ? (
                <Text style={styles.summaryPayments}>
                  {formatPaise(view.receivedPaise)} received · {formatPaise(view.sentPaise)} sent in
                  payments (not deducted)
                </Text>
              ) : null}
            </View>

            <View style={styles.people}>
              {view.people.map((person, index) => {
                const name = nameOf(person.memberId)
                const open = captureMode || expanded.has(person.memberId)
                const even = person.theyOwePaise === 0 && person.youOwePaise === 0
                return (
                  <View key={person.memberId}>
                    {index > 0 ? <View style={styles.rowRule} /> : null}
                    <PressableScale
                      onPress={captureMode ? undefined : () => togglePerson(person.memberId)}
                      scaleTo={0.99}
                      accessibilityLabel={`${name}, ${open ? 'hide' : 'show'} expenses`}
                    >
                      <View style={styles.personRow}>
                        <Avatar name={name} color={colorOf(person.memberId)} size={34} />
                        <View style={styles.personText}>
                          <Text style={styles.personName} numberOfLines={1}>
                            {name}
                          </Text>
                          <Text style={styles.personMeta} numberOfLines={1}>
                            {countLine(person)}
                          </Text>
                        </View>
                        <View style={styles.personAmounts}>
                          {person.theyOwePaise > 0 ? (
                            <View style={styles.amountStack}>
                              <Text style={[styles.amountValue, { color: colors.accent }]}>
                                {formatPaise(person.theyOwePaise)}
                              </Text>
                              <Text style={styles.amountLabel}>
                                {viewerIsMe ? 'owes you' : `owes ${viewerShort}`}
                              </Text>
                            </View>
                          ) : null}
                          {person.youOwePaise > 0 ? (
                            <View style={styles.amountStack}>
                              <Text style={[styles.amountValue, { color: colors.coral }]}>
                                {formatPaise(person.youOwePaise)}
                              </Text>
                              <Text style={styles.amountLabel}>
                                {viewerIsMe ? 'you owe' : `${viewerShort} owes`}
                              </Text>
                            </View>
                          ) : null}
                          {even ? (
                            <View style={styles.amountStack}>
                              <Text style={[styles.amountValue, { color: colors.muted }]}>—</Text>
                              <Text style={styles.amountLabel}>payments only</Text>
                            </View>
                          ) : null}
                        </View>
                        {!captureMode ? (
                          <Ionicons
                            name={open ? 'chevron-up' : 'chevron-down'}
                            size={14}
                            color={colors.mutedDim}
                          />
                        ) : null}
                      </View>
                    </PressableScale>

                    {open ? (
                      <View style={styles.personBody}>
                        {person.theyOwe.length > 0 ? (
                          <View style={styles.section}>
                            <View style={styles.sectionHead}>
                              <Text style={styles.sectionLabel}>
                                {viewerIsMe ? 'They owe you' : `They owe ${viewerShort}`}
                              </Text>
                              <Text style={styles.sectionTotal}>
                                {person.theyOwe.length} · {formatPaise(person.theyOwePaise)}
                              </Text>
                            </View>
                            {person.theyOwe.map((line, lineIndex) =>
                              renderLine(line, person, 'in', lineIndex),
                            )}
                          </View>
                        ) : null}

                        {person.youOwe.length > 0 ? (
                          <View style={styles.section}>
                            <View style={styles.sectionHead}>
                              <Text style={styles.sectionLabel}>
                                {viewerIsMe ? 'You owe them' : `${viewerShort} owes them`}
                              </Text>
                              <Text style={styles.sectionTotal}>
                                {person.youOwe.length} · {formatPaise(person.youOwePaise)}
                              </Text>
                            </View>
                            {person.youOwe.map((line, lineIndex) =>
                              renderLine(line, person, 'out', lineIndex),
                            )}
                          </View>
                        ) : null}

                        {person.payments.length > 0 ? (
                          <View style={styles.section}>
                            <View style={styles.sectionHead}>
                              <Text style={styles.sectionLabel}>
                                {viewerIsMe
                                  ? 'Payments between you'
                                  : `Payments between ${viewerShort} and them`}
                              </Text>
                              <Text style={styles.sectionTotal}>not deducted</Text>
                            </View>
                            {person.payments.map((payment) => (
                              <View key={payment.settlementId} style={styles.paymentLine}>
                                <Text style={styles.paymentText} numberOfLines={2}>
                                  {payment.direction === 'in'
                                    ? `${name} paid ${viewerIsMe ? 'you' : viewerShort}`
                                    : `${viewerIsMe ? 'You' : viewerShort} paid ${name}`}{' '}
                                  <Text style={styles.paymentAmount}>
                                    {formatPaise(payment.amountPaise)}
                                  </Text>
                                  <Text style={styles.lineDate}>
                                    {' · '}
                                    {formatDay(payment.date)}
                                  </Text>
                                </Text>
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                )
              })}
            </View>
          </>
        )}

        <Divider />
        {captureMode ? (
          <Text style={styles.watermark} numberOfLines={1}>
            RupeeSplit · {groupName} · {viewerIsMe ? 'you' : viewerShort} · {filterLabel}
          </Text>
        ) : (
          <Text style={styles.fineprint}>
            Built from the actual expenses, not a netted settlement plan. Record payments when money
            moves — the totals here always show what each expense cost.
          </Text>
        )}
      </Card>
    </View>
  )
}

const styles = StyleSheet.create({
  // A small dark frame around the card so the shared PNG never has transparent
  // or clipped corners; the card itself drops its top margin while capturing.
  captureSurface: { backgroundColor: colors.bg, padding: spacing(2) },
  card: { paddingBottom: spacing(3.5) },
  cardCapture: { marginTop: 0, elevation: 0, shadowOpacity: 0 },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing(3) },
  title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { color: colors.mutedDim, fontSize: 11.5, lineHeight: 16, marginTop: spacing(1.5) },
  captureFilter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.5),
    marginTop: spacing(2.5),
  },
  captureFilterText: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  shareButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: tints.accent.fill,
    borderWidth: 1,
    borderColor: tints.accent.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButtonBusy: { backgroundColor: colors.surfaceAlt, borderColor: colors.borderSoft },

  controls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing(2),
    marginTop: spacing(3),
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.5),
    paddingHorizontal: spacing(2.5),
    paddingVertical: spacing(1.6),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bgElevated,
  },
  chipOpen: { borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  chipText: { color: colors.muted, fontSize: 11.5, fontWeight: '700' },
  chipTextActive: { color: colors.accent },

  viewerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing(2),
    marginTop: spacing(3),
  },
  viewerLabel: {
    color: colors.mutedDim,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  viewerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.6),
    paddingLeft: spacing(1.2),
    paddingRight: spacing(2.5),
    paddingVertical: spacing(1),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: tints.accent.border,
    backgroundColor: tints.accent.fill,
  },
  viewerChipText: { color: colors.text, fontSize: 12, fontWeight: '700', maxWidth: 190 },
  viewerNote: {
    marginTop: spacing(1.8),
    color: colors.muted,
    fontSize: 10.5,
    lineHeight: 15,
  },
  viewerOption: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), flex: 1, minWidth: 0 },

  dropdown: {
    marginTop: spacing(2),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    padding: spacing(1),
  },
  dropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing(2.5),
    paddingVertical: spacing(2.4),
    borderRadius: radius.sm,
  },
  dropdownRowActive: { backgroundColor: tints.accent.fill },
  dropdownText: { color: colors.textSoft, fontSize: 12, fontWeight: '600' },
  dropdownTextActive: { color: colors.accent, fontWeight: '800' },

  summary: {
    marginTop: spacing(3.5),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2.6),
    gap: spacing(2),
  },
  summaryRow: { flexDirection: 'row', gap: spacing(2) },
  summaryItem: { flex: 1, minWidth: 0 },
  summaryLabel: {
    color: colors.mutedDim,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  summaryValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 3,
    fontVariant: ['tabular-nums'],
  },
  summaryPayments: { color: colors.muted, fontSize: 10.5, fontWeight: '600', lineHeight: 15 },

  people: { marginTop: spacing(1.5) },
  rowRule: { height: 1, backgroundColor: colors.borderSoft },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2.5),
    paddingVertical: spacing(2.6),
  },
  personText: { flex: 1, minWidth: 0 },
  personName: { color: colors.text, fontSize: 13, fontWeight: '700' },
  personMeta: { color: colors.mutedDim, fontSize: 10.5, marginTop: 2 },
  personAmounts: { alignItems: 'flex-end', gap: spacing(1.5) },
  amountStack: { alignItems: 'flex-end' },
  amountValue: { fontSize: 12.5, fontWeight: '800', fontVariant: ['tabular-nums'] },
  amountLabel: {
    color: colors.mutedDim,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginTop: 1,
    textTransform: 'uppercase',
  },

  personBody: {
    marginTop: spacing(0.5),
    marginBottom: spacing(2.5),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2.5),
    gap: spacing(2.5),
  },
  section: { gap: spacing(0.5) },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing(2),
    marginBottom: spacing(0.5),
  },
  sectionLabel: {
    color: colors.mutedDim,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionTotal: { color: colors.muted, fontSize: 10, fontWeight: '800' },

  line: { paddingVertical: spacing(1.4) },
  lineTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing(2) },
  lineText: { flex: 1, minWidth: 0 },
  lineTitle: { color: colors.textSoft, fontSize: 12, fontWeight: '600', lineHeight: 16 },
  lineDate: { color: colors.mutedDim, fontSize: 10, marginTop: 2 },
  lineAmount: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginTop: 1,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(1.5), marginTop: spacing(1.5) },
  action: {
    height: 26,
    borderRadius: radius.sm,
    paddingHorizontal: spacing(2.5),
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  actionUpi: { backgroundColor: tints.accent.fill, borderColor: tints.accent.border },
  actionUpiText: { color: colors.accent, fontSize: 10, fontWeight: '800' },
  actionRecord: { backgroundColor: colors.surfaceHigh, borderColor: colors.border },
  actionRecordText: { color: colors.textSoft, fontSize: 10, fontWeight: '800' },

  paymentLine: { paddingVertical: spacing(1.4) },
  paymentText: { color: colors.textSoft, fontSize: 11.5, lineHeight: 16, fontWeight: '600' },
  paymentAmount: { color: colors.text, fontSize: 11.5, fontWeight: '800' },

  empty: { alignItems: 'center', paddingVertical: spacing(5), paddingHorizontal: spacing(2), gap: spacing(1) },
  emptyTitle: {
    color: colors.text,
    fontSize: 13.5,
    fontWeight: '800',
    marginTop: spacing(1),
    textAlign: 'center',
  },
  resetButton: {
    marginTop: spacing(2),
    paddingHorizontal: spacing(3.5),
    paddingVertical: spacing(2),
    borderRadius: radius.pill,
    backgroundColor: tints.accent.fill,
    borderWidth: 1,
    borderColor: tints.accent.border,
  },
  resetText: { color: colors.accent, fontSize: 11.5, fontWeight: '800' },

  fineprint: { color: colors.mutedDim, fontSize: 10.5, lineHeight: 15 },
  watermark: {
    color: colors.mutedDim,
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
})
