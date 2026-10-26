import React, { useState } from 'react'
import { useStore } from '../lib/store'
import { processVoiceCommand } from '../lib/voiceCommand'
import type { Settlement } from '../types'

interface TextVoiceInputProps {
  groupId: string
  currentMemberId: string
  onRecordManual?: (fromName: string, toName: string, amountPaise: number, method: Settlement['method']) => void
}

export function TextVoiceInput({ groupId, currentMemberId, onRecordManual }: TextVoiceInputProps) {
  const { identity, summaries, addExpense, recordSettlement, deleteExpense } = useStore()
  const [input, setInput] = useState('')
  const [response, setResponse] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    
    setLoading(true)
    setResponse(null)
    
    try {
      const context = {
        myId: currentMemberId,
        myName: identity?.name || '',
        groupId,
        members: summaries.find(s => s.groupId === groupId)?.members || [],
        groups: summaries.map(s => ({ id: s.groupId, name: s.name }))
      }
      
      const result = processVoiceCommand(input, context)
      setResponse(result.reply)
      
      if (result.ok && result.command) {
        // Execute the command
        if (result.command.type === 'add_expense') {
          await addExpense(groupId, {
            description: result.command.description,
            amountPaise: result.command.amountPaise,
            date: Date.now(),
            category: 'other',
            payers: [{ memberId: result.command.payerId, amountPaise: result.command.amountPaise }],
            split: { mode: result.command.splitMode, participants: result.command.participantIds }
          })
        } else if (result.command.type === 'record_settlement') {
          await recordSettlement(groupId, result.command.fromId, result.command.toId, result.command.amountPaise, result.command.method)
        } else if (result.command.type === 'delete_expense') {
          await deleteExpense(groupId, result.command.expenseId)
        }
      }
    } catch (error) {
      setResponse('Error processing voice command. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="text-voice-input">
      <form onSubmit={handleSubmit} className="voice-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Say it... (e.g., 'I got 500 rupees from Priya')"
          className="voice-input"
          disabled={loading}
        />
        <button type="submit" disabled={loading} className="voice-submit">
          {loading ? 'Processing...' : 'Send'}
        </button>
      </form>
      {response && <div className="voice-response">{response}</div>}
    </div>
  )
}
