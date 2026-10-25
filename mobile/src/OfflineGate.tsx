import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Button } from './components/ui'
import { colors, spacing } from './theme'

/**
 * RupeeSplit is server-authoritative: balances must be computed from the same
 * ledger everyone else sees, so the app does not run without a connection.
 */
export function OfflineGate({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.icon}>⇅</Text>
      <Text style={styles.title}>You're offline</Text>
      <Text style={styles.body}>
        RupeeSplit keeps every trip on the server so nobody's balance can drift. Turn on mobile data or
        Wi-Fi and try again.
      </Text>
      <Button label="Try again" onPress={onRetry} />
      <Text style={styles.hint}>
        Nothing you entered is lost: the ledger lives on the server, and this screen reappears only while
        the phone has no connection.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing(8),
  },
  icon: { fontSize: 42, color: colors.accent, marginBottom: spacing(4) },
  title: { color: colors.text, fontSize: 24, fontWeight: '800' },
  body: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: spacing(3),
    marginBottom: spacing(4),
  },
  hint: {
    color: '#5f7a6d',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: spacing(4),
  },
})
