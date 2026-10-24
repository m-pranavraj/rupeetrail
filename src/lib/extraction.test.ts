// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { parseReceipt } from './receipt'
import { parseVoiceSplit, spokenAmount } from './voice'
import { buildExpenseFromReceipt, buildExpenseFromVoice } from './billParser'
import { queueExpense, readOutbox, removeQueued, queuedForGroup } from './outbox'
import { allocateSplit } from './splits'

const RESTAURANT = `SPICE ROUTE
GSTIN: 29ABCDE1234F1Z5
Date: 24/10/2026
Paneer Tikka 2 x 280.00 560.00
Butter Naan 3 60.00 180.00
Masala Chai 2 40.00 80.00
Sub Total 820.00
CGST 2.5% 20.50
SGST 2.5% 20.50
Discount 20.00
Grand Total 841.00`

const GROCERY = `DMART
Milk 2 32.00 64.00
Rice 1 kg 120.00
Total 184.00`

const NOISY = `Cafe Mocha
Cold Coffee 2O0.00
Total 2O0.00`

const MISMATCH = `Bar
Beer 500.00
Fries 200.00
Total 900.00`

describe('receipt extraction', () => {
  it('reads items, quantity, GST and the printed total', () => {
    const receipt = parseReceipt(RESTAURANT)

    expect(receipt.merchant).toBe('SPICE ROUTE')
    expect(receipt.items).toHaveLength(3)

    const [tikka, naan, chai] = receipt.items
    expect(tikka.name).toBe('Paneer Tikka')
    expect(tikka.quantity).toBe(2)
    expect(tikka.unitPaise).toBe(28000)
    expect(tikka.amountPaise).toBe(56000)

    expect(naan.name).toBe('Butter Naan')
    expect(naan.quantity).toBe(3)
    expect(naan.unitPaise).toBe(6000)
    expect(naan.amountPaise).toBe(18000)

    expect(chai.quantity).toBe(2)
    expect(chai.amountPaise).toBe(8000)

    expect(receipt.subtotalPaise).toBe(82000)
    expect(receipt.taxes).toHaveLength(2)
    expect(receipt.gstRate).toBe(5)
    expect(receipt.discountPaise).toBe(2000)
    expect(receipt.totalPaise).toBe(84100)
    expect(receipt.warnings).toHaveLength(0)
    expect(receipt.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('drops weight markers from grocery names', () => {
    const receipt = parseReceipt(GROCERY)
    expect(receipt.items).toHaveLength(2)
    expect(receipt.items[1].name).toBe('Rice')
    expect(receipt.items[1].amountPaise).toBe(12000)
    expect(receipt.totalPaise).toBe(18400)
  })

  it('repairs letters that OCR swapped into numbers', () => {
    const receipt = parseReceipt(NOISY)
    expect(receipt.items[0].amountPaise).toBe(20000)
    expect(receipt.totalPaise).toBe(20000)
  })

  it('flags a total that does not match the lines', () => {
    const receipt = parseReceipt(MISMATCH)
    expect(receipt.totalPaise).toBe(90000)
    expect(receipt.warnings.join(' ')).toMatch(/less than the printed total/i)
    expect(receipt.confidence).toBeLessThan(0.8)
  })

  it('still produces a usable total without a printed total line', () => {
    const receipt = parseReceipt('Chai Point\nTea 40.00\nSamosa 30.00')
    expect(receipt.totalPaise).toBe(7000)
    expect(receipt.warnings.join(' ')).toMatch(/no printed total/i)
  })

  it('pairs an item name on one line with its price on the next', () => {
    const receipt = parseReceipt('TWO COLUMN\nPaneer Tikka\n560.00\nButter Naan\n180.00\nTotal 740.00')

    expect(receipt.items).toHaveLength(2)
    expect(receipt.items[0].name).toBe('Paneer Tikka')
    expect(receipt.items[0].amountPaise).toBe(56000)
    expect(receipt.items[1].name).toBe('Butter Naan')
    expect(receipt.totalPaise).toBe(74000)
  })

  it('builds a balanced expense draft from a receipt', () => {
    const receipt = parseReceipt(RESTAURANT)
    const draft = buildExpenseFromReceipt(receipt, 'me', new Set(['me', 'priya']))

    expect(draft.description).toBe('SPICE ROUTE')
    expect(draft.amountPaise).toBe(84100)
    expect(draft.split?.mode).toBe('equal')
    expect(draft.notes).toContain('Paneer Tikka')
    expect(draft.category).toBe('food')

    const shares = allocateSplit(draft.amountPaise!, draft.split!)
    expect(shares.reduce((sum, share) => sum + share.amountPaise, 0)).toBe(84100)
  })
})

describe('voice split extraction', () => {
  const members = [
    { id: 'arjun', name: 'Arjun' },
    { id: 'priya', name: 'Priya' },
  ]

  it('understands amounts, a title total and who paid', () => {
    const parsed = parseVoiceSplit('Dinner 1200, Priya had the wine for 400, I paid', members, 'arjun')

    expect(parsed.mode).toBe('exact')
    expect(parsed.payerMemberId).toBe('arjun')
    expect(parsed.totalPaise).toBe(120000)
    expect(parsed.people.find((p) => p.memberId === 'priya')?.amountPaise).toBe(40000)
    expect(parsed.people.find((p) => p.memberId === 'arjun')?.amountPaise).toBe(80000)
  })

  it('handles an equal split between the people named', () => {
    const parsed = parseVoiceSplit('Auto 240 split equally between me and Priya', members, 'arjun')
    expect(parsed.mode).toBe('equal')
    expect(parsed.totalPaise).toBe(24000)
    expect(new Set(parsed.participants)).toEqual(new Set(['arjun', 'priya']))
  })

  it('handles percentages', () => {
    const parsed = parseVoiceSplit('Cab 600, Arjun 60%, Priya 40%, I paid', members, 'arjun')
    expect(parsed.mode).toBe('percent')
    expect(parsed.totalPaise).toBe(60000)
    expect(parsed.people).toHaveLength(2)
    expect(parsed.warnings).toHaveLength(0)

    const draft = buildExpenseFromVoice(parsed, 'arjun', new Set(['arjun', 'priya']))
    const shares = allocateSplit(draft.amountPaise!, draft.split!)
    expect(shares.find((s) => s.memberId === 'arjun')?.amountPaise).toBe(36000)
    expect(shares.find((s) => s.memberId === 'priya')?.amountPaise).toBe(24000)
  })

  it('warns when a spoken name is not in the group', () => {
    const parsed = parseVoiceSplit('Lunch 900, Priya 300, Rahul 300', members, 'arjun')
    expect(parsed.warnings.join(' ')).toMatch(/Rahul/)
    expect(parsed.people.every((person) => person.memberId)).toBe(true)
  })

  it('reads spoken shorthand for money', () => {
    expect(spokenAmount('1.2k')).toBe(1200)
    expect(spokenAmount('1,200')).toBe(1200)
    expect(spokenAmount('two thousand')).toBe(2000)
    expect(spokenAmount('550')).toBe(550)
  })
})

describe('offline outbox', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('queues an expense and reads it back per group', () => {
    const queued = queueExpense('g1', {
      description: 'Tea',
      amountPaise: 4000,
      date: 1,
      category: 'food',
      payers: [{ memberId: 'me', amountPaise: 4000 }],
      split: { mode: 'equal', participants: ['me'] },
    })

    expect(readOutbox()).toHaveLength(1)
    expect(queuedForGroup('g1')).toHaveLength(1)
    expect(queuedForGroup('g2')).toHaveLength(0)

    removeQueued(queued.id)
    expect(readOutbox()).toHaveLength(0)
  })

  it('ignores a corrupted queue instead of throwing', () => {
    localStorage.setItem('rupeetrail.outbox.v1', '{not json')
    expect(readOutbox()).toEqual([])
  })
})
