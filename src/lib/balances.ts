import type {
  BalanceEntry,
  Expense,
  Group,
  MemberBalance,
  MemberId,
  Settlement,
} from '../types'
import { allocateSplit } from './splits'

interface BalanceInput {
  group: Group
  expenses: Expense[]
  settlements: Settlement[]
}

/**
 * Compute each member's net position.
 *
 * net = (what they paid) - (their share of expenses)
 *       + (settlements they sent) - (settlements they received)
 *
 * A positive net means the group owes that member money.
 */
export function computeBalances({ group, expenses, settlements }: BalanceInput): MemberBalance[] {
  const members = group.members
  const byId = new Map<MemberId, MemberBalance>()
  for (const m of members) {
    byId.set(m.id, {
      memberId: m.id,
      netPaise: 0,
      entries: [],
      paidPaise: 0,
      sharePaise: 0,
      settledInPaise: 0,
      settledOutPaise: 0,
    })
  }

  const live = expenses.filter((e) => !e.deletedAt && e.amountPaise > 0)

  for (const expense of live) {
    // Credits: money each payer put in.
    for (const payer of expense.payers) {
      const bal = byId.get(payer.memberId)
      if (!bal || payer.amountPaise === 0) continue
      bal.paidPaise += payer.amountPaise
      bal.netPaise += payer.amountPaise
      bal.entries.push({
        kind: 'paid',
        label: `Paid for “${expense.description}”`,
        amountPaise: payer.amountPaise,
        refId: expense.id,
        date: expense.date,
      })
    }

    // Debits: each participant's allocated share.
    let allocations
    try {
      allocations = allocateSplit(expense.amountPaise, expense.split)
    } catch {
      // A corrupt split must not silently disappear; skip debits for it so the
      // reconciliation screen can surface the problem instead of lying.
      continue
    }
    for (const alloc of allocations) {
      const bal = byId.get(alloc.memberId)
      if (!bal || alloc.amountPaise === 0) continue
      bal.sharePaise += alloc.amountPaise
      bal.netPaise -= alloc.amountPaise
      bal.entries.push({
        kind: 'share',
        label: `Your share of “${expense.description}”`,
        amountPaise: -alloc.amountPaise,
        refId: expense.id,
        date: expense.date,
      })
    }
  }

  // Settlements only count once both sides (or a provider) attest.
  for (const s of settlements) {
    if (s.status !== 'confirmed') continue
    const from = byId.get(s.from)
    const to = byId.get(s.to)
    if (!from || !to) continue
    from.settledOutPaise += s.amountPaise
    from.netPaise += s.amountPaise
    from.entries.push({
      kind: 'settlement-out',
      label: `Paid ${nameOf(group, s.to)}`,
      amountPaise: s.amountPaise,
      refId: s.id,
      date: s.updatedAt,
    })
    to.settledInPaise += s.amountPaise
    to.netPaise -= s.amountPaise
    to.entries.push({
      kind: 'settlement-in',
      label: `Received from ${nameOf(group, s.from)}`,
      amountPaise: -s.amountPaise,
      refId: s.id,
      date: s.updatedAt,
    })
  }

  for (const bal of byId.values()) {
    bal.entries.sort((a, b) => b.date - a.date)
  }
  return members.map((m) => byId.get(m.id)!)
}

/** Total of all nets must be zero — the core reconciliation invariant. */
export function isReconciled(balances: MemberBalance[]): boolean {
  return balances.reduce((sum, b) => sum + b.netPaise, 0) === 0
}

export function nameOf(group: Group, memberId: MemberId): string {
  return group.members.find((m) => m.id === memberId)?.name ?? 'Removed member'
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

/** Signed label used on balance chips. */
export function balanceVerb(netPaise: number): 'gets back' | 'owes' | 'settled' {
  if (netPaise > 0) return 'gets back'
  if (netPaise < 0) return 'owes'
  return 'settled'
}
