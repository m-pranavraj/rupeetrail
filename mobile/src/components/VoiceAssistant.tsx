import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { parseVoiceCommand, type AiCommand } from '../lib/voice-command'
import { useStore } from '../state'
import { colors, elevation, gradients, motion, radius, spacing } from '../theme'
import { PressableScale, buzz, tap } from './ui'
import type { Expense, ExpenseCategory, Split } from '../lib/types'

type Tone = 'idle' | 'listening' | 'processing' | 'confirm' | 'done' | 'error'

interface VoiceAssistantProps {
  onTabChange: (tab: 'expenses' | 'balances' | 'settle') => void
  onOpenGroup: (groupId: string) => void
}

const TERMINAL_MS = 5_000

function latestExpense(expenses: Expense[]): Expense | undefined {
  return [...expenses]
    .filter((expense) => !expense.deletedAt)
    .sort((a, b) => b.date - a.date)[0]
}

function participantIdsOf(split: Split): string[] {
  if (split.mode === 'equal') return split.participants ?? []
  return Object.keys(split.values ?? {})
}

export function VoiceAssistant({ onTabChange, onOpenGroup }: VoiceAssistantProps) {
  const {
    active,
    session,
    addExpense,
    updateExpense,
    removeExpense,
    settle,
    confirmSettlement,
    createGroup,
    joinGroup,
    openGroup,
  } = useStore()
  const insets = useSafeAreaInsets()

  const [tone, setTone] = useState<Tone>('idle')
  const [transcript, setTranscript] = useState('')
  const [reply, setReply] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState<AiCommand | null>(null)

  const panel = useRef(new Animated.Value(0)).current
  const pulse = useRef(new Animated.Value(0)).current
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listening = useRef(false)
  const heard = useRef('')
  const partial = useRef('')
  const processed = useRef(false)

  const snapshot = active?.snapshot
  const group = snapshot?.group
  const me = snapshot?.me
  const myId = me?.id ?? ''
  const myName = me?.name ?? ''
  const members = group?.members.filter((member) => !member.leftAt) ?? []
  const groups = session?.memberships.map((entry) => ({ id: entry.groupId, name: entry.groupName })) ?? []

  const open = tone !== 'idle'

  useEffect(() => {
    Animated.timing(panel, {
      toValue: open ? 1 : 0,
      duration: motion.base,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [open, panel])

  useEffect(() => {
    if (tone !== 'listening') {
      pulse.stopAnimation()
      pulse.setValue(0)
      return
    }
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1_400,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [pulse, tone])

  const clearTimers = useCallback(() => {
    if (watchdog.current) clearTimeout(watchdog.current)
    if (resetTimer.current) clearTimeout(resetTimer.current)
    watchdog.current = null
    resetTimer.current = null
  }, [])

  const reset = useCallback(() => {
    clearTimers()
    listening.current = false
    processed.current = false
    heard.current = ''
    partial.current = ''
    try {
      ExpoSpeechRecognitionModule.abort()
    } catch {
      // not running
    }
    setPending(null)
    setTone('idle')
    setReply('')
    setTranscript('')
    setError('')
  }, [clearTimers])

  const finish = useCallback(
    (message: string, next: Tone = 'done') => {
      clearTimers()
      listening.current = false
      setReply(message)
      setTone(next)
      resetTimer.current = setTimeout(() => {
        setTone('idle')
        setReply('')
        setTranscript('')
        setError('')
      }, TERMINAL_MS)
    },
    [clearTimers],
  )

  const memberName = useCallback(
    (id: string) => {
      if (id.startsWith('manual:')) {
        const parts = id.split(':')
        return (parts[2] ?? parts[1] ?? 'someone').replace(/-/g, ' ')
      }
      return group?.members.find((member) => member.id === id)?.name ?? 'member'
    },
    [group],
  )

  const runCommand = useCallback(
    async (cmd: AiCommand) => {
      const current = active?.snapshot
      const expenses = current?.expenses ?? []
      const settlements = current?.settlements ?? []

      switch (cmd.type) {
        case 'add_expense': {
          if (!current) return finish('Open a trip first.', 'error')
          const values = cmd.splitValues ?? {}
          let split: Split
          if (cmd.splitMode === 'equal') {
            split = { mode: 'equal', participants: cmd.participantIds }
          } else {
            const sum = Object.values(values).reduce((total, value) => total + value, 0)
            split =
              Object.keys(values).length > 0 && Math.abs(sum - cmd.amountPaise) <= 2
                ? { mode: cmd.splitMode, values }
                : { mode: 'equal', participants: cmd.participantIds }
          }
          const payerId = current.group.members.some((member) => member.id === cmd.payerId)
            ? cmd.payerId
            : myId
          const id = await addExpense({
            description: cmd.description,
            amountPaise: cmd.amountPaise,
            date: Date.now(),
            category: (cmd.category as ExpenseCategory | undefined) ?? 'other',
            payers: [{ memberId: payerId, amountPaise: cmd.amountPaise }],
            split,
            notes: cmd.notes || undefined,
          })
          if (id) buzz()
          return finish(
            id
              ? `Added “${cmd.description}” for ₹${(cmd.amountPaise / 100).toFixed(2)}.`
              : 'Could not add that expense.',
            id ? 'done' : 'error',
          )
        }

        case 'delete_expense': {
          if (!current) return finish('Open a trip first.', 'error')
          const newest = latestExpense(expenses)
          if (!newest) return finish('There is nothing to delete.', 'error')
          const ok = await removeExpense(newest.id)
          if (ok) buzz()
          return finish(
            ok ? `Deleted “${newest.description}”.` : 'Could not delete that expense.',
            ok ? 'done' : 'error',
          )
        }

        case 'edit_expense': {
          if (!current) return finish('Open a trip first.', 'error')
          const target = latestExpense(expenses)
          if (!target) return finish('There is nothing to edit.', 'error')
          const amountPaise = cmd.amountPaise ?? target.amountPaise
          const split =
            amountPaise !== target.amountPaise && target.split.mode !== 'equal'
              ? { mode: 'equal' as const, participants: participantIdsOf(target.split) }
              : target.split
          const payerTotal = target.payers.reduce((sum, payer) => sum + payer.amountPaise, 0)
          const payers = payerTotal === amountPaise ? target.payers : [{ memberId: myId, amountPaise }]
          const ok = await updateExpense(target.id, {
            description: cmd.description ?? target.description,
            amountPaise,
            date: target.date,
            category: target.category,
            payers,
            split,
            notes: target.notes,
          })
          if (ok) buzz()
          return finish(
            ok
              ? `Updated “${cmd.description ?? target.description}” to ₹${(amountPaise / 100).toFixed(2)}.`
              : 'Could not update that expense.',
            ok ? 'done' : 'error',
          )
        }

        case 'record_settlement': {
          if (!current) return finish('Open a trip first.', 'error')
          const ok = await settle({
            from: cmd.fromId,
            to: cmd.toId,
            amountPaise: cmd.amountPaise,
            method: cmd.method,
          })
          if (ok) buzz()
          return finish(
            ok
              ? `Recorded ₹${(cmd.amountPaise / 100).toFixed(2)}. ${memberName(cmd.fromId)} → ${memberName(cmd.toId)}.`
              : 'Could not record that payment.',
            ok ? 'done' : 'error',
          )
        }

        case 'confirm_payment': {
          if (!current) return finish('Open a trip first.', 'error')
          const match = settlements
            .filter((entry) => entry.status !== 'confirmed' && entry.status !== 'disputed')
            .filter((entry) => {
              if (cmd.amountPaise && entry.amountPaise !== cmd.amountPaise) return false
              if (cmd.action === 'received') {
                if (entry.to !== myId) return false
                return !cmd.memberName || memberName(entry.from) === cmd.memberName
              }
              if (entry.from !== myId) return false
              return !cmd.memberName || memberName(entry.to) === cmd.memberName
            })
            .sort((a, b) => b.updatedAt - a.updatedAt)[0]

          if (match) {
            const ok = await confirmSettlement(match.id, cmd.action)
            if (ok) buzz()
            return finish(
              ok
                ? `Confirmed ₹${(match.amountPaise / 100).toFixed(2)} with ${memberName(
                    cmd.action === 'received' ? match.from : match.to,
                  )}.`
                : 'Could not confirm that payment.',
              ok ? 'done' : 'error',
            )
          }

          if (cmd.action === 'received' && cmd.amountPaise) {
            const fromId = cmd.memberName
              ? members.find((member) =>
                  member.name.toLowerCase().startsWith(cmd.memberName!.toLowerCase()),
                )?.id ??
                `manual:from:${cmd.memberName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
              : 'manual:from:someone'
            const ok = await settle({
              from: fromId,
              to: myId,
              amountPaise: cmd.amountPaise,
              method: fromId.startsWith('manual:') ? 'cash' : 'upi',
            })
            if (ok) buzz()
            return finish(
              ok
                ? `Recorded ₹${(cmd.amountPaise / 100).toFixed(2)} received from ${memberName(fromId)}.`
                : 'Could not record that payment.',
              ok ? 'done' : 'error',
            )
          }

          return finish('No pending payment matches that.', 'error')
        }

        case 'create_group': {
          const id = await createGroup({ name: cmd.name, emoji: cmd.emoji })
          if (id) {
            buzz()
            onOpenGroup(id)
            return finish(`Created “${cmd.name}”.`)
          }
          return finish('Could not create the trip.', 'error')
        }

        case 'join_group': {
          const id = await joinGroup(cmd.code)
          if (id) {
            buzz()
            onOpenGroup(id)
            return finish(`Joined “${cmd.code}”.`)
          }
          return finish('That invite code did not work.', 'error')
        }

        case 'open_group': {
          if (!groups.some((entry) => entry.id === cmd.groupId)) {
            return finish('That trip is not on this phone.', 'error')
          }
          onOpenGroup(cmd.groupId)
          return finish('Opening the trip.')
        }

        case 'switch_tab': {
          onTabChange(cmd.tab)
          return finish(`Switched to ${cmd.tab}.`)
        }

        case 'show_balances': {
          onTabChange('balances')
          return finish("Here are everyone's balances.")
        }

        case 'show_help': {
          return finish(cmd.text)
        }

        default:
          return finish('That command is not available here.', 'error')
      }
    },
    [
      active,
      addExpense,
      confirmSettlement,
      createGroup,
      finish,
      groups,
      joinGroup,
      memberName,
      members,
      myId,
      onOpenGroup,
      onTabChange,
      removeExpense,
      settle,
      updateExpense,
    ],
  )

  const handleTranscript = useCallback(
    (text: string) => {
      const parsed = parseVoiceCommand(text, {
        myId,
        myName,
        groups,
        members: members.map((member) => ({ id: member.id, name: member.name })),
        currentGroupId: group?.id,
      })

      const cmd = parsed.command
      if (!cmd) {
        setReply(parsed.reply)
        setTone('error')
        return
      }

      if (
        cmd.type === 'switch_tab' ||
        cmd.type === 'show_balances' ||
        cmd.type === 'open_group' ||
        cmd.type === 'show_help'
      ) {
        setReply(parsed.reply)
        void runCommand(cmd)
        return
      }

      setPending(cmd)
      setReply(parsed.reply)
      setTone('confirm')
    },
    [group?.id, groups, members, myId, myName, runCommand],
  )

  const handleRef = useRef(handleTranscript)
  useEffect(() => {
    handleRef.current = handleTranscript
  }, [handleTranscript])

  // Continuous dictation: keep the microphone open until the speaker stops,
  // then process everything that was heard in one pass. Tapping the mic is a
  // "done talking" gesture, not a cancel.
  const stopAndProcess = useCallback(() => {
    if (!listening.current) return
    setTone('processing')
    try {
      ExpoSpeechRecognitionModule.stop()
    } catch {
      // already stopped — the end event still delivers what was heard
    }
  }, [])

  const start = useCallback(async () => {
    clearTimers()
    setError('')
    setReply('')
    setTranscript('')
    setPending(null)
    heard.current = ''
    partial.current = ''
    processed.current = false

    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
      if (!permission.granted) {
        setError('Microphone access is blocked. Allow it in system settings.')
        setTone('error')
        return
      }
    } catch {
      // Some Android builds grant implicitly; let the recogniser report.
    }

    listening.current = true
    setTone('listening')
    tap()

    // Absolute ceiling so a stuck recogniser cannot hold the mic forever.
    watchdog.current = setTimeout(() => {
      watchdog.current = null
      if (!listening.current) return
      try {
        ExpoSpeechRecognitionModule.stop()
      } catch {
        listening.current = false
        setError('The microphone did not respond. Try again.')
        setTone('error')
      }
    }, 60_000)

    try {
      ExpoSpeechRecognitionModule.start({
        lang: 'en-IN',
        interimResults: true,
        continuous: true,
        maxAlternatives: 3,
        requiresOnDeviceRecognition: false,
        addsPunctuation: false,
        // Bias the recogniser towards the names and words this ledger uses.
        contextualStrings: [
          ...members.map((member) => member.name),
          ...members.map((member) => member.name.split(' ')[0]),
          ...groups.map((entry) => entry.name),
          'paid',
          'split',
          'rupees',
          'balance',
          'settle',
          'dinner',
          'lunch',
          'pani puri',
        ].filter((word, index, all) => word.length > 1 && all.indexOf(word) === index),
        androidIntentOptions: {
          // Keep listening through natural pauses, then end on real silence.
          EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 1_500,
          EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 2_800,
          EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 4_500,
        },
      })
    } catch (cause) {
      listening.current = false
      clearTimers()
      setError(cause instanceof Error ? cause.message : 'Could not start voice input.')
      setTone('error')
    }
  }, [clearTimers, groups, members])

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results?.[0]?.transcript?.trim() ?? ''
    if (!text) return
    if (event.isFinal) {
      const previous = heard.current
      if (!previous) heard.current = text
      else if (text.startsWith(previous)) heard.current = text
      else if (!previous.endsWith(text)) heard.current = `${previous} ${text}`
      partial.current = ''
      setTranscript(heard.current)
    } else {
      partial.current = text
      setTranscript(heard.current ? `${heard.current} ${text}` : text)
    }
  })

  useSpeechRecognitionEvent('error', (event) => {
    if (event.error === 'aborted') return
    listening.current = false
    clearTimers()
    setError(
      event.error === 'not-allowed'
        ? 'Microphone blocked. Allow it in system settings.'
        : event.error === 'no-speech'
          ? 'No speech detected. Try again.'
          : `Voice error: ${event.error}`,
    )
    setTone('error')
  })

  useSpeechRecognitionEvent('end', () => {
    const wasListening = listening.current
    listening.current = false
    if (watchdog.current) {
      clearTimeout(watchdog.current)
      watchdog.current = null
    }

    const text = (heard.current || partial.current).trim()
    if (!wasListening || processed.current) {
      setTone((current) => (current === 'listening' ? 'idle' : current))
      return
    }
    if (!text) {
      setTone('idle')
      setError('I did not catch that. Tap the mic and try again.')
      return
    }

    processed.current = true
    heard.current = text
    partial.current = ''
    setTranscript(text)
    setTone('processing')
    handleRef.current(text)
  })

  useEffect(
    () => () => {
      clearTimers()
      try {
        ExpoSpeechRecognitionModule.abort()
      } catch {
        // not running
      }
    },
    [clearTimers],
  )

  const confirm = useCallback(async () => {
    const cmd = pending
    if (!cmd) return
    setPending(null)
    setTone('processing')
    await runCommand(cmd)
  }, [pending, runCommand])

  const busy = tone === 'listening' || tone === 'processing'
  const bottom = insets.bottom + spacing(4)

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.1] })
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] })

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={[
          styles.panel,
          {
            bottom: bottom + 68,
            opacity: panel,
            transform: [
              {
                translateY: panel.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }),
              },
            ],
          },
        ]}
      >
        <View style={styles.panelHead}>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    tone === 'error'
                      ? colors.coral
                      : tone === 'confirm'
                        ? colors.warn
                        : tone === 'done'
                          ? colors.accent
                          : colors.info,
                },
              ]}
            />
            <Text style={styles.statusText}>
              {tone === 'listening'
                ? 'Listening…'
                : tone === 'processing'
                  ? 'Working on it…'
                  : tone === 'confirm'
                    ? 'Confirm this action?'
                    : tone === 'done'
                      ? 'Done'
                      : tone === 'error'
                        ? 'Could not do that'
                        : 'Voice command'}
            </Text>
          </View>
          <PressableScale onPress={reset} scaleTo={0.9} accessibilityLabel="Close voice assistant">
            <View style={styles.close}>
              <Ionicons name="close" size={15} color={colors.muted} />
            </View>
          </PressableScale>
        </View>

        {transcript ? (
          <Text style={styles.transcript} numberOfLines={3}>
            <Text style={styles.transcriptLabel}>HEARD  </Text>
            {transcript}
          </Text>
        ) : null}
        {reply ? <Text style={[styles.reply, tone === 'error' && { color: colors.coral }]}>{reply}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {tone === 'confirm' && pending ? (
          <View style={styles.actions}>
            <PressableScale onPress={confirm} style={{ flex: 1 }} scaleTo={0.97}>
              <LinearGradient
                colors={gradients.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.confirmFill}
              >
                <Text style={styles.confirmText}>Confirm</Text>
              </LinearGradient>
            </PressableScale>
            <PressableScale onPress={reset} style={{ flex: 1 }} scaleTo={0.97}>
              <View style={styles.cancel}>
                <Text style={styles.cancelText}>Cancel</Text>
              </View>
            </PressableScale>
          </View>
        ) : null}

        {tone === 'idle' ? (
          <Text style={styles.hint}>
            Try “Dinner 1200 split between us”, “Bill 1256 GST 60, 2 ate 500, 3 split rest”, “I got 500
            from Priya”, or “Show balances”.
          </Text>
        ) : null}
      </Animated.View>

      <View style={[styles.micWrap, { bottom }]} pointerEvents="box-none">
        {tone === 'listening' ? (
          <Animated.View
            style={[styles.pulse, { opacity: pulseOpacity, transform: [{ scale }] }]}
            pointerEvents="none"
          />
        ) : null}
        <PressableScale
          onPress={tone === 'listening' ? stopAndProcess : start}
          disabled={tone === 'processing'}
          scaleTo={0.92}
          accessibilityLabel={tone === 'listening' ? 'I am done speaking' : 'Start voice command'}
        >
          <LinearGradient
            colors={tone === 'listening' ? gradients.coral : gradients.violet}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.mic}
          >
            <Ionicons name={busy ? 'stop' : 'mic'} size={23} color="#fff" />
          </LinearGradient>
        </PressableScale>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: spacing(5),
    right: spacing(5),
    padding: spacing(4),
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    ...elevation.sheet,
  },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(2) },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: {
    color: colors.muted,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  close: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transcript: { color: colors.text, fontSize: 13.5, lineHeight: 19, marginTop: spacing(2.5) },
  transcriptLabel: { color: colors.mutedDim, fontSize: 9.5, fontWeight: '800', letterSpacing: 1 },
  reply: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: spacing(2) },
  error: { color: colors.coral, fontSize: 13, lineHeight: 18, marginTop: spacing(2) },
  actions: { flexDirection: 'row', gap: spacing(2.5), marginTop: spacing(3.5) },
  confirmFill: {
    paddingVertical: spacing(2.8),
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: { color: colors.accentInk, fontSize: 13, fontWeight: '800' },
  cancel: {
    paddingVertical: spacing(2.8),
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  cancelText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  hint: { color: colors.mutedDim, fontSize: 11.5, lineHeight: 17, marginTop: spacing(2.5) },
  micWrap: { position: 'absolute', left: spacing(5) },
  pulse: {
    position: 'absolute',
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.warn,
  },
  mic: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7b61ff',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
})
