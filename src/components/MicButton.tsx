import React, { useRef } from 'react'
import { useStore } from '../lib/store'
import { IconMapPin } from './Icons'
import type { Settlement } from '../types'

interface MicButtonProps {
  groupId: string
  currentMemberId: string
  onRecordManual?: (fromName: string, toName: string, amountPaise: number, method: Settlement['method']) => void
}

export function MicButton({ groupId, currentMemberId, onRecordManual }: MicButtonProps) {
  const { active, summaries } = useStore()
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const handleClick = () => {
    // Simple voice interaction - user speaks, we try to understand
    // In a real implementation, this would use the Web Speech API
    // For now, we show a prompt for text input
    const message = `Say something like:
- "I got 500 rupees from Priya" (record payment received)
- "Dinner 1256 split between 5 people" (add expense)
- "Delete last expense" (remove expense)
- "Show balances" (see who owes what)
- "Create group called [name]" (create new group)`

    alert(message)
  }

  return (
    <button
      className="mic-button"
      onClick={handleClick}
      title="Voice command"
    >
      <IconMapPin size={24} />
      <span className="mic-button-label">Voice</span>
    </button>
  )
}
