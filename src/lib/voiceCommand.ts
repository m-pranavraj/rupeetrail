import type { AiCommand } from './ondevice-ai'

export interface VoiceContext {
  myId: string
  myName: string
  groupId?: string
  members: { id: string; name: string }[]
  groups: { id: string; name: string }[]
}

export function processVoiceCommand(
  transcript: string,
  context: VoiceContext
): { ok: boolean; command?: AiCommand; reply: string } {
  // This is a wrapper around the ondevice-ai parser
  // In a full implementation, this would call the AI service
  // For now, we return a simple response
  
  const lower = transcript.toLowerCase()
  
  if (lower.includes('help') || lower.includes('what can you do')) {
    return {
      ok: true,
      command: { type: 'show_help', text: 'Available commands: create group, add expense, delete expense, record payment, show balances' },
      reply: 'I can help you: create groups, add expenses, record payments, show balances. Try saying something specific.'
    }
  }
  
  if (lower.includes('create') && (lower.includes('group') || lower.includes('trip'))) {
    const nameMatch = transcript.match(/create.*?(group|trip).*?called\s+([a-zA-Z\s]+)/i)
    const name = nameMatch ? nameMatch[2].trim() : 'New Group'
    return {
      ok: true,
      command: { type: 'create_group', name, emoji: '🧾' },
      reply: `Creating group "${name}"...`
    }
  }
  
  if (lower.includes('add') && (lower.includes('expense') || lower.includes('bill') || lower.includes('dinner') || lower.includes('lunch'))) {
    const amountMatch = transcript.match(/(\d+)/)
    const amount = amountMatch ? parseInt(amountMatch[1]) * 100 : 10000 // default 100 rupees
    return {
      ok: true,
      command: { 
        type: 'add_expense', 
        description: transcript.slice(0, 50),
        amountPaise: amount, 
        splitMode: 'equal', 
        participantIds: context.members.map(m => m.id), 
        payerId: context.myId, 
        notes: '' 
      },
      reply: `Adding expense of ₹${(amount/100).toFixed(2)}...`
    }
  }
  
  if (lower.includes('delete') || lower.includes('remove')) {
    return {
      ok: true,
      command: { type: 'delete_expense', expenseId: '__last__', groupId: context.groupId || '' },
      reply: 'Deleting last expense...'
    }
  }
  
  if (lower.includes('payment') || lower.includes('received') || lower.includes('got') || lower.includes('paid')) {
    const amountMatch = transcript.match(/(\d+)/)
    const amount = amountMatch ? parseInt(amountMatch[1]) * 100 : 50000
    return {
      ok: true,
      command: { 
        type: 'record_settlement', 
        fromId: 'manual:payer', 
        toId: context.myId, 
        amountPaise: amount, 
        groupId: context.groupId || '', 
        method: 'upi' 
      },
      reply: `Recording payment of ₹${(amount/100).toFixed(2)}...`
    }
  }
  
  if (lower.includes('balance') || lower.includes('show') || lower.includes('who owes')) {
    return {
      ok: true,
      command: { type: 'show_balances', groupId: context.groupId || '' },
      reply: 'Showing balances...'
    }
  }
  
  return {
    ok: false,
    reply: `I heard "${transcript}" but I'm not sure what you want. Try: "Add expense for 1000 rupees", "Record payment of 500 rupees", or "Show balances".`
  }
}
