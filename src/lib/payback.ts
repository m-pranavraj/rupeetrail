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
        const otherId =
          portion.memberId === meId
            ? allocation.memberId
            : allocation.memberId === meId
              ? portion.memberId
              : null
        if (!otherId || !amountInFilter(portion.amountPaise, filter)) continue

        const person = personFor(otherId)
        const line: PaybackLine = {
          expenseId: expense.id,
          description: expense.description,
          date: expense.date,
          amountPaise: portion.amountPaise,
        }
        if (portion.memberId === meId) person.theyOwe.push(line)
        else person.youOwe.push(line)
      }
    }
  }

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
