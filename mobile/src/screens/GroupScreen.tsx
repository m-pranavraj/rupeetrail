import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Avatar,
  AvatarStack,
  Banner,
  BusyLine,
  Button,
  Card,
  Divider,
  EmptyState,
  FadeIn,
  Field,
  IconButton,
  KeyboardAware,
  Label,
  Muted,
  Pill,
  PressableScale,
  Screen,
  Segmented,
  Sheet,
  Toast,
  buzz,
  tap,
} from '../components/ui'
import { TripMap, type MapPoint } from '../components/TripMap'
import { PaybackCard } from '../components/PaybackCard'
import { ExpenseForm } from '../components/ExpenseForm'
import { ExpenseDetail } from '../components/ExpenseDetail'
import { GroupSettingsSheet } from '../components/GroupSettingsSheet'
import { VoiceAssistant } from '../components/VoiceAssistant'
import { useStore } from '../state'
import { API_BASE, APP_LABEL } from '../config'
import { computeBalances, isReconciled, nameOf } from '../lib/balances'
import { formatPaise, parseRupees } from '../lib/money'
import { planSettlements } from '../lib/settlement'
import { shareTripCsv } from '../lib/csv'
import { currentPoint } from '../lib/geo'
import { isValidUpi, upiPayLink } from '../lib/upi'
import { categoryColors, categoryEmoji, colors, gradients, radius, spacing, tints } from '../theme'
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
    updateMe,
    addPerson,
    removePerson,
    settle,
    confirmSettlement,
    tagPlace,
    clearPlace,
    openGroup,
  } = useStore()

  const insets = useSafeAreaInsets()
  const [tab, setTab] = useState<Tab>('expenses')
  const [tabTrack, setTabTrack] = useState(0)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [manualPay, setManualPay] = useState(false)
  const [payFrom, setPayFrom] = useState('')
  const [payTo, setPayTo] = useState('')
  const [payFromName, setPayFromName] = useState('')
  const [payToName, setPayToName] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<'upi' | 'cash' | 'bank'>('upi')
  const [payingKey, setPayingKey] = useState<string | null>(null)
  const [submittingPay, setSubmittingPay] = useState(false)
  const [paymentId, setPaymentId] = useState<string | null>(null)
  const [payingSettlement, setPayingSettlement] = useState<'paid' | 'received' | 'dispute' | null>(null)
  const [expandedMember, setExpandedMember] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null)
  const [focusHere, setFocusHere] = useState(true)
  const [locating, setLocating] = useState(false)

  const tabIndex = Math.max(0, TABS.findIndex((entry) => entry.id === tab))
  const tabProgress = useRef(new Animated.Value(tabIndex)).current
  const tabSlot = tabTrack > 0 ? (tabTrack - 20) / TABS.length : 0

  useEffect(() => {
    Animated.spring(tabProgress, {
      toValue: tabIndex,
      useNativeDriver: true,
      damping: 18,
      stiffness: 190,
      mass: 0.7,
    }).start()
  }, [tabIndex, tabProgress])

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
  const payment = paymentId ? settlements.find((entry) => entry.id === paymentId) ?? null : null

  const notify = (message: string, tone: 'ok' | 'error' = 'ok') => {
    setToast({ message, tone })
    setTimeout(() => setToast(null), 2_400)
  }

  const locate = async () => {
    if (locating) return
    setLocating(true)
    setFocusHere(true)
    try {
      const point = await currentPoint()
      if (point) setHere({ lat: point.lat, lng: point.lng })
      else notify('Location is off for this app. Allow it in system settings.', 'error')
    } finally {
      setLocating(false)
    }
  }

  // Opening the map for the first time asks for a fix so there is always
  // somewhere recognisable on screen, even with zero tagged expenses.
  useEffect(() => {
    if (tab !== 'map' || here) return
    void locate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

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

  const openManualPay = () => {
    setPayFrom(me.id)
    setPayTo('')
    setPayFromName('')
    setPayToName('')
    setPayAmount('')
    setPayMethod('upi')
    setManualPay(true)
  }

  const submitManualPay = async () => {
    const slugify = (value: string) =>
      value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (payFrom === 'manual' && !payFromName.trim()) {
      notify('Enter the name of the person who paid.', 'error')
      return
    }
    if (payTo === 'manual' && !payToName.trim()) {
      notify('Enter the name of the person who received.', 'error')
      return
    }
    const from = payFrom === 'manual' ? `manual:from:${slugify(payFromName) || 'someone'}` : payFrom
    const to = payTo === 'manual' ? `manual:to:${slugify(payToName) || 'someone'}` : payTo
    if (!from || !to) {
      notify('Pick who paid and who received.', 'error')
      return
    }
    if (from === to) {
      notify('Payer and receiver must be different people.', 'error')
      return
    }
    const paise = parseRupees(payAmount)
    if (!paise || paise <= 0) {
      notify('Enter an amount greater than zero.', 'error')
      return
    }
    if (submittingPay) return
    setSubmittingPay(true)
    try {
      const ok = await settle({ from, to, amountPaise: paise, method: payMethod })
      if (ok) {
        buzz()
        setManualPay(false)
        notify('Payment recorded — balances updated.')
      } else {
        notify('Could not record that payment.', 'error')
      }
    } finally {
      setSubmittingPay(false)
    }
  }

  const recordTransfer = async (from: string, to: string, amountPaise: number, key: string) => {
    if (payingKey) return
    setPayingKey(key)
    try {
      const ok = await settle({ from, to, amountPaise })
      if (ok) buzz()
      notify(ok ? 'Payment recorded — balances updated.' : 'Could not record that.', ok ? 'ok' : 'error')
    } finally {
      setPayingKey(null)
    }
  }

  const actOnPayment = async (action: 'paid' | 'received' | 'dispute') => {
    if (!payment || payingSettlement) return
    setPayingSettlement(action)
    try {
      const ok = await confirmSettlement(payment.id, action)
      if (ok) {
        buzz()
        notify(action === 'dispute' ? 'Disputed — balance reversed.' : 'Payment confirmed.')
      } else {
        notify('Could not update that payment.', 'error')
      }
    } finally {
      setPayingSettlement(null)
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
          <Pressable onPress={() => void refresh()} hitSlop={10} style={styles.headerMeta}>
            <View
              style={[
                styles.liveDot,
                {
                  backgroundColor:
                    active.live === 'live'
                      ? colors.accent
                      : active.live === 'connecting'
                        ? colors.info
                        : colors.lime,
                },
              ]}
            />
            <Text style={styles.headerMetaText}>
              {active.live === 'live'
                ? 'Live sync'
                : active.live === 'connecting'
                  ? 'Connecting'
                  : 'Fast sync'}{' '}
              · {activeMembers.length} {activeMembers.length === 1 ? 'person' : 'people'}
              {group.status === 'closed' ? ' · closed' : ''}
            </Text>
          </Pressable>
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
      <View
        style={styles.tabBar}
        onLayout={(event: LayoutChangeEvent) => setTabTrack(event.nativeEvent.layout.width)}
      >
        {tabSlot > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.tabPill,
              {
                width: tabSlot,
                transform: [
                  {
                    translateX: tabProgress.interpolate({
                      inputRange: [0, TABS.length - 1],
                      outputRange: [0, (tabSlot + 4) * (TABS.length - 1)],
                    }),
                  },
                ],
              },
            ]}
          >
            <LinearGradient
              colors={gradients.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        ) : null}
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
                        Net = what they paid − their share, adjusted the moment a payment is recorded. The whole
                        group must add up to zero; right now it {reconcile ? 'does' : 'does not'}.
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
            <PaybackCard
              transfers={plan.transfers}
              groupName={group.name}
              meId={me.id}
              nameOf={(id) => nameOf(group, id)}
              colorOf={(id) => group.members.find((entry) => entry.id === id)?.color ?? 0}
              upiOf={(id) => activeMembers.find((entry) => entry.id === id)?.upiId}
              onRecord={(transfer) =>
                void recordTransfer(
                  transfer.from,
                  transfer.to,
                  transfer.amountPaise,
                  `${transfer.from}-${transfer.to}-${transfer.amountPaise}`,
                )
              }
              onPayUpi={(toId, amountPaise) => void payViaUpi(toId, amountPaise)}
              payingKey={payingKey}
              closed={group.status === 'closed'}
              onNotify={notify}
            />

            <Button
              label="Record a payment"
              variant="soft"
              onPress={openManualPay}
              icon={<Ionicons name="cash-outline" size={18} color={colors.text} />}
            />

            {settlements.length > 0 ? (
              <Card>
                <Label>Payments</Label>
                {[...settlements]
                  .sort((a, b) => b.updatedAt - a.updatedAt)
                  .map((payment) => (
                    <PressableScale
                      key={payment.id}
                      onPress={() => {
                        tap()
                        setPaymentId(payment.id)
                      }}
                      scaleTo={0.985}
                    >
                      <View style={styles.paymentRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.transferWho} numberOfLines={1}>
                            {nameOf(group, payment.from)} → {nameOf(group, payment.to)}
                          </Text>
                          <Text style={styles.personMeta}>
                            {formatPaise(payment.amountPaise)} · {payment.method} ·{' '}
                            {new Date(payment.updatedAt).toLocaleTimeString('en-IN', {
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </Text>
                        </View>
                        <Pill
                          tone={
                            payment.status === 'confirmed'
                              ? 'ok'
                              : payment.status === 'disputed'
                                ? 'bad'
                                : 'info'
                          }
                        >
                          {payment.status === 'pending' ? 'recorded' : payment.status.replace(/_/g, ' ')}
                        </Pill>
                        <Ionicons
                          name="chevron-forward"
                          size={15}
                          color={colors.mutedDim}
                          style={{ marginLeft: spacing(1.5) }}
                        />
                      </View>
                    </PressableScale>
                  ))}
                <Muted small>
                  Balances move the moment a payment is recorded. If money never actually moved, open the
                  payment and mark it disputed to reverse it.
                </Muted>
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
                <PressableScale onPress={() => void locate()} scaleTo={0.92} accessibilityLabel="Show my location">
                  <View style={styles.mapPinBadge}>
                    {locating ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <Ionicons name="locate" size={16} color={colors.accent} />
                    )}
                  </View>
                </PressableScale>
              </View>
              <TripMap
                points={mapPoints}
                here={here}
                focusHere={focusHere}
                height={260}
                onPickPoint={(id) => {
                  setFocusHere(false)
                  setDetailId(id)
                }}
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
                      onPress={() => {
                        setFocusHere(false)
                        setDetailId(point.id)
                      }}
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
        <>
          <VoiceAssistant onTabChange={setTab} onOpenGroup={(groupId) => void openGroup(groupId)} />
          <PressableScale
            onPress={() => setAdding(true)}
            style={[styles.fab, { bottom: insets.bottom + spacing(4) }]}
          >
            <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fabFill}>
              <Ionicons name="add" size={26} color={colors.accentInk} />
            </LinearGradient>
          </PressableScale>
        </>
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
          meName={me.name}
          meUpi={me.upiId}
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
          onUpdateMe={async (patch) => {
            const ok = await updateMe(patch)
            if (ok) notify('Your details saved.')
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

      {manualPay ? (
        <Sheet
          visible={manualPay}
          title="Record a payment"
          subtitle="Cash, UPI or a person who is not in the group yet. The balance moves as soon as you record it."
          onClose={() => setManualPay(false)}
          footer={
            <Button
              label="Record payment"
              loading={submittingPay}
              disabled={!payAmount.trim()}
              onPress={() => void submitManualPay()}
            />
          }
        >
          <View style={{ marginTop: spacing(2) }}>
            <Label>Who paid</Label>
            <View style={styles.payChips}>
              {activeMembers.map((member) => {
                const selected = payFrom === member.id
                return (
                  <PressableScale key={member.id} onPress={() => setPayFrom(member.id)} scaleTo={0.94}>
                    <View style={[styles.payChip, selected && styles.payChipActive]}>
                      <Text style={[styles.payChipText, selected && styles.payChipTextActive]} numberOfLines={1}>
                        {member.name}
                      </Text>
                    </View>
                  </PressableScale>
                )
              })}
              <PressableScale onPress={() => setPayFrom('manual')} scaleTo={0.94}>
                <View style={[styles.payChip, payFrom === 'manual' && styles.payChipActive]}>
                  <Text
                    style={[styles.payChipText, payFrom === 'manual' && styles.payChipTextActive]}
                    numberOfLines={1}
                  >
                    Someone else
                  </Text>
                </View>
              </PressableScale>
            </View>
            {payFrom === 'manual' ? (
              <Field
                label="Name of person who paid"
                value={payFromName}
                onChangeText={setPayFromName}
                placeholder="e.g. Priya Sharma"
              />
            ) : null}
          </View>

          <View style={{ marginTop: spacing(4) }}>
            <Label>Who received</Label>
            <View style={styles.payChips}>
              {activeMembers.map((member) => {
                const selected = payTo === member.id
                return (
                  <PressableScale key={member.id} onPress={() => setPayTo(member.id)} scaleTo={0.94}>
                    <View style={[styles.payChip, selected && styles.payChipActive]}>
                      <Text style={[styles.payChipText, selected && styles.payChipTextActive]} numberOfLines={1}>
                        {member.name}
                      </Text>
                    </View>
                  </PressableScale>
                )
              })}
              <PressableScale onPress={() => setPayTo('manual')} scaleTo={0.94}>
                <View style={[styles.payChip, payTo === 'manual' && styles.payChipActive]}>
                  <Text
                    style={[styles.payChipText, payTo === 'manual' && styles.payChipTextActive]}
                    numberOfLines={1}
                  >
                    Someone else
                  </Text>
                </View>
              </PressableScale>
            </View>
            {payTo === 'manual' ? (
              <Field
                label="Name of person who received"
                value={payToName}
                onChangeText={setPayToName}
                placeholder="e.g. Rahul"
              />
            ) : null}
          </View>

          <Field
            label="Amount"
            value={payAmount}
            onChangeText={setPayAmount}
            placeholder="500"
            keyboardType="decimal-pad"
            hint="₹ amount that actually moved."
          />

          <View style={{ marginTop: spacing(4) }}>
            <Label>How did it move?</Label>
            <View style={{ marginTop: spacing(2) }}>
              <Segmented
                value={payMethod}
                onChange={setPayMethod}
                options={[
                  { value: 'upi', label: 'UPI' },
                  { value: 'cash', label: 'Cash' },
                  { value: 'bank', label: 'Bank' },
                ]}
              />
            </View>
          </View>
        </Sheet>
      ) : null}

      {payment ? (
        <Sheet
          visible
          title="Payment"
          subtitle={`${nameOf(group, payment.from)} → ${nameOf(group, payment.to)}`}
          onClose={() => setPaymentId(null)}
          footer={<Button label="Done" variant="soft" onPress={() => setPaymentId(null)} />}
        >
          <View style={styles.paymentHero}>
            <Text style={styles.paymentAmount}>{formatPaise(payment.amountPaise)}</Text>
            <Text style={styles.paymentMeta}>
              {payment.method.toUpperCase()} ·{' '}
              {new Date(payment.createdAt).toLocaleString('en-IN', {
                day: 'numeric',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </Text>
          </View>

          {payment.status === 'disputed' ? (
            <Banner tone="error">
              Disputed. This payment is left out of every balance until it is recorded again.
            </Banner>
          ) : payment.status === 'confirmed' ? (
            <Banner tone="ok">Both sides confirmed this payment.</Banner>
          ) : (
            <Banner tone="info">
              {payment.status === 'payer_confirmed'
                ? 'The payer confirmed. Waiting for the receiver.'
                : payment.status === 'receiver_confirmed'
                  ? 'The receiver confirmed. Waiting for the payer.'
                  : 'Balances already include this payment. Confirming just records that both sides agree.'}
            </Banner>
          )}

          {(
            [
              { label: `${nameOf(group, payment.from)} paid`, at: payment.payerConfirmedAt },
              { label: `${nameOf(group, payment.to)} received`, at: payment.receiverConfirmedAt },
            ] as { label: string; at?: number }[]
          ).map((row) => (
            <View key={row.label} style={styles.confirmRow}>
              <Ionicons
                name={row.at ? 'checkmark-circle' : 'ellipse-outline'}
                size={17}
                color={row.at ? colors.accent : colors.mutedDim}
              />
              <Text style={styles.confirmText} numberOfLines={1}>
                {row.label}
              </Text>
              <Text style={styles.confirmState}>{row.at ? 'confirmed' : 'not yet'}</Text>
            </View>
          ))}

          {(() => {
            const role: 'paid' | 'received' | null =
              payment.from === me.id ? 'paid' : payment.to === me.id ? 'received' : null
            if (!role) {
              return (
                <Muted small>Only the two people in this payment can confirm or question it.</Muted>
              )
            }
            const mine =
              role === 'paid' ? Boolean(payment.payerConfirmedAt) : Boolean(payment.receiverConfirmedAt)
            if (payment.status === 'confirmed' || payment.status === 'disputed') return null
            return (
              <View style={{ gap: spacing(2), marginTop: spacing(2) }}>
                {mine ? (
                  <Muted small>You already confirmed this side.</Muted>
                ) : (
                  <Button
                    label={role === 'paid' ? 'Yes, I paid this' : 'Yes, I received this'}
                    loading={payingSettlement === role}
                    onPress={() => void actOnPayment(role)}
                  />
                )}
                <Button
                  label="This didn't happen"
                  variant="ghost"
                  loading={payingSettlement === 'dispute'}
                  onPress={() => void actOnPayment('dispute')}
                />
              </View>
            )
          })()}
        </Sheet>
      ) : null}

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
      <BusyLine visible={busy} />
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
    backgroundColor: colors.glass,
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
  tabPill: {
    position: 'absolute',
    left: 4,
    top: 4,
    bottom: 4,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(1.5),
    paddingVertical: spacing(2.2),
    borderRadius: radius.pill,
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
    borderTopColor: colors.borderSoft,
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

  transferWho: { color: colors.textSoft, fontSize: 12.5, fontWeight: '600' },
  paymentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing(2.2), gap: spacing(2) },
  paymentHero: { alignItems: 'center', paddingVertical: spacing(3) },
  paymentAmount: { color: colors.text, fontSize: 34, fontWeight: '900', letterSpacing: -1.2 },
  paymentMeta: { color: colors.muted, fontSize: 11.5, fontWeight: '600', marginTop: spacing(1) },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    paddingVertical: spacing(2),
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  confirmText: { flex: 1, color: colors.textSoft, fontSize: 12.5, fontWeight: '600' },
  confirmState: { color: colors.muted, fontSize: 10.5, fontWeight: '700' },
  payChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2), marginTop: spacing(2) },
  payChip: {
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  payChipActive: { borderColor: colors.accent, backgroundColor: tints.mint.fill },
  payChipText: { color: colors.muted, fontSize: 12.5, fontWeight: '700' },
  payChipTextActive: { color: colors.accent },
  link: { color: colors.accent, fontSize: 11.5, fontWeight: '800' },

  mapHead: { flexDirection: 'row', alignItems: 'center', gap: spacing(3) },
  mapTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  mapPinBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: tints.accent.fill,
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
    shadowColor: colors.accent,
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
    backgroundColor: tints.warn.fill,
    borderRadius: radius.pill,
    paddingVertical: spacing(2.6),
    borderWidth: 1,
    borderColor: tints.warn.border,
  },
  closedText: { color: colors.warn, fontSize: 11, fontWeight: '700' },
})
