import React, { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { Banner, Body, Button, Card, Field, Muted, ModalSheet, Screen, Subtitle, Title } from '../components/ui'
import { useStore } from '../state'
import { colors, radius, spacing } from '../theme'

const EMOJI = ['🏖️', '🏠', '🍜', '🚗', '🎉', '🏔️']

export function GroupsScreen() {
  const { session, createGroup, joinGroup, openGroup, signOut, busy, error, clearMessages } = useStore()
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState(EMOJI[0])
  const [code, setCode] = useState('')

  const memberships = session?.memberships ?? []
  const first = session?.user.name.split(' ')[0] ?? 'there'

  return (
    <Screen>
      <Body>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Muted small>Signed in as +91 {session?.user.phone}</Muted>
            <Title>Hi {first}</Title>
            <Subtitle>Every trip, flat and dinner, one honest ledger.</Subtitle>
          </View>
          <Pressable
            onPress={() =>
              Alert.alert('Sign out?', 'Your groups stay on the server; sign back in with your number.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
              ])
            }
          >
            <Text style={styles.signOut}>Sign out</Text>
          </Pressable>
        </View>

        {error ? <Banner tone="error">{error}</Banner> : null}

        {memberships.length === 0 ? (
          <Card>
            <Text style={styles.emptyTitle}>No groups yet</Text>
            <Muted>
              Create one for your trip, or enter the six-character code someone shared with you.
            </Muted>
          </Card>
        ) : (
          memberships.map((group) => (
            <Pressable key={group.groupId} onPress={() => void openGroup(group.groupId)}>
              <Card style={styles.groupCard}>
                <Text style={{ fontSize: 26 }}>{group.emoji}</Text>
                <View style={{ flex: 1, marginLeft: spacing(3) }}>
                  <Text style={styles.groupName}>{group.groupName}</Text>
                  <Muted small>
                    you are {group.name}
                  </Muted>
                </View>
                <Text style={{ color: colors.muted, fontSize: 20 }}>›</Text>
              </Card>
            </Pressable>
          ))
        )}

        <Button label="Create a group" onPress={() => { clearMessages(); setCreating(true) }} />
        <Button label="Join with a code" variant="soft" onPress={() => { clearMessages(); setJoining(true) }} />

        <View style={{ alignItems: 'center', marginTop: spacing(4) }}>
          <Muted small>Powered by Govira · govira.tech</Muted>
        </View>
      </Body>

      <ModalSheet visible={creating} title="New group" onClose={() => setCreating(false)}>
        <Field label="Group name" value={name} onChangeText={setName} placeholder="e.g. Goa plan" maxLength={60} />
        <Text style={styles.pickerLabel}>Icon</Text>
        <View style={styles.emojiRow}>
          {EMOJI.map((choice) => (
            <Pressable
              key={choice}
              onPress={() => setEmoji(choice)}
              style={[styles.emojiButton, emoji === choice && styles.emojiActive]}
            >
              <Text style={{ fontSize: 22 }}>{choice}</Text>
            </Pressable>
          ))}
        </View>
        <Button
          label="Create group"
          loading={busy}
          onPress={async () => {
            if (!name.trim()) return
            const ok = await createGroup({ name: name.trim(), emoji })
            if (ok) {
              setCreating(false)
              setName('')
            }
          }}
        />
      </ModalSheet>

      <ModalSheet visible={joining} title="Join a group" onClose={() => setJoining(false)}>
        <Subtitle>Enter the six-character invite code from the other person's app.</Subtitle>
        <Field
          label="Invite code"
          value={code}
          onChangeText={(value) => setCode(value.toUpperCase())}
          placeholder="7KQ4M2"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={8}
        />
        <Button
          label="Join group"
          loading={busy}
          onPress={async () => {
            if (code.trim().length < 4) return
            const ok = await joinGroup(code)
            if (ok) {
              setJoining(false)
              setCode('')
            }
          }}
        />
      </ModalSheet>

    </Screen>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing(2) },
  signOut: { color: colors.muted, fontSize: 13, paddingTop: spacing(2) },
  groupCard: { flexDirection: 'row', alignItems: 'center' },
  groupName: { color: colors.text, fontSize: 17, fontWeight: '700' },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: spacing(1) },
  pickerLabel: { color: colors.muted, fontSize: 12, marginTop: spacing(4), textTransform: 'uppercase', letterSpacing: 0.4 },
  emojiRow: { flexDirection: 'row', gap: spacing(2), marginTop: spacing(2) },
  emojiButton: {
    padding: spacing(2),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  emojiActive: { borderColor: colors.accent, backgroundColor: '#14342a' },
})
