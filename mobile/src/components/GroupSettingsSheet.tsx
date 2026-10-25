import React, { useState } from 'react'
import { Alert, Linking, Share, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Ionicons } from '@expo/vector-icons'
import {
  Avatar,
  Banner,
  Button,
  Card,
  Divider,
  Field,
  Label,
  Muted,
  Pill,
  PressableScale,
  Sheet,
  tap,
} from './ui'
import { colors, radius, spacing } from '../theme'
import { formatPaise } from '../lib/money'
import type { Group } from '../lib/types'

const EMOJI = ['🏖️', '🏠', '🍜', '🚗', '🎉', '🏔️', '✈️', '🍻', '🎓', '🧾']

const GOVIRA_URL = 'https://govira.tech'

export function GroupSettingsSheet({
  group,
  code,
  inviteLink,
  meId,
  appVersion,
  totalPaise,
  onClose,
  onRename,
  onStatus,
  onAddPerson,
  onRemovePerson,
  onExport,
}: {
  group: Group
  code: string
  inviteLink: string
  meId: string
  appVersion: string
  totalPaise: number
  onClose: () => void
  onRename: (name: string, emoji: string) => Promise<boolean>
  onStatus: (status: 'active' | 'closed') => Promise<boolean>
  onAddPerson: (name: string, upiId: string) => Promise<boolean>
  onRemovePerson: (memberId: string) => Promise<boolean>
  onExport: () => void
}) {
  const [name, setName] = useState(group.name)
  const [emoji, setEmoji] = useState(group.emoji)
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)
  const [personName, setPersonName] = useState('')
  const [personUpi, setPersonUpi] = useState('')
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const active = group.members.filter((member) => !member.leftAt)
  const placeholders = active.filter((member) => member.isPlaceholder)
  const closed = group.status === 'closed'

  const copy = async (value: string, kind: 'code' | 'link') => {
    await Clipboard.setStringAsync(value)
    tap()
    setCopied(kind)
    setTimeout(() => setCopied(null), 1_600)
  }

  const share = async () => {
    await Share.share({
      message: `Join “${group.name}” on RupeeSplit — log who paid what and settle without the spreadsheet: ${inviteLink} (code ${code})`,
    })
  }

  const whatsapp = async () => {
    const text = encodeURIComponent(
      `Join “${group.name}” on RupeeSplit: ${inviteLink} (code ${code})`,
    )
    const app = `whatsapp://send?text=${text}`
    const web = `https://wa.me/?text=${text}`
    try {
      const supported = await Linking.canOpenURL(app)
      await Linking.openURL(supported ? app : web)
    } catch {
      await Linking.openURL(web)
    }
  }

  const rename = async () => {
    if (!name.trim() || (name.trim() === group.name && emoji === group.emoji)) return
    setSaving(true)
    setError('')
    const ok = await onRename(name.trim(), emoji)
    setSaving(false)
    if (!ok) setError('Could not rename the group. Try again.')
  }

  const toggleStatus = () => {
    Alert.alert(
      closed ? 'Reopen this trip?' : 'Close this trip?',
      closed
        ? 'Everyone can add expenses again.'
        : 'The ledger stays readable and exportable, but new expenses stop until you reopen it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: closed ? 'Reopen' : 'Close trip',
          style: closed ? 'default' : 'destructive',
          onPress: () => void onStatus(closed ? 'active' : 'closed'),
        },
      ],
    )
  }

  return (
    <Sheet visible title="Trip settings" subtitle={`${group.emoji} ${group.name}`} onClose={onClose} full>
      {error ? <Banner tone="error">{error}</Banner> : null}

      <Card tone="raised" style={{ marginTop: spacing(1) }}>
        <Label>Invite</Label>
        <View style={styles.codeRow}>
          <Text style={styles.code}>{code}</Text>
          <PressableScale onPress={() => void copy(code, 'code')}>
            <View style={styles.copyButton}>
              <Ionicons name={copied === 'code' ? 'checkmark' : 'copy-outline'} size={15} color={colors.accent} />
              <Text style={styles.copyText}>{copied === 'code' ? 'Copied' : 'Copy code'}</Text>
            </View>
          </PressableScale>
        </View>
        <Muted small numberOfLines={1}>
          {inviteLink}
        </Muted>
        <View style={styles.inviteActions}>
          <PressableScale style={{ flex: 1 }} onPress={() => void share()}>
            <View style={styles.inviteAction}>
              <Ionicons name="share-outline" size={16} color={colors.text} />
              <Text style={styles.inviteActionText}>Share</Text>
            </View>
          </PressableScale>
          <PressableScale style={{ flex: 1 }} onPress={() => void whatsapp()}>
            <View style={styles.inviteAction}>
              <Ionicons name="logo-whatsapp" size={16} color="#63e6a5" />
              <Text style={styles.inviteActionText}>WhatsApp</Text>
            </View>
          </PressableScale>
        </View>
      </Card>

      <Card>
        <Label>Name</Label>
        <Field label="Trip name" value={name} onChangeText={setName} maxLength={60} />
        <View style={styles.emojiRow}>
          {EMOJI.map((choice) => (
            <PressableScale key={choice} onPress={() => setEmoji(choice)} scaleTo={0.9}>
              <View style={[styles.emojiButton, emoji === choice && styles.emojiActive]}>
                <Text style={{ fontSize: 19 }}>{choice}</Text>
              </View>
            </PressableScale>
          ))}
        </View>
        {name.trim() !== group.name || emoji !== group.emoji ? (
          <Button label="Save name" compact loading={saving} onPress={() => void rename()} />
        ) : null}
      </Card>

      <Card>
        <View style={styles.statusRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusTitle}>{closed ? 'Trip closed' : 'Trip in progress'}</Text>
            <Muted small>
              {closed
                ? 'Read-only. Reopen to keep adding expenses.'
                : `${active.length} ${active.length === 1 ? 'person' : 'people'} · ${formatPaise(totalPaise)} logged`}
            </Muted>
          </View>
          <Pill tone={closed ? 'warn' : 'ok'}>{closed ? 'closed' : 'active'}</Pill>
        </View>
        <Divider />
        <Button
          label={closed ? 'Reopen trip' : 'Close trip'}
          variant={closed ? 'soft' : 'ghost'}
          compact
          onPress={toggleStatus}
        />
      </Card>

      <Card>
        <Label>People</Label>
        {active.map((member) => (
          <View key={member.id} style={styles.memberRow}>
            <Avatar name={member.name} color={member.color} size={30} />
            <View style={{ flex: 1, marginLeft: spacing(2.5) }}>
              <Text style={styles.memberName} numberOfLines={1}>
                {member.name}
                {member.id === meId ? '  (you)' : ''}
              </Text>
              <Muted small>{member.isPlaceholder ? 'added by name · not joined yet' : 'joined'}</Muted>
            </View>
            {member.isPlaceholder ? (
              <PressableScale
                onPress={() =>
                  Alert.alert('Remove this person?', 'They have no expenses attached, so nothing is lost.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: () => void onRemovePerson(member.id) },
                  ])
                }
              >
                <Text style={styles.remove}>Remove</Text>
              </PressableScale>
            ) : null}
          </View>
        ))}

        {adding ? (
          <View style={{ marginTop: spacing(2) }}>
            <Field label="Their name" value={personName} onChangeText={setPersonName} placeholder="Priya" maxLength={40} />
            <Field
              label="UPI id (optional)"
              value={personUpi}
              onChangeText={setPersonUpi}
              placeholder="name@okhdfcbank"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={{ flexDirection: 'row', gap: spacing(2.5) }}>
              <View style={{ flex: 1 }}>
                <Button
                  label="Add"
                  compact
                  disabled={!personName.trim()}
                  onPress={async () => {
                    const ok = await onAddPerson(personName.trim(), personUpi.trim())
                    if (ok) {
                      setPersonName('')
                      setPersonUpi('')
                      setAdding(false)
                    }
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Cancel" variant="ghost" compact onPress={() => setAdding(false)} />
              </View>
            </View>
          </View>
        ) : (
          <Button
            label="Add someone who hasn't joined"
            variant="soft"
            compact
            onPress={() => setAdding(true)}
          />
        )}
        {placeholders.length > 0 ? (
          <Muted small>
            People added by name appear in splits now. When they join with the code, they take over the same entry
            and keep their history.
          </Muted>
        ) : null}
      </Card>

      <Card>
        <Label>Trip data</Label>
        <Button
          label="Export this trip as CSV"
          variant="soft"
          compact
          onPress={onExport}
          icon={<Ionicons name="download-outline" size={16} color={colors.text} />}
        />
        <Muted small>
          Balances, every expense with each person's share, and all recorded payments — one spreadsheet.
        </Muted>
      </Card>

      <View style={styles.footer}>
        <Text style={styles.version}>RupeeSplit {appVersion}</Text>
        <PressableScale onPress={() => void Linking.openURL(GOVIRA_URL)}>
          <Text style={styles.govira}>
            Powered by Govira Technologies <Text style={{ color: colors.accent }}>↗</Text>
          </Text>
        </PressableScale>
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing(2) },
  code: { color: colors.accent, fontSize: 26, fontWeight: '900', letterSpacing: 5 },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.5),
    backgroundColor: '#123f30',
    borderRadius: radius.pill,
    paddingHorizontal: spacing(2.5),
    paddingVertical: spacing(1.5),
  },
  copyText: { color: colors.accent, fontSize: 11, fontWeight: '800' },
  inviteActions: { flexDirection: 'row', gap: spacing(2.5), marginTop: spacing(3) },
  inviteAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(2),
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.md,
    paddingVertical: spacing(2.6),
    borderWidth: 1,
    borderColor: colors.border,
  },
  inviteActionText: { color: colors.text, fontSize: 12.5, fontWeight: '700' },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2), marginTop: spacing(2) },
  emojiButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiActive: { borderColor: colors.accent, backgroundColor: '#14342a' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(3) },
  statusTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginBottom: 2 },
  memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing(2) },
  memberName: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  remove: { color: colors.coral, fontSize: 11.5, fontWeight: '700' },
  footer: { alignItems: 'center', marginTop: spacing(6), gap: spacing(1.5) },
  version: { color: colors.mutedDim, fontSize: 10.5 },
  govira: { color: colors.muted, fontSize: 11.5, fontWeight: '600' },
})
