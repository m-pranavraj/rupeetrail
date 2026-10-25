import React, { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import {
  Banner,
  Button,
  FadeIn,
  Field,
  Muted,
  PressableScale,
  Screen,
  Subtitle,
  tap,
} from '../components/ui'
import { useStore } from '../state'
import { colors, gradients, radius, spacing } from '../theme'

type Mode = 'signup' | 'signin'

export function AuthScreen() {
  const { signIn, signUp, busy, error, clearMessages } = useStore()
  const [mode, setMode] = useState<Mode>('signup')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [upiId, setUpi] = useState('')
  const [reveal, setReveal] = useState(false)
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardWillShow', ({ endCoordinates }) => {
      const scrollView = screenRef.current
      if (scrollView) {
        scrollView.scrollTo({ y: endCoordinates.height })
      }
    })
    return () => subscription.remove()
  }, [])

  const switchMode = (next: Mode) => {
    if (next === mode) return
    tap()
    setMode(next)
    setLocalError('')
    clearMessages()
  }

  const submit = async () => {
    const digits = phone.replace(/\D/g, '').slice(-10)
    if (!/^[6-9]\d{9}$/.test(digits)) {
      setLocalError('Enter a 10-digit Indian mobile number.')
      return
    }
    if (!/^\d{4,6}$/.test(pin)) {
      setLocalError('Your PIN must be 4 to 6 digits.')
      return
    }
    if (mode === 'signup' && name.trim().length < 2) {
      setLocalError('Tell us your name so the group knows who paid.')
      return
    }
    setLocalError('')
    if (mode === 'signup') {
      await signUp({ name: name.trim(), phone: digits, pin, upiId: upiId.trim() || undefined })
    } else {
      await signIn({ phone: digits, pin })
    }
  }

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardShouldPersistTaps="handled"
      style={styles.container}
    >
      <FadeIn>
        <View style={styles.markRow}>
          <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.mark}>
            <Text style={styles.markText}>₹</Text>
          </LinearGradient>
          <View style={{ marginLeft: spacing(3) }}>
            <Text style={styles.brand}>RupeeSplit</Text>
            <Text style={styles.brandSub}>by Govira Technologies</Text>
          </View>
        </View>
      </FadeIn>

      <FadeIn delay={100}>
        <View style={styles.tabs}>
          {(
            [
              { id: 'signup', label: 'New account' },
              { id: 'signin', label: 'Sign in' },
            ] as { id: Mode; label: string }[]
          ).map((tab) => {
            const active = mode === tab.id
            return (
              <Pressable key={tab.id} onPress={() => switchMode(tab.id)} style={styles.tab}>
                {active ? (
                  <LinearGradient
                    colors={gradients.primary}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                ) : null}
                <Text style={[styles.tabText, active && { color: colors.accentInk }]}>{tab.label}</Text>
              </Pressable>
            )
          })}
        </View>
      </FadeIn>

      {mode === 'signup' ? (
        <Field
          label="Your name"
          value={name}
          onChangeText={setName}
          placeholder="Arjun"
          autoCapitalize="words"
          maxLength={40}
        />
      ) : null}

      <Field
        label="Mobile number"
        value={phone}
        onChangeText={setPhone}
        placeholder="9876543210"
        keyboardType="number-pad"
        maxLength={10}
        hint="This number is your account. Only one account can use it."
      />

      <Field
        label="PIN"
        value={pin}
        onChangeText={setPin}
        placeholder="4–6 digits"
        keyboardType="number-pad"
        secureTextEntry={!reveal}
        maxLength={6}
        hint="Anyone with your number and PIN can open these ledgers."
        right={
          <Pressable onPress={() => setReveal((value) => !value)} hitSlop={10}>
            <Ionicons
              name={reveal ? 'eye-off-outline' : 'eye-outline'}
              size={18}
              color={colors.muted}
            />
          </Pressable>
        }
      />

      {mode === 'signup' ? (
        <Field
          label="UPI id (optional)"
          value={upiId}
          onChangeText={setUpi}
          placeholder="name@okhdfcbank"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={100}
          hint="So people can actually pay you from the settle screen."
        />
      ) : null}

      {localError || error ? <Banner tone="error">{localError || error}</Banner> : null}

      <Button
        label={mode === 'signup' ? 'Create my account' : 'Sign in'}
        onPress={() => void submit()}
        loading={busy}
      />

      <Muted small>
        {mode === 'signup'
          ? 'Already have one? Tap Sign in above — your trips come back automatically.'
          : 'New here? Create an account with just your number and a PIN.'}
      </Muted>

      <PressableScale onPress={() => void Linking.openURL('https://govira.tech')}>
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Powered by Govira Technologies <Text style={{ color: colors.accent }}>↗</Text>
          </Text>
        </View>
      </PressableScale>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  markRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing(4),
    paddingTop: spacing(8),
  },
  mark: {
    fontSize: 48,
    color: colors.accent,
  },
  markText: {
    fontSize: 48,
    color: '#fff',
    marginRight: spacing(1),
  },
  headline: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.onBackground,
    textAlign: 'center',
    paddingHorizontal: spacing(4),
    paddingTop: spacing(8),
  },
  tabs: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginHorizontal: spacing(4),
    marginTop: spacing(4),
  },
  tab: {
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
    borderRadius: radius.pill,
    marginHorizontal: spacing(1),
  },
  tabText: {
    fontSize: 14,
    color: colors.muted,
  },
  footer: {
    alignItems: 'center',
    marginTop: spacing(8),
  },
  footerText: { color: colors.muted, fontSize: 11.5, fontWeight: '600' },
})