import React, { useMemo, useState } from 'react'
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native'
import { API_BASE } from '../config'
import { Avatar, Banner, Body, Button, Card, Field, ModalSheet, Muted, Pill, Screen } from '../components/ui'
import { useStore } from '../state'
import { computeBalances, nameOf } from '../lib/balances'
import { formatPaise, parseRupees } from '../lib/money'
import { planSettlements } from '../lib/settlement'
import type { ExpenseCategory, MemberId } from '../lib/types'
import { colors, radius, spacing } from '../theme'

type Tab = 'expenses' | 'balances' | 'settle'

const CATEGORIES: { id: ExpenseCategory; label: string }[] = [
  { id: 'food', label: 'Food' },
  { id: 'travel', label: 'Travel' },
  { id: 'stay', label: 'Stay' },
  { id: 'groceries', label: 'Groceries' },
  { id: 'entertainment', label: 'Fun' },
  { id: 'utilities', label: 'Bills' },
  { id: 'shopping', label: 'Shopping' },
  { id: 'other', label: 'Other' },
]

export function GroupScreen() {
  const {
    active,
    busy,
    error,
    closeGroup,
    refresh,
    addExpense,
    removeExpense,
    acknowledge,
    addPerson,
    settle,
    confirmSettlement,
  } = useStore()
  const [tab, setTab] = useState<Tab>('expenses')
  const [addingExpense, setAddingExpense] = useState(false)
  const [addingPerson, setAddingPerson] = useState(false)

  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<ExpenseCategory>('food')
  const [participants, setParticipants] = useState<MemberId[]>([])
  const [personName, setPersonName] = useState('')
  const [personUpi, setPersonUpi] = useState('')
  const [formError, setFormError] = useState('')

  const snapshot = active?.snapshot
  const group = snapshot?.group
  const me = snapshot?.me

  const expenses = useMemo(
    () => (snapshot?.expenses ?? []).filter((expense) => !expense.deletedAt).sort((a, b) => b.date - a.date),
    [snapshot],
  )
  const settlements = snapshot?.settlements ?? []
  const activeMembers = useMemo(() => (group?.members ?? []).filter((member) => !member.leftAt), [group])
  const balances = useMemo(
    () => (group ? computeBalances({ group, expenses, settlements }) : []),
    [group, expenses, settlements],
  )
  const plan = useMemo(() => planSettlements(balances), [balances])
  const mine = balances.find((balance) => balance.memberId === me?.id)

  if (!active || !group || !snapshot || !me) {
    return (
      <Screen>
        <Button label="Back" variant="ghost" onPress={closeGroup} />
        <Muted>Loading the ledger…</Muted>
      </Screen>
    )
  }

  const openAddExpense = () => {
    setAmount('')
    setDescription('')
    setCategory('food')
    setParticipants(activeMembers.map((member) => member.id))
    setFormError('')
    setAddingExpense(true)
  }

  const submitExpense = async () => {
    const paise = parseRupees(amount)
    if (!paise || paise <= 0) return setFormError('Enter the amount in rupees, e.g. 450 or 450.50.')
    if (!description.trim()) return setFormError('What was this for?')
    if (participants.length === 0) return setFormError('Pick at least one person to share it.')
    setFormError('')
    const ok = await addExpense({
      amountPaise: paise,
      description: description.trim(),
      category,
      date: Date.now(),
      payers: [{ memberId: me.id, amountPaise: paise }],
      split: { mode: 'equal', participants },
    })
    if (ok) setAddingExpense(false)
  }

  const shareInvite = () => {
    const link = `${API_BASE}/#/join/${snapshot.code}`
    void Share.share({
      message: `Join “${group.name}” on RupeeTrail — log who paid what and settle up: ${link} (code ${snapshot.code})`,
    })
  }

  const openExpenseActions = (expenseId: string, title: string, mineAck: string) => {
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = []
    if (mineAck !== 'acknowledged') {
      buttons.push({ text: 'This looks right', onPress: () => void acknowledge(expenseId, 'acknowledged') })
    }
    buttons.push({ text: 'Question it', onPress: () => void acknowledge(expenseId, 'questioned') })
    buttons.push({
      text: 'Delete expense',
      style: 'destructive',
      onPress: () =>
        Alert.alert('Remove this expense?', 'It stays in history and can be restored on the web app.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => void removeExpense(expenseId) },
        ]),
    })
    buttons.push({ text: 'Close', style: 'cancel' })
    Alert.alert(title, 'Acknowledge it, question it, or remove it.', buttons)
  }

  return (
    <Screen>
      <View style={styles.head}>
        <Pressable onPress={closeGroup} hitSlop={10}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.groupName}>
            {group.emoji} {group.name}
          </Text>
          <Muted small>
            {activeMembers.length} {activeMembers.length === 1 ? 'person' : 'people'} ·{' '}
            {active.live === 'live' ? 'live' : active.live === 'connecting' ? 'connecting…' : 'offline'}
          </Muted>
        </View>
        <Pressable onPress={shareInvite} hitSlop={10}>
          <Text style={styles.code}>{snapshot.code}</Text>
        </Pressable>
      </View>

      {error ? <Banner tone="error">{error}</Banner> : null}

      <View style={styles.tabs}>
        {(
          [
            { id: 'expenses', label: 'Expenses' },
            { id: 'balances', label: 'Balances' },
            { id: 'settle', label: 'Settle' },
          ] as { id: Tab; label: string }[]
        ).map((entry) => (
          <Pressable
            key={entry.id}
            onPress={() => setTab(entry.id)}
            style={[styles.tab, tab === entry.id && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === entry.id && { color: colors.bg }]}>{entry.label}</Text>
          </Pressable>
        ))}
      </View>

      <Body>
        <Card style={{ marginTop: spacing(4) }}>
          <Muted small>Your position</Muted>
          <Text style={[styles.position, { color: (mine?.netPaise ?? 0) >= 0 ? colors.positive : colors.negative }]}>
            {mine?.netPaise === 0
              ? 'Settled up'
              : mine && mine.netPaise > 0
                ? `${formatPaise(mine.netPaise)} due to you`
                : `${formatPaise(Math.abs(mine?.netPaise ?? 0))} you owe`}
          </Text>
          <Muted small>
            You paid {formatPaise(mine?.paidPaise ?? 0)} · your share {formatPaise(mine?.sharePaise ?? 0)}
          </Muted>
        </Card>

        {tab === 'expenses' && (
          <>
            {expenses.length === 0 ? (
              <Card>
                <Text style={styles.emptyTitle}>Nothing logged yet</Text>
                <Muted>Tap Add expense when someone pays for something.</Muted>
              </Card>
            ) : (
              expenses.map((expense) => {
                const pending = (expense.acks?.[me.id] ?? 'pending') === 'pending'
                return (
                  <Pressable
                    key={expense.id}
                    onPress={() => openExpenseActions(expense.id, expense.description, expense.acks?.[me.id] ?? 'pending')}
                  >
                    <Card style={styles.expenseCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.expenseTitle}>{expense.description}</Text>
                        <Muted small>
                          {expense.payers
                            .map((payer) => `${nameOf(group, payer.memberId)} paid`)
                            .join(' + ')}{' '}
                          · {new Date(expense.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </Muted>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.expenseAmount}>{formatPaise(expense.amountPaise)}</Text>
                        {pending ? <Pill>tap to confirm</Pill> : <Pill tone="ok">ok</Pill>}
                      </View>
                    </Card>
                  </Pressable>
                )
              })
            )}
            <Button label="Add expense" onPress={openAddExpense} />
          </>
        )}

        {tab === 'balances' && (
          <>
            {balances.map((balance) => {
              const member = group.members.find((entry) => entry.id === balance.memberId)
              if (!member) return null
              return (
                <Card key={balance.memberId} style={styles.personRow}>
                  <Avatar name={member.name} color={member.color} />
                  <View style={{ flex: 1, marginLeft: spacing(3) }}>
                    <Text style={styles.expenseTitle}>
                      {member.name}
                      {member.isPlaceholder ? '  · not joined' : ''}
                    </Text>
                    <Muted small>
                      paid {formatPaise(balance.paidPaise)} · share {formatPaise(balance.sharePaise)}
                    </Muted>
                  </View>
                  <Text
                    style={{
                      color: balance.netPaise >= 0 ? colors.positive : colors.negative,
                      fontWeight: '700',
                    }}
                  >
                    {balance.netPaise === 0 ? '—' : formatPaise(balance.netPaise)}
                  </Text>
                </Card>
              )
            })}
            <Button label="Add someone who hasn't joined" variant="soft" onPress={() => setAddingPerson(true)} />
          </>
        )}

        {tab === 'settle' && (
          <>
            <Card>
              <Text style={styles.emptyTitle}>Suggested plan</Text>
              {plan.transfers.length === 0 ? (
                <Muted>Everyone is settled. Nothing to transfer.</Muted>
              ) : (
                plan.transfers.map((transfer, index) => (
                  <View key={`${transfer.from}-${transfer.to}-${index}`} style={styles.transfer}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.expenseTitle}>
                        {nameOf(group, transfer.from)} → {nameOf(group, transfer.to)}
                      </Text>
                      <Text style={{ color: colors.text, fontSize: 15, marginTop: 2 }}>
                        {formatPaise(transfer.amountPaise)}
                      </Text>
                    </View>
                    {transfer.from === me.id || transfer.to === me.id ? (
                      <Button
                        label="Record"
                        variant="soft"
                        onPress={async () => {
                          const ok = await settle({
                            from: transfer.from,
                            to: transfer.to,
                            amountPaise: transfer.amountPaise,
                          })
                          if (ok) setTab('settle')
                        }}
                      />
                    ) : null}
                  </View>
                ))
              )}
              <Muted small>
                A payment only moves the balances after both sides confirm it.
              </Muted>
            </Card>

            {settlements.length > 0 && (
              <Card>
                <Text style={styles.emptyTitle}>Payments</Text>
                {settlements
                  .slice()
                  .reverse()
                  .map((payment) => (
                    <View key={payment.id} style={styles.transfer}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.expenseTitle}>
                          {nameOf(group, payment.from)} → {nameOf(group, payment.to)}
                        </Text>
                        <Muted small>
                          {formatPaise(payment.amountPaise)} · {payment.status.replace('_', ' ')}
                        </Muted>
                      </View>
                      {payment.status !== 'confirmed' && (
                        <View style={{ flexDirection: 'row', gap: spacing(2) }}>
                          {payment.from === me.id && payment.status !== 'payer_confirmed' && (
                            <Pressable onPress={() => void confirmSettlement(payment.id, 'paid')}>
                              <Text style={styles.link}>I paid</Text>
                            </Pressable>
                          )}
                          {payment.to === me.id && payment.status !== 'receiver_confirmed' && (
                            <Pressable onPress={() => void confirmSettlement(payment.id, 'received')}>
                              <Text style={styles.link}>Got it</Text>
                            </Pressable>
                          )}
                        </View>
                      )}
                    </View>
                  ))}
              </Card>
            )}
            <Button label="Refresh ledger" variant="ghost" onPress={() => void refresh()} />
          </>
        )}
      </Body>

      <ModalSheet visible={addingExpense} title="Add expense" onClose={() => setAddingExpense(false)}>
        <Field
          label="Amount (₹)"
          value={amount}
          onChangeText={setAmount}
          placeholder="450"
          keyboardType="decimal-pad"
        />
        <Field
          label="What was it for?"
          value={description}
          onChangeText={setDescription}
          placeholder="e.g. Beach shack dinner"
          maxLength={80}
        />

        <Text style={styles.pickerLabel}>Category</Text>
        <View style={styles.chips}>
          {CATEGORIES.map((entry) => (
            <Pressable
              key={entry.id}
              onPress={() => setCategory(entry.id)}
              style={[styles.chip, category === entry.id && styles.chipActive]}
            >
              <Text style={[styles.chipText, category === entry.id && { color: colors.bg }]}>{entry.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.pickerLabel}>Split between</Text>
        {activeMembers.map((member) => {
          const selected = participants.includes(member.id)
          return (
            <Pressable
              key={member.id}
              onPress={() =>
                setParticipants((prev) =>
                  prev.includes(member.id) ? prev.filter((id) => id !== member.id) : [...prev, member.id],
                )
              }
              style={styles.checkRow}
            >
              <View style={[styles.checkbox, selected && styles.checkboxOn]}>
                {selected ? <Text style={{ color: colors.bg, fontWeight: '900', fontSize: 12 }}>✓</Text> : null}
              </View>
              <Text style={{ color: colors.text, fontSize: 15 }}>
                {member.name}
                {member.isPlaceholder ? ' · not joined' : ''}
              </Text>
            </Pressable>
          )
        })}
        <Muted small>Paid by {me.name}. Equal split across the people ticked.</Muted>

        {formError ? <Banner tone="error">{formError}</Banner> : null}

        <Button label="Save expense" loading={busy} onPress={() => void submitExpense()} />
      </ModalSheet>

      <ModalSheet visible={addingPerson} title="Add someone by name" onClose={() => setAddingPerson(false)}>
        <Muted>
          They show up in splits right away. If they later join with the invite code, they take over this
          entry and keep their history.
        </Muted>
        <Field label="Their name" value={personName} onChangeText={setPersonName} placeholder="e.g. Priya" maxLength={40} />
        <Field
          label="UPI id (optional)"
          value={personUpi}
          onChangeText={setPersonUpi}
          placeholder="name@okhdfcbank"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button
          label="Add to group"
          loading={busy}
          onPress={async () => {
            if (!personName.trim()) return
            const ok = await addPerson(personName.trim(), personUpi)
            if (ok) {
              setAddingPerson(false)
              setPersonName('')
              setPersonUpi('')
            }
          }}
        />
      </ModalSheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', marginTop: spacing(2), gap: spacing(2) },
  back: { color: colors.text, fontSize: 32, lineHeight: 34, paddingRight: spacing(1) },
  groupName: { color: colors.text, fontSize: 20, fontWeight: '800' },
  code: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.5,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing(1),
    marginTop: spacing(4),
    borderWidth: 1,
    borderColor: colors.border,
  },
  tab: { flex: 1, paddingVertical: spacing(2.5), borderRadius: radius.sm, alignItems: 'center' },
  tabActive: { backgroundColor: colors.accent },
  tabText: { color: colors.muted, fontWeight: '700', fontSize: 13 },
  position: { fontSize: 24, fontWeight: '800', marginVertical: spacing(1) },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: spacing(1) },
  expenseCard: { flexDirection: 'row', alignItems: 'center', gap: spacing(2) },
  expenseTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  expenseAmount: { color: colors.text, fontSize: 16, fontWeight: '800' },
  personRow: { flexDirection: 'row', alignItems: 'center' },
  transfer: { flexDirection: 'row', alignItems: 'center', marginTop: spacing(3), gap: spacing(3) },
  link: { color: colors.accent, fontWeight: '700', paddingVertical: spacing(1) },
  pickerLabel: {
    color: colors.muted,
    fontSize: 12,
    marginTop: spacing(4),
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2), marginTop: spacing(2) },
  chip: {
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(3), paddingVertical: spacing(2.5) },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
})
