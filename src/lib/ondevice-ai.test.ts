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

  it('adds a separately stated GST total to a count-based split', () => {
    const result = parseVoiceCommand(
      'bill amount is 1256, between 5 people, 2 ate for cost 500 and 3 ate for cost each, gst total 60',
      context,
    )
    expect(result.command).toMatchObject({
      type: 'add_expense',
      amountPaise: 131600,
      splitMode: 'exact',
      notes: 'GST ₹60',
    })
    if (result.command?.type !== 'add_expense') throw new Error('expected expense command')
    expect(Object.values(result.command.splitValues ?? {})).toEqual([
      25000, 25000, 27200, 27200, 27200,
    ])
    expect(Object.values(result.command.splitValues ?? {}).reduce((a, b) => a + b, 0)).toBe(131600)
  })

  it('understands “2 ate for cost 500” without the word each', () => {
    const result = parseVoiceCommand('Dinner 1000, 2 people ate for cost 500, remaining 3 split the rest', context)
    expect(result.command).toMatchObject({ type: 'add_expense', splitMode: 'exact' })
    if (result.command?.type !== 'add_expense') throw new Error('expected expense command')
    expect(Object.values(result.command.splitValues ?? {})).toEqual([
      25000, 25000, 16666, 16666, 16668,
    ])
  })

  it('records money received from a member', () => {
    const result = parseVoiceCommand('I got 500 rupees from Priya', context)
    expect(result.command).toEqual({
      type: 'record_settlement',
      fromId: 'priya',
      toId: 'me',
      amountPaise: 50000,
      groupId: 'g',
      method: 'upi',
    })
  })

  it('records money paid to a member', () => {
    const result = parseVoiceCommand('I paid Priya 800', context)
    expect(result.command).toMatchObject({
      type: 'record_settlement',
      fromId: 'me',
      toId: 'priya',
      amountPaise: 80000,
    })
  })

  it('keeps a payment from someone outside the group as a manual party', () => {
    const result = parseVoiceCommand('I got 500 from Rajesh', context)
    expect(result.command).toMatchObject({
      type: 'record_settlement',
      fromId: 'manual:from:rajesh',
      toId: 'me',
      amountPaise: 50000,
    })
  })

  it('confirms an existing incoming payment', () => {
    const result = parseVoiceCommand('confirm I received 500', context)
    expect(result.command).toMatchObject({
      type: 'confirm_payment',
      action: 'received',
      amountPaise: 50000,
    })
  })

  it('switches tabs and deletes by voice', () => {
    expect(parseVoiceCommand('show balances', context).command).toEqual({
      type: 'switch_tab',
      tab: 'balances',
    })
    expect(parseVoiceCommand('go to settle', context).command).toEqual({
      type: 'switch_tab',
      tab: 'settle',
    })
    expect(parseVoiceCommand('delete the last expense', context).command).toMatchObject({
      type: 'delete_expense',
      expenseId: '__last__',
    })
  })

  it('creates a named group', () => {
    expect(parseVoiceCommand('Create a group called Goa trip', context).command).toMatchObject({
      type: 'create_group',
      name: 'Goa trip',
    })
  })

  it('reads who paid and who the expense was for', () => {
    const result = parseVoiceCommand('arjun paid 500 for priya for pani puri', context)
    expect(result.command).toMatchObject({
      type: 'add_expense',
      description: 'Pani Puri',
      amountPaise: 50000,
      payerId: 'arjun',
      splitMode: 'exact',
    })
    if (result.command?.type !== 'add_expense') throw new Error('expected expense command')
    expect(result.command.participantIds).toEqual(['priya'])
    expect(result.command.splitValues).toEqual({ priya: 50000 })
    expect(result.reply).toContain('Arjun paid')
  })

  it('matches a misheard payer name and keeps it out of the item name', () => {
    const result = parseVoiceCommand('arjan paid twelve hundred for dinner', context)
    expect(result.command).toMatchObject({
      type: 'add_expense',
      description: 'Dinner',
      amountPaise: 120000,
      payerId: 'arjun',
    })
    expect(result.command?.type === 'add_expense' && result.command.category).toBe('food')
  })

  it('splits only between the named people when the payer was stated', () => {
    const result = parseVoiceCommand('priya paid 300 for rahul and neha for lunch', context)
    if (result.command?.type !== 'add_expense') throw new Error('expected expense command')
    expect(result.command.payerId).toBe('priya')
    expect(result.command.splitValues).toEqual({ rahul: 15000, neha: 15000 })
  })

  it('treats the speaker as payer when no name is given', () => {
    const result = parseVoiceCommand('five hundred for cab', context)
    expect(result.command).toMatchObject({
      type: 'add_expense',
      amountPaise: 50000,
      payerId: 'me',
      description: 'Cab',
    })
  })
})
