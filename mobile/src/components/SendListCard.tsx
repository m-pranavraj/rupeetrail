/**
 * "What each person pays" — pick a person and read only the payments they make,
 * one plain sentence each. Tap why to open the expenses behind an amount.
 *
 * Amounts are gross pairwise totals from the expenses themselves, so a line
 * never shrinks because money already moved, and nothing the person receives
 * appears here. That keeps the list usable as a send-it-everyone checklist.
 */
import React, { useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Avatar, Card, PressableScale } from './ui'
import { buildGroupDues, type DuesEdge } from '../lib/payback'
import { formatPaise } from '../lib/money'
import { isValidUpi } from '../lib/upi'
import { colors, radius, spacing, tints } from '../theme'
import type { Expense, MemberId } from '../lib/types'

const formatDay = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

function shortName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

function countExpenses(edges: DuesEdge[]): number {
  const ids = new Set<string>()
  for (const edge of edges) for (const line of edge.lines) ids.add(line.expenseId)
  return ids.size
}

export interface SendListCardProps {
  expenses: Expense[]
  memberIds: MemberId[]
  meId: MemberId
  groupName: string
  nameOf: (id: MemberId) => string
  colorOf: (id: MemberId) => number
  upiOf: (id: MemberId) => string | undefined
  onPayUpi: (toId: MemberId, amountPaise: number) => void
}

export function SendListCard({
  expenses,
  memberIds,
  meId,
  groupName,
  nameOf,
  colorOf,
  upiOf,
  onPayUpi,
}: SendListCardProps) {
  const view = useMemo(() => buildGroupDues(expenses, { memberIds }), [expenses, memberIds])
  const [picked, setPicked] = useState<MemberId>('')
  const [open, setOpen] = useState<Set<MemberId>>(() => new Set())

  const options = useMemo(() => {
    const ids = [...memberIds]
    if (!ids.includes(meId)) ids.unshift(meId)
    return ids
  }, [memberIds, meId])
  const byId = useMemo(
    () => new Map(view.members.map((member) => [member.memberId, member])),
    [view],
  )

  const senderId = picked && byId.has(picked) ? picked : byId.has(meId) ? meId : options[0]
  const sender = byId.get(senderId)
  const sends = sender?.owes ?? []
  const senderName = senderId ? nameOf(senderId) : ''
  const senderIsMe = senderId === meId
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
    <Card style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="send-outline" size={17} color={colors.coral} />
        <Text style={styles.title}>What each person pays</Text>
      </View>

      <Text style={styles.subtitle}>
        Tap a name for one line per payment that person makes — nothing they receive is listed. Tap
        why to see the expenses behind an amount.
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.people}
        accessibilityLabel="Choose whose payments to list"
      >
        {options.map((memberId) => {
          const amount = byId.get(memberId)?.owesPaise ?? 0
          const label = nameOf(memberId)
          const active = memberId === senderId
          return (
            <PressableScale
              key={memberId}
              onPress={() => {
                setPicked(memberId)
                setOpen(new Set())
              }}
              scaleTo={0.96}
              accessibilityLabel={
                memberId === meId
                  ? 'Show your payments'
                  : `Show payments ${label} makes`
              }
            >
              <View style={[styles.personChip, active && styles.personChipActive]}>
                <Avatar name={label} color={colorOf(memberId)} size={20} />
                <Text style={[styles.personName, active && styles.personNameActive]} numberOfLines={1}>
                  {shortName(label)}
                  {memberId === meId ? ' · you' : ''}
                </Text>
                <Text style={[styles.personAmount, amount === 0 && styles.personAmountClear]}>
                  {amount > 0 ? formatPaise(amount) : '—'}
                </Text>
              </View>
            </PressableScale>
          )
        })}
      </ScrollView>

      {sends.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="checkmark-circle-outline" size={22} color={colors.mutedDim} />
          <Text style={styles.emptyText}>
            {senderIsMe ? 'You have nothing to pay anyone.' : `${senderName} has nothing to pay anyone.`}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.totals}>
            <Text style={styles.totalsMain}>
              <Text style={styles.totalsAmount}>{formatPaise(sender?.owesPaise ?? 0)}</Text>{' '}
              {senderIsMe ? 'for you to pay' : `for ${senderShort} to pay`}
            </Text>
            <Text style={styles.totalsMeta}>
              {sends.length} {sends.length === 1 ? 'person' : 'people'} · {expenseCount}{' '}
              {expenseCount === 1 ? 'expense' : 'expenses'}
            </Text>
          </View>

          {sends.map((edge) => {
            const payeeName = nameOf(edge.memberId)
            const isOpen = open.has(edge.memberId)
            const upiId = upiOf(edge.memberId)
            const canPayUpi = senderIsMe && Boolean(upiId) && isValidUpi(upiId ?? '')
            return (
              <View key={edge.memberId} style={styles.line}>
                <View style={styles.lineTop}>
                  <Text style={styles.lineText}>
                    {senderIsMe ? 'Pay ' : `${senderShort} pays `}
                    <Text style={styles.linePayee}>{payeeName}</Text>
                  </Text>
                  <Text style={styles.lineAmount}>{formatPaise(edge.amountPaise)}</Text>
                </View>

                <View style={styles.actions}>
                  <PressableScale
                    onPress={() => toggle(edge.memberId)}
                    scaleTo={0.94}
                    accessibilityLabel={`${isOpen ? 'Hide' : 'Show'} the expenses behind ${formatPaise(
                      edge.amountPaise,
                    )}`}
                  >
                    <View style={[styles.whyChip, isOpen && styles.whyChipOpen]}>
                      <Ionicons
                        name={isOpen ? 'chevron-up' : 'chevron-down'}
                        size={11}
                        color={isOpen ? colors.coral : colors.mutedDim}
                      />
                      <Text style={[styles.whyText, isOpen && styles.whyTextOpen]}>
                        why {formatPaise(edge.amountPaise)}?
                      </Text>
                    </View>
                  </PressableScale>
                  {canPayUpi ? (
                    <PressableScale
                      onPress={() => onPayUpi(edge.memberId, edge.amountPaise)}
                      scaleTo={0.94}
                      accessibilityLabel={`Pay ${payeeName} ${formatPaise(edge.amountPaise)} by UPI`}
                    >
                      <View style={styles.upiChip}>
                        <Text style={styles.upiText}>Send UPI</Text>
                      </View>
                    </PressableScale>
                  ) : null}
                </View>

                {isOpen ? (
                  <View style={styles.reasons}>
                    <View style={styles.reasonsHead}>
                      <Text style={styles.reasonsLabel}>From these expenses</Text>
                      <Text style={styles.reasonsCount}>
                        {edge.lines.length} · {formatPaise(edge.amountPaise)}
                      </Text>
                    </View>
                    {edge.lines.map((line, index) => (
                      <View key={`${line.expenseId}-${index}`} style={styles.reasonRow}>
                        <View style={styles.reasonText}>
                          <Text style={styles.reasonTitle} numberOfLines={2}>
                            {line.description}
                          </Text>
                          <Text style={styles.reasonDate}>{formatDay(line.date)}</Text>
                        </View>
                        <Text style={styles.reasonAmount}>{formatPaise(line.amountPaise)}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            )
          })}
        </>
      )}

      <Text style={styles.legend}>
        Every amount is the full expense total for that pair of people. Recording a payment does not
        shrink these lines — {groupName} keeps them as the expenses happened.
      </Text>
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { paddingBottom: spacing(3.5) },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing(2) },
  title: { color: colors.text, fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { color: colors.mutedDim, fontSize: 11.5, lineHeight: 16, marginTop: spacing(1.5) },

  people: { gap: spacing(2), paddingVertical: spacing(1), marginTop: spacing(2) },
  personChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.5),
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.4),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bgElevated,
  },
  personChipActive: { borderColor: tints.accent.border, backgroundColor: tints.accent.fill },
  personName: { color: colors.muted, fontSize: 11.5, fontWeight: '700', maxWidth: 110 },
  personNameActive: { color: colors.text },
  personAmount: {
    color: colors.coral,
    fontSize: 11.5,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  personAmountClear: { color: colors.mutedDim, fontWeight: '600' },

  totals: {
    marginTop: spacing(2.5),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2.4),
    gap: spacing(0.8),
  },
  totalsMain: { color: colors.textSoft, fontSize: 12, fontWeight: '600', lineHeight: 18 },
  totalsAmount: { color: colors.text, fontWeight: '800', fontVariant: ['tabular-nums'] },
  totalsMeta: { color: colors.mutedDim, fontSize: 10.5, fontWeight: '600' },

  line: { paddingVertical: spacing(2.4), borderTopWidth: 1, borderTopColor: colors.borderSoft },
  lineTop: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing(2) },
  lineText: { flex: 1, minWidth: 0, color: colors.textSoft, fontSize: 13.5, lineHeight: 19 },
  linePayee: { color: colors.text, fontWeight: '800' },
  lineAmount: {
    color: colors.coral,
    fontSize: 15,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing(1.5), marginTop: spacing(1.5) },
  whyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1),
    height: 26,
    paddingHorizontal: spacing(2.2),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bgElevated,
  },
  whyChipOpen: { borderColor: colors.border, backgroundColor: colors.surfaceHigh },
  whyText: { color: colors.muted, fontSize: 10.5, fontWeight: '700' },
  whyTextOpen: { color: colors.coral },
  upiChip: {
    height: 26,
    paddingHorizontal: spacing(2.5),
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: tints.accent.border,
    backgroundColor: tints.accent.fill,
  },
  upiText: { color: colors.accent, fontSize: 10, fontWeight: '800' },

  reasons: {
    marginTop: spacing(1.8),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: spacing(2.5),
    paddingVertical: spacing(2),
  },
  reasonsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing(2),
  },
  reasonsLabel: {
    color: colors.mutedDim,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  reasonsCount: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing(2),
    paddingVertical: spacing(1.3),
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    marginTop: spacing(1),
  },
  reasonText: { flex: 1, minWidth: 0 },
  reasonTitle: { color: colors.textSoft, fontSize: 11.5, fontWeight: '600', lineHeight: 15 },
  reasonDate: { color: colors.mutedDim, fontSize: 10, marginTop: 2 },
  reasonAmount: {
    color: colors.text,
    fontSize: 11.5,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginTop: 1,
  },

  empty: {
    alignItems: 'center',
    paddingVertical: spacing(4),
    paddingHorizontal: spacing(2),
    gap: spacing(1.5),
    marginTop: spacing(2.5),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bgElevated,
  },
  emptyText: { color: colors.textSoft, fontSize: 12.5, fontWeight: '700', textAlign: 'center' },

  legend: { color: colors.mutedDim, fontSize: 10.5, lineHeight: 15, marginTop: spacing(3) },
})
