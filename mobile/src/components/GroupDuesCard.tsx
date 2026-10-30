/**
 * A payer × payee table for the whole group. Rows owe columns, and each cell is
 * the full amount from the actual expenses — never netted against payments.
 */
import React, { useMemo } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Avatar, Card, Pill } from './ui'
import { buildGroupDues } from '../lib/payback'
import { formatPaise } from '../lib/money'
import { colors, radius, spacing, tints } from '../theme'
import type { Expense, MemberId } from '../lib/types'

const AMOUNT_COL = 84
const SUM_COL = 88
const PERSON_COL = 118
const HEADER_H = 44
const ROW_H = 42
const FOOT_H = 42

function shortName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

export interface GroupDuesCardProps {
  expenses: Expense[]
  memberIds: MemberId[]
  meId?: MemberId
  nameOf: (id: MemberId) => string
  colorOf: (id: MemberId) => number
}

export function GroupDuesCard({ expenses, memberIds, meId, nameOf, colorOf }: GroupDuesCardProps) {
  const view = useMemo(() => buildGroupDues(expenses, { memberIds }), [expenses, memberIds])
  const empty = view.pairCount === 0
  const hasExpenses = expenses.some((expense) => !expense.deletedAt && expense.amountPaise > 0)

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headTitle}>
          <Ionicons name="people-outline" size={17} color={colors.accent} />
          <Text style={styles.title}>Everyone’s dues</Text>
        </View>
        <Pill tone={empty ? 'muted' : 'ok'}>
          {view.pairCount} {view.pairCount === 1 ? 'due' : 'dues'}
        </Pill>
      </View>

      <Text style={styles.subtitle}>
        Rows owe columns. Read across a row to see whom that person owes; read down a column to see
        who owes them. Every amount comes from the actual expenses — payments are never subtracted
        here.
      </Text>

      {empty ? (
        <View style={styles.empty}>
          <Ionicons
            name={hasExpenses ? 'checkmark-circle-outline' : 'receipt-outline'}
            size={22}
            color={colors.mutedDim}
          />
          <Text style={styles.emptyText}>
            {hasExpenses ? 'Nothing is pending between anyone.' : 'No shared expenses yet.'}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.totals}>
            <Text style={styles.totalsMain}>
              <Text style={styles.totalsAmount}>{formatPaise(view.totalPaise)}</Text> pending
              between {view.pairCount} {view.pairCount === 1 ? 'pair' : 'pairs'}
            </Text>
            <Text style={styles.totalsMeta}>
              {view.expenseCount} {view.expenseCount === 1 ? 'expense' : 'expenses'} behind it ·
              payments not deducted
            </Text>
          </View>

          <View style={styles.table}>
            <View style={styles.fixedCol}>
              <View style={[styles.headCorner, { height: HEADER_H }]}>
                <Text style={styles.cornerOwes}>Owes</Text>
                <Text style={styles.cornerTo}>to →</Text>
              </View>
              {view.members.map((row) => {
                const rowName = nameOf(row.memberId)
                return (
                  <View key={row.memberId} style={[styles.personCell, { height: ROW_H }]}>
                    <Avatar name={rowName} color={colorOf(row.memberId)} size={22} />
                    <Text style={styles.personName} numberOfLines={1}>
                      {shortName(rowName)}
                    </Text>
                    {row.memberId === meId ? <Text style={styles.you}>you</Text> : null}
                  </View>
                )
              })}
              <View style={[styles.personCell, styles.footCell, { height: FOOT_H }]}>
                <Text style={styles.footLabel}>Gets</Text>
              </View>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tableWrap}
              accessibilityLabel="Gross amount each person owes each other person"
            >
              <View>
                <View style={[styles.row, styles.headRow, { height: HEADER_H }]}>
                  {view.members.map((member) => (
                    <View key={member.memberId} style={styles.amountCell}>
                      <Text style={[styles.amountText, styles.headCell]} numberOfLines={1}>
                        {shortName(nameOf(member.memberId))}
                      </Text>
                    </View>
                  ))}
                  <View style={[styles.amountCell, styles.sumCell]}>
                    <Text style={[styles.amountText, styles.headCell]}>Owes</Text>
                  </View>
                </View>

                {view.members.map((row) => (
                  <View key={row.memberId} style={[styles.row, styles.dataRow, { height: ROW_H }]}>
                    {view.members.map((column) => {
                      if (column.memberId === row.memberId) {
                        return (
                          <View key={column.memberId} style={styles.amountCell}>
                            <Text style={[styles.amountText, styles.amountNone]}>·</Text>
                          </View>
                        )
                      }
                      const edge = row.owes.find((entry) => entry.memberId === column.memberId)
                      return (
                        <View key={column.memberId} style={styles.amountCell}>
                          <Text
                            style={[
                              styles.amountText,
                              edge ? styles.amountDue : styles.amountNone,
                            ]}
                            numberOfLines={1}
                          >
                            {edge ? formatPaise(edge.amountPaise) : '—'}
                          </Text>
                        </View>
                      )
                    })}
                    <View style={[styles.amountCell, styles.sumCell]}>
                      <Text
                        style={[
                          styles.amountText,
                          row.owesPaise > 0 ? styles.sumDue : styles.amountNone,
                        ]}
                        numberOfLines={1}
                      >
                        {row.owesPaise > 0 ? formatPaise(row.owesPaise) : '—'}
                      </Text>
                    </View>
                  </View>
                ))}

                <View style={[styles.row, styles.footRow, { height: FOOT_H }]}>
                  {view.members.map((member) => (
                    <View key={member.memberId} style={styles.amountCell}>
                      <Text
                        style={[
                          styles.amountText,
                          member.owedByPaise > 0 ? styles.getCell : styles.amountNone,
                        ]}
                        numberOfLines={1}
                      >
                        {member.owedByPaise > 0 ? formatPaise(member.owedByPaise) : '—'}
                      </Text>
                    </View>
                  ))}
                  <View style={[styles.amountCell, styles.sumCell]}>
                    <Text style={[styles.amountText, styles.getTotal]} numberOfLines={1}>
                      {formatPaise(view.totalPaise)}
                    </Text>
                  </View>
                </View>
              </View>
            </ScrollView>
          </View>

          <Text style={styles.legend}>
            Totals are gross: every expense counts in full for the person who paid. Recorded
            payments stay separate and are never subtracted from this table.
          </Text>
        </>
      )}
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
  totalsAmount: { color: colors.text, fontWeight: '800', fontVariant: ['tabular-nums'] },
  totalsMeta: { color: colors.mutedDim, fontSize: 10.5, fontWeight: '600' },

  tableWrap: { paddingVertical: spacing(2.5) },
  table: { flexDirection: 'row', marginTop: spacing(0.5) },
  fixedCol: {
    width: PERSON_COL,
    borderRightWidth: 1,
    borderRightColor: colors.borderSoft,
    paddingVertical: spacing(2.5),
  },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  headRow: { backgroundColor: colors.surfaceAlt },
  dataRow: { borderTopWidth: 1, borderTopColor: colors.borderSoft },
  personCell: {
    width: PERSON_COL,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.6),
    paddingHorizontal: spacing(2),
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  headCorner: {
    backgroundColor: colors.surfaceAlt,
    justifyContent: 'center',
    gap: spacing(0.6),
    paddingHorizontal: spacing(2),
  },
  footCell: { borderTopWidth: 1, borderTopColor: colors.border },
  cornerOwes: {
    color: colors.mutedDim,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  cornerTo: { color: colors.mutedDim, fontSize: 9, fontWeight: '600' },
  personName: { color: colors.text, fontSize: 11.5, fontWeight: '700', flexShrink: 1 },
  you: {
    color: colors.accent,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    backgroundColor: tints.accent.fill,
    borderRadius: radius.pill,
    paddingHorizontal: spacing(1.2),
    paddingVertical: 1,
    overflow: 'hidden',
  },
  amountCell: {
    width: AMOUNT_COL,
    justifyContent: 'center',
    paddingHorizontal: spacing(2),
  },
  amountText: {
    color: colors.textSoft,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  headCell: {
    color: colors.muted,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  amountDue: { color: colors.text, fontWeight: '800' },
  amountNone: { color: colors.mutedDim, fontWeight: '600' },
  sumCell: { borderLeftWidth: 1, borderLeftColor: colors.borderSoft, width: SUM_COL },
  sumDue: { color: colors.coral, fontWeight: '800' },
  footRow: { borderTopWidth: 1, borderTopColor: colors.border },
  footLabel: {
    color: colors.mutedDim,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  getCell: { color: colors.accent, fontWeight: '800' },
  getTotal: { color: colors.accent, fontWeight: '800' },
  legend: {
    color: colors.mutedDim,
    fontSize: 10.5,
    lineHeight: 15,
    marginTop: spacing(1),
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing(4),
    paddingHorizontal: spacing(2),
    gap: spacing(1.5),
  },
  emptyText: { color: colors.textSoft, fontSize: 12.5, fontWeight: '700', textAlign: 'center' },
})
