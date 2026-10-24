import React, { useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { Banner, Body, Button, Field, Muted, Screen, Subtitle, Title } from '../components/ui'
import { useStore } from '../state'
import { colors, radius, spacing } from '../theme'

type Mode = 'signup' | 'signin'

export function AuthScreen() {
  const { signIn, signUp, busy, error, clearMessages } = useStore()
  const [mode, setMode] = useState<Mode>('signup')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [upiId, setUpi] = useState('')
  const [localError, setLocalError] = useState('')

  const switchMode = (next: Mode) => {
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
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen>
        <Body>
          <View style={{ marginTop: spacing(8) }}>
            <View style={styles.mark}>
              <Text style={styles.markText}>₹</Text>
            </View>
            <Title>RupeeTrail</Title>
            <Subtitle>
              One number, one account. Log what each of you paid and settle without the spreadsheet
              argument.
            </Subtitle>
          </View>

          <View style={styles.tabs}>
            {(
              [
                { id: 'signup', label: 'New account' },
                { id: 'signin', label: 'Sign in' },
              ] as { id: Mode; label: string }[]
            ).map((tab) => (
              <Pressable
                key={tab.id}
                onPress={() => switchMode(tab.id)}
                style={[styles.tab, mode === tab.id && styles.tabActive]}
              >
                <Text style={[styles.tabText, mode === tab.id && { color: colors.bg }]}>{tab.label}</Text>
              </Pressable>
            ))}
          </View>

          {mode === 'signup' && (
            <Field
              label="Your name"
              value={name}
              onChangeText={setName}
              placeholder="e.g. Arjun"
              autoCapitalize="words"
              maxLength={40}
            />
          )}

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
            secureTextEntry
            maxLength={6}
            hint="Anyone with your number and PIN can open these ledgers."
          />

          {mode === 'signup' && (
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
          )}

          {(localError || error) && <Banner tone="error">{localError || error}</Banner>}

          <Button
            label={mode === 'signup' ? 'Create account' : 'Sign in'}
            onPress={() => void submit()}
            loading={busy}
          />

          <Muted small>
            RupeeTrail never moves money and never sends an OTP. It records what each person says they
            paid, and every payment needs both sides to confirm.
          </Muted>
        </Body>
      </Screen>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  mark: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing(4),
  },
  markText: { color: '#062018', fontSize: 28, fontWeight: '900' },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing(1),
    marginTop: spacing(6),
    borderWidth: 1,
    borderColor: colors.border,
  },
  tab: { flex: 1, paddingVertical: spacing(2.5), borderRadius: radius.sm, alignItems: 'center' },
  tabActive: { backgroundColor: colors.accent },
  tabText: { color: colors.muted, fontWeight: '700', fontSize: 13 },
})
