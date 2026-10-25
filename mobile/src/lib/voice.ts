/** Structured parsing for dictated expenses.
 *
 * Understands the way people actually speak about a shared bill:
 *   "Dinner 1200, Priya had the wine for 400, I paid"
 *   "Auto 240 split equally between me and Priya"
 *   "Cab 600, Arjun 60%, Priya 40%, I paid"
 *
 * Names are matched to the group roster, so the draft lands on the right people
 * instead of inventing members, and any unexplained balance goes to the payer.
 */
import { detectPrintedGst } from './receipt'

export interface VoicePerson {
  name: string
  memberId?: string
  amountPaise?: number
  percent?: number
}

export interface ParsedVoice {
  payerMemberId?: string
  payerName?: string
  mode: 'equal' | 'exact' | 'percent'
  people: VoicePerson[]
  participants: string[]
  totalPaise: number
  gstRate?: number
  warnings: string[]
  rawText: string
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}

/** Read a spoken amount: "800", "1.2k", "1,200", "two thousand". */
export function spokenAmount(raw: string): number | undefined {
  const trimmed = raw.trim().toLowerCase().replace(/,/g, '')
  const k = /^([0-9]+(?:\.[0-9]+)?)\s*k$/.exec(trimmed)
  if (k) return Math.round(Number(k[1]) * 1000)
  const lakh = /^([0-9]+(?:\.[0-9]+)?)\s*l(?:akh)?$/.exec(trimmed)
  if (lakh) return Math.round(Number(lakh[1]) * 100000)
  const plain = /^([0-9]+(?:\.[0-9]{1,2})?)$/.exec(trimmed)
  if (plain) return Number(plain[1])
  const thousands = /^([a-z]+)\s+thousand$/.exec(trimmed)
  if (thousands) {
    const base = WORD_NUMBERS[thousands[1]]
    if (base) return base * 1000
  }
  return WORD_NUMBERS[trimmed]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function matchMember(name: string, members: { id: string; name: string }[]): string | undefined {
  const needle = name.trim().toLowerCase()
  if (!needle) return undefined
  const exact = members.find((m) => m.name.toLowerCase() === needle)
  if (exact) return exact.id
  const firstWord = needle.split(/\s+/)[0]
  const first = members.find((m) => m.name.toLowerCase().split(/\s+/)[0] === firstWord)
  if (first) return first.id
  if (needle.length < 3) return undefined
  const partial = members.find(
    (m) =>
      m.name.toLowerCase().includes(needle) ||
      needle.includes(m.name.toLowerCase().split(/\s+/)[0]),
  )
  return partial?.id
}

function mentionedMembers(
  text: string,
  members: { id: string; name: string }[],
): { id: string; name: string }[] {
  return members.filter((member) => {
    const first = member.name.split(/\s+/)[0]
    return new RegExp(`\\b${escapeRegExp(first)}\\b`, 'i').test(text)
  })
}

const NAME = "[A-Za-z][A-Za-z.'-]{1,20}"

/** Words that look like names after capitalisation but describe the expense. */
const EXPENSE_WORDS =
  /^(dinner|lunch|breakfast|brunch|snacks?|coffee|tea|beer|wine|drinks?|food|cab|taxi|auto|ola|uber|movie|tickets?|hotel|stay|groceries?|petrol|fuel|party|rent|trip|bill|total|shopping|medicine|recharge|parking|toll)$/i

export function parseVoiceSplit(
  transcript: string,
  members: { id: string; name: string }[],
  meMemberId?: string,
): ParsedVoice {
  const rawText = transcript.trim()
  const text = rawText.replace(/\s+/g, ' ')
  const lower = text.toLowerCase()
  const warnings: string[] = []

  // ---- payer -----------------------------------------------------------
  let payerMemberId: string | undefined
  let payerName: string | undefined

  if (/\bi\s+paid\b|\bpaid\s+by\s+me\b|\bmy\s+(?:card|upi)\b/i.test(text)) {
    payerMemberId = meMemberId
  }
  if (!payerMemberId) {
    const payerMatch = new RegExp(`\\b(${NAME})\\s+(?:had\\s+)?paid\\b`, 'i').exec(text)
    if (payerMatch) payerMemberId = matchMember(payerMatch[1], members)
  }
  if (!payerMemberId) payerMemberId = meMemberId
  payerName = members.find((m) => m.id === payerMemberId)?.name

  // ---- explicit total --------------------------------------------------
  let statedTotal = 0
  const totalMatch =
    /(?:total|bill|amount|it\s+was|cost(?:s|ed)?)\s*(?:of|is|was|:)?\s*(?:₹|rs\.?)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(k|thousand)?/i.exec(
      text,
    )
  if (totalMatch) {
    const value = spokenAmount(`${totalMatch[1]}${totalMatch[2] ? 'k' : ''}`)
    if (value) statedTotal = Math.round(value * 100)
  }

  // ---- equal split -----------------------------------------------------
  const equalMatch =
    /\b(?:split|share|divide)\b[^.,;]{0,24}?\b(?:equally|evenly|between|among|by)\b/i.test(
      text,
    ) || /\bequal(?:ly)?\s+split\b|\bsame\s+for\s+everyone\b/i.test(text)

  // ---- percentages -----------------------------------------------------
  const percents: VoicePerson[] = []
  const percentRe = new RegExp(
    `\\b(${NAME})\\s+(?:has|had|gets|pays|should\\s+pay|owes|takes|:)?\\s*([0-9]{1,3}(?:\\.[0-9]{1,2})?)\\s*%`,
    'gi',
  )
  let percentMatch: RegExpExecArray | null
  while ((percentMatch = percentRe.exec(text)) !== null) {
    percents.push({
      name: percentMatch[1],
      memberId: matchMember(percentMatch[1], members),
      percent: Number(percentMatch[2]),
    })
  }

  // ---- named amounts, clause by clause --------------------------------
  // People speak in clauses: "Priya had the wine for 400". Scan each clause for
  // a known person and the last amount it contains.
  const amounts: VoicePerson[] = []
  let titleAmount = 0
  const clauses = text.split(/[,;]|\band\b/i).map((clause) => clause.trim()).filter(Boolean)

  for (const clause of clauses) {
    if (/%/.test(clause)) continue
    const named = members.find((member) => {
      const first = member.name.split(/\s+/)[0]
      return new RegExp(`\\b${escapeRegExp(first)}\\b`, 'i').test(clause)
    })

    const numbers = [...clause.matchAll(/(?:₹|rs\.?)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(k|thousand)?/gi)]
    if (numbers.length === 0) continue

    const last = numbers[numbers.length - 1]
    const tail = clause.slice((last.index ?? 0) + last[0].length).trim()
    if (/^(%|people|persons?|ways|of\s+us)/i.test(tail)) continue

    const value = spokenAmount(`${last[1]}${last[2] ? 'k' : ''}`)
    if (!value) continue
    const paise = Math.round(value * 100)
    if (paise < 100) continue

    if (named) {
      if (!amounts.some((person) => person.memberId === named.id)) {
        amounts.push({ name: named.name, memberId: named.id, amountPaise: paise })
      }
      continue
    }

    // A capitalised word that is not an expense word is probably a person we
    // do not know; say so rather than silently dropping their share.
    const firstWord = clause.split(/\s+/)[0]
    const looksLikeName =
      /^[A-Z][a-z]{2,}$/.test(firstWord) && !EXPENSE_WORDS.test(firstWord)
    if (looksLikeName) {
      warnings.push(`${firstWord} isn’t in this group — their share was left out.`)
      continue
    }

    // "Dinner 1200" — a title with its amount, used as the overall total.
    if (titleAmount === 0 && !/\b(total|bill|amount|paid)\b/i.test(clause)) titleAmount = paise
  }

  if (statedTotal === 0) statedTotal = titleAmount

  const mentioned = mentionedMembers(text, members)
  const gstRate = detectPrintedGst(text)

  if (percents.some((person) => person.memberId)) {
    const known = percents.filter((person) => person.memberId)
    const sum = known.reduce((total, person) => total + (person.percent ?? 0), 0)
    if (Math.abs(sum - 100) > 0.5) warnings.push(`Percentages add up to ${sum}%, not 100%.`)

    const totalPaise =
      statedTotal > 0
        ? statedTotal
        : Math.max(...percents.map((person) => person.amountPaise ?? 0), 0)

    return {
      payerMemberId,
      payerName,
      mode: 'percent',
      people: known,
      participants: known.map((person) => person.memberId!).filter(Boolean),
      totalPaise,
      gstRate,
      warnings,
      rawText,
    }
  }

  if (equalMatch) {
    const named = mentioned.map((member) => member.id)
    if (payerMemberId && !named.includes(payerMemberId)) named.push(payerMemberId)
    const participants = named.length > 0 ? [...new Set(named)] : members.map((m) => m.id)
    const totalPaise =
      statedTotal ||
      amounts.reduce((total, person) => total + (person.amountPaise ?? 0), 0)
    return {
      payerMemberId,
      payerName,
      mode: 'equal',
      people: participants.map((id) => ({
        memberId: id,
        name: members.find((m) => m.id === id)?.name ?? id,
      })),
      participants,
      totalPaise,
      gstRate,
      warnings,
      rawText,
    }
  }

  if (amounts.length > 0) {
    let shareSum = amounts.reduce((sum, person) => sum + (person.amountPaise ?? 0), 0)
    const people = [...amounts]

    // If a total was stated and one person is missing, the payer covers the rest.
    if (statedTotal > shareSum && payerMemberId && !people.some((p) => p.memberId === payerMemberId)) {
      const remainder = statedTotal - shareSum
      people.push({
        name: payerName ?? 'Payer',
        memberId: payerMemberId,
        amountPaise: remainder,
      })
      shareSum = statedTotal
    }

    if (statedTotal > 0 && shareSum > 0 && Math.abs(statedTotal - shareSum) > 100) {
      warnings.push(
        `Shares add up to ₹${(shareSum / 100).toFixed(2)}, but the total you said was ₹${(
          statedTotal / 100
        ).toFixed(2)}.`,
      )
    }

    return {
      payerMemberId,
      payerName,
      mode: 'exact',
      people,
      participants: people.map((person) => person.memberId!).filter(Boolean),
      totalPaise: shareSum || statedTotal,
      gstRate,
      warnings,
      rawText,
    }
  }

  if (statedTotal > 0) {
    warnings.push('No people were recognised, so this will be split equally.')
    return {
      payerMemberId,
      payerName,
      mode: 'equal',
      people: members.map((member) => ({ memberId: member.id, name: member.name })),
      participants: members.map((member) => member.id),
      totalPaise: statedTotal,
      gstRate,
      warnings,
      rawText,
    }
  }

  warnings.push('Could not find an amount in what you said.')
  return {
    payerMemberId,
    payerName,
    mode: 'equal',
    people: [],
    participants: [],
    totalPaise: 0,
    gstRate,
    warnings,
    rawText,
  }
}
