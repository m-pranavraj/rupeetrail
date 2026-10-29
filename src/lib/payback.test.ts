import { describe, expect, it } from 'vitest'
import type { Expense, Settlement } from '../types'
import { amountInFilter, buildPayback, PAYBACK_FILTERS } from './payback'

const ME = 'arjun'
const PRIYA = 'priya'
const RAVI = 'ravi'
const BASE_TIME = 1_700_000_000_000

let seq = 0
function expense(overrides: Partial<Expense> = {}): Expense {
  seq += 1
  const date = BASE_TIME + seq * 1_000
  return {
    id: `e_${seq}`,
    groupId: 'g',
    description: 'Dinner',
    amountPaise: 1_00_000,
    date,
    category: 'food',
    payers: [{ memberId: ME, amountPaise: 1_00_000 }],
    split: { mode: 'equal', participants: [ME, PRIYA] },
    createdBy: ME,
    createdAt: date,
    updatedAt: date,
    acks: {},
    revision: 1,
    ...overrides,
  }
}

function settlement(overrides: Partial<Settlement> = {}): Settlement {
  seq += 1
  const date = BASE_TIME + seq * 1_000
  return {
    id: `s_${seq}`,
    groupId: 'g',
    from: PRIYA,
    to: ME,
    amountPaise: 20_000,
    method: 'upi',
    status: 'confirmed',
    createdAt: date,
    updatedAt: date,
    ...overrides,
  }
}

describe('amountInFilter', () => {
  it('uses exact rupee-band boundaries', () => {
    expect(amountInFilter(29_999, 'under300')).toBe(true)
    expect(amountInFilter(30_000, 'under300')).toBe(false)
    expect(amountInFilter(30_000, 'between300and1000')).toBe(true)
    expect(amountInFilter(99_999, 'between300and1000')).toBe(true)
    expect(amountInFilter(1_00_000, 'between300and1000')).toBe(false)
    expect(amountInFilter(1_00_000, 'between1000and5000')).toBe(true)
    expect(amountInFilter(4_99_999, 'between1000and5000')).toBe(true)
    expect(amountInFilter(5_00_000, 'between1000and5000')).toBe(false)
    expect(amountInFilter(5_00_000, 'over5000')).toBe(true)
  })

  it('lets everything through in the all filter', () => {
    expect(amountInFilter(1, 'all')).toBe(true)
    expect(amountInFilter(1_00_00_000, 'all')).toBe(true)
  })
})

describe('PAYBACK_FILTERS', () => {
  it('offers the amount bands used by the picker', () => {
    expect(PAYBACK_FILTERS.map((option) => option.id)).toEqual([
      'all',
      'under300',
      'between300and1000',
      'between1000and5000',
      'over5000',
    ])
    expect(PAYBACK_FILTERS.find((option) => option.id === 'under300')?.label).toBe('Under ₹300')
  })
})

describe('buildPayback', () => {
  it('lists every expense you paid for each person, not a netted total', () => {
    const dinner = expense({ id: 'e_dinner', description: 'Dinner' })
    const cab = expense({
      id: 'e_cab',
      description: 'Cab',
      amountPaise: 30_000,
      split: { mode: 'equal', participants: [ME, RAVI] },
    })

    const view = buildPayback([dinner, cab], [], { meId: ME })

    expect(view.theyOwePaise).toBe(65_000)
    expect(view.youOwePaise).toBe(0)
    expect(view.expenseCount).toBe(2)

    const priya = view.people.find((person) => person.memberId === PRIYA)!
    expect(priya.theyOwe.map((line) => [line.description, line.amountPaise])).toEqual([
      ['Dinner', 50_000],
    ])
    expect(priya.theyOwePaise).toBe(50_000)
    expect(priya.youOwe).toEqual([])

    const ravi = view.people.find((person) => person.memberId === RAVI)!
    expect(ravi.theyOwe.map((line) => [line.description, line.amountPaise])).toEqual([
      ['Cab', 15_000],
    ])
    expect(ravi.theyOwePaise).toBe(15_000)

    expect(view.people.map((person) => person.memberId)).toEqual([PRIYA, RAVI])
  })

  it('keeps every expense and never subtracts payments from the totals', () => {
    const dinner = expense({ id: 'e_dinner', description: 'Dinner' })
    const lunch = expense({ id: 'e_lunch', description: 'Lunch', amountPaise: 40_000 })
    const paidBack = settlement({ id: 's_paid', amountPaise: 20_000 })
    const paidThem = settlement({
      id: 's_sent',
      from: ME,
      to: PRIYA,
      amountPaise: 5_000,
      status: 'pending',
    })

    const view = buildPayback([dinner, lunch], [paidBack, paidThem], { meId: ME })
    const priya = view.people.find((person) => person.memberId === PRIYA)!

    expect(priya.theyOwePaise).toBe(70_000)
    expect(priya.youOwePaise).toBe(0)
    expect(priya.receivedPaise).toBe(20_000)
    expect(priya.sentPaise).toBe(5_000)
    expect(priya.payments.map((payment) => [payment.direction, payment.amountPaise])).toEqual([
      ['out', 5_000],
      ['in', 20_000],
    ])
    expect(view.theyOwePaise).toBe(70_000)
    expect(view.receivedPaise).toBe(20_000)
    expect(view.sentPaise).toBe(5_000)
  })

  it('splits a person share across multiple people who paid', () => {
    const shared = expense({
      id: 'e_shared',
      amountPaise: 1_00_000,
      payers: [
        { memberId: ME, amountPaise: 60_000 },
        { memberId: PRIYA, amountPaise: 40_000 },
      ],
      split: { mode: 'equal', participants: [ME, PRIYA] },
    })

    const view = buildPayback([shared], [], { meId: ME })
    const priya = view.people.find((person) => person.memberId === PRIYA)!

    // Her ₹500 share was fronted 60% by me; my ₹500 share was fronted 40% by her.
    expect(priya.theyOwe.map((line) => line.amountPaise)).toEqual([30_000])
    expect(priya.youOwe.map((line) => line.amountPaise)).toEqual([20_000])
    expect(priya.theyOwePaise).toBe(30_000)
    expect(priya.youOwePaise).toBe(20_000)
  })

  it('applies the amount filter line by line and drops people with no matching lines', () => {
    const big = expense({ id: 'e_big', description: 'Hotel', amountPaise: 1_00_000 })
    const small = expense({ id: 'e_small', description: 'Chai', amountPaise: 20_000 })

    const view = buildPayback([big, small], [], { meId: ME, filter: 'under300' })
    const priya = view.people.find((person) => person.memberId === PRIYA)!

    expect(priya.theyOwe.map((line) => line.description)).toEqual(['Chai'])
    expect(priya.theyOwePaise).toBe(10_000)
    expect(view.theyOwePaise).toBe(10_000)
    expect(view.expenseCount).toBe(1)

    const empty = buildPayback([big, small], [], { meId: ME, filter: 'over5000' })
    expect(empty.people).toEqual([])
    expect(empty.theyOwePaise).toBe(0)
    expect(empty.expenseCount).toBe(0)
  })

  it('shows payments made directly to you even when the band hides their expenses', () => {
    const big = expense({ id: 'e_big', amountPaise: 1_00_000 })
    const partial = settlement({ amountPaise: 10_000 })

    const all = buildPayback([big], [partial], { meId: ME })
    const priya = all.people.find((person) => person.memberId === PRIYA)!
    expect(priya.theyOwePaise).toBe(50_000)
    expect(priya.receivedPaise).toBe(10_000)

    const banded = buildPayback([big], [partial], { meId: ME, filter: 'under300' })
    expect(banded.people).toEqual([])
  })

  it('lists a person who only has payments when no band is active', () => {
    const payment = settlement({
      from: RAVI,
      to: ME,
      amountPaise: 7_000,
      status: 'pending',
    })

    const view = buildPayback([], [payment], { meId: ME })
    const ravi = view.people.find((person) => person.memberId === RAVI)!

    expect(ravi.theyOwe).toEqual([])
    expect(ravi.youOwe).toEqual([])
    expect(ravi.receivedPaise).toBe(7_000)
    expect(view.people).toHaveLength(1)
  })

  it('ignores deleted expenses, disputed payments and broken splits', () => {
    const deleted = expense({ id: 'e_deleted', deletedAt: BASE_TIME })
    const disputed = settlement({ status: 'disputed' })
    const broken = expense({
      id: 'e_broken',
      split: { mode: 'percent', values: { [ME]: 50, [PRIYA]: 40 } },
    })

    const view = buildPayback([deleted, broken], [disputed], { meId: ME })

    expect(view.people).toEqual([])
    expect(view.theyOwePaise).toBe(0)
    expect(view.receivedPaise).toBe(0)
  })

  it('never treats your own share as money you owe yourself', () => {
    const solo = expense({
      id: 'e_solo',
      split: { mode: 'equal', participants: [ME] },
    })

    const view = buildPayback([solo], [], { meId: ME })

    expect(view.people).toEqual([])
    expect(view.theyOwePaise).toBe(0)
    expect(view.youOwePaise).toBe(0)
  })

  it('does not mutate the expenses or settlements it was given', () => {
    const input = [expense(), expense({ id: 'e_two', amountPaise: 50_000 })]
    const payments = [settlement()]
    const beforeExpenses = structuredClone(input)
    const beforePayments = structuredClone(payments)

    buildPayback(input, payments, { meId: ME, filter: 'between300and1000' })

    expect(input).toEqual(beforeExpenses)
    expect(payments).toEqual(beforePayments)
  })

  it('returns an empty view when there is no current member', () => {
    expect(buildPayback([expense()], [settlement()], { meId: '' })).toEqual({
      people: [],
      theyOwePaise: 0,
      youOwePaise: 0,
      receivedPaise: 0,
      sentPaise: 0,
      expenseCount: 0,
    })
  })
})
