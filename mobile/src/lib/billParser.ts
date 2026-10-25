/** Turn structured extractions into the app's expense model. */
import type { Expense, PayerShare, Split } from './types'
import { allocateSplit } from './splits'
import { inferCategory, type ParsedReceipt } from './receipt'
import type { ParsedVoice } from './voice'

function money(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`
}

function describeReceipt(receipt: ParsedReceipt): string {
  if (receipt.merchant) return receipt.merchant.slice(0, 80)
  const named = receipt.items
    .slice(0, 2)
    .map((item) => item.name)
    .filter(Boolean)
  if (named.length > 0) return named.join(', ').slice(0, 80)
  return 'Scanned bill'
}

function receiptNotes(receipt: ParsedReceipt): string | undefined {
  const parts: string[] = []
  for (const item of receipt.items.slice(0, 12)) {
    const qty = item.quantity > 1 ? `${item.quantity} × ` : ''
    parts.push(`${item.name} ${qty}${money(item.amountPaise)}`)
  }
  if (receipt.discountPaise > 0) parts.push(`Discount −${money(receipt.discountPaise)}`)
  for (const tax of receipt.taxes) {
    const rate = tax.rate !== undefined ? ` ${tax.rate}%` : ''
    parts.push(`${tax.label}${rate} ${money(tax.amountPaise)}`)
  }
  if (receipt.warnings.length > 0) parts.push(`Check: ${receipt.warnings[0]}`)
  const note = parts.join(' · ')
  return note ? note.slice(0, 400) : undefined
}

/**
 * Build a draft expense from a scanned receipt.
 * The recorder pays the bill; the split is equal across the group.
 */
export function buildExpenseFromReceipt(
  receipt: ParsedReceipt,
  payerMemberId: string,
  allMemberIds: Set<string>,
): Partial<Expense> {
  const participants = [...allMemberIds]
  const totalPaise = receipt.totalPaise > 0 ? receipt.totalPaise : receipt.subtotalPaise
  const split: Split = { mode: 'equal', participants }

  let usable = false
  if (totalPaise > 0 && participants.length > 0) {
    try {
      allocateSplit(totalPaise, split)
      usable = true
    } catch {
      usable = false
    }
  }

  const payers: PayerShare[] = [{ memberId: payerMemberId, amountPaise: totalPaise }]
  const now = Date.now()
  const searchText = [receipt.merchant ?? '', ...receipt.items.map((item) => item.name)].join(' ')

  return {
    groupId: '',
    description: describeReceipt(receipt),
    amountPaise: usable ? totalPaise : 0,
    date: now,
    category: inferCategory(searchText),
    payers,
    split,
    notes: receiptNotes(receipt),
    createdBy: payerMemberId,
    createdAt: now,
    updatedAt: now,
    acks: {},
    revision: 1,
  }
}

/**
 * Build a draft expense from a dictated split.
 * Exact and percentage splits are validated first, then fall back to equal so a
 * dictated expense can always be saved.
 */
export function buildExpenseFromVoice(
  parsed: ParsedVoice,
  payerMemberId: string,
  allMemberIds: Set<string>,
): Partial<Expense> {
  const now = Date.now()
  const participants = parsed.participants.filter((id) => allMemberIds.has(id))
  const known = participants.length > 0 ? participants : [...allMemberIds]

  const shareTotal = parsed.people.reduce((sum, person) => sum + (person.amountPaise ?? 0), 0)
  const totalPaise = shareTotal > 0 ? shareTotal : parsed.totalPaise > 0 ? parsed.totalPaise : 0

  let split: Split = { mode: 'equal', participants: known }
  let usable = false

  if (totalPaise > 0) {
    if (parsed.mode === 'exact' && shareTotal > 0) {
      const values: Record<string, number> = {}
      for (const person of parsed.people) {
        if (!person.memberId || !allMemberIds.has(person.memberId)) continue
        values[person.memberId] = person.amountPaise ?? 0
      }
      const candidate: Split = { mode: 'exact', values }
      try {
        allocateSplit(totalPaise, candidate)
        split = candidate
        usable = true
      } catch {
        usable = false
      }
    } else if (parsed.mode === 'percent') {
      const values: Record<string, number> = {}
      for (const person of parsed.people) {
        if (!person.memberId || !allMemberIds.has(person.memberId)) continue
        values[person.memberId] = person.percent ?? 0
      }
      const candidate: Split = { mode: 'percent', values }
      try {
        allocateSplit(totalPaise, candidate)
        split = candidate
        usable = true
      } catch {
        usable = false
      }
    }

    if (!usable) {
      split = { mode: 'equal', participants: known }
      try {
        allocateSplit(totalPaise, split)
        usable = true
      } catch {
        usable = false
      }
    }
  }

  const payers: PayerShare[] = [{ memberId: payerMemberId, amountPaise: totalPaise }]
  const summary = parsed.people
    .filter((person) => person.memberId)
    .map((person) =>
      person.percent !== undefined
        ? `${person.name} ${person.percent}%`
        : `${person.name} ${money(person.amountPaise ?? 0)}`,
    )
    .join(' · ')

  const noteParts: string[] = []
  if (summary) noteParts.push(summary)
  if (parsed.gstRate) noteParts.push(`GST ${parsed.gstRate}%`)
  noteParts.push(`Heard: “${parsed.rawText.slice(0, 140)}”`)

  return {
    groupId: '',
    description: parsed.rawText.slice(0, 70) || 'Voice expense',
    amountPaise: usable ? totalPaise : 0,
    date: now,
    category: inferCategory(parsed.rawText),
    payers,
    split,
    notes: noteParts.join(' · ').slice(0, 400),
    createdBy: payerMemberId,
    createdAt: now,
    updatedAt: now,
    acks: {},
    revision: 1,
  }
}
