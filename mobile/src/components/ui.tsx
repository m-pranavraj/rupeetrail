import React from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native'
import { colors, radius, spacing } from '../theme'

export function Screen({ children, padded = true }: { children: React.ReactNode; padded?: boolean }) {
  return (
    <View style={[styles.screen, padded && { paddingHorizontal: spacing(5) }]}>
      {children}
    </View>
  )
}

export function Body({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  if (!scroll) return <View style={{ flex: 1 }}>{children}</View>
  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: spacing(10) }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  )
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>
}

export function Subtitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.subtitle}>{children}</Text>
}

export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>
}

export function Muted({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return <Text style={[styles.muted, small && { fontSize: 12 }]}>{children}</Text>
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  testID,
}: {
  label: string
  onPress: () => void
  variant?: 'primary' | 'soft' | 'ghost' | 'danger'
  disabled?: boolean
  loading?: boolean
  testID?: string
}) {
  const palette = {
    primary: { bg: colors.accent, fg: '#062018', border: colors.accent },
    soft: { bg: colors.surfaceAlt, fg: colors.text, border: colors.border },
    ghost: { bg: 'transparent', fg: colors.muted, border: colors.border },
    danger: { bg: 'transparent', fg: colors.danger, border: '#3d211d' },
  }[variant]

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border },
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.85 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} size="small" />
      ) : (
        <Text style={[styles.buttonText, { color: palette.fg }]}>{label}</Text>
      )}
    </Pressable>
  )
}

export function Field({
  label,
  hint,
  ...props
}: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ marginTop: spacing(3) }}>
      <Label>{label}</Label>
      <TextInput
        placeholderTextColor="#5f7a6d"
        {...props}
        style={[styles.input, props.style]}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  )
}

export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>
}

export function Pill({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode
  tone?: 'muted' | 'ok' | 'warn' | 'bad'
}) {
  const map = {
    muted: { bg: '#1b2f27', fg: colors.muted },
    ok: { bg: '#123a2c', fg: colors.accent },
    warn: { bg: '#3a2f14', fg: colors.warn },
    bad: { bg: '#3a1d19', fg: colors.danger },
  }[tone]
  return (
    <View style={[styles.pill, { backgroundColor: map.bg }]}>
      <Text style={[styles.pillText, { color: map.fg }]}>{children}</Text>
    </View>
  )
}

export function Avatar({ name, color, size = 32 }: { name: string; color: number; size?: number }) {
  const palette = ['#2f6b57', '#c8553d', '#3d6fa8', '#b07a2a', '#7a4fa0', '#2d7a8a', '#a54e75', '#5c6b3a']
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: palette[Math.abs(color) % palette.length],
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#fff', fontSize: size * 0.36, fontWeight: '700' }}>{initials || '?'}</Text>
    </View>
  )
}

export function Banner({ tone, children }: { tone: 'error' | 'info'; children: React.ReactNode }) {
  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: tone === 'error' ? '#3a1d19' : '#123a2c' },
      ]}
    >
      <Text style={{ color: tone === 'error' ? colors.danger : colors.accent, fontSize: 13 }}>
        {children}
      </Text>
    </View>
  )
}

export function ModalSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
              <Text style={{ color: colors.muted, fontSize: 22 }}>×</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={{ paddingBottom: spacing(8) }}>{children}</View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: (StatusBar.currentHeight ?? 0) + spacing(3),
  },
  title: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: spacing(1), lineHeight: 20 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
  muted: { color: colors.muted, fontSize: 14 },
  hint: { color: '#5f7a6d', fontSize: 12, marginTop: spacing(1) },
  input: {
    marginTop: spacing(1.5),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing(3.5),
    paddingVertical: spacing(3),
    color: colors.text,
    fontSize: 16,
  },
  button: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing(3.5),
    alignItems: 'center',
    marginTop: spacing(3),
  },
  buttonText: { fontSize: 15, fontWeight: '700' },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing(4),
    marginTop: spacing(3),
  },
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(0.75),
    alignSelf: 'flex-start',
  },
  pillText: { fontSize: 11, fontWeight: '700' },
  banner: { borderRadius: radius.md, padding: spacing(3), marginTop: spacing(3) },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing(5),
    maxHeight: '90%',
  },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing(2) },
  sheetTitle: { color: colors.text, fontSize: 19, fontWeight: '700' },
})
