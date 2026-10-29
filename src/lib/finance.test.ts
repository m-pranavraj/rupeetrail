import { describe, expect, it } from 'vitest'
import { allocateSplit, allocationTotal, SplitError } from './splits'
import { computeBalances, isReconciled } from './balances'
import { planSettlements } from './settlement'
import type { Expense, Group, Settlement } from '../types'

function group(memberIds: string[]): Group {
  return {
    id: 'g',
    name: 'Test',
    emoji: '🧪',
    status: 'active',
    createdAt: 0,
    currency: 'INR',
    members: memberIds.map((id, i) => ({ id, name: id, color: i, joinedAt: 0 })),
  }
}

function expense(partial: Partial<Expense> & Pick<Expense, 'amountPaise' | 'payers' | 'split'>): Expense {
  return {
    id: 'e1',
    groupId: 'g',
    description: 'Test expense',
    date: 0,
    category: 'other',
    createdBy: 'a',
    createdAt: 0,
    updatedAt: 0,
    acks: {},
    revision: 1,
    ...partial,
  }
}

describe('equal split', () => {
  it('splits three ways with paise remainder going somewhere', () => {
    const alloc = allocateSplit(100, { mode: 'equal', participants: ['a', 'b', 'c'] })
    expect(allocationTotal(alloc)).toBe(100)
    expect(alloc.map((a) => a.amountPaise).sort((x, y) => y - x)).toEqual([34, 33, 33])
  })

  it('is deterministic for the same input', () => {
    const first = allocateSplit(1001, { mode: 'equal', participants: ['c', 'a', 'b'] })
    const second = allocateSplit(1001, { mode: 'equal', participants: ['c', 'a', 'b'] })
    expect(first).toEqual(second)
  })

  it('handles a single participant', () => {
    expect(allocateSplit(999, { mode: 'equal', participants: ['a'] })).toEqual([
      { memberId: 'a', amountPaise: 999 },
    ])
  })

  it('rejects an empty participant list', () => {
    expect(() => allocateSplit(100, { mode: 'equal', participants: [] })).toThrow(SplitError)
  })
})

describe('exact split', () => {
  it('accepts shares that sum to the total', () => {
    const alloc = allocateSplit(1000, { mode: 'exact', values: { a: 250, b: 750 } })
    expect(alloc).toEqual([
      { memberId: 'a', amountPaise: 250 },
      { memberId: 'b', amountPaise: 750 },
    ])
  })

  describe('manual settlements', () => {
    it('reduces the real member balance immediately when the counterparty is manual', () => {
      const balances = computeBalances({
        group: group(['me', 'other']),
        expenses: [
          expense({
            amountPaise: 50000,
            payers: [{ memberId: 'me', amountPaise: 50000 }],
            split: { mode: 'equal', participants: ['other'] },
          }),
        ],
        settlements: [
          {
            id: 's1',
            groupId: 'g',
            from: 'manual:from:rajesh',
            to: 'me',
            amountPaise: 50000,
            method: 'cash',
            status: 'receiver_confirmed',
            createdAt: 1,
            updatedAt: 1,
            receiverConfirmedAt: 1,
          },
        ],
      })

      expect(balances.find((balance) => balance.memberId === 'me')?.netPaise).toBe(0)
      expect(isReconciled(balances)).toBe(true)
    })
  })

  it('rejects shares that do not sum to the total', () => {
    expect(() => allocateSplit(1000, { mode: 'exact', values: { a: 250, b: 700 } })).toThrow(
      /under by ₹0\.50/,
    )
  })

  it('rejects negative shares', () => {
    expect(() => allocateSplit(100, { mode: 'exact', values: { a: -100, b: 200 } })).toThrow(
      /negative/,
    )
  })
})

describe('percent split', () => {
  it('allocates exactly and shares the remainder', () => {
    const alloc = allocateSplit(1000, { mode: 'percent', values: { a: 33.33, b: 33.33, c: 33.34 } })
    expect(allocationTotal(alloc)).toBe(1000)
  })

  it('rejects percentages that do not total 100', () => {
    expect(() => allocateSplit(1000, { mode: 'percent', values: { a: 50, b: 40 } })).toThrow(
      /must total 100%/,
    )
  })
})

describe('shares split', () => {
  it('weights by share count and stays exact', () => {
    const alloc = allocateSplit(700, { mode: 'shares', values: { a: 2, b: 3, c: 2 } })
    expect(alloc).toEqual([
      { memberId: 'a', amountPaise: 200 },
      { memberId: 'b', amountPaise: 300 },
      { memberId: 'c', amountPaise: 200 },
    ])
    expect(allocationTotal(alloc)).toBe(700)
  })
})

describe('balances', () => {
  it('credits payers and debits participants, and reconciles to zero', () => {
    const g = group(['a', 'b', 'c'])
    const e = expense({
      amountPaise: 300,
      payers: [{ memberId: 'a', amountPaise: 300 }],
      split: { mode: 'equal', participants: ['a', 'b', 'c'] },
    })
    const balances = computeBalances({ group: g, expenses: [e], settlements: [] })
    expect(isReconciled(balances)).toBe(true)
    expect(balances.find((b) => b.memberId === 'a')?.netPaise).toBe(200)
    expect(balances.find((b) => b.memberId === 'b')?.netPaise).toBe(-100)
    expect(balances.find((b) => b.memberId === 'c')?.netPaise).toBe(-100)
  })

  it('supports multiple payers on one bill', () => {
    const g = group(['a', 'b'])
    const e = expense({
      amountPaise: 1000,
      payers: [
        { memberId: 'a', amountPaise: 600 },
        { memberId: 'b', amountPaise: 400 },
      ],
      split: { mode: 'equal', participants: ['a', 'b'] },
    })
    const balances = computeBalances({ group: g, expenses: [e], settlements: [] })
    expect(balances.find((b) => b.memberId === 'a')?.netPaise).toBe(100)
    expect(balances.find((b) => b.memberId === 'b')?.netPaise).toBe(-100)
  })

  it('applies a recorded settlement immediately, before either side confirms', () => {
    const g = group(['a', 'b'])
    const e = expense({
      amountPaise: 100,
      payers: [{ memberId: 'a', amountPaise: 100 }],
      split: { mode: 'equal', participants: ['a', 'b'] },
    })
    const pending: Settlement = {
      id: 's1',
      groupId: 'g',
      from: 'b',
      to: 'a',
      amountPaise: 50,
      method: 'upi',
      status: 'pending',
      createdAt: 0,
      updatedAt: 0,
    }
    const after = computeBalances({ group: g, expenses: [e], settlements: [pending] })
    expect(after.find((b) => b.memberId === 'b')?.netPaise).toBe(0)
    expect(after.find((b) => b.memberId === 'a')?.netPaise).toBe(0)
    expect(isReconciled(after)).toBe(true)
  })

  it('reverses a settlement that has been disputed', () => {
    const g = group(['a', 'b'])
    const e = expense({
      amountPaise: 100,
      payers: [{ memberId: 'a', amountPaise: 100 }],
      split: { mode: 'equal', participants: ['a', 'b'] },
    })
    const disputed: Settlement = {
      id: 's1',
      groupId: 'g',
      from: 'b',
      to: 'a',
      amountPaise: 50,
      method: 'upi',
      status: 'disputed',
      createdAt: 0,
      updatedAt: 0,
    }
    const balances = computeBalances({ group: g, expenses: [e], settlements: [disputed] })
    expect(balances.find((b) => b.memberId === 'b')?.netPaise).toBe(-50)
    expect(balances.find((b) => b.memberId === 'a')?.netPaise).toBe(50)
  })

  it('ignores soft-deleted expenses', () => {
    const g = group(['a', 'b'])
    const e = expense({
      amountPaise: 100,
      payers: [{ memberId: 'a', amountPaise: 100 }],
      split: { mode: 'equal', participants: ['a', 'b'] },
      deletedAt: 1,
    })
    const balances = computeBalances({ group: g, expenses: [e], settlements: [] })
    expect(balances.every((b) => b.netPaise === 0)).toBe(true)
  })
})

describe('settlement planner', () => {
  it('settles a simple two-person debt', () => {
    const g = group(['a', 'b'])
    const e = expense({
      amountPaise: 100,
      payers: [{ memberId: 'a', amountPaise: 100 }],
      split: { mode: 'equal', participants: ['a', 'b'] },
    })
    const balances = computeBalances({ group: g, expenses: [e], settlements: [] })
    const plan = planSettlements(balances)
    expect(plan.transfers).toEqual([{ from: 'b', to: 'a', amountPaise: 50 }])
    expect(plan.minimal).toBe(true)
  })

  it('uses at most n-1 transfers for a chain', () => {
    const g = group(['a', 'b', 'c', 'd'])
    const e = expense({
      amountPaise: 400,
      payers: [{ memberId: 'a', amountPaise: 400 }],
      split: { mode: 'equal', participants: ['a', 'b', 'c', 'd'] },
    })
    const balances = computeBalances({ group: g, expenses: [e], settlements: [] })
    const plan = planSettlements(balances)
    expect(plan.transfers.length).toBeLessThanOrEqual(3)
    // all transfers conserve value
    const total = plan.transfers.reduce((s, t) => s + t.amountPaise, 0)
    expect(total).toBe(300)
  })

  it('reports nothing to do when everyone is settled', () => {
    const g = group(['a', 'b'])
    const balances = computeBalances({ group: g, expenses: [], settlements: [] })
    const plan = planSettlements(balances)
    expect(plan.transfers).toEqual([])
    expect(plan.notes.join(' ')).toMatch(/settled up/i)
  })
})
