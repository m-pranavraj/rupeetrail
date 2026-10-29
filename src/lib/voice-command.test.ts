import { describe, expect, it } from 'vitest'
import {
  foldNumberWords,
  parseVoiceCommand,
  prepareTranscript,
  type AiCommand,
  type VoiceCommandContext,
} from './voice-command'

const members = [
  { id: 'me', name: 'Pranav' },
  { id: 'priya', name: 'Priya Sharma' },
  { id: 'arjun', name: 'Arjun Rao' },
  { id: 'rahul', name: 'Rahul Verma' },
  { id: 'diya', name: 'Diya Nair' },
]

const context: VoiceCommandContext = {
  myId: 'me',
  myName: 'Pranav',
  groups: [{ id: 'goa', name: 'Goa trip' }],
  members,
  currentGroupId: 'goa',
}

type Settlement = Extract<AiCommand, { type: 'record_settlement' }>
type Expense = Extract<AiCommand, { type: 'add_expense' }>

function settlement(transcript: string): Settlement {
  const result = parseVoiceCommand(transcript, context)
  expect(result.command?.type, `"${transcript}" should record a payment`).toBe('record_settlement')
  return result.command as Settlement
}

function expense(transcript: string): Expense {
  const result = parseVoiceCommand(transcript, context)
  expect(result.command?.type, `"${transcript}" should add an expense`).toBe('add_expense')
  return result.command as Expense
}

describe('Hinglish settlement phrases', () => {
  it('reads "maine Priya ko 500 diya" as a payment from me to Priya', () => {
    expect(settlement('Maine Priya ko 500 diya')).toMatchObject({
      fromId: 'me',
      toId: 'priya',
      amountPaise: 50000,
    })
  })

  it('reads "Priya se 500 mila" as money received from Priya', () => {
    expect(settlement('Priya se 500 mila')).toMatchObject({
      fromId: 'priya',
      toId: 'me',
      amountPaise: 50000,
    })
  })

  it('reads "mujhe Priya se 500 mile" the same way', () => {
    expect(settlement('Mujhe Priya se 500 mile')).toMatchObject({
      fromId: 'priya',
      toId: 'me',
      amountPaise: 50000,
    })
  })

  it('reads "bheja" as sent money', () => {
    expect(settlement('Maine Priya ko 500 bheja')).toMatchObject({
      fromId: 'me',
      toId: 'priya',
      amountPaise: 50000,
    })
  })

  it('reads "Priya ne mujhe 500 diye" as money received from Priya', () => {
    expect(settlement('Priya ne mujhe 500 diye')).toMatchObject({
      fromId: 'priya',
      toId: 'me',
      amountPaise: 50000,
    })
  })

  it('reads "liye" as money taken from someone', () => {
    expect(settlement('Maine Priya se dedh sau liye')).toMatchObject({
      fromId: 'priya',
      toId: 'me',
      amountPaise: 15000,
    })
  })

  it('folds spoken numbers before reading the verb', () => {
    expect(settlement('Maine Priya ko five hundred diya')).toMatchObject({
      fromId: 'me',
      toId: 'priya',
      amountPaise: 50000,
    })
  })

  it('still understands the plain English phrasings', () => {
    expect(settlement('I got 500 from Priya')).toMatchObject({
      fromId: 'priya',
      toId: 'me',
      amountPaise: 50000,
    })
    expect(settlement('I paid Priya 800')).toMatchObject({
      fromId: 'me',
      toId: 'priya',
      amountPaise: 80000,
    })
  })
})

describe('Hinglish expenses', () => {
  it('keeps "diya" as a payment verb, not a payer', () => {
    const command = expense('Maine dinner ke liye 1200 diya')
    expect(command).toMatchObject({
      description: 'Dinner',
      amountPaise: 120000,
      payerId: 'me',
      splitMode: 'equal',
    })
    expect(command.participantIds).toHaveLength(members.length)
  })

  it('understands "sab ke liye" as a split for the whole group', () => {
    const command = expense('Humne lunch ke liye 800 diya, sab ke liye')
    expect(command.amountPaise).toBe(80000)
    expect(command.splitMode).toBe('exact')
    expect(command.participantIds).toHaveLength(members.length)
    const shares = Object.values(command.splitValues ?? {})
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(80000)
  })

  it('does not treat a member called Diya as a payment verb', () => {
    expect(expense('Diya ne 800 diye')).toMatchObject({
      payerId: 'diya',
      amountPaise: 80000,
    })
  })

  it('treats "paid for Priya" as an expense on her behalf, not a transfer', () => {
    const english = expense('I paid 500 for Priya')
    expect(english.payerId).toBe('me')
    expect(english.splitValues).toEqual({ priya: 50000 })

    const hinglish = expense('Priya ke liye 500 diya')
    expect(hinglish.payerId).toBe('me')
    expect(hinglish.splitValues).toEqual({ priya: 50000 })
  })
})

describe('spoken numbers', () => {
  it('folds English number words', () => {
    expect(foldNumberWords('one thousand two hundred fifty six')).toBe('1256')
    expect(foldNumberWords('twelve fifty')).toBe('1250')
  })

  it('folds Hinglish number words', () => {
    expect(foldNumberWords('ek sau pandrah')).toBe('115')
    expect(foldNumberWords('saat sau')).toBe('700')
  })

  it('folds Hindi fractions and digit multipliers', () => {
    expect(prepareTranscript('dedh sau')).toBe('150')
    expect(prepareTranscript('dhai hazaar')).toBe('2500')
    expect(prepareTranscript('sava sau')).toBe('125')
    expect(prepareTranscript('paune do sau')).toBe('175')
    expect(prepareTranscript('2 sau pachas')).toBe('250')
    expect(prepareTranscript('do sau pachas')).toBe('250')
    expect(prepareTranscript('1.5 hazaar')).toBe('1500')
  })

  it('leaves "what do I owe" alone so the balance query still works', () => {
    expect(prepareTranscript('what do I owe')).toBe('what do I owe')
    const result = parseVoiceCommand('What do I owe?', context)
    expect(result.command?.type).toBe('show_balances')
  })

  it('answers Hinglish balance questions', () => {
    const result = parseVoiceCommand('Kitna baki hai?', context)
    expect(result.command?.type).toBe('show_balances')
  })
})

describe('existing expense parsing', () => {
  it('splits a plain bill between the stated number of people', () => {
    const command = expense('Dinner 1200 split between 4')
    expect(command.amountPaise).toBe(120000)
    expect(command.participantIds).toHaveLength(4)
  })

  it('still records Hinglish settlement amounts without a rupee word', () => {
    expect(settlement('Maine Priya ko do sau pachas diye')).toMatchObject({
      fromId: 'me',
      toId: 'priya',
      amountPaise: 25000,
    })
  })
})
