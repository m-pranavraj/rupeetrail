import type { MemberId, Split } from '../types'

export interface Allocation {
  memberId: MemberId
  amountPaise: number
}

export class SplitError extends Error {}

/**
 * Distribute `totalPaise` across ordered members proportionally to `weights`,
 * with a deterministic largest-remainder pass so the output always sums
 * exactly to totalPaise.
 */
function distribute(totalPaise: number, weights: number[], order: MemberId[]): number[] {
  const weightSum = weights.reduce((a, b) => a + b, 0)
  if (weightSum <= 0) throw new SplitError('Split weights must total more than zero.')

  const raw = weights.map((w) => (totalPaise * w) / weightSum)
  const floors = raw.map((v) => Math.floor(v))
  let remainder = totalPaise - floors.reduce((a, b) => a + b, 0)

  // Hand out leftover paise to the largest fractional parts; ties break by
  // member id so the result is stable across devices (PRD: explainable).
  const indices = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || order[a.i].localeCompare(order[b.i]))

  const result = floors.slice()
  for (let k = 0; k < indices.length && remainder > 0; k += 1) {
    result[indices[k].i] += 1
    remainder -= 1
  }
  return result
}

/**
 * Resolve a split into concrete per-member amounts.
 * Throws SplitError with a user-showable message when the definition is invalid.
 */
export function allocateSplit(expenseAmountPaise: number, split: Split): Allocation[] {
  if (!Number.isInteger(expenseAmountPaise) || expenseAmountPaise < 0) {
    throw new SplitError('Expense amount must be a positive whole number of paise.')
  }
  if (expenseAmountPaise === 0) {
    throw new SplitError('Expense amount must be greater than zero.')
  }

  if (split.mode === 'equal') {
    const parts = split.participants ?? []
    if (parts.length === 0) throw new SplitError('Pick at least one person to share this expense.')
    const unique = [...new Set(parts)]
    const amounts = distribute(
      expenseAmountPaise,
      unique.map(() => 1),
      unique,
    )
    return unique.map((memberId, i) => ({ memberId, amountPaise: amounts[i] }))
  }

  const values = split.values ?? {}
  const ids = Object.keys(values).sort((a, b) => a.localeCompare(b))

  if (split.mode === 'exact') {
    const entries = ids
      .map((memberId) => ({ memberId, amountPaise: Math.round(values[memberId]) }))
      .filter((e) => e.amountPaise !== 0)
    if (entries.length === 0) throw new SplitError('Enter at least one share amount.')
    const total = entries.reduce((sum, e) => sum + e.amountPaise, 0)
    if (entries.some((e) => e.amountPaise < 0)) throw new SplitError('Shares cannot be negative.')
    if (total !== expenseAmountPaise) {
      const diff = expenseAmountPaise - total
      const verb = diff > 0 ? 'under' : 'over'
      throw new SplitError(
        `Exact shares are ${verb} by ₹${(Math.abs(diff) / 100).toFixed(2)}. They must add up to the total.`,
      )
    }
    return entries
  }

  if (split.mode === 'percent') {
    const entries = ids
      .map((memberId) => ({ memberId, pct: values[memberId] }))
      .filter((e) => e.pct > 0)
    if (entries.length === 0) throw new SplitError('Give at least one person a percentage.')
    const pctTotal = entries.reduce((sum, e) => sum + e.pct, 0)
    if (Math.abs(pctTotal - 100) > 0.001) {
      throw new SplitError(`Percentages add up to ${round2(pctTotal)}% and must total 100%.`)
    }
    const order = entries.map((e) => e.memberId)
    const amounts = distribute(
      expenseAmountPaise,
      entries.map((e) => e.pct),
      order,
    )
    return order.map((memberId, i) => ({ memberId, amountPaise: amounts[i] }))
  }

  // shares
  const entries = ids
    .map((memberId) => ({ memberId, weight: values[memberId] }))
    .filter((e) => e.weight > 0)
  if (entries.length === 0) throw new SplitError('Give at least one person a share weight.')
  const order = entries.map((e) => e.memberId)
  const amounts = distribute(
    expenseAmountPaise,
    entries.map((e) => e.weight),
    order,
  )
  return order.map((memberId, i) => ({ memberId, amountPaise: amounts[i] }))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Convenience: total of an allocation list (used by tests and validation). */
export function allocationTotal(allocations: Allocation[]): number {
  return allocations.reduce((sum, a) => sum + a.amountPaise, 0)
}
