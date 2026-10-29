import React, { useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Avatar, Banner, Button, Card, Divider, Label, Muted, Pill, PressableScale, Sheet } from './ui'
import { colors, radius, spacing } from '../theme'
import { formatPaise } from '../lib/money'
import { allocateSplit } from '../lib/splits'
import { nameOf } from '../lib/balances'
import { categoryEmoji } from '../theme'
import type { GeoPoint } from '../lib/geo'
import type { Expense, Group, Member } from '../lib/types'

type Viewer = Pick<Member, 'id' | 'name' | 'upiId' | 'color'>

/**
 * One expense, explained.
 *
 * Every number here traces back to the stored split, so "why do I owe this?"
 * has an answer on the same screen: who paid, what each person's share is, who
 * has confirmed it, and what anybody has questioned.
 */
export function ExpenseDetail({
  expense,
  group,
  me,
  place,
  onClose,
  onEdit,
  onDelete,
  onAck,
  onResolve,
  onTagPlace,
  onClearPlace,
}: {
  expense: Expense
  group: Group
  me: Viewer
  place?: GeoPoint
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  onAck: (status: 'acknowledged' | 'questioned', reason?: string) => void | Promise<void>
  onResolve: (resolution: string) => void | Promise<void>
  onTagPlace: () => void | Promise<void>
  onClearPlace: () => void | Promise<void>
}) {
  const [questioning, setQuestioning] = useState(false)
  const [reason, setReason] = useState('')
  const [resolving, setResolving] = useState(false)
  const [resolution, setResolution] = useState('')
  const [working, setWorking] = useState<string | null>(null)

  const run = async (key: string, work: () => void | Promise<void>) => {
    if (working) return
    setWorking(key)
    try {
      await work()
    } finally {
      setWorking(null)
    }
  }

  const shares = useMemo(() => {
    try {
      return allocateSplit(expense.amountPaise, expense.split)
    } catch {
      return []
    }
  }, [expense])

  const myAck = expense.acks?.[me.id] ?? 'pending'
  const dispute = expense.dispute
  const isPlaceholder =
    (expense.split.mode === 'equal'
      ? expense.split.participants ?? []
      : Object.keys(expense.split.values ?? {})) ?? []

  const payers = expense.payers
    .map((payer) => `${nameOf(group, payer.memberId)} ${formatPaise(payer.amountPaise)}`)
    .join(' · ')

  return (
    <Sheet
      visible
      title={expense.description}
      subtitle={`${new Date(expense.date).toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })} · ${new Date(expense.date).toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
      })} · ${expense.split.mode === 'equal' ? 'equal split' : `${expense.split.mode} split`}`}
      onClose={onClose}
      full
      footer={
        <View style={{ flexDirection: 'row', gap: spacing(2.5) }}>
          <View style={{ flex: 1 }}>
            <Button label="Edit" variant="soft" onPress={onEdit} compact />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Delete" variant="danger" onPress={onDelete} compact />
          </View>
        </View>
      }
    >
      <Card tone="raised" style={{ marginTop: spacing(1) }}>
        <View style={styles.amountRow}>
          <View style={styles.categoryBubble}>
            <Text style={{ fontSize: 20 }}>{categoryEmoji[expense.category] ?? '📦'}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: spacing(3) }}>
            <Text style={styles.amount}>{formatPaise(expense.amountPaise)}</Text>
            <Muted small>{expense.category}</Muted>
          </View>
          <Pill tone={myAck === 'acknowledged' ? 'ok' : myAck === 'questioned' ? 'warn' : 'muted'}>
            {myAck === 'acknowledged' ? 'you agreed' : myAck === 'questioned' ? 'you questioned' : 'needs you'}
          </Pill>
        </View>

        <Divider />

        <Text style={styles.label}>Paid by</Text>
        <Text style={styles.value}>{payers}</Text>

        {expense.notes ? (
          <>
            <Text style={[styles.label, { marginTop: spacing(3) }]}>Note</Text>
            <Text style={styles.notes}>{expense.notes}</Text>
          </>
        ) : null}

        <View style={styles.placeRow}>
          <Ionicons
            name={place ? 'location' : 'location-outline'}
            size={16}
            color={place ? colors.accent : colors.muted}
          />
          <Text style={styles.placeText} numberOfLines={1}>
            {place?.label ? place.label : place ? `${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}` : 'No place tagged'}
          </Text>
          <PressableScale
            onPress={() => void run('place', place ? onClearPlace : onTagPlace)}
            disabled={working === 'place'}
          >
            {working === 'place' ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Text style={styles.placeAction}>{place ? 'Remove' : 'Tag'}</Text>
            )}
          </PressableScale>
        </View>
      </Card>

      <Card>
        <Label>How it splits</Label>
        {shares.length === 0 ? (
          <Muted small>This split could not be read. Edit the expense to fix it.</Muted>
        ) : (
          shares.map((share) => {
            const member = group.members.find((entry) => entry.id === share.memberId)
            return (
              <View key={share.memberId} style={styles.shareRow}>
                <Avatar name={member?.name ?? '?'} color={member?.color ?? 0} size={26} />
                <Text style={styles.shareName} numberOfLines={1}>
                  {member?.name ?? 'Member'}
                  {share.memberId === me.id ? '  (you)' : ''}
                </Text>
                <Text style={styles.shareAmount}>{formatPaise(share.amountPaise)}</Text>
              </View>
            )
          })
        )}
        <Muted small>
          {expense.split.mode === 'equal'
            ? `Split equally between ${isPlaceholder.length} ${isPlaceholder.length === 1 ? 'person' : 'people'}.`
            : `Split by ${expense.split.mode} values, rounded to the paise with a stable remainder pass.`}
        </Muted>
      </Card>

      <Card>
        <Label>Confirmations</Label>
        {group.members
          .filter((member) => !member.leftAt)
          .map((member) => {
            const status = expense.acks?.[member.id] ?? 'pending'
            return (
              <View key={member.id} style={styles.shareRow}>
                <Avatar name={member.name} color={member.color} size={24} />
                <Text style={styles.shareName} numberOfLines={1}>
                  {member.name}
                </Text>
                <Pill tone={status === 'acknowledged' ? 'ok' : status === 'questioned' ? 'warn' : 'muted'}>
                  {status === 'acknowledged' ? 'agreed' : status === 'questioned' ? 'questioned' : 'waiting'}
                </Pill>
              </View>
            )
          })}
      </Card>

      {dispute ? (
        <Card tone={dispute.status === 'open' ? 'plain' : 'mint'}>
          <View style={styles.disputeHead}>
            <Ionicons
              name={dispute.status === 'open' ? 'alert-circle-outline' : 'checkmark-circle-outline'}
              size={17}
              color={dispute.status === 'open' ? colors.warn : colors.accent}
            />
            <Text style={styles.disputeTitle}>
              Questioned by {nameOf(group, dispute.raisedBy)}
            </Text>
          </View>
          <Text style={styles.disputeReason}>{dispute.reason}</Text>
          {dispute.status === 'open' && dispute.raisedBy !== me.id ? (
            resolving ? (
              <View style={{ marginTop: spacing(2) }}>
                <TextInput
                  value={resolution}
                  onChangeText={setResolution}
                  placeholder="What was agreed?"
                  placeholderTextColor={colors.mutedDim}
                  selectionColor={colors.accent}
                  style={styles.resolveInput}
                  multiline
                />
                <View style={{ flexDirection: 'row', gap: spacing(2.5), marginTop: spacing(2) }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      label="Resolve"
                      compact
                      disabled={!resolution.trim()}
                      loading={working === 'resolve'}
                      onPress={() =>
                        void run('resolve', async () => {
                          await onResolve(resolution.trim())
                          setResolving(false)
                          setResolution('')
                        })
                      }
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label="Cancel" variant="ghost" compact onPress={() => setResolving(false)} />
                  </View>
                </View>
              </View>
            ) : (
              <Button label="Resolve this question" variant="soft" compact onPress={() => setResolving(true)} />
            )
          ) : null}
          {dispute.status === 'resolved' ? (
            <Text style={styles.resolution}>Resolved: {dispute.resolution}</Text>
          ) : (
            <Muted small>
              {dispute.status === 'open'
                ? dispute.raisedBy === me.id
                  ? 'You flagged this. The numbers stay as recorded until someone revises the expense.'
                  : 'Balances still use this expense. Resolve it, or edit the expense to correct it.'
                : ''}
            </Muted>
          )}
        </Card>
      ) : null}

      {myAck !== 'acknowledged' ? (
        <View style={{ marginTop: spacing(3) }}>
          <Button
            label="This looks right"
            variant="soft"
            loading={working === 'agree'}
            onPress={() => void run('agree', () => onAck('acknowledged'))}
          />
          {questioning ? (
            <View>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="What looks wrong?"
                placeholderTextColor={colors.mutedDim}
                selectionColor={colors.accent}
                style={styles.resolveInput}
                multiline
              />
              <Button
                label="Send question"
                variant="danger"
                disabled={!reason.trim()}
                loading={working === 'question'}
                onPress={() =>
                  void run('question', async () => {
                    await onAck('questioned', reason.trim())
                    setQuestioning(false)
                    setReason('')
                  })
                }
              />
              <Button label="Cancel" variant="ghost" compact onPress={() => setQuestioning(false)} />
            </View>
          ) : (
            <Button
              label="Something looks wrong"
              variant="ghost"
              onPress={() => setQuestioning(true)}
            />
          )}
        </View>
      ) : (
        <View style={{ marginTop: spacing(2) }}>
          <Muted small>You agreed with this expense. It counts in everyone's balances.</Muted>
        </View>
      )}

      {myAck === 'questioned' && !dispute ? (
        <Banner tone="info">Your question is recorded. The other person can resolve it.</Banner>
      ) : null}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  amountRow: { flexDirection: 'row', alignItems: 'center' },
  categoryBubble: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amount: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.8 },
  label: { color: colors.mutedDim, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  value: { color: colors.text, fontSize: 14, marginTop: spacing(1), fontWeight: '600' },
  notes: { color: colors.textSoft, fontSize: 13, marginTop: spacing(1), lineHeight: 19 },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    marginTop: spacing(3.5),
    paddingTop: spacing(3),
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  placeText: { color: colors.muted, fontSize: 12, flex: 1 },
  placeAction: { color: colors.accent, fontSize: 11.5, fontWeight: '800' },

  shareRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(2.5), paddingVertical: spacing(1.6) },
  shareName: { color: colors.textSoft, fontSize: 13, flex: 1 },
  shareAmount: { color: colors.text, fontSize: 13, fontWeight: '700' },

  disputeHead: { flexDirection: 'row', alignItems: 'center', gap: spacing(2) },
  disputeTitle: { color: colors.text, fontSize: 13.5, fontWeight: '700' },
  disputeReason: { color: colors.textSoft, fontSize: 13, marginTop: spacing(2), lineHeight: 19 },
  resolution: { color: colors.accent, fontSize: 12.5, marginTop: spacing(2), fontWeight: '600' },
  resolveInput: {
    marginTop: spacing(2),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing(3),
    color: colors.text,
    fontSize: 14,
    minHeight: 64,
    textAlignVertical: 'top',
  },
})
