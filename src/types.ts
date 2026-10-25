/**
 * RupeeSplit domain model.
 *
 * Invariant: every monetary amount in this app is an integer number of paise.
 * Rupees only appear at the formatting boundary (see lib/money.ts).
 */

export type MemberId = string
export type GroupId = string
export type ExpenseId = string
export type SettlementId = string

export interface Member {
  id: MemberId
  name: string
  /** UPI id shared with the group so people can actually pay each other */
  upiId?: string
  /** deterministic accent colour index 0..7 */
  color: number
  joinedAt: number
  /** placeholder members can be invited but have not joined yet */
  isPlaceholder?: boolean
  /** removed members stay in history but are excluded from new expenses */
  leftAt?: number
}

export type SplitMode = 'equal' | 'exact' | 'percent' | 'shares'

export interface Split {
  mode: SplitMode
  /** participants for equal mode */
  participants?: MemberId[]
  /** payer-independent weights/amounts keyed by member id */
  values?: Record<MemberId, number>
}

export interface PayerShare {
  memberId: MemberId
  amountPaise: number
}

export type ExpenseCategory =
  | 'food'
  | 'travel'
  | 'stay'
  | 'groceries'
  | 'entertainment'
  | 'utilities'
  | 'shopping'
  | 'other'

export type AckStatus = 'pending' | 'acknowledged' | 'questioned'

export interface Dispute {
  raisedBy: MemberId
  reason: string
  raisedAt: number
  status: 'open' | 'resolved'
  resolution?: string
  resolvedAt?: number
}

export interface Expense {
  id: ExpenseId
  groupId: GroupId
  description: string
  amountPaise: number
  date: number
  category: ExpenseCategory
  payers: PayerShare[]
  split: Split
  notes?: string
  createdBy: MemberId
  createdAt: number
  updatedAt: number
  /** soft delete keeps history intact (PRD: deleted-item recovery) */
  deletedAt?: number
  /** per-member acknowledgement of the record */
  acks: Record<MemberId, AckStatus>
  dispute?: Dispute
  /** revision counter, incremented on every edit */
  revision: number
  /** client-only: this expense is queued on the device and not yet on the server */
  pendingSync?: boolean
}

export type SettlementStatus =
  | 'pending'
  | 'payer_confirmed'
  | 'receiver_confirmed'
  | 'confirmed'
  | 'disputed'

export interface Settlement {
  id: SettlementId
  groupId: GroupId
  from: MemberId
  to: MemberId
  amountPaise: number
  /** how the payment claims to have moved */
  method: 'upi' | 'cash' | 'bank' | 'other'
  status: SettlementStatus
  note?: string
  createdAt: number
  /** last change to status */
  updatedAt: number
  /** staged confirmation flags keep payer/receiver attestations distinct */
  payerConfirmedAt?: number
  receiverConfirmedAt?: number
}

export type GroupStatus = 'active' | 'reconciling' | 'closed'

export interface Group {
  id: GroupId
  name: string
  emoji: string
  status: GroupStatus
  createdAt: number
  closedAt?: number
  members: Member[]
  /** notional group pool contributions — never custody of funds */
  currency: 'INR'
}

export interface Ledger {
  version: 1
  groups: Group[]
  expenses: Expense[]
  settlements: Settlement[]
  /** id of the member acting as "me" on this device */
  currentMemberId?: MemberId
}

/** A single line explaining part of a member's net position. */
export interface BalanceEntry {
  kind: 'paid' | 'share' | 'settlement-in' | 'settlement-out'
  label: string
  /** signed effect on this member's net position, in paise */
  amountPaise: number
  refId: string
  date: number
}

export interface MemberBalance {
  memberId: MemberId
  /** positive = is owed money, negative = owes money */
  netPaise: number
  entries: BalanceEntry[]
  paidPaise: number
  sharePaise: number
  settledInPaise: number
  settledOutPaise: number
}

export interface Transfer {
  from: MemberId
  to: MemberId
  amountPaise: number
}

export interface SettlementPlan {
  transfers: Transfer[]
  /** true when the plan provably uses the minimum number of transfers */
  minimal: boolean
  notes: string[]
}
