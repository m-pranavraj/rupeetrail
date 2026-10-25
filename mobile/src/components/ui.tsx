import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import * as Haptics from 'expo-haptics'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, elevation, gradients, motion, radius, spacing, type } from '../theme'

/* ------------------------------------------------------------------ *
 * Motion helpers
 * ------------------------------------------------------------------ */

export function tap(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) {
  void Haptics.impactAsync(style).catch(() => undefined)
}

export function buzz(type: Haptics.NotificationFeedbackType = Haptics.NotificationFeedbackType.Success) {
  void Haptics.notificationAsync(type).catch(() => undefined)
}

export function FadeIn({
  children,
  delay = 0,
  offset = 14,
  style,
}: {
  children: React.ReactNode
  delay?: number
  offset?: number
  style?: StyleProp<ViewStyle>
}) {
  const progress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motion.slow,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [delay, progress])

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  )
}

export function PressableScale({
  children,
  onPress,
  onLongPress,
  disabled,
  style,
  scaleTo = 0.965,
  accessibilityLabel,
  testID,
  hitSlop,
}: {
  children: React.ReactNode
  onPress?: () => void
  onLongPress?: () => void
  disabled?: boolean
  style?: StyleProp<ViewStyle>
  scaleTo?: number
  accessibilityLabel?: string
  testID?: string
  hitSlop?: number
}) {
  const scale = useRef(new Animated.Value(1)).current

  const to = (value: number) =>
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      ...motion.spring,
    }).start()

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        hitSlop={hitSlop}
        disabled={disabled}
        onPressIn={() => to(scaleTo)}
        onPressOut={() => to(1)}
        onPress={
          onPress
            ? () => {
                tap()
                onPress()
              }
            : undefined
        }
        onLongPress={
          onLongPress
            ? () => {
                tap(Haptics.ImpactFeedbackStyle.Medium)
                onLongPress()
              }
            : undefined
        }
        style={({ pressed }) => [{ opacity: disabled ? 0.45 : 1 }, pressed && { opacity: 0.94 }]}
      >
        {children}
      </Pressable>
    </Animated.View>
  )
}

/* ------------------------------------------------------------------ *
 * Keyboard awareness
 *
 * Modal bottom sheets do not resize with the Android window, so every focus
 * measures the input in window space and scrolls the difference away. This is
 * what keeps a field visible instead of hiding behind the keyboard.
 * ------------------------------------------------------------------ */

// React Native's generated ref types differ per release; the keyboard helper only
// needs measureInWindow + scrollTo, so it accepts the native instance generically.
type FocusTarget = React.RefObject<any>
const KeyboardCtx = createContext<((ref: FocusTarget) => void) | null>(null)

function useKeyboardAware() {
  const focus = useContext(KeyboardCtx)
  return useCallback(
    (ref: FocusTarget) => {
      if (!focus) return
      // Let the keyboard animation commit before measuring.
      setTimeout(() => focus(ref), 120)
    },
    [focus],
  )
}

export function KeyboardAware({
  children,
  scrollRef,
  style,
  contentStyle,
  extraBottom = 80,
  scrollEnabled = true,
}: {
  children: React.ReactNode
  scrollRef?: React.RefObject<any>
  style?: StyleProp<ViewStyle>
  contentStyle?: StyleProp<ViewStyle>
  extraBottom?: number
  scrollEnabled?: boolean
}) {
  const inner = useRef<any>(null)
  const scroll = scrollRef ?? inner
  const insets = useSafeAreaInsets()
  const [keyboard, setKeyboard] = useState(0)

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboard(event.endCoordinates?.height ?? 0)
    })
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  const focus = useCallback(
    (ref: FocusTarget) => {
      const input = ref.current
      if (!input) return
      const windowHeight = Dimensions.get('window').height
      const keyboardHeight = Keyboard.metrics()?.height ?? keyboard
      const keyboardTop = windowHeight - keyboardHeight
      input.measureInWindow((_x: number, y: number, _width: number, height: number) => {
        const overflow = y + height - (keyboardTop - 28)
        if (overflow <= 0) return
        const current = (scroll.current as { _scrollY?: number } | null)?._scrollY ?? 0
        scroll.current?.scrollTo({ y: Math.max(0, current + overflow), animated: true })
      })
    },
    [keyboard, scroll],
  )

  return (
    <KeyboardCtx.Provider value={focus}>
      <ScrollView
        ref={scroll}
        style={[{ flex: 1 }, style]}
        contentContainerStyle={[
          { paddingBottom: Math.max(extraBottom, keyboard + 24) + insets.bottom },
          contentStyle,
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        showsVerticalScrollIndicator={false}
        scrollEnabled={scrollEnabled}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {children}
      </ScrollView>
    </KeyboardCtx.Provider>
  )
}

/* ------------------------------------------------------------------ *
 * Layout
 * ------------------------------------------------------------------ */

export function Screen({
  children,
  padded = true,
  scroll = true,
  contentStyle,
  extraBottom = 28,
}: {
  children: React.ReactNode
  padded?: boolean
  scroll?: boolean
  contentStyle?: StyleProp<ViewStyle>
  extraBottom?: number
}) {
  const padding = padded ? { paddingHorizontal: spacing(5) } : undefined

  return (
    <View style={styles.screen}>
      <LinearGradient colors={gradients.canvas} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={styles.orbWrap}>
        <View style={[styles.orb, styles.orbMint]} />
        <View style={[styles.orb, styles.orbViolet]} />
      </View>
      <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1 }}>
        {scroll ? (
          <KeyboardAware contentStyle={[padding, contentStyle]} extraBottom={extraBottom}>
            {children}
          </KeyboardAware>
        ) : (
          <View style={[{ flex: 1 }, padding]}>{children}</View>
        )}
      </SafeAreaView>
    </View>
  )
}

export function Title({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[styles.title, style]}>{children}</Text>
}

export function Subtitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.subtitle}>{children}</Text>
}

export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>
}

export function Muted({
  children,
  small,
  numberOfLines,
}: {
  children: React.ReactNode
  small?: boolean
  numberOfLines?: number
}) {
  return (
    <Text numberOfLines={numberOfLines} style={[styles.muted, small && { fontSize: 12, lineHeight: 17 }]}>
      {children}
    </Text>
  )
}

export function SectionHeading({
  title,
  action,
}: {
  title: string
  action?: React.ReactNode
}) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action}
    </View>
  )
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />
}

/* ------------------------------------------------------------------ *
 * Surfaces
 * ------------------------------------------------------------------ */

export function Card({
  children,
  style,
  tone = 'plain',
}: {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  tone?: 'plain' | 'raised' | 'mint'
}) {
  const toneStyle =
    tone === 'raised'
      ? { backgroundColor: colors.surfaceAlt, borderColor: colors.border }
      : tone === 'mint'
        ? { backgroundColor: '#0f2e24', borderColor: '#2b5b49' }
        : { backgroundColor: colors.surface, borderColor: colors.borderSoft }
  return <View style={[styles.card, toneStyle, style]}>{children}</View>
}

export function Pill({
  children,
  tone = 'muted',
  icon,
}: {
  children: React.ReactNode
  tone?: 'muted' | 'ok' | 'warn' | 'bad' | 'info'
  icon?: React.ReactNode
}) {
  const map = {
    muted: { bg: '#17332a', fg: colors.muted },
    ok: { bg: '#123f30', fg: colors.accent },
    warn: { bg: '#3c2f12', fg: colors.warn },
    bad: { bg: '#3d211b', fg: colors.coral },
    info: { bg: '#122e3d', fg: colors.info },
  }[tone]
  return (
    <View style={[styles.pill, { backgroundColor: map.bg }]}>
      {icon}
      <Text style={[styles.pillText, { color: map.fg }]}>{children}</Text>
    </View>
  )
}

export function Avatar({
  name,
  color,
  size = 36,
  ring,
}: {
  name: string
  color: number
  size?: number
  ring?: boolean
}) {
  const palette = ['#2f8f70', '#c8553d', '#3d7fb8', '#b8892a', '#7a4fa0', '#2d8a9a', '#a54e75', '#5c7b3a']
  const initials =
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  const background = palette[Math.abs(color) % palette.length]

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: ring ? 2 : 0,
        borderColor: colors.bg,
      }}
    >
      <Text style={{ color: '#fff', fontSize: size * 0.36, fontWeight: '800' }}>{initials}</Text>
    </View>
  )
}

export function AvatarStack({
  members,
  max = 4,
  size = 28,
}: {
  members: { id: string; name: string; color: number }[]
  max?: number
  size?: number
}) {
  const shown = members.slice(0, max)
  const rest = members.length - shown.length
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {shown.map((member, index) => (
        <View key={member.id} style={{ marginLeft: index === 0 ? 0 : -size * 0.32 }}>
          <Avatar name={member.name} color={member.color} size={size} ring />
        </View>
      ))}
      {rest > 0 ? (
        <View
          style={{
            marginLeft: -size * 0.32,
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.surfaceHigh,
            borderWidth: 2,
            borderColor: colors.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800' }}>+{rest}</Text>
        </View>
      ) : null}
    </View>
  )
}

/* ------------------------------------------------------------------ *
 * Buttons
 * ------------------------------------------------------------------ */

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  icon,
  testID,
  compact,
}: {
  label: string
  onPress: () => void
  variant?: 'primary' | 'soft' | 'ghost' | 'danger'
  disabled?: boolean
  loading?: boolean
  icon?: React.ReactNode
  testID?: string
  compact?: boolean
}) {
  const isPrimary = variant === 'primary'
  const isDanger = variant === 'danger'

  const content = (
    <View style={[styles.buttonInner, compact && { paddingVertical: spacing(2.5) }]}>
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.accentInk : isDanger ? colors.danger : colors.text} />
      ) : (
        <>
          {icon}
          <Text
            style={[
              styles.buttonText,
              isPrimary && { color: colors.accentInk },
              isDanger && { color: colors.danger },
              variant === 'ghost' && { color: colors.muted },
              icon ? { marginLeft: spacing(2) } : null,
            ]}
          >
            {label}
          </Text>
        </>
      )}
    </View>
  )

  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={[styles.button, compact && { marginTop: spacing(2) }]}
    >
      {isPrimary ? (
        <LinearGradient
          colors={gradients.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.buttonFill}
        >
          {content}
        </LinearGradient>
      ) : (
        <View
          style={[
            styles.buttonFill,
            {
              backgroundColor: variant === 'soft' ? colors.surfaceAlt : 'transparent',
              borderWidth: 1,
              borderColor: isDanger ? '#4a2620' : colors.border,
            },
          ]}
        >
          {content}
        </View>
      )}
    </PressableScale>
  )
}

export function IconButton({
  icon,
  onPress,
  label,
  tone = 'plain',
}: {
  icon: React.ReactNode
  onPress: () => void
  label: string
  tone?: 'plain' | 'mint'
}) {
  return (
    <PressableScale onPress={onPress} accessibilityLabel={label} style={styles.iconButton}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: tone === 'mint' ? '#123f30' : 'rgba(255,255,255,0.05)',
          borderWidth: 1,
          borderColor: tone === 'mint' ? '#2b6b52' : colors.borderSoft,
        }}
      >
        {icon}
      </View>
    </PressableScale>
  )
}

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  style,
  right,
  onFocus,
  ...props
}: TextInputProps & { label: string; hint?: string; right?: React.ReactNode }) {
  const scrollToFocused = useKeyboardAware()
  const inputRef = useRef<any>(null)
  const focusProgress = useRef(new Animated.Value(0)).current

  const animate = (to: number) =>
    Animated.timing(focusProgress, {
      toValue: to,
      duration: motion.fast,
      useNativeDriver: false,
    }).start()

  return (
    <View style={{ marginTop: spacing(3.5) }}>
      <Label>{label}</Label>
      <View style={styles.inputWrap}>
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.inputGlow,
            {
              opacity: focusProgress,
              borderColor: colors.accent,
            },
          ]}
        />
        <TextInput
          ref={inputRef}
          placeholderTextColor={colors.mutedDim}
          selectionColor={colors.accent}
          {...props}
          onFocus={(event) => {
            animate(1)
            scrollToFocused(inputRef)
            onFocus?.(event)
          }}
          onBlur={(event) => {
            animate(0)
            props.onBlur?.(event)
          }}
          style={[styles.input, style, right ? { paddingRight: 48 } : null]}
        />
        {right ? <View style={styles.inputRight}>{right}</View> : null}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  )
}

/* ------------------------------------------------------------------ *
 * Segmented control
 * ------------------------------------------------------------------ */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (next: T) => void
}) {
  const [width, setWidth] = useState(0)
  const index = Math.max(0, options.findIndex((option) => option.value === value))
  const progress = useRef(new Animated.Value(index)).current

  useEffect(() => {
    Animated.spring(progress, {
      toValue: index,
      useNativeDriver: true,
      ...motion.springSoft,
    }).start()
  }, [index, progress])

  const segment = width > 0 ? (width - 8) / options.length : 0

  return (
    <View
      style={styles.segmented}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
    >
      {segment > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.segmentActive,
            {
              width: segment,
              transform: [
                {
                  translateX: progress.interpolate({
                    inputRange: [0, Math.max(1, options.length - 1)],
                    outputRange: [0, segment * (options.length - 1)],
                  }),
                },
              ],
            },
          ]}
        >
          <LinearGradient
            colors={gradients.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.segmentFill}
          />
        </Animated.View>
      ) : null}
      {options.map((option) => {
        const active = option.value === value
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              if (!active) {
                tap()
                onChange(option.value)
              }
            }}
            style={styles.segment}
          >
            <Text style={[styles.segmentText, active && { color: colors.accentInk, fontWeight: '800' }]}>
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/* ------------------------------------------------------------------ *
 * Sheet — a real animated bottom sheet with drag-to-close
 * ------------------------------------------------------------------ */

export function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
  footer,
  full,
}: {
  visible: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  full?: boolean
}) {
  const insets = useSafeAreaInsets()
  const [mounted, setMounted] = useState(visible)
  const translate = useRef(new Animated.Value(0)).current
  const backdrop = useRef(new Animated.Value(0)).current
  const heightRef = useRef(Dimensions.get('window').height * (full ? 0.92 : 0.78))

  useEffect(() => {
    if (visible) {
      setMounted(true)
      translate.setValue(heightRef.current)
      backdrop.setValue(0)
      Animated.parallel([
        Animated.spring(translate, {
          toValue: 0,
          useNativeDriver: true,
          damping: 20,
          stiffness: 170,
          mass: 0.9,
        }),
        Animated.timing(backdrop, {
          toValue: 1,
          duration: motion.base,
          useNativeDriver: true,
        }),
      ]).start()
    } else if (mounted) {
      dismiss()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(translate, {
        toValue: heightRef.current,
        duration: motion.base,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdrop, {
        toValue: 0,
        duration: motion.base,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setMounted(false)
      onClose()
    })
  }, [backdrop, onClose, translate])

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_event, gesture) => {
        translate.setValue(Math.max(0, gesture.dy))
      },
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dy > heightRef.current * 0.18 || gesture.vy > 1.1) {
          dismiss()
        } else {
          Animated.spring(translate, {
            toValue: 0,
            useNativeDriver: true,
            damping: 22,
            stiffness: 200,
          }).start()
        }
      },
    }),
  ).current

  if (!mounted) return null

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={dismiss}>
      <View style={styles.sheetRoot}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdrop }]}>
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} onPress={dismiss} />
        </Animated.View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.sheetKeyboard}
          keyboardVerticalOffset={0}
        >
          <Animated.View
            style={[
              styles.sheet,
              { paddingBottom: Math.max(insets.bottom, 12) },
              { height: heightRef.current, transform: [{ translateY: translate }] },
            ]}
          >
            <View {...pan.panHandlers} style={styles.sheetGrab}>
              <View style={styles.sheetHandle} />
            </View>

            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>{title}</Text>
                {subtitle ? <Text style={styles.sheetSubtitle}>{subtitle}</Text> : null}
              </View>
              <PressableScale onPress={dismiss} accessibilityLabel="Close" hitSlop={10}>
                <View style={styles.sheetClose}>
                  <Text style={{ color: colors.muted, fontSize: 18, marginTop: -2 }}>×</Text>
                </View>
              </PressableScale>
            </View>

            <KeyboardAware extraBottom={0} contentStyle={{ paddingHorizontal: spacing(5) }}>
              {children}
            </KeyboardAware>

            {footer ? (
              <View style={[styles.sheetFooter, { paddingBottom: Math.max(insets.bottom, spacing(2)) }]}>
                {footer}
              </View>
            ) : null}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

/* ------------------------------------------------------------------ *
 * Feedback
 * ------------------------------------------------------------------ */

export function Banner({ tone, children }: { tone: 'error' | 'info' | 'ok'; children: React.ReactNode }) {
  const map = {
    error: { bg: '#3a1d17', fg: colors.coral, border: '#5a2b22' },
    info: { bg: '#122b3c', fg: colors.info, border: '#1d4a63' },
    ok: { bg: '#12301f', fg: colors.accent, border: '#1f5a3c' },
  }[tone]
  return (
    <FadeIn offset={-6}>
      <View style={[styles.banner, { backgroundColor: map.bg, borderColor: map.border }]}>
        <Text style={{ color: map.fg, fontSize: 13, lineHeight: 19, fontWeight: '600' }}>{children}</Text>
      </View>
    </FadeIn>
  )
}

export function EmptyState({
  emoji,
  title,
  body,
  action,
}: {
  emoji: string
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <FadeIn>
      <Card style={styles.empty}>
        <Text style={{ fontSize: 40 }}>{emoji}</Text>
        <Text style={styles.emptyTitle}>{title}</Text>
        <Text style={styles.emptyBody}>{body}</Text>
        {action}
      </Card>
    </FadeIn>
  )
}

export function Stat({
  label,
  value,
  tone = 'plain',
  style,
}: {
  label: string
  value: string
  tone?: 'plain' | 'mint' | 'coral'
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View style={[styles.stat, style]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[
          styles.statValue,
          tone === 'mint' && { color: colors.accent },
          tone === 'coral' && { color: colors.coral },
        ]}
      >
        {value}
      </Text>
    </View>
  )
}

export function Toast({ message, tone }: { message: string; tone: 'ok' | 'error' }) {
  const progress = useRef(new Animated.Value(0)).current
  const insets = useSafeAreaInsets()

  useEffect(() => {
    Animated.sequence([
      Animated.spring(progress, { toValue: 1, useNativeDriver: true, ...motion.springSoft }),
      Animated.delay(2_200),
      Animated.timing(progress, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start()
  }, [message, progress])

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.toast,
        {
          bottom: insets.bottom + 92,
          backgroundColor: tone === 'ok' ? '#123f30' : '#3a1d17',
          borderColor: tone === 'ok' ? '#2b6b52' : '#5a2b22',
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
          ],
        },
      ]}
    >
      <Text style={{ color: tone === 'ok' ? colors.accent : colors.coral, fontSize: 13, fontWeight: '700' }}>
        {message}
      </Text>
    </Animated.View>
  )
}

/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  orbWrap: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  orb: { position: 'absolute', borderRadius: 999 },
  orbMint: {
    width: 320,
    height: 320,
    top: -150,
    right: -110,
    backgroundColor: 'rgba(79, 227, 172, 0.10)',
  },
  orbViolet: {
    width: 260,
    height: 260,
    bottom: -120,
    left: -100,
    backgroundColor: 'rgba(183, 155, 255, 0.07)',
  },

  title: { ...type.title, color: colors.text, marginTop: spacing(1) },
  subtitle: { ...type.body, color: colors.muted, marginTop: spacing(1.5), lineHeight: 21 },
  label: {
    color: colors.muted,
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing(5),
    marginBottom: spacing(1),
  },
  sectionTitle: { ...type.caption, color: colors.muted, letterSpacing: 1.1, textTransform: 'uppercase' },
  divider: { height: 1, backgroundColor: colors.borderSoft, marginVertical: spacing(3) },

  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing(4),
    marginTop: spacing(3),
    ...elevation.card,
  },

  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing(2.5),
    paddingVertical: spacing(1),
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.5),
  },
  pillText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },

  button: { marginTop: spacing(3), borderRadius: radius.md },
  buttonFill: { borderRadius: radius.md, overflow: 'hidden' },
  buttonInner: {
    paddingVertical: spacing(3.6),
    paddingHorizontal: spacing(4),
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  buttonText: { fontSize: 15, fontWeight: '800', letterSpacing: 0.2 },

  iconButton: { borderRadius: 20 },

  inputWrap: { marginTop: spacing(1.5), justifyContent: 'center' },
  inputGlow: {
    borderRadius: radius.md + 2,
    borderWidth: 1.5,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing(3.5),
    paddingVertical: spacing(3.2),
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  inputRight: { position: 'absolute', right: spacing(3) },
  hint: { color: colors.mutedDim, fontSize: 11.5, marginTop: spacing(1.5), lineHeight: 16 },

  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    padding: spacing(1),
    borderWidth: 1,
    borderColor: colors.borderSoft,
    position: 'relative',
  },
  segmentActive: {
    position: 'absolute',
    top: spacing(1),
    left: spacing(1),
    bottom: spacing(1),
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  segmentFill: { flex: 1 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: spacing(2.2) },
  segmentText: { color: colors.muted, fontSize: 12.5, fontWeight: '700' },

  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetKeyboard: { justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    overflow: 'hidden',
    ...elevation.sheet,
  },
  sheetGrab: { paddingTop: spacing(2.5), paddingBottom: spacing(1.5), alignItems: 'center' },
  sheetHandle: { width: 44, height: 4.5, borderRadius: 3, backgroundColor: colors.border },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing(5),
    paddingBottom: spacing(2),
    gap: spacing(3),
  },
  sheetTitle: { ...type.heading, color: colors.text },
  sheetSubtitle: { color: colors.muted, fontSize: 12.5, marginTop: spacing(1), lineHeight: 18 },
  sheetClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetFooter: {
    borderTopWidth: 1,
    borderColor: colors.borderSoft,
    paddingHorizontal: spacing(5),
    paddingTop: spacing(3),
    backgroundColor: colors.bgElevated,
  },

  banner: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing(3),
    marginTop: spacing(3),
  },

  empty: { alignItems: 'center', paddingVertical: spacing(7), paddingHorizontal: spacing(5) },
  emptyTitle: { ...type.heading, color: colors.text, marginTop: spacing(3) },
  emptyBody: {
    ...type.small,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing(2),
    lineHeight: 19,
  },

  stat: { flex: 1 },
  statLabel: {
    color: colors.mutedDim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  statValue: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: spacing(1.5) },

  toast: {
    position: 'absolute',
    left: spacing(5),
    right: spacing(5),
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3),
    zIndex: 50,
  },
})

export { StatusBar }
