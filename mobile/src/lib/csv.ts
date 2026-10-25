/**
 * Trip export.
 *
 * A group ledger is only useful outside the app if it opens in a spreadsheet,
 * so this writes the same numbers the screens show — including each person's
 * share per expense — into one CSV and hands it to the Android share sheet.
 */
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { Share } from 'react-native'
import { computeBalances, nameOf } from './balances'
import { formatPlain } from './money'
import { allocateSplit } from './splits'
import type { Expense, Group, Settlement } from './types'

export interface ExportInput {
  group: Group
  expenses: Expense[]
  settlements: Settlement[]
  viewerId?: string
}

const cell = (value: unknown): string => {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const row = (values: unknown[]): string => values.map(cell).join(',')

const date = (ts: number): string => new Date(ts).toISOString().slice(0, 10)

const money = (paise: number): string => formatPlain(paise)

/** Build the full trip CSV. Pure, so it can be tested without a filesystem. */
export function buildTripCsv({ group, expenses, settlements, viewerId }: ExportInput): string {
  const live = expenses.filter((expense) => !expense.deletedAt)
  const active = group.members.filter((member) => !member.leftAt)
  const balances = computeBalances({ group, expenses: live, settlements })
  const lines: string[] = []

  lines.push(row(['RupeeSplit trip export']))
  lines.push(row(['Group', group.name]))
  lines.push(row(['Code', '']))
  lines.push(row(['Status', group.status]))
  lines.push(row(['Exported', new Date().toISOString()]))
  lines.push(row(['Members', active.map((member) => member.name).join(', ')]))
  lines.push('')

  lines.push(row(['Balances']))
  lines.push(row(['Member', 'Paid', 'Share', 'Net', 'Direction']))
  for (const balance of balances) {
    lines.push(
      row([
        nameOf(group, balance.memberId),
        money(balance.paidPaise),
        money(balance.sharePaise),
        money(Math.abs(balance.netPaise)),
        balance.netPaise > 0 ? 'gets back' : balance.netPaise < 0 ? 'owes' : 'settled',
      ]),
    )
  }
  lines.push('')

  const participantNames = active.map((member) => member.name)
  lines.push(row(['Expenses']))
  lines.push(
    row(['Date', 'Description', 'Category', 'Paid by', 'Amount', 'Split', ...participantNames, 'Notes']),
  )
  for (const expense of [...live].sort((a, b) => a.date - b.date)) {
    let shares: Record<string, number> = {}
    try {
      shares = Object.fromEntries(
        allocateSplit(expense.amountPaise, expense.split).map((entry) => [entry.memberId, entry.amountPaise]),
      )
    } catch {
      shares = {}
    }
    lines.push(
      row([
        date(expense.date),
        expense.description,
        expense.category,
        expense.payers.map((payer) => nameOf(group, payer.memberId)).join(' + '),
        money(expense.amountPaise),
        expense.split.mode,
        ...active.map((member) => (shares[member.id] ? money(shares[member.id]) : '')),
        expense.notes ?? '',
      ]),
    )
  }
  lines.push('')

  lines.push(row(['Payments']))
  lines.push(row(['Date', 'From', 'To', 'Amount', 'Method', 'Status']))
  for (const payment of settlements) {
    lines.push(
      row([
        date(payment.updatedAt || payment.createdAt),
        nameOf(group, payment.from),
        nameOf(group, payment.to),
        money(payment.amountPaise),
        payment.method,
        payment.status,
      ]),
    )
  }

  if (viewerId) {
    const viewer = group.members.find((member) => member.id === viewerId)
    if (viewer) {
      lines.push('')
      lines.push(row(['Exported for', viewer.name]))
    }
  }

  return lines.join('\n')
}

/**
 * Write the CSV to the cache and open the share sheet.
 * Returns false when the platform has no share sheet, so the caller can fall
 * back to sharing the raw text.
 */
export async function shareTripCsv(input: ExportInput): Promise<boolean> {
  const csv = buildTripCsv(input)
  const fileName = `rupeesplit-${input.group.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${date(
    Date.now(),
  )}.csv`

  try {
    if (!(await Sharing.isAvailableAsync())) {
      await Share.share({ message: csv, title: 'RupeeSplit trip export' })
      return true
    }
    const file = new File(Paths.cache, fileName)
    if (file.exists) file.delete()
    file.create()
    file.write(csv)
    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/csv',
      dialogTitle: 'Export this trip',
      UTI: 'public.comma-separated-values-text',
    })
    return true
  } catch {
    try {
      await Share.share({ message: csv, title: 'RupeeSplit trip export' })
      return true
    } catch {
      return false
    }
  }
}
