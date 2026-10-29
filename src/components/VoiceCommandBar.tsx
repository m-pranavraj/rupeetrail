import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { parseVoiceCommand, type AiCommand } from '../lib/ondevice-ai'
import { IconClose, IconMic } from './Icons'
import type { Expense, Split } from '../types'

type VoiceStatus = 'idle' | 'listening' | 'processing' | 'confirm' | 'done' | 'error'

interface VoiceCommandBarProps {
  onTabChange: (tab: 'expenses' | 'balances' | 'settle') => void
  onOpenGroup: (groupId: string) => void
}

const TERMINAL_REPLY_MS = 5_000

function latestExpense(expenses: Expense[]): Expense | undefined {
  return [...expenses]
    .filter((expense) => !expense.deletedAt)
    .sort((a, b) => b.date - a.date)[0]
}

function participantIdsOf(split: Split): string[] {
  if (split.mode === 'equal') return split.participants ?? []
  return Object.keys(split.values ?? {})
}

export function VoiceCommandBar({ onTabChange, onOpenGroup }: VoiceCommandBarProps) {
  const store = useStore()
  const {
    identity,
    summaries,
    active,
    activeGroupId,
    addExpense,
    updateExpense,
    deleteExpense,
    recordSettlement,
    advanceSettlement,
    createGroup,
    fetchGroupSummaries,
  } = store

  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [transcript, setTranscript] = useState('')
  const [reply, setReply] = useState('')
  const [error, setError] = useState('')
  const [pendingCommand, setPendingCommand] = useState<AiCommand | null>(null)
  const recognitionRef = useRef<any>(null)
  const watchdogRef = useRef<number | null>(null)
  const resetTimerRef = useRef<number | null>(null)
  const listeningRef = useRef(false)

  const myId = identity?.id ?? ''
  const myName = identity?.name ?? ''
  const group = active?.group
  const currentGroupId = activeGroupId ?? summaries[0]?.groupId
  const members = group?.members.map((m) => ({ id: m.id, name: m.name })) ?? []
  const groups = summaries.map((s) => ({ id: s.groupId, name: s.name }))

  const clearTimers = useCallback(() => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current)
      watchdogRef.current = null
    }
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }
  }, [])

  const reset = useCallback(() => {
    clearTimers()
    setPendingCommand(null)
    setStatus('idle')
    setReply('')
    setTranscript('')
    setError('')
  }, [clearTimers])

  const finish = useCallback(
    (message: string, tone: VoiceStatus = 'done') => {
      setReply(message)
      setStatus(tone)
      clearTimers()
      resetTimerRef.current = window.setTimeout(() => {
        setStatus('idle')
        setReply('')
        setTranscript('')
        setError('')
      }, TERMINAL_REPLY_MS)
    },
    [clearTimers],
  )

  const memberName = useCallback(
    (id: string) => {
      if (id.startsWith('manual:')) {
        const parts = id.split(':')
        return (parts[2] ?? parts[1] ?? 'someone').replace(/-/g, ' ')
      }
      return group?.members.find((m) => m.id === id)?.name ?? 'member'
    },
    [group],
  )

  /* ------------------------------------------------------------ executing */

  const runCommand = useCallback(
    async (cmd: AiCommand) => {
      const snapshot = store.active
      const expenses = snapshot?.expenses ?? []
      const settlements = snapshot?.settlements ?? []

      switch (cmd.type) {
        case 'add_expense': {
          if (!snapshot) return finish('Open a group first.', 'error')
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
          const payerId = snapshot.group.members.some((m) => m.id === cmd.payerId)
            ? cmd.payerId
            : myId
          const ok = await addExpense(snapshot.group.id, {
            description: cmd.description,
            amountPaise: cmd.amountPaise,
            date: Date.now(),
            category: 'other',
            payers: [{ memberId: payerId, amountPaise: cmd.amountPaise }],
            split,
            notes: cmd.notes || undefined,
          })
          await fetchGroupSummaries()
          return ok
            ? finish(`Added “${cmd.description}” for ₹${(cmd.amountPaise / 100).toFixed(2)}.`)
            : finish('Could not add the expense.', 'error')
        }

        case 'delete_expense': {
          if (!snapshot) return finish('Open a group first.', 'error')
          const newest = latestExpense(expenses)
          if (!newest) return finish('There are no expenses to delete.', 'error')
          const ok = await deleteExpense(snapshot.group.id, newest.id)
          await fetchGroupSummaries()
          return ok
            ? finish(`Deleted “${newest.description}”.`)
            : finish('Could not delete the expense.', 'error')
        }

        case 'edit_expense': {
          if (!snapshot) return finish('Open a group first.', 'error')
          const target = latestExpense(expenses)
          if (!target) return finish('There are no expenses to edit.', 'error')
          const amountPaise = cmd.amountPaise ?? target.amountPaise
          let split = target.split
          if (amountPaise !== target.amountPaise) {
            split =
              target.split.mode === 'equal'
                ? target.split
                : { mode: 'equal', participants: participantIdsOf(target.split) }
          }
          const payerTotal = target.payers.reduce((sum, payer) => sum + payer.amountPaise, 0)
          const payers =
            payerTotal === amountPaise
              ? target.payers
              : [{ memberId: myId, amountPaise }]
          const ok = await updateExpense(snapshot.group.id, target.id, {
            description: cmd.description ?? target.description,
            amountPaise,
            date: target.date,
            category: target.category,
            payers,
            split,
            notes: target.notes,
          })
          await fetchGroupSummaries()
          return ok
            ? finish(`Updated “${cmd.description ?? target.description}” to ₹${(amountPaise / 100).toFixed(2)}.`)
            : finish('Could not update that expense.', 'error')
        }

        case 'record_settlement': {
          if (!snapshot) return finish('Open a group first.', 'error')
          const ok = await recordSettlement(
            cmd.groupId,
            cmd.fromId,
            cmd.toId,
            cmd.amountPaise,
            cmd.method,
          )
          await fetchGroupSummaries()
          return ok
            ? finish(
                cmd.fromId.startsWith('manual:')
                  ? `Recorded ₹${(cmd.amountPaise / 100).toFixed(2)} from ${memberName(cmd.fromId)}. Your balance is updated.`
                  : `Recorded ₹${(cmd.amountPaise / 100).toFixed(2)}. The other person can confirm from their phone.`,
              )
            : finish('Could not record the payment.', 'error')
        }

        case 'confirm_payment': {
          if (!snapshot) return finish('Open a group first.', 'error')
          const pending = settlements
            .filter((s) => s.status !== 'confirmed' && s.status !== 'disputed')
            .filter((s) => {
              const matchesAmount = !cmd.amountPaise || s.amountPaise === cmd.amountPaise
              if (!matchesAmount) return false
              if (cmd.action === 'received') {
                if (s.to !== myId) return false
                return !cmd.memberName || memberName(s.from) === cmd.memberName
              }
              if (s.from !== myId) return false
              return !cmd.memberName || memberName(s.to) === cmd.memberName
            })
            .sort((a, b) => b.updatedAt - a.updatedAt)[0]

          if (pending) {
            const ok = await advanceSettlement(
              pending.id,
              myId,
              cmd.action === 'received' ? 'receiver_confirmed' : 'payer_confirmed',
            )
            await fetchGroupSummaries()
            return ok
              ? finish(`Confirmed ₹${(pending.amountPaise / 100).toFixed(2)} with ${memberName(cmd.action === 'received' ? pending.from : pending.to)}.`)
              : finish('Could not confirm that payment.', 'error')
          }

          if (cmd.action === 'received' && cmd.amountPaise) {
            const fromName = cmd.memberName ?? 'Someone'
            const fromId = cmd.memberName
              ? members.find((m) => m.name.toLowerCase().startsWith(cmd.memberName!.toLowerCase()))
                  ?.id ??
                `manual:from:${cmd.memberName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
              : 'manual:from:someone'
            const ok = await recordSettlement(
              snapshot.group.id,
              fromId,
              myId,
              cmd.amountPaise,
              fromId.startsWith('manual:') ? 'cash' : 'upi',
            )
            await fetchGroupSummaries()
            return ok
              ? finish(`Recorded ₹${(cmd.amountPaise / 100).toFixed(2)} received from ${fromName}.`)
              : finish('Could not record that payment.', 'error')
          }

          return finish('No pending payment matches that. Say “I got 500 from Priya” to record one.', 'error')
        }

        case 'create_group': {
          const groupId = await createGroup(cmd.name, cmd.emoji)
          await fetchGroupSummaries()
          if (groupId) {
            onOpenGroup(groupId)
            return finish(`Created “${cmd.name}”. Invite people from the share button.`)
          }
          return finish('Could not create the group.', 'error')
        }

        case 'join_group': {
          const groupId = await store.joinGroup(cmd.code)
          await fetchGroupSummaries()
          if (groupId) {
            onOpenGroup(groupId)
            return finish(`Joined with code ${cmd.code}.`)
          }
          return finish('That invite code did not work.', 'error')
        }

        case 'switch_tab': {
          onTabChange(cmd.tab)
          return finish(`Switched to ${cmd.tab}.`)
        }

        case 'show_balances': {
          onTabChange('balances')
          return finish("Here are everyone's balances.")
        }

        case 'open_group': {
          onOpenGroup(cmd.groupId)
          return finish('Opening the group.')
        }

        case 'show_help': {
          return finish(cmd.text)
        }

        default:
          return finish('That command is not available here.', 'error')
      }
    },
    [
      addExpense,
      advanceSettlement,
      createGroup,
      deleteExpense,
      fetchGroupSummaries,
      finish,
      memberName,
      members,
      myId,
      onOpenGroup,
      onTabChange,
      recordSettlement,
      store,
      updateExpense,
    ],
  )

  /* ------------------------------------------------------------ listening */

  const handleTranscript = useCallback(
    (text: string) => {
      const parsed = parseVoiceCommand(text, {
        myId,
        myName,
        groups,
        members,
        currentGroupId,
      })
      if (!parsed.ok && parsed.command?.type === 'show_help') {
        setReply(parsed.command.text)
        setStatus('done')
        return
      }
      const cmd = parsed.command
      if (!cmd) {
        setReply(parsed.reply)
        setStatus('error')
        return
      }

      // Navigation and help run straight away. Money and destructive actions
      // need a confirmation tap.
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

      setPendingCommand(cmd)
      setReply(parsed.reply)
      setStatus('confirm')
    },
    [currentGroupId, groups, members, myId, myName, runCommand],
  )

  const handleTranscriptRef = useRef(handleTranscript)
  useEffect(() => {
    handleTranscriptRef.current = handleTranscript
  }, [handleTranscript])

  const stopVoice = useCallback(() => {
    listeningRef.current = false
    clearTimers()
    try {
      recognitionRef.current?.stop()
    } catch {
      // already stopped
    }
    setStatus('idle')
  }, [clearTimers])

  const startVoice = useCallback(() => {
    clearTimers()
    setError('')
    setReply('')
    setTranscript('')

    const speechWindow = window as any
    const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError('This browser has no speech recognition. Try typing a command in the home search bar.')
      setStatus('error')
      return
    }

    try {
      navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((permission) => {
          if (permission.state === 'denied') {
            setError('Microphone access is blocked. Allow it in your browser settings.')
            setStatus('error')
          }
        })
        .catch(() => undefined)
    } catch {
      // Permission API missing; recognition will report it.
    }

    const recognition = new SpeechRecognition()
    recognitionRef.current = recognition
    recognition.lang = 'en-IN'
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    listeningRef.current = true
    setStatus('listening')

    recognition.onresult = (event: any) => {
      if (watchdogRef.current !== null) {
        window.clearTimeout(watchdogRef.current)
        watchdogRef.current = null
      }
      const results = Array.from(event.results as ArrayLike<any>)
      const last = results[results.length - 1]
      if (!last) return
      const text = last[0]?.transcript?.trim() ?? ''
      setTranscript(text)
      if (last.isFinal) {
        listeningRef.current = false
        setStatus('processing')
        handleTranscriptRef.current(text)
      }
    }

    recognition.onerror = (event: any) => {
      listeningRef.current = false
      clearTimers()
      if (event.error === 'aborted') return
      setStatus('error')
      setError(
        event.error === 'not-allowed'
          ? 'Microphone blocked. Allow it in your browser settings.'
          : event.error === 'no-speech'
            ? 'No speech detected. Try again.'
            : `Voice error: ${event.error}`,
      )
    }

    recognition.onend = () => {
      listeningRef.current = false
      if (watchdogRef.current !== null) {
        window.clearTimeout(watchdogRef.current)
        watchdogRef.current = null
      }
      setStatus((current) => (current === 'listening' ? 'idle' : current))
    }

    watchdogRef.current = window.setTimeout(() => {
      watchdogRef.current = null
      listeningRef.current = false
      try {
        recognition.abort()
      } catch {
        // already stopped
      }
      setStatus('error')
      setError('No response from the microphone. Try again or type the command.')
    }, 12_000)

    try {
      recognition.start()
    } catch (cause) {
      listeningRef.current = false
      clearTimers()
      setStatus('error')
      setError(cause instanceof Error ? cause.message : 'Could not start voice input.')
    }
  }, [clearTimers])

  useEffect(() => {
    return () => {
      clearTimers()
      try {
        recognitionRef.current?.abort()
      } catch {
        // already stopped
      }
    }
  }, [clearTimers])

  const confirmCommand = useCallback(async () => {
    const cmd = pendingCommand
    if (!cmd) return
    setPendingCommand(null)
    setStatus('processing')
    await runCommand(cmd)
  }, [pendingCommand, runCommand])

  const isListening = status === 'listening' || status === 'processing'
  const showPanel = status !== 'idle' || Boolean(transcript || reply || error)

  return (
    <div className={`voice-bar${isListening ? ' is-listening' : ''}`}>
      {status === 'listening' && <span className="voice-bar__pulse" aria-hidden />}
      <button
        type="button"
        className={`voice-fab${isListening ? ' voice-fab--active' : ''}`}
        onClick={isListening ? stopVoice : startVoice}
        aria-label={isListening ? 'Stop listening' : 'Start voice command'}
        title={isListening ? 'Stop listening' : 'Speak a command'}
      >
        <IconMic size={22} />
      </button>

      {showPanel && (
        <div className={`voice-bar__panel voice-bar__panel--${status}`} role="status">
          <div className="voice-bar__header">
            <span className="voice-bar__status">
              {status === 'listening' && 'Listening…'}
              {status === 'processing' && 'Working on it…'}
              {status === 'confirm' && 'Confirm this action?'}
              {status === 'done' && 'Done'}
              {status === 'error' && 'Could not do that'}
              {status === 'idle' && 'Voice command'}
            </span>
            <button type="button" className="voice-bar__close" onClick={reset} aria-label="Close voice bar">
              <IconClose size={16} />
            </button>
          </div>

          {transcript && (
            <p className="voice-bar__transcript">
              <span>Heard</span>
              {transcript}
            </p>
          )}
          {reply && (
            <p className={`voice-bar__reply${status === 'error' ? ' is-error' : ''}`}>{reply}</p>
          )}
          {error && <p className="voice-bar__error">{error}</p>}

          {status === 'confirm' && pendingCommand && (
            <div className="voice-bar__actions">
              <button type="button" className="voice-bar__btn voice-bar__btn--confirm" onClick={confirmCommand}>
                Confirm
              </button>
              <button type="button" className="voice-bar__btn voice-bar__btn--cancel" onClick={reset}>
                Cancel
              </button>
            </div>
          )}

          {status === 'idle' && (
            <div className="voice-bar__hint">
              Try “Dinner 1200 split between us”, “Bill 1256, GST 60, 2 ate 500, 3 split rest”,
              “I got 500 from Priya”, “Show balances”, or “Delete the last expense”.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
