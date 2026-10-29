/**
 * "Who pays whom" — a person-by-person read of the settlement plan.
 *
 * The plan itself is a flat list of transfers, which is precise but hard to act
 * on when you only care about your own corner of it. This card groups the same
 * transfers around each person, narrows them by amount band, and can capture the
 * visible card as an image so the plan can leave the app in a chat.
 */
import React, { useMemo, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View, type ViewInstance } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Sharing from 'expo-sharing'
import { captureRef, type CaptureOptions } from 'react-native-view-shot'
import { Avatar, Card, Divider, Muted, PressableScale } from './ui'
import { PAYBACK_FILTERS, buildPayback, type PaybackFilter, type PaybackPerson } from '../lib/payback'
import { formatPaise } from '../lib/money'
import { colors, radius, spacing, tints } from '../theme'
import type { Transfer } from '../lib/types'

export interface PaybackCardProps {
  transfers: Transfer[]
  groupName: string
  meId: string
  nameOf: (id: string) => string
  colorOf: (id: string) => number
  upiOf: (id: string) => string | undefined
  onRecord: (transfer: Transfer) => void
  onPayUpi: (toId: string, amountPaise: number) => void
  payingKey: string | null
  closed: boolean
  onNotify: (message: string, tone?: 'ok' | 'error') => void
}

type Direction = 'in' | 'out'

const transferKey = (transfer: Transfer): string =>
  `${transfer.from}-${transfer.to}-${transfer.amountPaise}`

/** Counts that explain a person row without making the reader do arithmetic. */
function countLine(person: PaybackPerson): string {
  const parts: string[] = []
  if (person.incoming.length > 0) parts.push(`${person.incoming.length} incoming`)
  if (person.outgoing.length > 0) parts.push(`${person.outgoing.length} outgoing`)
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
  transfers,
  groupName,
  meId,
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
  const [onlyMine, setOnlyMine] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [captureMode, setCaptureMode] = useState(false)
  const [sharing, setSharing] = useState(false)
  // The current user's rows start open; every other person starts folded.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(transfers.some((transfer) => transfer.from === meId || transfer.to === meId) ? [meId] : []),
  )
  const cardRef = useRef<ViewInstance>(null)
  const sharingRef = useRef(false)

  const activeFilter = PAYBACK_FILTERS.find((option) => option.id === filter) ?? PAYBACK_FILTERS[0]
  const view = useMemo(
    () =>
      buildPayback(transfers, {
        filter,
        onlyMember: onlyMine ? meId : null,
        priorityMember: meId,
      }),
    [transfers, filter, onlyMine, meId],
  )
  const meLine = view.people.find((person) => person.memberId === meId)
  const filterLine = `${onlyMine ? 'Only mine · ' : ''}${activeFilter.label}`
  const hasTransfers = transfers.length > 0
  const actionsBlocked = payingKey !== null || closed
  const canShare = view.people.length > 0 && !sharing

  const togglePerson = (memberId: string) => {
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
    setFilterOpen(false)
  }

  const shareView = async () => {
    if (sharingRef.current || view.people.length === 0) return
    sharingRef.current = true
    setSharing(true)
    setFilterOpen(false)
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
        dialogTitle: 'Share who pays whom',
      })
    } catch (error) {
      if (!isCancellation(error)) onNotify('Could not share that image. Try again.', 'error')
    } finally {
      // Expanded is derived, so dropping capture mode restores the folded rows.
      setCaptureMode(false)
      setSharing(false)
      sharingRef.current = false
    }
  }

  const renderTransferRow = (transfer: Transfer, direction: Direction, isMe: boolean) => {
    const key = transferKey(transfer)
    const involvesMe = transfer.from === meId || transfer.to === meId
    const canPayUpi = transfer.from === meId && Boolean(upiOf(transfer.to))
    const sentence =
      direction === 'in'
        ? isMe
          ? `${nameOf(transfer.from)} should pay you`
          : `${nameOf(transfer.from)} should pay ${nameOf(transfer.to)}`
        : isMe
          ? `You should pay ${nameOf(transfer.to)}`
          : `${nameOf(transfer.from)} should pay ${nameOf(transfer.to)}`

    return (
      <View key={key} style={styles.transferRow}>
        <View style={styles.transferLeft}>
          <Text style={styles.transferSentence}>{sentence}</Text>
          {!captureMode && involvesMe ? (
            <View style={styles.actions}>
              {canPayUpi ? (
                <PressableScale
                  onPress={() => onPayUpi(transfer.to, transfer.amountPaise)}
                  disabled={actionsBlocked}
                  scaleTo={0.94}
                  accessibilityLabel={`Pay ${nameOf(transfer.to)} via UPI`}
                >
                  <View style={[styles.action, styles.actionUpi]}>
                    <Text style={styles.actionUpiText}>Pay UPI</Text>
                  </View>
                </PressableScale>
              ) : null}
              <PressableScale
                onPress={() => onRecord(transfer)}
                disabled={actionsBlocked}
                scaleTo={0.94}
                accessibilityLabel={`Record payment of ${formatPaise(transfer.amountPaise)}`}
              >
                <View style={[styles.action, styles.actionRecord]}>
                  {payingKey === key ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Text style={styles.actionRecordText}>Record</Text>
                  )}
                </View>
              </PressableScale>
            </View>
          ) : null}
        </View>
        <Text style={styles.transferAmount}>{formatPaise(transfer.amountPaise)}</Text>
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
            Who pays whom
          </Text>
          {!captureMode ? (
            <PressableScale
              onPress={() => void shareView()}
              disabled={!canShare}
              scaleTo={0.92}
              accessibilityLabel="Share who pays whom"
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
        {captureMode ? (
          <View style={styles.captureFilter}>
            <Ionicons name="funnel-outline" size={11} color={colors.accent} />
            <Text style={styles.captureFilterText}>{filterLine}</Text>
          </View>
        ) : (
          <Text style={styles.hint}>Tap a person to see who pays them and whom they pay.</Text>
        )}

        {hasTransfers && !captureMode ? (
          <View style={styles.controls}>
            <PressableScale
              onPress={() => setFilterOpen((previous) => !previous)}
              scaleTo={0.96}
              accessibilityLabel="Filter by amount"
            >
              <View style={[styles.chip, filterOpen && styles.chipOpen]}>
                <Ionicons
                  name="funnel-outline"
                  size={12}
                  color={filter === 'all' ? colors.mutedDim : colors.accent}
                />
                <Text style={[styles.chipText, filter !== 'all' && styles.chipTextActive]}>
                  {activeFilter.label}
                </Text>
                <Ionicons
                  name={filterOpen ? 'chevron-up' : 'chevron-down'}
                  size={12}
                  color={colors.mutedDim}
                />
              </View>
            </PressableScale>
            <PressableScale
              onPress={() => setOnlyMine((previous) => !previous)}
              scaleTo={0.96}
              accessibilityLabel="Only show my transfers"
            >
              <View style={[styles.chip, onlyMine && styles.chipActive]}>
                <Ionicons
                  name={onlyMine ? 'checkmark' : 'person-outline'}
                  size={12}
                  color={onlyMine ? colors.accent : colors.mutedDim}
                />
                <Text style={[styles.chipText, onlyMine && styles.chipTextActive]}>Only mine</Text>
              </View>
            </PressableScale>
          </View>
        ) : null}

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

        {view.people.length > 0 ? (
          <View style={styles.summary}>
            <Text style={styles.summaryMain}>
              <Text style={styles.summaryAmount}>{formatPaise(view.totalPaise)}</Text>
              {' moving · '}
              {view.transfers.length} {view.transfers.length === 1 ? 'transfer' : 'transfers'}
            </Text>
            {meLine ? (
              <Text style={styles.summaryMe}>
                {meLine.incomingPaise > 0 ? (
                  <Text style={{ color: colors.accent }}>
                    You receive {formatPaise(meLine.incomingPaise)}
                  </Text>
                ) : null}
                {meLine.incomingPaise > 0 && meLine.outgoingPaise > 0 ? (
                  <Text style={{ color: colors.mutedDim }}>{'  ·  '}</Text>
                ) : null}
                {meLine.outgoingPaise > 0 ? (
                  <Text style={{ color: colors.coral }}>
                    You pay {formatPaise(meLine.outgoingPaise)}
                  </Text>
                ) : null}
                {meLine.incomingPaise === 0 && meLine.outgoingPaise === 0 ? (
                  <Text style={{ color: colors.muted }}>You are even</Text>
                ) : null}
              </Text>
            ) : null}
          </View>
        ) : null}

        {!hasTransfers ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🤝</Text>
            <Text style={styles.emptyTitle}>Everyone is settled</Text>
            <Muted small>Nothing needs to move. The ledger is clean.</Muted>
          </View>
        ) : view.people.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="funnel-outline" size={22} color={colors.mutedDim} />
            <Text style={styles.emptyTitle}>No transfers match this filter</Text>
            <Muted small>Try a wider amount band, or widen the scope.</Muted>
            <PressableScale onPress={resetFilters} scaleTo={0.94} accessibilityLabel="Show all amounts">
              <View style={styles.resetButton}>
                <Text style={styles.resetText}>Show all amounts</Text>
              </View>
            </PressableScale>
          </View>
        ) : (
          <View style={styles.people}>
            {view.people.map((person, index) => {
              const isMe = person.memberId === meId
              const name = nameOf(person.memberId)
              const net = person.incomingPaise - person.outgoingPaise
              const open = captureMode || expanded.has(person.memberId)
              return (
                <View key={person.memberId}>
                  {index > 0 ? <View style={styles.rowRule} /> : null}
                  <PressableScale
                    onPress={captureMode ? undefined : () => togglePerson(person.memberId)}
                    scaleTo={0.99}
                    accessibilityLabel={`${name}, ${open ? 'hide' : 'show'} transfers`}
                  >
                    <View style={styles.personRow}>
                      <Avatar name={name} color={colorOf(person.memberId)} size={34} />
                      <View style={styles.personText}>
                        <Text style={styles.personName} numberOfLines={1}>
                          {name}
                          {isMe ? ' · you' : ''}
                        </Text>
                        <Text style={styles.personMeta} numberOfLines={1}>
                          {countLine(person)}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.personNet,
                          {
                            color:
                              net > 0 ? colors.accent : net < 0 ? colors.coral : colors.muted,
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {net > 0 ? `Gets ${formatPaise(net)}` : net < 0 ? `Pays ${formatPaise(-net)}` : 'Even'}
                      </Text>
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
                      {person.incoming.length > 0 ? (
                        <View style={styles.section}>
                          <Text style={styles.sectionLabel}>
                            {isMe ? 'COMING TO YOU' : 'COMING IN'} ·{' '}
                            {formatPaise(person.incomingPaise)}
                          </Text>
                          {person.incoming.map((transfer) =>
                            renderTransferRow(transfer, 'in', isMe),
                          )}
                        </View>
                      ) : null}
                      {person.outgoing.length > 0 ? (
                        <View style={styles.section}>
                          <Text style={styles.sectionLabel}>
                            GOING OUT · {formatPaise(person.outgoingPaise)}
                          </Text>
                          {person.outgoing.map((transfer) =>
                            renderTransferRow(transfer, 'out', isMe),
                          )}
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              )
            })}
          </View>
        )}

        <Divider />
        <Text style={styles.fineprint}>
          Calculated from confirmed balances. RupeeSplit never touches the money — record what
          actually moved.
        </Text>
        {captureMode ? (
          <Text style={styles.watermark} numberOfLines={1}>
            RupeeSplit · {groupName} · {activeFilter.label}
          </Text>
        ) : null}
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
  hint: { color: colors.mutedDim, fontSize: 11.5, lineHeight: 16, marginTop: spacing(1) },
  captureFilter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.5),
    marginTop: spacing(1.5),
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
    marginTop: spacing(3.5),
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
  chipActive: { borderColor: tints.accent.border, backgroundColor: tints.accent.fill },
  chipText: { color: colors.muted, fontSize: 11.5, fontWeight: '700' },
  chipTextActive: { color: colors.accent },

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
    gap: spacing(1),
  },
  summaryMain: { color: colors.muted, fontSize: 11.5, fontWeight: '600' },
  summaryAmount: { color: colors.text, fontSize: 13, fontWeight: '800' },
  summaryMe: { fontSize: 11.5, fontWeight: '700' },

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
  personNet: { fontSize: 11.5, fontWeight: '800', fontVariant: ['tabular-nums'] },

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
  sectionLabel: {
    color: colors.mutedDim,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: spacing(0.5),
  },
  transferRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing(2),
    paddingVertical: spacing(1.5),
  },
  transferLeft: { flex: 1 },
  transferSentence: { color: colors.textSoft, fontSize: 11.5, lineHeight: 16, fontWeight: '600' },
  transferAmount: {
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

  empty: { alignItems: 'center', paddingVertical: spacing(5), paddingHorizontal: spacing(2) },
  emptyEmoji: { fontSize: 30 },
  emptyTitle: {
    color: colors.text,
    fontSize: 14.5,
    fontWeight: '800',
    marginTop: spacing(2),
    textAlign: 'center',
  },
  resetButton: {
    marginTop: spacing(3),
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
    marginTop: spacing(2),
    textAlign: 'center',
  },
})
