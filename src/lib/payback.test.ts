import { describe, expect, it } from 'vitest'
import type { Transfer } from '../types'
import { amountInFilter, buildPayback, PAYBACK_FILTERS } from './payback'

const transfers: Transfer[] = [
  { from: 'priya', to: 'arjun', amountPaise: 50_000 },
  { from: 'ravi', to: 'arjun', amountPaise: 20_000 },
  { from: 'arjun', to: 'meera', amountPaise: 35_000 },
  { from: 'priya', to: 'meera', amountPaise: 5_000 },
]

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
  it('lists money coming in and going out for every person involved', () => {
    const view = buildPayback(transfers)

    expect(view.transfers).toHaveLength(4)
    expect(view.totalPaise).toBe(1_10_000)
    expect(view.people).toHaveLength(4)

    const arjun = view.people.find((person) => person.memberId === 'arjun')!
    expect(arjun.incoming.map((transfer) => transfer.amountPaise)).toEqual([50_000, 20_000])
    expect(arjun.outgoing.map((transfer) => transfer.amountPaise)).toEqual([35_000])
    expect(arjun.incomingPaise).toBe(70_000)
    expect(arjun.outgoingPaise).toBe(35_000)

    const priya = view.people.find((person) => person.memberId === 'priya')!
    expect(priya.incoming).toEqual([])
    expect(priya.outgoing.map((transfer) => transfer.amountPaise)).toEqual([50_000, 5_000])
    expect(priya.outgoingPaise).toBe(55_000)

    const meera = view.people.find((person) => person.memberId === 'meera')!
    expect(meera.incomingPaise).toBe(40_000)
    expect(meera.outgoingPaise).toBe(0)
  })

  it('puts the priority member first and orders everyone else by money moved', () => {
    const view = buildPayback(transfers, { priorityMember: 'meera' })
    expect(view.people.map((person) => person.memberId)).toEqual([
      'meera',
      'arjun',
      'priya',
      'ravi',
    ])
  })

  it('applies an amount filter and drops people with no matching lines', () => {
    const view = buildPayback(transfers, { filter: 'under300' })

    expect(view.transfers.map((transfer) => transfer.amountPaise).sort((a, b) => a - b)).toEqual([
      5_000,
      20_000,
    ])
    expect(view.totalPaise).toBe(25_000)
    expect(view.people.map((person) => person.memberId).sort()).toEqual([
      'arjun',
      'meera',
      'priya',
      'ravi',
    ])
    expect(view.people.every((person) => person.incoming.length + person.outgoing.length > 0)).toBe(true)

    const empty = buildPayback(transfers, { filter: 'over5000' })
    expect(empty.people).toEqual([])
    expect(empty.transfers).toEqual([])
    expect(empty.totalPaise).toBe(0)
  })

  it('keeps only transfers touching one person', () => {
    const view = buildPayback(transfers, { onlyMember: 'arjun' })

    expect(view.totalPaise).toBe(1_05_000)
    expect(view.transfers.every((transfer) => transfer.from === 'arjun' || transfer.to === 'arjun')).toBe(true)

    const arjun = view.people.find((person) => person.memberId === 'arjun')!
    expect(arjun.incomingPaise).toBe(70_000)
    expect(arjun.outgoingPaise).toBe(35_000)

    const meera = view.people.find((person) => person.memberId === 'meera')!
    expect(meera.incomingPaise).toBe(35_000)
    expect(meera.outgoingPaise).toBe(0)
  })

  it('does not mutate the transfers it was given', () => {
    const input: Transfer[] = transfers.map((transfer) => ({ ...transfer }))
    const before = input.map((transfer) => ({ ...transfer }))

    buildPayback(input, { filter: 'between300and1000', priorityMember: 'arjun' })

    expect(input).toEqual(before)
  })

  it('returns an empty view when nobody needs to move money', () => {
    expect(buildPayback([])).toEqual({ transfers: [], people: [], totalPaise: 0 })
  })
})
