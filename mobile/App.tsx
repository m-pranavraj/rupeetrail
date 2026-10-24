import React, { useEffect } from 'react'
import { ActivityIndicator, BackHandler, StatusBar, StyleSheet, View } from 'react-native'
import NetInfo, { useNetInfo } from '@react-native-community/netinfo'
import { LedgerProvider, useStore } from './src/state'
import { AuthScreen } from './src/screens/AuthScreen'
import { GroupsScreen } from './src/screens/GroupsScreen'
import { GroupScreen } from './src/screens/GroupScreen'
import { OfflineGate } from './src/OfflineGate'
import { UpdateGate } from './src/UpdateGate'
import { colors } from './src/theme'

function Shell() {
  const { ready, session, active, closeGroup } = useStore()
  const net = useNetInfo()

  // The app is intentionally online-only: a shared ledger needs the server.
  const offline = net.isConnected === false

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (active) {
        closeGroup()
        return true
      }
      return false
    })
    return () => sub.remove()
  }, [active, closeGroup])

  if (!ready) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    )
  }

  if (offline) {
    return <OfflineGate onRetry={() => void NetInfo.refresh()} />
  }

  if (!session) return <AuthScreen />
  if (active) return <GroupScreen />
  return <GroupsScreen />
}

export default function App() {
  return (
    <LedgerProvider>
      <StatusBar barStyle="light-content" />
      <Shell />
      <UpdateGate />
    </LedgerProvider>
  )
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
})
