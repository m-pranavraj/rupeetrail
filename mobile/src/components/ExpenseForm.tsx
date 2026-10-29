import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Location from 'expo-location'
import {
  Avatar,
  Banner,
  Button,
  Card,
  Field,
  Label,
  Muted,
  Pill,
  PressableScale,
  Segmented,
  Sheet,
  tap,
} from './ui'
import { BillScanner } from './BillScanner'
import { colors, radius, spacing, tints } from '../theme'
import { formatPaise, paiseToInput, parseRupees } from '../lib/money'
import { allocateSplit, SplitError } from '../lib/splits'
import type { Expense, ExpenseCategory, Group, Member, Split, SplitMode } from '../lib/types'

type Viewer = Pick<Member, 'id' | 'name' | 'upiId' | 'color'>
import type { ExpenseInput } from '../api'

const CATEGORIES: { id: ExpenseCategory; label: string; emoji: string }[] = [
  { id: 'food', label: 'Food', emoji: '🍽️' },
  { id: 'travel', label: 'Travel', emoji: '🚕' },
  { id: 'stay', label: 'Stay', emoji: '🛏️' },
  { id: 'groceries', label: 'Groceries', emoji: '🛒' },
  { id: 'entertainment', label: 'Fun', emoji: '🎟️' },
  { id: 'utilities', label: 'Bills', emoji: '💡' },
  { id: 'shopping', label: 'Shopping', emoji: '🛍️' },
  { id: 'other', label: 'Other', emoji: '📦' },
]

const MODES: { value: SplitMode; label: string }[] = [
  { value: 'equal', label: 'Equal' },
  { value: 'exact', label: 'Exact ₹' },
  { value: 'percent', label: '%' },
  { value: 'shares', label: 'Shares' },
]

function dayOf(ts: number): number {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Keep the clock time, swap the calendar day. */
function withTimeOf(day: number, reference: number): number {
  const target = new Date(day)
  const clock = new Date(reference)
  target.setHours(clock.getHours(), clock.getMinutes(), clock.getSeconds(), 0)
  return target.getTime()
}

function shiftMinutes(ts: number, minutes: number): number {
  return ts + minutes * 60_000
}

function dayLabel(offset: number): string {
  const date = new Date()
  date.setDate(date.getDate() - offset)
  if (offset === 0) return 'Today'
  if (offset === 1) return 'Yesterday'
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

const QUICK_DAYS = [0, 1, 2, 3, 4, 5, 6]

/**
 * The expense editor.
 *
 * Deliberately the same shape as the web form: several payers, four split
 * modes, a live per-person preview, a date, notes and a place tag. Validation
 * reuses the server's own split maths, so a share previewed here is exactly
 * what every other phone will compute.
 */
export function ExpenseForm({
  group,
  me,
  expense,
  hasPlace,
  onSave,
  onClose,
}: {
  group: Group
  me: Viewer
  expense?: Expense
  hasPlace?: boolean
  onSave: (input: ExpenseInput, options: { tagPlace: boolean }) => Promise<boolean>
  onClose: () => void
}) {
  const activeMembers = useMemo(() => group.members.filter((member) => !member.leftAt), [group.members])
  const editableIds = useMemo(() => new Set(activeMembers.map((member) => member.id)), [activeMembers])

  const [stage, setStage] = useState<'form' | 'scan'>('form')
  const [amountInput, setAmountInput] = useState(expense ? paiseToInput(expense.amountPaise) : '')
  const [description, setDescription] = useState(expense?.description ?? '')
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? 'food')
  const [notes, setNotes] = useState(expense?.notes ?? '')
  const [date, setDate] = useState(() => expense?.date ?? Date.now())
  const [tagPlace, setTagPlace] = useState(!expense || !hasPlace)

  const [payerIds, setPayerIds] = useState<string[]>(
    expense
      ? expense.payers.map((payer) => payer.memberId)
      : editableIds.has(me.id)
        ? [me.id]
        : activeMembers[0]
          ? [activeMembers[0].id]
          : [],
  )
  const [payerAmounts, setPayerAmounts] = useState<Record<string, string>>(() => {
    if (expense) {
      return Object.fromEntries(expense.payers.map((payer) => [payer.memberId, paiseToInput(payer.amountPaise)]))
    }
    return {}
  })

  const [mode, setMode] = useState<SplitMode>(expense?.split.mode ?? 'equal')
  const [participants, setParticipants] = useState<string[]>(() => {
    if (!expense) return activeMembers.map((member) => member.id)
    if (expense.split.mode === 'equal') return expense.split.participants ?? []
    return Object.keys(expense.split.values ?? {}).filter((id) => (expense.split.values?.[id] ?? 0) > 0)
  })
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    if (expense && expense.split.mode !== 'equal') {
      for (const [id, raw] of Object.entries(expense.split.values ?? {})) initial[id] = String(raw)
    }
    return initial
  })

  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // Ask while the form is open, not while the user waits for a save.
  useEffect(() => {
    if (tagPlace && !expense) {
      void Location.requestForegroundPermissionsAsync().catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totalPaise = parseRupees(amountInput)
  const amountOk = totalPaise !== null && totalPaise > 0

  const effectivePayerAmounts = useMemo(() => {
    if (payerIds.length === 1 && amountOk) {
      return { ...payerAmounts, [payerIds[0]]: paiseToInput(totalPaise) }
    }
    return payerAmounts
  }, [amountOk, payerAmounts, payerIds, totalPaise])

  const payerTotal = payerIds.reduce((sum, id) => {
    const parsed = parseRupees(effectivePayerAmounts[id] ?? '0')
    return sum + (parsed ?? 0)
  }, 0)
  const unassigned = totalPaise === null ? null : totalPaise - payerTotal

  const togglePayer = (id: string) => {
    tap()
    setPayerIds((previous) => {
      if (previous.includes(id)) {
        if (previous.length === 1) return previous
        return previous.filter((entry) => entry !== id)
      }
      return [...previous, id]
    })
  }

  const toggleParticipant = (id: string) => {
    tap()
    setParticipants((previous) =>
      previous.includes(id) ? previous.filter((entry) => entry !== id) : [...previous, id],
    )
  }

  const switchMode = (next: SplitMode) => {
    if (next === mode) return
    const ids = participants.length > 0 ? participants : activeMembers.map((member) => member.id)
    const seed: Record<string, string> = {}
    if (next === 'exact' && amountOk) {
      try {
        const allocation = allocateSplit(totalPaise, { mode: 'equal', participants: ids })
        for (const entry of allocation) seed[entry.memberId] = paiseToInput(entry.amountPaise)
      } catch {
        for (const id of ids) seed[id] = '0'
      }
    } else if (next === 'percent') {
      const each = Math.floor((100 / Math.max(1, ids.length)) * 100) / 100
      for (const id of ids) seed[id] = String(each)
    } else if (next === 'shares') {
      for (const id of ids) seed[id] = '1'
    }
    setValues(seed)
    setMode(next)
    setError('')
  }

  const buildSplit = useCallback((): Split => {
    if (mode === 'equal') return { mode, participants }
    const parsed: Record<string, number> = {}
    for (const id of participants) {
      const raw = values[id] ?? ''
      parsed[id] = mode === 'exact' ? (parseRupees(raw) ?? 0) : Number(raw) || 0
    }
    return { mode, values: parsed }
  }, [mode, participants, values])

  const preview = useMemo(() => {
    if (!amountOk || participants.length === 0) return null
    try {
      return allocateSplit(totalPaise, buildSplit())
    } catch {
      return null
    }
  }, [amountOk, buildSplit, participants.length, totalPaise])

  const applyDraft = useCallback(
    (draft: Partial<Expense>) => {
      if (draft.description) setDescription(draft.description)
      if (draft.amountPaise && draft.amountPaise > 0) setAmountInput(paiseToInput(draft.amountPaise))
      if (draft.category) setCategory(draft.category)
      if (draft.notes) setNotes(draft.notes)
      if (draft.split) {
        setMode(draft.split.mode)
        if (draft.split.mode === 'equal') {
          setParticipants(draft.split.participants ?? activeMembers.map((member) => member.id))
        } else {
          const entries = Object.entries(draft.split.values ?? {})
          setParticipants(entries.filter(([, value]) => value > 0).map(([id]) => id))
          setValues(Object.fromEntries(entries.map(([id, value]) => [id, String(value)])))
        }
      }
      setStage('form')
    },
    [activeMembers],
  )

  const submit = async () => {
    setError('')
    if (!description.trim()) return setError('What was this expense for?')
    if (!amountOk) return setError('Enter an amount greater than zero.')
    if (payerIds.length === 0) return setError('Choose who paid.')
    if (unassigned !== null && unassigned !== 0) {
      return setError(
        unassigned > 0
          ? `Assign the remaining ${formatPaise(unassigned)} to a payer.`
          : `Payer amounts exceed the total by ${formatPaise(Math.abs(unassigned))}.`,
      )
    }
    if (participants.length === 0) return setError('Choose at least one person to share this.')

    const split = buildSplit()
    try {
      allocateSplit(totalPaise, split)
    } catch (cause) {
      return setError(cause instanceof SplitError ? cause.message : 'Check the split values.')
    }

    const payers = payerIds.map((id) => ({
      memberId: id,
      amountPaise: parseRupees(effectivePayerAmounts[id] ?? '0') ?? 0,
    }))

    setSaving(true)
    try {
      const ok = await onSave(
        {
          description: description.trim(),
          amountPaise: totalPaise,
          date,
          category,
          payers,
          split,
          notes: notes.trim() || undefined,
        },
        { tagPlace },
      )
      if (!ok) setError('Could not save that. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      visible
      title={expense ? 'Edit expense' : 'Add expense'}
      subtitle={stage === 'scan' ? 'Read a bill or type it in a sentence' : `${group.emoji} ${group.name}`}
      onClose={onClose}
      full
      footer={
        stage === 'form' ? (
          <Button
            label={expense ? 'Save changes' : 'Add expense'}
            loading={saving}
            onPress={() => void submit()}
          />
        ) : undefined
      }
    >
      {stage === 'scan' ? (
        <BillScanner
          members={activeMembers.map((member) => ({ id: member.id, name: member.name }))}
          meMemberId={me.id}
          onApply={applyDraft}
          onBack={() => setStage('form')}
        />
      ) : (
        <View>
          <Card tone="raised" style={styles.amountCard}>
            <Label>Amount</Label>
            <View style={styles.amountRow}>
              <Text style={styles.rupee}>₹</Text>
              <TextInput
                value={amountInput}
                onChangeText={setAmountInput}
                placeholder="0"
                placeholderTextColor={colors.mutedDim}
                keyboardType="decimal-pad"
                selectionColor={colors.accent}
                style={styles.amountInput}
                autoFocus={!expense}
              />
            </View>
            <View style={styles.captureRow}>
              <PressableScale style={{ flex: 1 }} onPress={() => setStage('scan')}>
                <View style={styles.capture}>
                  <Ionicons name="scan-outline" size={16} color={colors.accent} />
                  <Text style={styles.captureText}>Scan bill</Text>
                </View>
              </PressableScale>
              <PressableScale style={{ flex: 1 }} onPress={() => setStage('scan')}>
                <View style={styles.capture}>
                  <Ionicons name="sparkles-outline" size={16} color={colors.lime} />
                  <Text style={styles.captureText}>Quick add</Text>
                </View>
              </PressableScale>
            </View>
          </Card>

          <Field
            label="What for?"
            value={description}
            onChangeText={setDescription}
            placeholder="Beach shack dinner"
            maxLength={80}
          />

          <View style={{ marginTop: spacing(4) }}>
            <Label>Category</Label>
            <View style={styles.chipRow}>
              {CATEGORIES.map((entry) => {
                const active = entry.id === category
                return (
                  <PressableScale key={entry.id} onPress={() => setCategory(entry.id)} scaleTo={0.94}>
                    <View style={[styles.chip, active && styles.chipActive]}>
                      <Text style={{ fontSize: 13 }}>{entry.emoji}</Text>
                      <Text style={[styles.chipText, active && { color: colors.accentInk }]}>{entry.label}</Text>
                    </View>
                  </PressableScale>
                )
              })}
            </View>
          </View>

          <View style={{ marginTop: spacing(4) }}>
            <Label>Paid by</Label>
            <View style={styles.chipRow}>
              {activeMembers.map((member) => {
                const active = payerIds.includes(member.id)
                return (
                  <PressableScale key={member.id} onPress={() => togglePayer(member.id)} scaleTo={0.94}>
                    <View style={[styles.chip, active && styles.chipActive]}>
                      <Avatar name={member.name} color={member.color} size={20} />
                      <Text style={[styles.chipText, active && { color: colors.accentInk }]} numberOfLines={1}>
                        {member.name.split(' ')[0]}
                      </Text>
                    </View>
                  </PressableScale>
                )
              })}
            </View>

            {payerIds.length > 1 ? (
              <View style={styles.payerBox}>
                {payerIds.map((id) => {
                  const member = activeMembers.find((entry) => entry.id === id)
                  if (!member) return null
                  return (
                    <View key={id} style={styles.payerRow}>
                      <Text style={styles.payerName} numberOfLines={1}>
                        {member.name} paid
                      </Text>
                      <View style={styles.miniInput}>
                        <Text style={styles.miniSymbol}>₹</Text>
                        <TextInput
                          value={payerAmounts[id] ?? ''}
                          onChangeText={(text) => setPayerAmounts((prev) => ({ ...prev, [id]: text }))}
                          placeholder="0"
                          placeholderTextColor={colors.mutedDim}
                          keyboardType="decimal-pad"
                          selectionColor={colors.accent}
                          style={styles.miniText}
                        />
                      </View>
                    </View>
                  )
                })}
                <Text
                  style={[
                    styles.assignNote,
                    { color: unassigned === 0 ? colors.accent : colors.warn },
                  ]}
                >
                  {unassigned === null
                    ? 'Enter the total first.'
                    : unassigned === 0
                      ? 'Fully assigned.'
                      : unassigned > 0
                        ? `${formatPaise(unassigned)} left to assign.`
                        : `${formatPaise(-unassigned)} over the total.`}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={{ marginTop: spacing(4) }}>
            <Label>Split between</Label>
            <View style={styles.chipRow}>
              {activeMembers.map((member) => {
                const active = participants.includes(member.id)
                return (
                  <PressableScale key={member.id} onPress={() => toggleParticipant(member.id)} scaleTo={0.94}>
                    <View style={[styles.chip, active && styles.chipMint]}>
                      <Avatar name={member.name} color={member.color} size={20} />
                      <Text style={[styles.chipText, active && { color: colors.accent }]} numberOfLines={1}>
                        {member.name.split(' ')[0]}
                      </Text>
                    </View>
                  </PressableScale>
                )
              })}
            </View>

            <View style={{ marginTop: spacing(3) }}>
              <Segmented value={mode} options={MODES} onChange={switchMode} />
            </View>

            {mode !== 'equal' ? (
              <View style={{ marginTop: spacing(2) }}>
                {participants.map((id) => {
                  const member = activeMembers.find((entry) => entry.id === id)
                  if (!member) return null
                  return (
                    <View key={id} style={styles.valueRow}>
                      <Avatar name={member.name} color={member.color} size={26} />
                      <Text style={styles.valueName} numberOfLines={1}>
                        {member.name}
                      </Text>
                      <View style={styles.valueInput}>
                        {mode !== 'shares' ? (
                          <Text style={styles.valueSymbol}>{mode === 'percent' ? '%' : '₹'}</Text>
                        ) : null}
                        <TextInput
                          value={values[id] ?? ''}
                          onChangeText={(text) => setValues((prev) => ({ ...prev, [id]: text }))}
                          placeholder={mode === 'shares' ? '1' : '0'}
                          placeholderTextColor={colors.mutedDim}
                          keyboardType="decimal-pad"
                          selectionColor={colors.accent}
                          style={styles.valueText}
                        />
                        {mode === 'shares' ? <Text style={styles.valueSuffix}>parts</Text> : null}
                      </View>
                    </View>
                  )
                })}
                {mode === 'shares' ? (
                  <Muted small>
                    Shares are proportional — everyone on 1 part is the same as an equal split.
                  </Muted>
                ) : null}
              </View>
            ) : null}

            <Card tone={preview ? 'mint' : 'plain'} style={{ marginTop: spacing(3) }}>
              <View style={styles.previewHead}>
                <Ionicons name="checkmark-circle-outline" size={15} color={colors.accent} />
                <Text style={styles.previewTitle}>Each person's share</Text>
              </View>
              {preview ? (
                <>
                  {preview.map((entry) => {
                    const member = activeMembers.find((candidate) => candidate.id === entry.memberId)
                    return (
                      <View key={entry.memberId} style={styles.previewRow}>
                        <Text style={styles.previewName}>{member?.name ?? 'Member'}</Text>
                        <Text style={styles.previewAmount}>{formatPaise(entry.amountPaise)}</Text>
                      </View>
                    )
                  })}
                  <View style={[styles.previewRow, styles.previewTotal]}>
                    <Text style={styles.previewTotalLabel}>Total</Text>
                    <Text style={styles.previewTotalValue}>
                      {formatPaise(preview.reduce((sum, entry) => sum + entry.amountPaise, 0))}
                    </Text>
                  </View>
                </>
              ) : (
                <Muted small>
                  {mode === 'exact'
                    ? 'Enter shares that add up to the total.'
                    : mode === 'percent'
                      ? 'Percentages must add up to 100%.'
                      : 'Enter an amount to preview shares.'}
                </Muted>
              )}
            </Card>
          </View>

          <View style={{ marginTop: spacing(4) }}>
            <Label>When</Label>
            <View style={styles.chipRow}>
              {QUICK_DAYS.map((offset) => {
                const day = new Date()
                day.setDate(day.getDate() - offset)
                const active = dayOf(date) === dayOf(day.getTime())
                return (
                  <PressableScale
                    key={offset}
                    onPress={() => setDate(withTimeOf(day.getTime(), date))}
                    scaleTo={0.94}
                  >
                    <View style={[styles.chip, active && styles.chipActive]}>
                      <Text style={[styles.chipText, active && { color: colors.accentInk }]}>
                        {dayLabel(offset)}
                      </Text>
                    </View>
                  </PressableScale>
                )
              })}
            </View>

            <View style={styles.timeRow}>
              <View style={styles.timeInfo}>
                <Ionicons name="time-outline" size={16} color={colors.accent} />
                <View>
                  <Text style={styles.timeValue}>
                    {new Date(date).toLocaleTimeString('en-IN', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </Text>
                  <Muted small>
                    {new Date(date).toLocaleDateString('en-IN', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })}
                  </Muted>
                </View>
              </View>
              <View style={styles.timeActions}>
                <PressableScale onPress={() => setDate(shiftMinutes(date, -15))} scaleTo={0.92}>
                  <View style={styles.timeStep}>
                    <Text style={styles.timeStepText}>−15m</Text>
                  </View>
                </PressableScale>
                <PressableScale onPress={() => setDate(shiftMinutes(date, 15))} scaleTo={0.92}>
                  <View style={styles.timeStep}>
                    <Text style={styles.timeStepText}>+15m</Text>
                  </View>
                </PressableScale>
                <PressableScale onPress={() => setDate(Date.now())} scaleTo={0.92}>
                  <View style={[styles.timeStep, styles.timeNow]}>
                    <Text style={[styles.timeStepText, { color: colors.accentInk }]}>Now</Text>
                  </View>
                </PressableScale>
              </View>
            </View>
          </View>

          <Field
            label="Note (optional)"
            value={notes}
            onChangeText={setNotes}
            placeholder="Context others might need"
            maxLength={200}
          />

          <PressableScale onPress={() => setTagPlace((value) => !value)} scaleTo={0.98}>
            <View style={[styles.placeRow, tagPlace && styles.placeRowOn]}>
              <View style={styles.placeIcon}>
                <Ionicons name="location-outline" size={18} color={tagPlace ? colors.accent : colors.muted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.placeTitle}>Tag this place</Text>
                <Muted small>
                  {tagPlace
                    ? 'Uses GPS once, saved on this phone, and pins the expense on the trip map.'
                    : 'No location for this one.'}
                </Muted>
              </View>
              <View style={[styles.switch, tagPlace && styles.switchOn]}>
                <View style={[styles.switchKnob, tagPlace && styles.switchKnobOn]} />
              </View>
            </View>
          </PressableScale>

          {error ? <Banner tone="error">{error}</Banner> : null}

          <View style={{ height: spacing(3) }} />
        </View>
      )}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  amountCard: { marginTop: spacing(1) },
  amountRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing(1) },
  rupee: { color: colors.muted, fontSize: 30, fontWeight: '700', marginRight: spacing(2) },
  amountInput: {
    flex: 1,
    color: colors.text,
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: -1.2,
    paddingVertical: spacing(1),
  },
  captureRow: { flexDirection: 'row', gap: spacing(2.5), marginTop: spacing(2) },
  capture: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(1.5),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: spacing(2.2),
  },
  captureText: { color: colors.textSoft, fontSize: 12, fontWeight: '700' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2), marginTop: spacing(2) },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.5),
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipMint: { backgroundColor: tints.accent.fill, borderColor: tints.accent.border },
  chipText: { color: colors.muted, fontSize: 12.5, fontWeight: '700' },

  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing(2),
    marginTop: spacing(3),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.md,
    padding: spacing(3),
  },
  timeInfo: { flexDirection: 'row', alignItems: 'center', gap: spacing(2) },
  timeValue: { color: colors.text, fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  timeActions: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
  timeStep: {
    paddingHorizontal: spacing(2.4),
    paddingVertical: spacing(1.6),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  timeStepText: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  timeNow: { backgroundColor: colors.accent, borderColor: colors.accent },

  payerBox: {
    marginTop: spacing(2.5),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.md,
    padding: spacing(3),
  },
  payerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing(1.5) },
  payerName: { color: colors.textSoft, fontSize: 13, flex: 1, marginRight: spacing(2) },
  miniInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    paddingHorizontal: spacing(2.5),
    minWidth: 110,
  },
  miniSymbol: { color: colors.muted, fontSize: 13, marginRight: spacing(1) },
  miniText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700', paddingVertical: spacing(1.8) },
  assignNote: { fontSize: 11.5, fontWeight: '700', marginTop: spacing(1.5) },

  valueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(2.5), paddingVertical: spacing(1.5) },
  valueName: { color: colors.textSoft, fontSize: 14, flex: 1 },
  valueInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing(2.5),
    minWidth: 120,
  },
  valueSymbol: { color: colors.muted, fontSize: 12, marginRight: spacing(1) },
  valueText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700', paddingVertical: spacing(2) },
  valueSuffix: { color: colors.mutedDim, fontSize: 10.5 },

  previewHead: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5), marginBottom: spacing(1.5) },
  previewTitle: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing(1.2) },
  previewName: { color: colors.textSoft, fontSize: 13 },
  previewAmount: { color: colors.text, fontSize: 13, fontWeight: '700' },
  previewTotal: {
    marginTop: spacing(1),
    paddingTop: spacing(2),
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  previewTotalLabel: { color: colors.text, fontSize: 13.5, fontWeight: '800' },
  previewTotalValue: { color: colors.accent, fontSize: 15, fontWeight: '800' },

  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    marginTop: spacing(5),
    padding: spacing(3.5),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surface,
  },
  placeRowOn: { borderColor: tints.mint.border, backgroundColor: tints.mint.fill },
  placeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.mintWash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeTitle: { color: colors.text, fontSize: 13.5, fontWeight: '700', marginBottom: 2 },
  switch: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.surfaceHigh,
    padding: 3,
    justifyContent: 'center',
  },
  switchOn: { backgroundColor: colors.accentDeep },
  switchKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.muted,
  },
  switchKnobOn: { backgroundColor: colors.accentInk, transform: [{ translateX: 18 }] },
})
