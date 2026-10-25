import React, { useEffect, useRef } from 'react'
import { ActivityIndicator, Animated, BackHandler, Easing, StyleSheet, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import NetInfo, { useNetInfo } from '@react-native-community/netinfo'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { LedgerProvider, useStore } from './src/state'
import { AuthScreen } from './src/screens/AuthScreen'
import { GroupsScreen } from './src/screens/GroupsScreen'
import { GroupScreen } from './src/screens/GroupScreen'
import { OfflineGate } from './src/OfflineGate'
import { UpdateGate } from './src/UpdateGate'
import { Toast } from './src/components/ui'
import { colors } from './src/theme'

function Scene({ children }: { children: React.ReactNode }) {
  const progress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [progress])

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  )
}

function Shell() {
  const { ready, session, active, closeGroup, notice, error } = useStore()
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

  if (offline) return <Scene key="offline"><OfflineGate onRetry={() => void NetInfo.refresh()} /></Scene>

  const route = !session ? 'auth' : active ? 'group' : 'groups'

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Scene key={route}>
        {route === 'auth' ? <AuthScreen /> : route === 'group' ? <GroupScreen /> : <GroupsScreen />}
      </Scene>
      {notice ? <Toast key={notice} message={notice} tone="ok" /> : null}
      {!notice && error ? <Toast key={error} message={error} tone="error" /> : null}
    </View>
  )
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <LedgerProvider>
        <Shell />
        <UpdateGate />
      </LedgerProvider>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
})
