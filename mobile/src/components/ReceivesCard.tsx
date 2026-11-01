/**
 * "What everyone gets" — the receiving side of the group in one place. Each row
 * is one person and the full amount the rest of the group owes them, with the
 * payers behind it one tap away.
 */
import React, { useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Avatar, Card, Pill, PressableScale } from './ui'
import { buildGroupDues } from '../lib/payback'
import { formatPaise } from '../lib/money'
import { colors, radius, spacing } from '../theme'
import type { Expense, MemberId } from '../lib/types'

export interface ReceivesCardProps {
  expenses: Expense[]
  memberIds: MemberId[]
  meId?: MemberId
  nameOf: (id: MemberId) => string
  colorOf: (id: MemberId) => number
}

export function ReceivesCard({ expenses, memberIds, meId, nameOf, colorOf }: ReceivesCardProps) {
  const view = useMemo(() => buildGroupDues(expenses, { memberIds }), [expenses, memberIds])
  const [open, setOpen] = useState<Set<MemberId>>(() => new Set())

  const receivers = useMemo(
    () =>
      view.members
        .filter((member) => member.owedByPaise > 0)
        .sort((a, b) => b.owedByPaise - a.owedByPaise || a.memberId.localeCompare(b.memberId)),
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
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headTitle}>
          <Ionicons name="wallet-outline" size={17} color={colors.accent} />
          <Text style={styles.title}>What everyone gets</Text>
        </View>
        <Pill tone={receivers.length > 0 ? 'ok' : 'muted'}>
          {receivers.length > 0
            ? `${receivers.length} ${receivers.length === 1 ? 'person' : 'people'} collecting`
            : 'nobody is owed'}
        </Pill>
      </View>

      <Text style={styles.subtitle}>
        The total each person takes in from the group, all in one place. Tap a name to see who pays
        them. What they pay out is in “What each person pays”.
      </Text>

      {receivers.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons
            name={
              expenses.some((expense) => !expense.deletedAt && expense.amountPaise > 0)
                ? 'checkmark-circle-outline'
                : 'receipt-outline'
            }
            size={22}
            color={colors.mutedDim}
          />
          <Text style={styles.emptyText}>
            {expenses.some((expense) => !expense.deletedAt && expense.amountPaise > 0)
              ? 'Nobody is collecting from anyone right now.'
              : 'No shared expenses yet.'}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.totals}>
            <Text style={styles.totalsMain}>
              <Text style={styles.totalsAmount}>{formatPaise(view.totalPaise)}</Text> to collect
              across {receivers.length} {receivers.length === 1 ? 'person' : 'people'}
            </Text>
            <Text style={styles.totalsMeta}>
              {view.expenseCount} {view.expenseCount === 1 ? 'expense' : 'expenses'} behind it ·
              payments not deducted
            </Text>
          </View>

          {receivers.map((member) => {
            const label = nameOf(member.memberId)
            const isOpen = open.has(member.memberId)
            return (
              <View key={member.memberId} style={styles.row}>
                <PressableScale
                  onPress={() => toggle(member.memberId)}
                  scaleTo={0.99}
                  accessibilityLabel={`${label} gets ${formatPaise(member.owedByPaise)}, ${
                    isOpen ? 'hide' : 'show'
                  } who pays`}
                >
                  <View style={styles.rowHead}>
                    <Avatar name={label} color={colorOf(member.memberId)} size={32} />
                    <View style={styles.rowId}>
                      <Text style={styles.rowName} numberOfLines={1}>
                        {label}
                        {member.memberId === meId ? ' · you' : ''}
                      </Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        from {member.owedBy.length}{' '}
                        {member.owedBy.length === 1 ? 'person' : 'people'} · {member.expenseCount}{' '}
                        {member.expenseCount === 1 ? 'expense' : 'expenses'}
                      </Text>
                    </View>
                    <Text style={styles.rowAmount}>{formatPaise(member.owedByPaise)}</Text>
                    <Ionicons
                      name={isOpen ? 'chevron-up' : 'chevron-down'}
                      size={14}
                      color={colors.mutedDim}
                    />
                  </View>
                </PressableScale>

                {isOpen ? (
                  <View style={styles.payers}>
                    {member.owedBy.map((edge) => (
                      <View key={edge.memberId} style={styles.payerRow}>
                        <Text style={styles.payerName} numberOfLines={1}>
                          From {nameOf(edge.memberId)}
                        </Text>
                        <Text style={styles.payerMeta}>
                          {edge.expenseCount} {edge.expenseCount === 1 ? 'expense' : 'expenses'}
                        </Text>
                        <Text style={styles.payerAmount}>{formatPaise(edge.amountPaise)}</Text>
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
        The same money the dues table adds up, read from the receiving side. These are gross totals —
        recording a payment does not shrink them.
      </Text>
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { paddingBottom: spacing(3.5) },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing(2) },
  headTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { color: colors.mutedDim, fontSize: 11.5, lineHeight: 16, marginTop: spacing(1.5) },

  totals: {
    marginTop: spacing(3),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2.4),
    gap: spacing(0.8),
  },
  totalsMain: { color: colors.textSoft, fontSize: 12, fontWeight: '600', lineHeight: 17 },
  totalsAmount: { color: colors.accent, fontWeight: '800', fontVariant: ['tabular-nums'] },
  totalsMeta: { color: colors.mutedDim, fontSize: 10.5, fontWeight: '600' },

  row: { borderTopWidth: 1, borderTopColor: colors.borderSoft, marginTop: spacing(2) },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2.5),
    paddingVertical: spacing(2.6),
  },
  rowId: { flex: 1, minWidth: 0 },
  rowName: { color: colors.text, fontSize: 13, fontWeight: '700' },
  rowMeta: { color: colors.mutedDim, fontSize: 10.5, marginTop: 2 },
  rowAmount: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },

  payers: {
    marginBottom: spacing(2.5),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(1.5),
  },
  payerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    paddingVertical: spacing(1.6),
  },
  payerName: { flex: 1, minWidth: 0, color: colors.textSoft, fontSize: 12, fontWeight: '600' },
  payerMeta: { color: colors.mutedDim, fontSize: 10 },
  payerAmount: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },

  empty: {
    alignItems: 'center',
    paddingVertical: spacing(4),
    paddingHorizontal: spacing(2),
    gap: spacing(1.5),
  },
  emptyText: { color: colors.textSoft, fontSize: 12.5, fontWeight: '700', textAlign: 'center' },

  legend: { color: colors.mutedDim, fontSize: 10.5, lineHeight: 15, marginTop: spacing(3) },
})
