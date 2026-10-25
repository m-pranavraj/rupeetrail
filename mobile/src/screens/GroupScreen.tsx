import React, { useMemo, useState } from 'react'
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Avatar,
  AvatarStack,
  Banner,
  Button,
  Card,
  Divider,
  EmptyState,
  FadeIn,
  IconButton,
  KeyboardAware,
  Label,
  Muted,
  Pill,
  PressableScale,
  Screen,
  Sheet,
  Toast,
  buzz,
  tap,
} from '../components/ui'
import { TripMap, type MapPoint } from '../components/TripMap'
import { ExpenseForm } from '../components/ExpenseForm'
import { ExpenseDetail } from '../components/ExpenseDetail'
import { GroupSettingsSheet } from '../components/GroupSettingsSheet'
import { useStore } from '../state'
import { API_BASE, APP_LABEL } from '../config'
import { computeBalances, isReconciled, nameOf } from '../lib/balances'
import { formatPaise } from '../lib/money'
import { planSettlements } from '../lib/settlement'
import { shareTripCsv } from '../lib/csv'
import { isValidUpi, upiPayLink } from '../lib/upi'
import { categoryColors, categoryEmoji, colors, gradients, radius, spacing } from '../theme'
import type { SplitMode } from '../lib/types'

type Tab = 'expenses' | 'balances' | 'settle' | 'map'

const TABS: { id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'expenses', label: 'Ledger', icon: 'receipt-outline' },
  { id: 'balances', label: 'Balances', icon: 'scale-outline' },
  { id: 'settle', label: 'Settle', icon: 'swap-horizontal-outline' },
  { id: 'map', label: 'Map', icon: 'map-outline' },
]

const SPLIT_LABEL: Record<SplitMode, string> = {
  equal: 'equal',
  exact: 'exact',
  percent: 'percent',
  shares: 'shares',
}

function dayKey(ts: number): string {
  const date = new Date(ts)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function dayHeading(ts: number): string {
  const target = new Date(ts)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (same(target, today)) return 'Today'
  if (same(target, yesterday)) return 'Yesterday'
  return target.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })
}

export function GroupScreen() {
  const {
    active,
    geo,
    busy,
    error,
    closeGroup,
    refresh,
    addExpense,
    updateExpense,
    removeExpense,
    acknowledge,
    resolveDispute,
    patchGroup,
    addPerson,
    removePerson,
    settle,
    confirmSettlement,
    tagPlace,
    clearPlace,
  } = useStore()

  const insets = useSafeAreaInsets()
  const [tab, setTab] = useState<Tab>('expenses')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [expandedMember, setExpandedMember] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)

  const snapshot = active?.snapshot
  const group = snapshot?.group
  const me = snapshot?.me
  const membership = active?.membership

  const expenses = useMemo(
    () =>
      (snapshot?.expenses ?? [])
        .filter((expense) => !expense.deletedAt)
        .sort((a, b) => b.date - a.date),
    [snapshot],
  )
  const settlements = useMemo(() => snapshot?.settlements ?? [], [snapshot])
  const activeMembers = useMemo(
    () => (group?.members ?? []).filter((member) => !member.leftAt),
    [group],
  )
  const balances = useMemo(
    () => (group ? computeBalances({ group, expenses, settlements }) : []),
    [expenses, group, settlements],
  )
  const plan = useMemo(() => planSettlements(balances), [balances])
  const mine = balances.find((balance) => balance.memberId === me?.id)
  const reconcile = useMemo(() => isReconciled(balances), [balances])
  const totalLogged = useMemo(
    () => expenses.reduce((sum, expense) => sum + expense.amountPaise, 0),
    [expenses],
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return expenses
    return expenses.filter((expense) => {
      const payerNames = expense.payers.map((payer) => nameOf(group!, payer.memberId)).join(' ')
      return (
        expense.description.toLowerCase().includes(needle) ||
        expense.category.toLowerCase().includes(needle) ||
        payerNames.toLowerCase().includes(needle) ||
        (expense.notes ?? '').toLowerCase().includes(needle)
      )
    })
  }, [expenses, group, query])

  const grouped = useMemo(() => {
    const blocks: { key: string; heading: string; items: typeof filtered }[] = []
    for (const expense of filtered) {
      const key = dayKey(expense.date)
      const last = blocks[blocks.length - 1]
      if (last && last.key === key) last.items.push(expense)
      else blocks.push({ key, heading: dayHeading(expense.date), items: [expense] })
    }
    return blocks
  }, [filtered])

  const categoryTotals = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const expense of expenses) totals[expense.category] = (totals[expense.category] ?? 0) + expense.amountPaise
    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
  }, [expenses])

  const mapPoints = useMemo<MapPoint[]>(() => {
    const points: MapPoint[] = []
    for (const expense of expenses) {
      const place = geo[expense.id]
      if (!place) continue
      points.push({
        id: expense.id,
        lat: place.lat,
        lng: place.lng,
        label: place.label || expense.description,
        amountPaise: expense.amountPaise,
        color: categoryColors[expense.category] ?? colors.accent,
      })
    }
    return points
  }, [expenses, geo])

  const locatedTotal = useMemo(
    () => mapPoints.reduce((sum, point) => sum + (point.amountPaise ?? 0), 0),
    [mapPoints],
  )

  const detailExpense = detailId ? expenses.find((expense) => expense.id === detailId) ?? null : null
  const editingExpense = editingId ? expenses.find((expense) => expense.id === editingId) ?? null : null

  const notify = (message: string, tone: 'ok' | 'error' = 'ok') => {
    setToast({ message, tone })
    setTimeout(() => setToast(null), 2_400)
  }

  if (!active || !group || !snapshot || !me || !membership) {
    return (
      <Screen>
        <Button label="Back" variant="ghost" onPress={closeGroup} />
        <Muted>Loading the ledger…</Muted>
      </Screen>
    )
  }

  const inviteLink = `${API_BASE}/#/join/${snapshot.code}`
  const net = mine?.netPaise ?? 0
  const heroGradient = net > 0 ? gradients.heroOwed : net < 0 ? gradients.heroDebt : gradients.hero

  const shareInvite = () =>
    void Share.share({
      message: `Join “${group.name}” on RupeeSplit — log who paid what and settle up: ${inviteLink} (code ${snapshot.code})`,
    })

  const payViaUpi = async (toId: string, amountPaise: number) => {
    const member = activeMembers.find((entry) => entry.id === toId)
    if (!member) return
    if (!member.upiId || !isValidUpi(member.upiId)) {
      notify(`${member.name} has no UPI id in this group yet.`, 'error')
      return
    }
    const link = upiPayLink({
      upiId: member.upiId,
      payeeName: member.name,
      amountPaise,
      note: group.name,
    })
    try {
      await Linking.openURL(link)
    } catch {
      notify('No UPI app answered on this phone.', 'error')
    }
  }

  const confirmDelete = (expenseId: string, description: string) => {
    Alert.alert('Remove this expense?', `“${description}” stays in history and can be restored later.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const ok = await removeExpense(expenseId)
          if (ok) {
            buzz()
            setDetailId(null)
            notify('Expense removed.')
          }
        },
      },
    ])
  }

  return (
    <View style={styles.root}>
      <LinearGradient colors={gradients.canvas} style={StyleSheet.absoluteFill} />

      {/* ---------------------------------------------------------- header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing(2) }]}>
        <Pressable onPress={closeGroup} hitSlop={12} style={styles.backButton}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.groupName} numberOfLines={1}>
            {group.emoji} {group.name}
          </Text>
          <View style={styles.headerMeta}>
            <View style={[styles.liveDot, { backgroundColor: active.live === 'live' ? colors.accent : colors.warn }]} />
            <Text style={styles.headerMetaText}>
              {active.live === 'live' ? 'live' : active.live === 'connecting' ? 'connecting' : 'polling'} ·{' '}
              {activeMembers.length} {activeMembers.length === 1 ? 'person' : 'people'}
              {group.status === 'closed' ? ' · closed' : ''}
            </Text>
          </View>
        </View>
        <IconButton
          label="Invite"
          onPress={shareInvite}
          icon={<Ionicons name="person-add-outline" size={18} color={colors.text} />}
        />
        <IconButton
          label="Trip settings"
          onPress={() => setSettingsOpen(true)}
          icon={<Ionicons name="settings-outline" size={18} color={colors.text} />}
        />
      </View>

      {/* ------------------------------------------------------------ tabs */}
      <View style={styles.tabBar}>
        {TABS.map((entry) => {
          const activeTab = tab === entry.id
          return (
            <Pressable
              key={entry.id}
              onPress={() => {
                if (!activeTab) {
                  tap()
                  setTab(entry.id)
                }
              }}
              style={styles.tab}
            >
              {activeTab ? (
                <LinearGradient
                  colors={gradients.primary}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              <Ionicons
                name={entry.icon}
                size={15}
                color={activeTab ? colors.accentInk : colors.muted}
              />
              <Text style={[styles.tabLabel, activeTab && { color: colors.accentInk }]}>{entry.label}</Text>
            </Pressable>
          )
        })}
      </View>

      <KeyboardAware contentStyle={{ paddingHorizontal: spacing(5) }} extraBottom={110}>
        {/* hero position */}
        <FadeIn>
          <LinearGradient
            colors={heroGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <View style={styles.heroTop}>
              <Text style={styles.heroLabel}>
                {net === 0 ? 'All square' : net > 0 ? 'You should receive' : 'You owe'}
              </Text>
              <Pill tone={reconcile ? 'ok' : 'bad'}>{reconcile ? 'reconciled' : 'check split'}</Pill>
            </View>
            <Text
              style={[
                styles.heroAmount,
                { color: net > 0 ? colors.accent : net < 0 ? colors.coral : colors.text },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {net === 0 ? '₹0' : formatPaise(Math.abs(net))}
            </Text>
            <View style={styles.heroStats}>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroStatLabel}>You paid</Text>
                <Text style={styles.heroStatValue}>{formatPaise(mine?.paidPaise ?? 0)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroStatLabel}>Your share</Text>
                <Text style={styles.heroStatValue}>{formatPaise(mine?.sharePaise ?? 0)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroStatLabel}>Trip total</Text>
                <Text style={styles.heroStatValue}>{formatPaise(totalLogged)}</Text>
              </View>
            </View>
            <View style={styles.heroFooter}>
              <AvatarStack members={activeMembers} max={5} />
              <Pressable onPress={shareInvite} hitSlop={8}>
                <Text style={styles.heroCode}>code {snapshot.code}</Text>
              </Pressable>
            </View>
          </LinearGradient>
        </FadeIn>

        {error ? <Banner tone="error">{error}</Banner> : null}

        {/* -------------------------------------------------- expenses tab */}
        {tab === 'expenses' ? (
          <FadeIn key="expenses" offset={8}>
            {expenses.length > 3 ? (
              <View style={styles.search}>
                <Ionicons name="search-outline" size={16} color={colors.mutedDim} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search this trip"
                  placeholderTextColor={colors.mutedDim}
                  selectionColor={colors.accent}
                  style={styles.searchInput}
                />
                {query ? (
                  <Pressable onPress={() => setQuery('')} hitSlop={8}>
                    <Ionicons name="close-circle" size={16} color={colors.mutedDim} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {filtered.length === 0 ? (
              <EmptyState
                emoji={query ? '🔍' : '🧾'}
                title={query ? 'Nothing matches' : 'Nothing logged yet'}
                body={
                  query
                    ? 'Try a different word, category or person.'
                    : 'Tap Add expense when someone pays for something. Scan a bill to fill it in for you.'
                }
              />
            ) : (
              grouped.map((block) => (
                <View key={block.key}>
                  <View style={styles.dayHead}>
                    <Text style={styles.dayLabel}>{block.heading}</Text>
                    <Text style={styles.dayTotal}>
                      {formatPaise(block.items.reduce((sum, item) => sum + item.amountPaise, 0))}
                    </Text>
                  </View>
                  {block.items.map((expense, index) => {
                    const ack = expense.acks?.[me.id] ?? 'pending'
                    const disputed = expense.dispute?.status === 'open'
                    return (
                      <FadeIn key={expense.id} delay={Math.min(index * 35, 240)} offset={10}>
                        <PressableScale onPress={() => setDetailId(expense.id)} scaleTo={0.985}>
                          <Card style={styles.expenseCard}>
                            <View
                              style={[
                                styles.categoryBubble,
                                { backgroundColor: `${categoryColors[expense.category] ?? colors.accent}22` },
                              ]}
                            >
                              <Text style={{ fontSize: 16 }}>{categoryEmoji[expense.category] ?? '📦'}</Text>
                            </View>
                            <View style={{ flex: 1, marginLeft: spacing(3) }}>
                              <Text style={styles.expenseTitle} numberOfLines={1}>
                                {expense.description}
                              </Text>
                              <Text style={styles.expenseMeta} numberOfLines={1}>
                                {expense.payers.map((payer) => nameOf(group, payer.memberId)).join(' + ')} paid ·{' '}
                                {SPLIT_LABEL[expense.split.mode]} · {geo[expense.id] ? '📍 ' : ''}
                                {new Date(expense.date).toLocaleTimeString('en-IN', {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </Text>
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                              <Text style={styles.expenseAmount}>{formatPaise(expense.amountPaise)}</Text>
                              <View style={{ marginTop: spacing(1) }}>
                                {disputed ? (
                                  <Pill tone="warn">questioned</Pill>
                                ) : ack === 'pending' ? (
                                  <Pill>confirm</Pill>
                                ) : ack === 'questioned' ? (
                                  <Pill tone="warn">your question</Pill>
                                ) : (
                                  <Pill tone="ok">agreed</Pill>
                                )}
                              </View>
                            </View>
                          </Card>
                        </PressableScale>
                      </FadeIn>
                    )
                  })}
                </View>
              ))
            )}

            {categoryTotals.length > 0 ? (
              <Card>
                <Label>Where the money went</Label>
                <View style={{ marginTop: spacing(2) }}>
                  {categoryTotals.map(([category, total]) => (
                    <View key={category} style={styles.barRow}>
                      <Text style={styles.barLabel}>
                        {categoryEmoji[category] ?? '📦'} {category}
                      </Text>
                      <View style={styles.barTrack}>
                        <LinearGradient
                          colors={[categoryColors[category] ?? colors.accent, `${categoryColors[category] ?? colors.accent}66`]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={[
                            styles.barFill,
                            { width: `${Math.max(6, (total / Math.max(1, totalLogged)) * 100)}%` },
                          ]}
                        />
                      </View>
                      <Text style={styles.barValue}>{formatPaise(total)}</Text>
                    </View>
                  ))}
                </View>
              </Card>
            ) : null}
          </FadeIn>
        ) : null}

        {/* ------------------------------------------------- balances tab */}
        {tab === 'balances' ? (
          <FadeIn key="balances" offset={8}>
            {balances.map((balance) => {
              const member = group.members.find((entry) => entry.id === balance.memberId)
              if (!member) return null
              const expanded = expandedMember === balance.memberId
              return (
                <Card key={balance.memberId} style={{ marginTop: spacing(2.5) }}>
                  <Pressable
                    onPress={() => {
                      tap()
                      setExpandedMember(expanded ? null : balance.memberId)
                    }}
                    style={styles.personRow}
                  >
                    <Avatar name={member.name} color={member.color} size={38} />
                    <View style={{ flex: 1, marginLeft: spacing(3) }}>
                      <Text style={styles.personName} numberOfLines={1}>
                        {member.name}
                        {member.isPlaceholder ? '  · not joined' : ''}
                        {member.id === me.id ? '  · you' : ''}
                      </Text>
                      <Text style={styles.personMeta}>
                        paid {formatPaise(balance.paidPaise)} · share {formatPaise(balance.sharePaise)}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text
                        style={[
                          styles.personNet,
                          { color: balance.netPaise > 0 ? colors.accent : balance.netPaise < 0 ? colors.coral : colors.muted },
                        ]}
                      >
                        {balance.netPaise === 0 ? '—' : formatPaise(Math.abs(balance.netPaise))}
                      </Text>
                      <Text style={styles.personNetLabel}>
                        {balance.netPaise > 0 ? 'gets back' : balance.netPaise < 0 ? 'owes' : 'settled'}
                      </Text>
                    </View>
                  </Pressable>

                  {expanded ? (
                    <View style={styles.entries}>
                      <Divider />
                      {balance.entries.length === 0 ? (
                        <Muted small>No entries yet.</Muted>
                      ) : (
                        balance.entries.slice(0, 20).map((entry, index) => (
                          <View key={`${entry.refId}-${entry.kind}-${index}`} style={styles.entryRow}>
                            <View
                              style={[
                                styles.entryDot,
                                {
                                  backgroundColor:
                                    entry.amountPaise >= 0 ? colors.accent : colors.coral,
                                },
                              ]}
                            />
                            <Text style={styles.entryLabel} numberOfLines={1}>
                              {entry.label}
                            </Text>
                            <Text
                              style={[
                                styles.entryAmount,
                                { color: entry.amountPaise >= 0 ? colors.accent : colors.coral },
                              ]}
                            >
                              {entry.amountPaise >= 0 ? '+' : '−'}
                              {formatPaise(Math.abs(entry.amountPaise))}
                            </Text>
                          </View>
                        ))
                      )}
                      <Muted small>
                        Net = what they paid − their share ± confirmed payments. The whole group must add up to
                        zero; right now it {reconcile ? 'does' : 'does not'}.
                      </Muted>
                    </View>
                  ) : null}
                </Card>
              )
            })}

            <Button
              label="Export trip as CSV"
              variant="soft"
              icon={<Ionicons name="download-outline" size={16} color={colors.text} />}
              onPress={async () => {
                const ok = await shareTripCsv({
                  group,
                  expenses,
                  settlements,
                  viewerId: me.id,
                })
                notify(ok ? 'Trip exported.' : 'Could not export on this device.', ok ? 'ok' : 'error')
              }}
            />
            <Button label="Refresh from server" variant="ghost" onPress={() => void refresh()} />
          </FadeIn>
        ) : null}

        {/* --------------------------------------------------- settle tab */}
        {tab === 'settle' ? (
          <FadeIn key="settle" offset={8}>
            <Card>
              <Label>Suggested plan</Label>
              {plan.transfers.length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: spacing(4) }}>
                  <Text style={{ fontSize: 34 }}>🤝</Text>
                  <Text style={styles.settledTitle}>Everyone is settled</Text>
                  <Muted small>Nothing needs to move. The ledger is clean.</Muted>
                </View>
              ) : (
                plan.transfers.map((transfer, index) => {
                  const to = activeMembers.find((member) => member.id === transfer.to)
                  const involvesMe = transfer.from === me.id || transfer.to === me.id
                  const canUpi = Boolean(to?.upiId && isValidUpi(to.upiId))
                  return (
                    <View
                      key={`${transfer.from}-${transfer.to}-${index}`}
                      style={[styles.transfer, involvesMe && styles.transferMine]}
                    >
                      <Avatar
                        name={nameOf(group, transfer.from)}
                        color={group.members.find((entry) => entry.id === transfer.from)?.color ?? 0}
                        size={32}
                      />
                      <View style={{ flex: 1, marginLeft: spacing(2.5) }}>
                        <Text style={styles.transferWho} numberOfLines={1}>
                          {nameOf(group, transfer.from)} → {nameOf(group, transfer.to)}
                        </Text>
                        <Text style={styles.transferAmount}>{formatPaise(transfer.amountPaise)}</Text>
                      </View>
                      <View style={{ gap: spacing(1.5) }}>
                        {canUpi ? (
                          <PressableScale onPress={() => void payViaUpi(transfer.to, transfer.amountPaise)}>
                            <View style={styles.upiButton}>
                              <Text style={styles.upiText}>Pay UPI</Text>
                            </View>
                          </PressableScale>
                        ) : null}
                        {involvesMe ? (
                          <PressableScale
                            onPress={async () => {
                              buzz()
                              const ok = await settle({
                                from: transfer.from,
                                to: transfer.to,
                                amountPaise: transfer.amountPaise,
                              })
                              notify(ok ? 'Payment recorded — both sides confirm.' : 'Could not record that.', ok ? 'ok' : 'error')
                            }}
                          >
                            <View style={styles.recordButton}>
                              <Text style={styles.recordText}>Record</Text>
                            </View>
                          </PressableScale>
                        ) : null}
                      </View>
                    </View>
                  )
                })
              )}
              <Muted small>{plan.notes[0] ?? ''}</Muted>
            </Card>

            {settlements.length > 0 ? (
              <Card>
                <Label>Payments</Label>
                {[...settlements]
                  .sort((a, b) => b.updatedAt - a.updatedAt)
                  .map((payment) => (
                    <View key={payment.id} style={styles.paymentRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.transferWho} numberOfLines={1}>
                          {nameOf(group, payment.from)} → {nameOf(group, payment.to)}
                        </Text>
                        <Text style={styles.personMeta}>
                          {formatPaise(payment.amountPaise)} · {payment.method} ·{' '}
                          {payment.status.replace('_', ' ')}
                        </Text>
                      </View>
                      {payment.status !== 'confirmed' && payment.status !== 'disputed' ? (
                        <View style={{ flexDirection: 'row', gap: spacing(2.5) }}>
                          {payment.from === me.id && payment.status !== 'payer_confirmed' ? (
                            <Pressable onPress={() => void confirmSettlement(payment.id, 'paid')} hitSlop={8}>
                              <Text style={styles.link}>I paid</Text>
                            </Pressable>
                          ) : null}
                          {payment.to === me.id && payment.status !== 'receiver_confirmed' ? (
                            <Pressable onPress={() => void confirmSettlement(payment.id, 'received')} hitSlop={8}>
                              <Text style={styles.link}>Got it</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      ) : (
                        <Pill tone={payment.status === 'confirmed' ? 'ok' : 'bad'}>{payment.status.replace('_', ' ')}</Pill>
                      )}
                    </View>
                  ))}
                <Muted small>Balances move only after both sides (or a provider) confirm a payment.</Muted>
              </Card>
            ) : null}
          </FadeIn>
        ) : null}

        {/* ------------------------------------------------------ map tab */}
        {tab === 'map' ? (
          <FadeIn key="map" offset={8}>
            <Card tone="raised" style={{ marginTop: spacing(2) }}>
              <View style={styles.mapHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.mapTitle}>Trip map</Text>
                  <Muted small>
                    {mapPoints.length > 0
                      ? `${mapPoints.length} tagged ${mapPoints.length === 1 ? 'stop' : 'stops'} · ${formatPaise(
                          locatedTotal,
                        )} of ${formatPaise(totalLogged)} located`
                      : 'Tag expenses with a place to draw your trip.'}
                  </Muted>
                </View>
                <View style={styles.mapPinBadge}>
                  <Ionicons name="location" size={16} color={colors.accent} />
                </View>
              </View>
              <TripMap
                points={mapPoints}
                height={260}
                onPickPoint={(id) => setDetailId(id)}
                emptyHint="Open an expense, tap Tag place, and it appears here with its amount."
              />
              {mapPoints.length > 0 ? (
                <View style={styles.mapLegend}>
                  {categoryTotals.slice(0, 4).map(([category]) => (
                    <View key={category} style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: categoryColors[category] ?? colors.accent }]} />
                      <Text style={styles.legendText}>{category}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </Card>

            {mapPoints.length > 0 ? (
              <Card>
                <Label>By stop</Label>
                {mapPoints
                  .slice()
                  .sort((a, b) => (b.amountPaise ?? 0) - (a.amountPaise ?? 0))
                  .map((point) => (
                    <Pressable
                      key={point.id}
                      onPress={() => setDetailId(point.id)}
                      style={styles.stopRow}
                    >
                      <View style={[styles.stopDot, { backgroundColor: point.color ?? colors.accent }]} />
                      <Text style={styles.stopLabel} numberOfLines={1}>
                        {point.label}
                      </Text>
                      <Text style={styles.stopAmount}>{formatPaise(point.amountPaise ?? 0)}</Text>
                    </Pressable>
                  ))}
              </Card>
            ) : (
              <EmptyState
                emoji="🗺️"
                title="No pins yet"
                body="Every expense you tag with a place lands here, so the end of the trip is a map of where the money went."
                action={<Button label="Add an expense" variant="soft" onPress={() => setAdding(true)} />}
              />
            )}

            {group.status === 'closed' ? (
              <Card tone="mint">
                <Label>Trip wrap</Label>
                <Text style={styles.wrapTotal}>{formatPaise(totalLogged)}</Text>
                <Muted small>
                  across {expenses.length} expenses and {mapPoints.length} mapped stops. Export the CSV for the
                  full trail.
                </Muted>
              </Card>
            ) : null}
          </FadeIn>
        ) : null}
      </KeyboardAware>

      {/* ------------------------------------------------------------- FAB */}
      {group.status !== 'closed' ? (
        <PressableScale
          onPress={() => setAdding(true)}
          style={[styles.fab, { bottom: insets.bottom + spacing(4) }]}
        >
          <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fabFill}>
            <Ionicons name="add" size={26} color={colors.accentInk} />
          </LinearGradient>
        </PressableScale>
      ) : (
        <View style={[styles.closedBar, { bottom: insets.bottom + spacing(3) }]}>
          <Ionicons name="lock-closed-outline" size={14} color={colors.warn} />
          <Text style={styles.closedText}>Trip closed — reopen it in settings to add expenses</Text>
        </View>
      )}

      {/* ---------------------------------------------------------- sheets */}
      {adding ? (
        <ExpenseForm
          group={group}
          me={me}
          onClose={() => setAdding(false)}
          onSave={async (input, options) => {
            const id = await addExpense(input)
            if (!id) return false
            if (options.tagPlace) {
              const point = await tagPlace(id, input.description)
              if (!point) notify('Saved. Location could not be captured.', 'error')
            }
            buzz()
            setAdding(false)
            setTab('expenses')
            notify('Expense added.')
            return true
          }}
        />
      ) : null}

      {editingExpense ? (
        <ExpenseForm
          group={group}
          me={me}
          expense={editingExpense}
          hasPlace={Boolean(geo[editingExpense.id])}
          onClose={() => setEditingId(null)}
          onSave={async (input, options) => {
            const ok = await updateExpense(editingExpense.id, input)
            if (!ok) return false
            if (options.tagPlace && !geo[editingExpense.id]) await tagPlace(editingExpense.id, input.description)
            setEditingId(null)
            notify('Expense updated.')
            return true
          }}
        />
      ) : null}

      {detailExpense ? (
        <ExpenseDetail
          expense={detailExpense}
          group={group}
          me={me}
          place={geo[detailExpense.id]}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            const target = detailExpense
            setDetailId(null)
            setEditingId(target.id)
          }}
          onDelete={() => confirmDelete(detailExpense.id, detailExpense.description)}
          onAck={async (status, reason) => {
            const ok = await acknowledge(detailExpense.id, status, reason)
            if (ok) {
              buzz()
              notify(status === 'questioned' ? 'Question sent to the group.' : 'Marked as agreed.')
            }
          }}
          onResolve={async (resolution) => {
            const ok = await resolveDispute(detailExpense.id, resolution)
            if (ok) notify('Question resolved.')
          }}
          onTagPlace={async () => {
            const point = await tagPlace(detailExpense.id, detailExpense.description)
            notify(point ? 'Pinned on the trip map.' : 'Could not get a location.', point ? 'ok' : 'error')
          }}
          onClearPlace={async () => {
            await clearPlace(detailExpense.id)
            notify('Place removed.')
          }}
        />
      ) : null}

      {settingsOpen ? (
        <GroupSettingsSheet
          group={group}
          code={snapshot.code}
          inviteLink={inviteLink}
          meId={me.id}
          appVersion={APP_LABEL}
          totalPaise={totalLogged}
          onClose={() => setSettingsOpen(false)}
          onRename={async (nextName, nextEmoji) => {
            const ok = await patchGroup({ name: nextName, emoji: nextEmoji })
            if (ok) notify('Trip renamed.')
            return ok
          }}
          onStatus={async (status) => {
            const ok = await patchGroup({ status })
            if (ok) notify(status === 'closed' ? 'Trip closed.' : 'Trip reopened.')
            return ok
          }}
          onAddPerson={async (personName, upiId) => {
            const ok = await addPerson(personName, upiId)
            if (ok) notify('Person added.')
            return ok
          }}
          onRemovePerson={async (memberId) => {
            const ok = await removePerson(memberId)
            if (ok) notify('Person removed.')
            return ok
          }}
          onExport={async () => {
            const ok = await shareTripCsv({ group, expenses, settlements, viewerId: me.id })
            notify(ok ? 'Trip exported.' : 'Could not export.', ok ? 'ok' : 'error')
          }}
        />
      ) : null}

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
      {busy ? <View pointerEvents="none" style={styles.busyBar} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    paddingHorizontal: spacing(4),
    paddingBottom: spacing(2),
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupName: { color: colors.text, fontSize: 17.5, fontWeight: '800', letterSpacing: -0.3 },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5), marginTop: 3 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  headerMetaText: { color: colors.muted, fontSize: 11, fontWeight: '600' },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    marginHorizontal: spacing(4),
    padding: spacing(1),
    gap: spacing(1),
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(1.5),
    paddingVertical: spacing(2.2),
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  tabLabel: { color: colors.muted, fontSize: 11.5, fontWeight: '800' },

  hero: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing(4.5),
    marginTop: spacing(4),
    overflow: 'hidden',
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroLabel: { color: colors.muted, fontSize: 11.5, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase' },
  heroAmount: { fontSize: 38, fontWeight: '900', letterSpacing: -1.6, marginTop: spacing(1.5) },
  heroStats: {
    flexDirection: 'row',
    gap: spacing(3),
    marginTop: spacing(3.5),
    paddingTop: spacing(3),
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  heroStatLabel: { color: colors.mutedDim, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase' },
  heroStatValue: { color: colors.textSoft, fontSize: 13.5, fontWeight: '800', marginTop: 3 },
  heroFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing(3.5) },
  heroCode: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing(3.5),
    paddingVertical: spacing(2.4),
    marginTop: spacing(4),
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 13.5, padding: 0 },

  dayHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing(5),
    marginBottom: spacing(0.5),
  },
  dayLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.9, textTransform: 'uppercase' },
  dayTotal: { color: colors.mutedDim, fontSize: 11, fontWeight: '700' },

  expenseCard: { flexDirection: 'row', alignItems: 'center', marginTop: spacing(2), padding: spacing(3.5) },
  categoryBubble: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  expenseTitle: { color: colors.text, fontSize: 14.5, fontWeight: '700' },
  expenseMeta: { color: colors.mutedDim, fontSize: 10.5, marginTop: 3 },
  expenseAmount: { color: colors.text, fontSize: 15, fontWeight: '800' },

  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), marginTop: spacing(2) },
  barLabel: { color: colors.textSoft, fontSize: 11, width: 88, textTransform: 'capitalize' },
  barTrack: { flex: 1, height: 7, borderRadius: 4, backgroundColor: colors.surfaceHigh, overflow: 'hidden' },
  barFill: { height: 7, borderRadius: 4 },
  barValue: { color: colors.muted, fontSize: 10.5, fontWeight: '700', width: 68, textAlign: 'right' },

  personRow: { flexDirection: 'row', alignItems: 'center' },
  personName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  personMeta: { color: colors.mutedDim, fontSize: 10.5, marginTop: 2 },
  personNet: { fontSize: 14, fontWeight: '800' },
  personNetLabel: { color: colors.mutedDim, fontSize: 9.5, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  entries: { marginTop: spacing(1) },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(2.5), paddingVertical: spacing(1.5) },
  entryDot: { width: 5, height: 5, borderRadius: 3 },
  entryLabel: { color: colors.textSoft, fontSize: 12, flex: 1 },
  entryAmount: { fontSize: 12, fontWeight: '700' },

  transfer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing(2.5),
    paddingHorizontal: spacing(2.5),
    borderRadius: radius.md,
    marginTop: spacing(2),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  transferMine: { borderColor: '#2b6b52', backgroundColor: '#0f2e24' },
  transferWho: { color: colors.textSoft, fontSize: 12.5, fontWeight: '600' },
  transferAmount: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 2 },
  upiButton: {
    backgroundColor: '#123f30',
    borderRadius: radius.sm,
    paddingHorizontal: spacing(2.5),
    paddingVertical: spacing(1.5),
    borderWidth: 1,
    borderColor: '#2b6b52',
  },
  upiText: { color: colors.accent, fontSize: 10.5, fontWeight: '800' },
  recordButton: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.sm,
    paddingHorizontal: spacing(2.5),
    paddingVertical: spacing(1.5),
    borderWidth: 1,
    borderColor: colors.border,
  },
  recordText: { color: colors.textSoft, fontSize: 10.5, fontWeight: '800' },
  paymentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing(2.2), gap: spacing(2) },
  link: { color: colors.accent, fontSize: 11.5, fontWeight: '800' },
  settledTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: spacing(2) },

  mapHead: { flexDirection: 'row', alignItems: 'center', gap: spacing(3) },
  mapTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  mapPinBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#123f30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(3), marginTop: spacing(3) },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { color: colors.muted, fontSize: 10.5, textTransform: 'capitalize' },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(2.5), paddingVertical: spacing(2) },
  stopDot: { width: 8, height: 8, borderRadius: 4 },
  stopLabel: { color: colors.textSoft, fontSize: 12.5, flex: 1 },
  stopAmount: { color: colors.text, fontSize: 12.5, fontWeight: '700' },
  wrapTotal: { color: colors.accent, fontSize: 26, fontWeight: '900', marginTop: spacing(2) },

  fab: { position: 'absolute', right: spacing(5), borderRadius: 30 },
  fabFill: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2fe0a4',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  closedBar: {
    position: 'absolute',
    left: spacing(5),
    right: spacing(5),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(2),
    backgroundColor: '#3c2f12',
    borderRadius: radius.pill,
    paddingVertical: spacing(2.6),
    borderWidth: 1,
    borderColor: '#5a4718',
  },
  closedText: { color: colors.warn, fontSize: 11, fontWeight: '700' },
  busyBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.accent,
    opacity: 0.5,
  },
})
