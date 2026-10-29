import React, { useMemo, useState } from 'react'
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import {
  Banner,
  BusyLine,
  Button,
  Card,
  EmptyState,
  FadeIn,
  Field,
  Label,
  Muted,
  PressableScale,
  Screen,
  Sheet,
  buzz,
} from '../components/ui'
import { useStore } from '../state'
import { APP_LABEL } from '../config'
import { colors, gradients, radius, spacing, tints } from '../theme'

const EMOJI = ['🏖️', '🏠', '🍜', '🚗', '🎉', '🏔️', '✈️', '🍻', '🎓', '🧾']

export function GroupsScreen() {
  const { session, createGroup, joinGroup, openGroup, signOut, busy, error, clearMessages } = useStore()
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState(EMOJI[0])
  const [code, setCode] = useState('')
  const [query, setQuery] = useState('')

  const memberships = session?.memberships ?? []
  const first = session?.user.name.split(' ')[0] ?? 'there'

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return memberships
    return memberships.filter(
      (group) =>
        group.groupName.toLowerCase().includes(needle) || group.name.toLowerCase().includes(needle),
    )
  }, [memberships, query])

  return (
    <View style={{ flex: 1 }}>
      <Screen>
      <FadeIn>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>RUPEESPLIT</Text>
            <Text style={styles.greeting}>
              Hi {first}
              <Text style={{ color: colors.accent }}>.</Text>
            </Text>
            <Muted small>
              +91 {session?.user.phone} · {memberships.length}{' '}
              {memberships.length === 1 ? 'trip' : 'trips'}
            </Muted>
          </View>
          <PressableScale
            onPress={() =>
              Alert.alert('Sign out?', 'Your trips stay on the server. Sign back in with your number.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Sign out',
                  style: 'destructive',
                  onPress: () => void signOut(),
                },
              ])
            }
          >
            <View style={styles.signOut}>
              <Ionicons name="log-out-outline" size={18} color={colors.muted} />
            </View>
          </PressableScale>
        </View>
      </FadeIn>

      <FadeIn delay={80}>
        <LinearGradient
          colors={gradients.hero}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.heroLabel}>Every shared rupee</Text>
            <Text style={styles.heroLine}>Logged once. Split honestly.</Text>
            <Muted small>
              Scan a bill, tag the place, and settle with UPI — no spreadsheet argument.
            </Muted>
          </View>
          <View style={styles.heroBadge}>
            <Text style={{ fontSize: 26 }}>₹</Text>
          </View>
        </LinearGradient>
      </FadeIn>

      {error ? <Banner tone="error">{error}</Banner> : null}

      {memberships.length > 3 ? (
        <View style={styles.search}>
          <Ionicons name="search-outline" size={16} color={colors.mutedDim} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Find a trip"
            placeholderTextColor={colors.mutedDim}
            selectionColor={colors.accent}
            style={styles.searchInput}
          />
        </View>
      ) : null}

      <View style={styles.sectionRow}>
        <Text style={styles.sectionLabel}>Your trips</Text>
        <Pressable onPress={() => { clearMessages(); setJoining(true) }} hitSlop={8}>
          <Text style={styles.sectionAction}>Join with code</Text>
        </Pressable>
      </View>

      {memberships.length === 0 ? (
        <EmptyState
          emoji="🧭"
          title="No trips yet"
          body="Start one for the next trip, or join with a six-character code someone shared."
          action={<Button label="Create a trip" onPress={() => { clearMessages(); setCreating(true) }} />}
        />
      ) : visible.length === 0 ? (
        <EmptyState emoji="🔍" title="No trip matches" body="Try another word." />
      ) : (
        visible.map((group, index) => (
          <FadeIn key={group.groupId} delay={index * 60} offset={12}>
            <PressableScale onPress={() => void openGroup(group.groupId)} scaleTo={0.98}>
              <Card style={styles.groupCard}>
                <View style={styles.groupEmoji}>
                  <Text style={{ fontSize: 22 }}>{group.emoji || '🧾'}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: spacing(3) }}>
                  <Text style={styles.groupName} numberOfLines={1}>
                    {group.groupName}
                  </Text>
                  <Muted small>you are {group.name}</Muted>
                </View>
                <View style={styles.chevron}>
                  <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                </View>
              </Card>
            </PressableScale>
          </FadeIn>
        ))
      )}

      <Button
        label="Create a trip"
        onPress={() => {
          clearMessages()
          setCreating(true)
        }}
        icon={<Ionicons name="add" size={18} color={colors.accentInk} />}
      />

      <PressableScale onPress={() => void Linking.openURL('https://govira.tech')}>
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Powered by Govira Technologies <Text style={{ color: colors.accent }}>↗</Text>
          </Text>
          <Text style={styles.version}>RupeeSplit {APP_LABEL}</Text>
        </View>
      </PressableScale>

      {/* ------------------------------------------------------------ create */}
      <Sheet
        visible={creating}
        title="New trip"
        subtitle="A name and an icon is all it takes."
        onClose={() => setCreating(false)}
        footer={
          <Button
            label="Create trip"
            loading={busy}
            disabled={!name.trim()}
            onPress={async () => {
              if (!name.trim()) return
              const ok = await createGroup({ name: name.trim(), emoji })
              if (ok) {
                buzz()
                setCreating(false)
                setName('')
                setEmoji(EMOJI[0])
              }
            }}
          />
        }
      >
        <Field
          label="Trip name"
          value={name}
          onChangeText={setName}
          placeholder="Goa with the gang"
          maxLength={60}
        />
        <View style={{ marginTop: spacing(4) }}>
          <Label>Icon</Label>
          <View style={styles.emojiRow}>
            {EMOJI.map((choice) => (
              <PressableScale key={choice} onPress={() => setEmoji(choice)} scaleTo={0.9}>
                <View style={[styles.emojiButton, emoji === choice && styles.emojiActive]}>
                  <Text style={{ fontSize: 20 }}>{choice}</Text>
                </View>
              </PressableScale>
            ))}
          </View>
        </View>
      </Sheet>

      {/* -------------------------------------------------------------- join */}
      <Sheet
        visible={joining}
        title="Join a trip"
        subtitle="The six-character code is on the other person's screen."
        onClose={() => setJoining(false)}
        footer={
          <Button
            label="Join trip"
            loading={busy}
            disabled={code.trim().length < 4}
            onPress={async () => {
              if (code.trim().length < 4) return
              const ok = await joinGroup(code)
              if (ok) {
                buzz()
                setJoining(false)
                setCode('')
              }
            }}
          />
        }
      >
        <Field
          label="Invite code"
          value={code}
          onChangeText={(value) => setCode(value.toUpperCase())}
          placeholder="7KQ4M2"
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          maxLength={8}
          hint="You join with the name on your account, so nobody has to type it again."
        />
      </Sheet>
      </Screen>
      <BusyLine visible={busy} />
    </View>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing(2) },
  kicker: { color: colors.accent, fontSize: 10.5, fontWeight: '800', letterSpacing: 2.4, marginBottom: spacing(1) },
  greeting: { color: colors.text, fontSize: 30, fontWeight: '900', letterSpacing: -1 },
  signOut: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing(4.5),
    marginTop: spacing(4),
    overflow: 'hidden',
  },
  heroLabel: {
    color: colors.mutedDim,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  heroLine: { color: colors.text, fontSize: 18.5, fontWeight: '800', marginTop: spacing(1.5), letterSpacing: -0.4 },
  heroBadge: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: colors.mintWash,
    borderWidth: 1,
    borderColor: tints.accent.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing(5),
  },
  sectionLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  sectionAction: { color: colors.accent, fontSize: 11.5, fontWeight: '800' },

  groupCard: { flexDirection: 'row', alignItems: 'center', padding: spacing(3.5) },
  groupEmoji: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupName: { color: colors.text, fontSize: 15.5, fontWeight: '700' },
  chevron: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },

  footer: { alignItems: 'center', marginTop: spacing(6), gap: spacing(1.5) },
  footerText: { color: colors.muted, fontSize: 11.5, fontWeight: '600' },
  version: { color: colors.mutedDim, fontSize: 10 },

  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2), marginTop: spacing(2) },
  emojiButton: {
    width: 42,
    height: 42,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiActive: { borderColor: colors.accent, backgroundColor: tints.mint.fill },
})
