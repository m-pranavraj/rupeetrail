import type {
  Expense,
  ExpenseId,
  MemberId,
  PayerShare,
  Settlement,
  SettlementId,
} from '../types'
import { allocateSplit } from './splits'

export type PaybackFilter =
  | 'all'
  | 'under300'
  | 'between300and1000'
  | 'between1000and5000'
  | 'over5000'

export interface PaybackFilterOption {
  id: PaybackFilter
  label: string
  minPaise: number
  maxPaise: number | null
}

export const PAYBACK_FILTERS: readonly PaybackFilterOption[] = [
  { id: 'all', label: 'All amounts', minPaise: 0, maxPaise: null },
  { id: 'under300', label: 'Under ₹300', minPaise: 0, maxPaise: 30_000 },
  { id: 'between300and1000', label: '₹300 – ₹1,000', minPaise: 30_000, maxPaise: 1_00_000 },
  { id: 'between1000and5000', label: '₹1,000 – ₹5,000', minPaise: 1_00_000, maxPaise: 5_00_000 },
  { id: 'over5000', label: 'Over ₹5,000', minPaise: 5_00_000, maxPaise: null },
]

export function amountInFilter(amountPaise: number, filter: PaybackFilter): boolean {
  const option = PAYBACK_FILTERS.find((entry) => entry.id === filter) ?? PAYBACK_FILTERS[0]
  if (amountPaise < option.minPaise) return false
  return option.maxPaise === null || amountPaise < option.maxPaise
}

/** One expense contribution that explains part of a person's total. */
export interface PaybackLine {
  expenseId: ExpenseId
  description: string
  date: number
  amountPaise: number
}

/** Money that already moved between you and this person. Never subtracted. */
export interface PaybackPayment {
  settlementId: SettlementId
  date: number
  amountPaise: number
  /** in = they paid you, out = you paid them */
  direction: 'in' | 'out'
}

export interface PaybackPerson {
  memberId: MemberId
  /** Expenses you paid, in full or in part, for this person. */
  theyOwe: PaybackLine[]
  /** Expenses this person paid, in full or in part, for you. */
  youOwe: PaybackLine[]
  theyOwePaise: number
  youOwePaise: number
  payments: PaybackPayment[]
  receivedPaise: number
  sentPaise: number
}

export interface PaybackView {
  people: PaybackPerson[]
  theyOwePaise: number
  youOwePaise: number
  receivedPaise: number
  sentPaise: number
  /** Distinct expenses visible under the current amount band. */
  expenseCount: number
}

/** One gross amount one person owes another, added up across expenses. */
export interface DuesPair {
  /** The person who consumed a share without fronting the money. */
  fromId: MemberId
  /** The person who actually paid for that share. */
  toId: MemberId
  amountPaise: number
  expenseCount: number
}

export interface DuesEdge {
  /** The other person in the pair. */
  memberId: MemberId
  amountPaise: number
  expenseCount: number
}

export interface DuesMember {
  memberId: MemberId
  /** People this member owes, largest first. */
  owes: DuesEdge[]
  /** People who owe this member, largest first. */
  owedBy: DuesEdge[]
  owesPaise: number
  owedByPaise: number
  /** Distinct expenses behind any edge involving this person. */
  expenseCount: number
}

export interface GroupDues {
  members: DuesMember[]
  pairs: DuesPair[]
  totalPaise: number
  pairCount: number
  expenseCount: number
}

/** One person's share of one expense, attributed to one person who paid. */
interface ExpenseDebt {
  expenseId: ExpenseId
  description: string
  date: number
  fromId: MemberId
  toId: MemberId
  amountPaise: number
}

/** Split one person's share across the people who actually fronted the money. */
function attributeShare(
  sharePaise: number,
  payers: PayerShare[],
): Array<{ memberId: MemberId; amountPaise: number }> {
  const paidTotal = payers.reduce((sum, payer) => sum + payer.amountPaise, 0)
  if (sharePaise <= 0 || paidTotal <= 0) return []

  const raw = payers.map((payer) => (sharePaise * payer.amountPaise) / paidTotal)
  const amounts = raw.map((value) => Math.floor(value))
  let remainder = sharePaise - amounts.reduce((sum, value) => sum + value, 0)

  const byFraction = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort(
      (a, b) =>
        b.fraction - a.fraction ||
        payers[a.index].memberId.localeCompare(payers[b.index].memberId),
    )
  for (let i = 0; i < byFraction.length && remainder > 0; i += 1) {
    amounts[byFraction[i].index] += 1
    remainder -= 1
  }

  return payers.map((payer, index) => ({
    memberId: payer.memberId,
    amountPaise: amounts[index],
  }))
}

/**
 * Walk every valid expense and report each portion of a share that one person
 * fronted for another. This is the single source of gross pairwise debt; both
 * the per-person ledger and the group dues table read from it.
 */
function forEachExpenseDebt(expenses: Expense[], onDebt: (debt: ExpenseDebt) => void): void {
  for (const expense of expenses) {
    if (expense.deletedAt || expense.amountPaise <= 0) continue
    const payers = expense.payers.filter((payer) => payer.amountPaise > 0)
    if (payers.length === 0) continue

    let allocations
    try {
      allocations = allocateSplit(expense.amountPaise, expense.split)
    } catch {
      continue
    }

    for (const allocation of allocations) {
      if (allocation.amountPaise <= 0) continue
      for (const portion of attributeShare(allocation.amountPaise, payers)) {
        if (portion.amountPaise <= 0 || portion.memberId === allocation.memberId) continue
        onDebt({
          expenseId: expense.id,
          description: expense.description,
          date: expense.date,
          fromId: allocation.memberId,
          toId: portion.memberId,
          amountPaise: portion.amountPaise,
        })
      }
    }
  }
}

/**
 * Turn the shared ledger into a person-by-person view of what every expense
 * actually cost each person. Totals are gross: every expense is listed and
 * recorded payments are shown separately, never subtracted. The only amount
 * filter is the one applied to each expense line.
 */
export function buildPayback(
  expenses: Expense[],
  settlements: Settlement[],
  options: { meId: MemberId; filter?: PaybackFilter },
): PaybackView {
  const { meId, filter = 'all' } = options
  const empty: PaybackView = {
    people: [],
    theyOwePaise: 0,
    youOwePaise: 0,
    receivedPaise: 0,
    sentPaise: 0,
    expenseCount: 0,
  }
  if (!meId) return empty

  const byMember = new Map<MemberId, PaybackPerson>()
  const personFor = (memberId: MemberId): PaybackPerson => {
    const existing = byMember.get(memberId)
    if (existing) return existing
    const created: PaybackPerson = {
      memberId,
      theyOwe: [],
      youOwe: [],
      theyOwePaise: 0,
      youOwePaise: 0,
      payments: [],
      receivedPaise: 0,
      sentPaise: 0,
    }
    byMember.set(memberId, created)
    return created
  }

  forEachExpenseDebt(expenses, (debt) => {
    const otherId =
      debt.toId === meId ? debt.fromId : debt.fromId === meId ? debt.toId : null
    if (!otherId || !amountInFilter(debt.amountPaise, filter)) return

    const person = personFor(otherId)
    const line: PaybackLine = {
      expenseId: debt.expenseId,
      description: debt.description,
      date: debt.date,
      amountPaise: debt.amountPaise,
    }
    if (debt.toId === meId) person.theyOwe.push(line)
    else person.youOwe.push(line)
  })

  for (const payment of settlements) {
    if (payment.status === 'disputed' || payment.amountPaise <= 0) continue
    if (payment.from === meId && payment.to === meId) continue
    const otherId =
      payment.to === meId ? payment.from : payment.from === meId ? payment.to : null
    if (!otherId) continue

    personFor(otherId).payments.push({
      settlementId: payment.id,
      date: payment.updatedAt || payment.createdAt,
      amountPaise: payment.amountPaise,
      direction: payment.to === meId ? 'in' : 'out',
    })
  }

  const visible = [...byMember.values()].filter(
    (person) => filter === 'all' || person.theyOwe.length + person.youOwe.length > 0,
  )

  const expenseIds = new Set<ExpenseId>()
  for (const person of visible) {
    person.theyOwe.sort((a, b) => b.date - a.date || a.expenseId.localeCompare(b.expenseId))
    person.youOwe.sort((a, b) => b.date - a.date || a.expenseId.localeCompare(b.expenseId))
    person.payments.sort(
      (a, b) => b.date - a.date || a.settlementId.localeCompare(b.settlementId),
    )
    person.theyOwePaise = person.theyOwe.reduce((sum, line) => sum + line.amountPaise, 0)
    person.youOwePaise = person.youOwe.reduce((sum, line) => sum + line.amountPaise, 0)
    person.receivedPaise = person.payments
      .filter((payment) => payment.direction === 'in')
      .reduce((sum, payment) => sum + payment.amountPaise, 0)
    person.sentPaise = person.payments
      .filter((payment) => payment.direction === 'out')
      .reduce((sum, payment) => sum + payment.amountPaise, 0)
    for (const line of [...person.theyOwe, ...person.youOwe]) expenseIds.add(line.expenseId)
  }

  visible.sort(
    (a, b) =>
      b.theyOwePaise + b.youOwePaise - (a.theyOwePaise + a.youOwePaise) ||
      a.memberId.localeCompare(b.memberId),
  )

  return {
    people: visible,
    theyOwePaise: visible.reduce((sum, person) => sum + person.theyOwePaise, 0),
    youOwePaise: visible.reduce((sum, person) => sum + person.youOwePaise, 0),
    receivedPaise: visible.reduce((sum, person) => sum + person.receivedPaise, 0),
    sentPaise: visible.reduce((sum, person) => sum + person.sentPaise, 0),
    expenseCount: expenseIds.size,
  }
}

/**
 * Every gross amount owed between every pair of people, from expenses only.
 * Payments are deliberately not an input: the dues table never shrinks when
 * someone pays part of a share. Pass memberIds to include people with no dues.
 */
export function buildGroupDues(
  expenses: Expense[],
  options: { memberIds?: MemberId[] } = {},
): GroupDues {
  interface PairAccumulator {
    fromId: MemberId
    toId: MemberId
    amountPaise: number
    expenseIds: Set<ExpenseId>
  }

  const byPair = new Map<string, PairAccumulator>()
  const allExpenseIds = new Set<ExpenseId>()
  const pairKey = (fromId: MemberId, toId: MemberId) => `${fromId}\u0000${toId}`

  forEachExpenseDebt(expenses, (debt) => {
    const key = pairKey(debt.fromId, debt.toId)
    const existing = byPair.get(key)
    if (existing) {
      existing.amountPaise += debt.amountPaise
      existing.expenseIds.add(debt.expenseId)
    } else {
      byPair.set(key, {
        fromId: debt.fromId,
        toId: debt.toId,
        amountPaise: debt.amountPaise,
        expenseIds: new Set([debt.expenseId]),
      })
    }
    allExpenseIds.add(debt.expenseId)
  })

  const pairs: DuesPair[] = [...byPair.values()]
    .map((pair) => ({
      fromId: pair.fromId,
      toId: pair.toId,
      amountPaise: pair.amountPaise,
      expenseCount: pair.expenseIds.size,
    }))
    .sort(
      (a, b) =>
        b.amountPaise - a.amountPaise ||
        a.fromId.localeCompare(b.fromId) ||
        a.toId.localeCompare(b.toId),
    )

  const memberIds = new Set<MemberId>(options.memberIds ?? [])
  for (const pair of pairs) {
    memberIds.add(pair.fromId)
    memberIds.add(pair.toId)
  }

  const members = new Map<MemberId, DuesMember & { expenseIds: Set<ExpenseId> }>()
  for (const memberId of memberIds) {
    members.set(memberId, {
      memberId,
      owes: [],
      owedBy: [],
      owesPaise: 0,
      owedByPaise: 0,
      expenseCount: 0,
      expenseIds: new Set(),
    })
  }

  for (const pair of pairs) {
    const from = members.get(pair.fromId)!
    const to = members.get(pair.toId)!
    from.owes.push({
      memberId: pair.toId,
      amountPaise: pair.amountPaise,
      expenseCount: pair.expenseCount,
    })
    to.owedBy.push({
      memberId: pair.fromId,
      amountPaise: pair.amountPaise,
      expenseCount: pair.expenseCount,
    })
    from.owesPaise += pair.amountPaise
    to.owedByPaise += pair.amountPaise
    for (const expenseId of byPair.get(pairKey(pair.fromId, pair.toId))!.expenseIds) {
      from.expenseIds.add(expenseId)
      to.expenseIds.add(expenseId)
    }
  }

  const sortedMembers: DuesMember[] = [...members.values()].map((member) => {
    member.owes.sort(
      (a, b) => b.amountPaise - a.amountPaise || a.memberId.localeCompare(b.memberId),
    )
    member.owedBy.sort(
      (a, b) => b.amountPaise - a.amountPaise || a.memberId.localeCompare(b.memberId),
    )
    return {
      memberId: member.memberId,
      owes: member.owes,
      owedBy: member.owedBy,
      owesPaise: member.owesPaise,
      owedByPaise: member.owedByPaise,
      expenseCount: member.expenseIds.size,
    }
  })
  sortedMembers.sort(
    (a, b) =>
      b.owesPaise + b.owedByPaise - (a.owesPaise + a.owedByPaise) ||
      a.memberId.localeCompare(b.memberId),
  )

  return {
    members: sortedMembers,
    pairs,
    totalPaise: pairs.reduce((sum, pair) => sum + pair.amountPaise, 0),
    pairCount: pairs.length,
    expenseCount: allExpenseIds.size,
  }
}
