import { describe, expect, it } from 'vitest'
import { parseVoiceCommand } from './ondevice-ai'

const context = {
  myId: 'me',
  myName: 'Me',
  currentGroupId: 'g',
  groups: [{ id: 'g', name: 'Goa' }],
  members: [
    { id: 'me', name: 'Me' },
    { id: 'priya', name: 'Priya' },
    { id: 'rahul', name: 'Rahul' },
    { id: 'arjun', name: 'Arjun' },
    { id: 'neha', name: 'Neha' },
  ],
}

describe('voice command parsing', () => {
  it('keeps a stated bill total when GST is an included amount', () => {
    const result = parseVoiceCommand('Bill 1256, GST 60, split between 5 people', context)
    expect(result.command).toMatchObject({
      type: 'add_expense',
      amountPaise: 125600,
      notes: 'GST ₹60',
    })
  })

  it('builds exact named shares and allocates the remainder', () => {
    const result = parseVoiceCommand('Dinner 1256, Priya ate 250, Rahul ate 300, rest equal', context)
    expect(result.command).toMatchObject({
      type: 'add_expense',
      splitMode: 'exact',
      amountPaise: 125600,
    })
    if (result.command?.type !== 'add_expense') throw new Error('expected expense command')
    expect(result.command.splitValues).toEqual({
      priya: 25000,
      rahul: 30000,
      arjun: 23533,
      me: 23533,
      neha: 23534,
    })
  })

  it('does not divide an amount that was spoken as per-person', () => {
    const result = parseVoiceCommand('Bill 1256, 2 people ate 250 each, 3 ate the rest', context)
    expect(result.command).toMatchObject({ type: 'add_expense', splitMode: 'exact' })
    if (result.command?.type !== 'add_expense') throw new Error('expected expense command')
    expect(Object.values(result.command.splitValues ?? {})).toEqual([25000, 25000, 25200, 25200, 25200])
  })
})
