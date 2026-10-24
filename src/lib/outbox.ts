/** Offline outbox.
 *
 * A receipt gets scanned in a basement restaurant with no signal. The expense is
 * written here first, shown immediately with a "saving" marker, and sent to the
 * ledger as soon as the device is back online. Nothing is lost on a refresh.
 */
import type { ExpenseInput } from './api'

export interface QueuedExpense {
  id: string
  groupId: string
  queuedAt: number
  input: ExpenseInput
}

const KEY = 'rupeetrail.outbox.v1'

function readAll(): QueuedExpense[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as QueuedExpense[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.groupId === 'string' &&
        item.input &&
        typeof item.input.amountPaise === 'number',
    )
  } catch {
    return []
  }
}

function writeAll(items: QueuedExpense[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    // Storage full or private mode: the expense still lives in the snapshot.
  }
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function readOutbox(): QueuedExpense[] {
  return readAll()
}

export function queuedForGroup(groupId: string): QueuedExpense[] {
  return readAll().filter((item) => item.groupId === groupId)
}

export function queueExpense(groupId: string, input: ExpenseInput): QueuedExpense {
  const item: QueuedExpense = { id: makeId(), groupId, queuedAt: Date.now(), input }
  writeAll([...readAll(), item])
  return item
}

export function removeQueued(id: string): void {
  writeAll(readAll().filter((item) => item.id !== id))
}

/** Stable client-side id so a queued expense can be rendered before it exists. */
export function pendingExpenseId(queuedId: string): string {
  return `pending_${queuedId}`
}

export function queuedCount(): number {
  return readAll().length
}
