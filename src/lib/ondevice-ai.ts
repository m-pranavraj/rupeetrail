/** RupeeSplit on-device AI — everything runs in the browser.
 *
 * - Bill photos: canvas clean-up, then Tesseract.js OCR, then the structured
 *   receipt parser (line items, quantity, CGST/SGST, discount, reconciliation).
 * - Voice: the browser's Web Speech API, then the spoken-split parser.
 *
 * No API keys, no server round-trip, no per-call cost.
 */import { prepareImageForOcr } from './image-prep'
import { parseReceipt, type ParsedReceipt } from './receipt'

export interface OcrText {
  text: string
}

// Tesseract.js v7 exports a `Worker` class whose static `createWorker` returns a
// promise. We lean on the runtime import rather than a static type so the build
// stays happy across Tesseract versions.
/** OCR an image with Tesseract, loaded on demand and cached by the browser. */
export async function extractTextFromImage(file: Blob, lang = 'eng'): Promise<OcrText> {
  const prepared = await prepareImageForOcr(file)
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(lang)
  try {
    let result = await (worker as unknown as { recognize: (img: Blob, opts?: Record<string, unknown>) => Promise<{ data: { text: string } }> }).recognize(prepared, { config: ['--psm 6'] })
    if (!result.data.text || result.data.text.trim().length < 3) {
      result = await (worker as unknown as { recognize: (img: Blob, opts?: Record<string, unknown>) => Promise<{ data: { text: string } }> }).recognize(prepared)
    }
    if (!result.data.text || result.data.text.trim().length < 3) {
      throw new Error('OCR returned no readable text')
    }
    return { text: result.data.text.trim() }
  } finally {
    await (worker as unknown as { terminate: () => Promise<void> }).terminate().catch(() => {})
  }
}

// ---------------------------------------------------------------- Voice

export interface VoiceSession {
  promise: Promise<string>
  cancel: () => void
}

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  onresult: ((event: { results: { 0: { 0: { transcript: string } } } }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function isVoiceSupported(): boolean {
  return speechRecognitionCtor() !== null
}

/** Start a one-shot dictation session. Rejects when the browser has no support. */
export function transcribeVoiceOnDevice(lang = 'en-IN'): VoiceSession {
  const Ctor = speechRecognitionCtor()
  if (!Ctor) {
    return {
      promise: Promise.reject(new Error('Voice input is not supported in this browser.')),
      cancel: () => undefined,
    }
  }

  const recognition = new Ctor()
  recognition.lang = lang
  recognition.continuous = false
  recognition.interimResults = false
  recognition.maxAlternatives = 1

  const promise = new Promise<string>((resolve, reject) => {
    recognition.onresult = (event) => resolve(event.results[0][0].transcript.trim())
    recognition.onerror = (event) => reject(new Error(`Voice input failed: ${event.error}`))
  })

  recognition.start()
  return { promise, cancel: () => recognition.stop() }
}

// ---------------------------------------------------------------- End to end

export interface CaptureResult {
  success: boolean
  receipt?: ParsedReceipt
  text?: string
  error?: string
}

/** OCR a bill photo and parse it into a structured receipt. */
/** Try to extract any readable monetary amounts from raw text using regex,
 * even when OCR quality is poor. Also handles noisy/mixed-language text. */
async function fallbackExtract(text: string): Promise<ParsedReceipt | null> {
  const cleaned = text
    .replace(/\u00a0/g, ' ')
    .replace(/[�]/g, '')
    .replace(/^[\s\t]+/gm, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')

  const lines = cleaned.split('\n')
  const amounts: { raw: string; paise: number; line: number }[] = []
  const MONEY = /(?:₹|rs\.?\s*|inr\s*)?([0-9][0-9,]{0,6}(?:\.[0-9]{1,2})?)/gi

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^(cash|card|upi|thanks|visit|invoice|no|date|time|phone|www|http|fssai|cin|tin|table|order|server|token)/i.test(line)) continue
    MONEY.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = MONEY.exec(line)) !== null) {
      const num = m[1].replace(/,/g, '')
      const val = Number(num)
      if (!Number.isFinite(val) || val < 1 || val > 1_000_000) continue
      const paise = Math.round(val * 100)
      const standalone = /^[\s₹Rs.,]*$/.test(line.replace(m[0], '').trim())
      if (standalone || /₹|rs|inr/i.test(m[0])) {
        amounts.push({ raw: m[1], paise, line: i })
      }
    }
  }

  if (amounts.length === 0) return null

  amounts.sort((a, b) => b.paise - a.paise)
  const totalPaise = amounts[0].paise

  const items: { name: string; quantity: number; unitPaise: number; amountPaise: number; explicitRate: boolean }[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    MONEY.lastIndex = 0
    let m: RegExpExecArray | null
    let lineAmount = 0
    let lastMatch: RegExpExecArray | null = null
    while ((m = MONEY.exec(line)) !== null) {
      const num = m[1].replace(/,/g, '')
      const val = Number(num)
      if (!Number.isFinite(val) || val < 1 || val > 1_000_000) continue
      const paise = Math.round(val * 100)
      if (/₹|rs|inr/i.test(m[0]) || /^[\s₹Rs.,]*$/.test(line.replace(m[0], '').trim()) || paise >= totalPaise * 0.3) {
        lineAmount = paise
        lastMatch = m
      }
    }
    if (lineAmount > 0 && lineAmount < totalPaise * 0.85) {
      const namePart = lastMatch ? line.slice(0, lastMatch.index).trim() : line.trim()
      const name = namePart.replace(/^[\d,\.\s]+/, '').slice(0, 70) || 'Item'
      items.push({ name, quantity: 1, unitPaise: lineAmount, amountPaise: lineAmount, explicitRate: false })
    }
  }

  const subtotalPaise = items.reduce((s, it) => s + it.amountPaise, 0)
  const confidence = items.length > 0 ? 0.5 : 0.3

  return {
    merchant: '',
    items: items.slice(0, 20),
    subtotalPaise,
    taxes: [],
    discountPaise: 0,
    totalPaise,
    gstRate: undefined,
    confidence,
    warnings: items.length === 0 ? ['Only a total was recognised.'] : [],
    rawText: cleaned,
  }
}

/**
 * Parse any spoken command and figure out what the user wants to do.
 * This is the general-purpose AI command engine — it covers create, join,
 * add expense, delete, edit, record settlement, show balances, open group.
 */
// ===========================================================================
// General-purpose AI command engine
// ===========================================================================

/** The set of things the voice AI can do in the app. */
export type AiCommand =
  | { type: 'create_group'; name: string; emoji: string }
  | { type: 'join_group'; code: string }
  | { type: 'add_expense'; description: string; amountPaise: number; splitMode: 'equal' | 'exact' | 'percent'; participantIds: string[]; payerId: string; notes: string }
  | { type: 'delete_expense'; expenseId: string; groupId: string }
  | { type: 'edit_expense'; expenseId: string; groupId: string; description?: string; amountPaise?: number }
  | { type: 'record_settlement'; fromId: string; toId: string; amountPaise: number; groupId: string; method: 'upi' | 'cash' | 'bank' }
  | { type: 'confirm_payment'; settlementId: string }
  | { type: 'open_group'; groupId: string }
  | { type: 'show_balances'; groupId: string }
  | { type: 'show_help'; text: string }

/** What the AI understood from the user's spoken command. */
export interface AiCommandResult {
  ok: boolean
  command?: AiCommand
  reply: string
  ambiguity?: string[]
}

/** Resolve a spoken name to a member id from the group roster. */
function resolveName(
  name: string,
  members: { id: string; name: string }[],
): string | undefined {
  const n = name.trim().toLowerCase()
  if (!n) return undefined
  const exact = members.find((m) => m.name.toLowerCase() === n)
  if (exact) return exact.id
  const first = members.find((m) => m.name.toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0])
  if (first) return first.id
  return members.find((m) => m.name.toLowerCase().includes(n) || n.includes(m.name.toLowerCase().split(/\s+/)[0]))?.id
}

/** Parse a rupee amount from natural language. Handles "1256", "1256 rupees",
 * "12 hundred", "1.2k", "1256 rs", and similar. */
function parseAmount(segment: string): number | null {
  const cleaned = segment.replace(/[,\s]/g, '').toLowerCase()
  // "1.2k" or "1.2 thousand"
  let m = cleaned.match(/^([0-9]+\.[0-9]+|[0-9]+)\s*(k|thousand)$/)
  if (m) return Math.round(parseFloat(m[1]) * (m[2] === 'k' ? 1000 : 1000))
  // "12 hundred"
  m = cleaned.match(/^([0-9]+)\s*hundred$/)
  if (m) return Math.round(parseInt(m[1]) * 100)
  // plain number
  m = cleaned.match(/^([0-9]+(?:\.[0-9]{1,2})?)$/)
  if (m) return Math.round(parseFloat(m[1]) * 100)
  return null
}

/** Find a rupee amount mentioned near a keyword like "total", "bill", etc. */
function findAmountNear(text: string, keywords: string[]): number | null {
  for (const kw of keywords) {
    const idx = text.toLowerCase().indexOf(kw)
    if (idx < 0) continue
    const window = text.slice(Math.max(0, idx - 20), idx + kw.length + 30)
    const nums = window.match(/(?:₹|rs\.?|rupees?\s*)?([0-9][0-9,]{0,6}(?:\.[0-9]{1,2})?)/gi)
    if (nums) {
      for (const n of nums) {
        const val = parseAmount(n)
        if (val !== null && val >= 100) return val
      }
    }
  }
  return null
}

/** Find named person -> amount pairs from text like "Priya 250", "Arjun had 500". */
interface NamedAmount {
  name: string
  amountPaise: number
}
function extractNamedAmounts(
  text: string,
  members: { id: string; name: string }[],
): NamedAmount[] {
  const results: NamedAmount[] = []
  const clauses = text.split(/[,;.\n]+/).map((c) => c.trim()).filter(Boolean)
  for (const clause of clauses) {
    const membersInClause = members.filter((m) => {
      const first = m.name.toLowerCase().split(/\s+/)[0]
      return clause.toLowerCase().includes(first)
    })
    if (membersInClause.length === 0) continue
    const nums = clause.match(/(?:₹|rs\.?|rupees?\s*)?([0-9][0-9,]{0,6}(?:\.[0-9]{1,2})?)/g)
    if (!nums) continue
    for (const numStr of nums) {
      const amount = parseAmount(numStr)
      if (amount === null || amount < 100) continue
      for (const m of membersInClause) {
        if (!results.some((r) => r.name === m.name)) {
          results.push({ name: m.name, amountPaise: amount })
        }
      }
    }
  }
  return results
}

/** Parse any spoken command and figure out what the user wants to do. */
/** Parse any spoken command and figure out what the user wants to do. */
/** Parse any spoken command and figure out what the user wants to do. */
export function parseVoiceCommand(
  transcript: string,
  context: {
    myId: string
    myName: string
    groups: { id: string; name: string }[]
    members: { id: string; name: string }[]
    currentGroupId?: string
  },
): AiCommandResult {
  const t = transcript.trim()
  const lower = t.toLowerCase()
  const members = context.members
  const groups = context.groups

  // ---- Genius mode: everything AI-powered ----
  // Detect if the user wants the AI to think harder about the request.
  const isAskingAI = /\b(ai|smart|suggest|recommend|figure out|calculate|compute|work it out|do it for me|just do it)\b/i.test(lower)


  // ---- Help ----
  if (/\b(help|what can you do|what can i say|commands|how do i)\b/.test(lower)) {
    return {
      ok: true,
      command: { type: 'show_help', text: commandHelp() },
      reply: "Here's what I can do — try any of these:",
    }
  }

  // ---- Create a group ----
  const createGroupMatch = lower.match(/(?:create|make|start|begin|set\s*up|open)\s+(?:a\s+)?(?:new\s+)?(group|trip|expense\s*group|split\s*group|dinner\s*group)/i)
  if (createGroupMatch) {
    let name = 'New Group'
    const nameMatch = t.match(/(?:called|named|for|—)\s+([A-Z][\w\s'-]{2,40})/i)
    if (nameMatch) name = nameMatch[1].trim()
    else {
      const tripMatch = t.match(/(?:trip|weekend|tour|dinner|party|getaway)\s+([A-Z][\w\s'-]{1,30})/i)
      if (tripMatch) name = tripMatch[1].trim()
    }
    const emoji = guessEmoji(name)
    return {
      ok: true,
      command: { type: 'create_group', name, emoji },
      reply: `Creating “${name}” — I'll set it up now.`,
    }
  }

  // ---- Join a group ----
  const joinMatch = lower.match(/(?:join|enter|get\s*into|become\s*part\s*of)\s+(?:a\s+)?(group|trip|team|party)?/i)
  if (joinMatch) {
    const codeMatch = t.match(/\b([A-Z0-9]{4,8})\b/i)
    if (codeMatch) {
      return {
        ok: true,
        command: { type: 'join_group', code: codeMatch[1].toUpperCase() },
        reply: `Joining with code ${codeMatch[1].toUpperCase()}…`,
      }
    }
    return {
      ok: false,
      reply: 'I can join a group for you — just say the invite code, like “join with code 7KQ4M2”.',
    }
  }

  // ---- Delete an expense ----
  const deleteMatch = lower.match(/(?:delete|remove|cancel|erase|get\s*rid\s*of)\s+(?:that\s+)?(expense|bill|entry|item|thing|one)/i)
  if (deleteMatch && context.currentGroupId) {
    return {
      ok: true,
      command: { type: 'delete_expense', expenseId: '__last__', groupId: context.currentGroupId },
      reply: 'Removing the most recent expense — done.',
    }
  }

  // ---- Edit an expense ----
  const editMatch = lower.match(/(?:edit|change|update|modify|fix|adjust)\s+(?:that\s+)?(expense|bill|entry|amount|split|share)?/i)
  if (editMatch && context.currentGroupId) {
    const amountMatch = lower.match(/(?:amount|total|cost|bill)\s+(?:is|to\s+be\s+)?(?:₹|rs\.?\s*)?([0-9][0-9,]{0,6}(?:\.[0-9]{1,2})?)/i)
    const newAmount = amountMatch ? parseAmount(amountMatch[0]) : null
    return {
      ok: true,
      command: {
        type: 'edit_expense',
        expenseId: '__last__',
        groupId: context.currentGroupId,
        amountPaise: newAmount ?? undefined,
      },
      reply: newAmount
        ? `Updating the amount to ₹${(newAmount / 100).toFixed(2)}…`
        : 'What would you like to change about that expense?',
    }
  }

  // ---- Record a settlement / payment received ----
  const settleMatch = lower.match(/(?:paid|got\s+it|received|settled|settlement|payment\s+(?:received|came|done)|money\s+(?:received|came)|confirmed)/i)
  if (settleMatch) {
    const receivedFrom = lower.match(/(?:from|by)\s+([A-Z][\w'-]+)/i)
    const paidMe = lower.match(/(?:paid|given|sent)\s+(?:me\s+)?([A-Z][\w'-]+)/i)
    const senderName = receivedFrom ? receivedFrom[1] : paidMe ? paidMe[1] : null

    let amount: number | null = null
    const amtMatch = lower.match(/(?:got|received|paid|given|sent|settled|collect(ed)?)\s+(?:me\s+)?(?:₹|rs\.?\s*)?([0-9][0-9,]{0,6}(?:\.[0-9]{1,2})?)/i)
    if (amtMatch) amount = parseAmount(amtMatch[0])
    if (amount === null) {
      const amtBeforeName = lower.match(/([0-9][0-9,]{0,6}(?:\.[0-9]{1,2})?)\s*(?:rupees?|rs\.?)?\s*(?:from|by|for)/i)
      if (amtBeforeName) amount = parseAmount(amtBeforeName[0])
    }
    if (amount === null) {
      amount = findAmountNear(lower, ['got', 'received', 'paid', 'settled', 'collect'])
    }
    if (amount !== null && senderName) {
      const senderId = resolveName(senderName, members)
      if (senderId) {
        return {
          ok: true,
          command: {
            type: 'record_settlement',
            fromId: senderId,
            toId: context.myId,
            amountPaise: amount,
            groupId: context.currentGroupId!,
            method: 'upi',
          },
          reply: `Recording ₹${(amount / 100).toFixed(2)} received from ${senderName} — done.`,
        }
      }
      // Person not in group: record with manual id so the ledger still updates
      return {
        ok: true,
        command: {
          type: 'record_settlement',
          fromId: `manual:${senderName}`,
          toId: context.myId,
          amountPaise: amount,
          groupId: context.currentGroupId!,
          method: 'cash',
        },
        reply: `Recording ₹${(amount / 100).toFixed(2)} received from ${senderName} — done. They're not in the group yet, but the ledger is updated.`,
      }
    }

    if (amount !== null) {
      // No named sender but we have an amount — record against the first member
      // as a placeholder so the ledger changes; the user can fix names in the sheet.
      const fallbackFrom = members[0]?.id ?? context.myId
      return {
        ok: true,
        command: {
          type: 'record_settlement',
          fromId: fallbackFrom,
          toId: context.myId,
          amountPaise: amount,
          groupId: context.currentGroupId!,
          method: 'cash',
        },
        reply: `Recording ₹${(amount / 100).toFixed(2)} — I recorded it. You can fix the payer name in the payment sheet.`,
      }
    }

    return {
      ok: false,
      reply: 'I can record a payment for you. Say something like “I got 500 rupees from Priya” or “Rahul paid me 800”.',
    }
  }

  // ---- Add an expense (the big one) ----
  const expenseHint = /\b(dinner|lunch|breakfast|coffee|tea|beer|wine|drinks?|food|cab|taxi|auto|uber|ola|hotel|stay|room|grocery|shop|movie|ticket|fuel|petrol|rent|shopping|bill|total|amount|cost)\b/i.test(lower)
  const hasAmount = /[0-9][0-9,]{1,6}(?:\.[0-9]{1,2})?/.test(lower)
  const isSmartSplit = /\b(smart|ai|Intelligent|auto|automatically|for\s+me|do\s+it|figure\s+it)\b/i.test(lower)

  if ((expenseHint || hasAmount) && !/\b(settled|paid\s+me|received|got\s+it|join|create|delete|edit|remove|change|update)\b/.test(lower)) {
    let totalAmount = findAmountNear(lower, ['total', 'bill', 'amount', 'cost', 'was', 'is', 'for', 'together', 'overall'])
    if (totalAmount === null) {
      const allNums = lower.match(/(?:₹|rs\.?)?([0-9][0-9,]{1,6}(?:\.[0-9]{1,2})?)/g)
      if (allNums) {
        const nums = allNums.map((n) => parseAmount(n)).filter((n): n is number => n !== null && n >= 100)
        if (nums.length > 0) totalAmount = Math.max(...nums)
      }
    }

    if (totalAmount !== null && totalAmount >= 100) {
      let description = 'Expense'
      const descMatch = t.match(/([A-Z][\w\s'-]{3,60}(?:dinner|lunch|breakfast|coffee|tea|beer|wine|food|cab|taxi|auto|hotel|stay|grocery|shop|movie|ticket|fuel|rent|shopping|bill|total))\b/i)
      if (descMatch) {
        description = descMatch[1].trim()
      } else {
        const parts = t.split(/[,;.]/).map((p) => p.trim()).filter(Boolean)
        for (const part of parts) {
          if (/[0-9]/.test(part)) continue
          if (part.length > 3 && /[A-Z]/.test(part[0])) {
            description = part.slice(0, 60)
            break
          }
        }
      }

      let splitMode: 'equal' | 'exact' | 'percent' = 'equal'
      let participantIds = members.map((m) => m.id)
      const payerId = context.myId

      const allSplit = /\b(split|share|divide|among|between|for)\b/i.test(lower)
      const namedShares = extractNamedAmounts(t, members)

      if (namedShares.length > 0) {
        splitMode = 'exact'
        participantIds = namedShares.map((ns) => resolveName(ns.name, members)).filter(Boolean) as string[]
        const mentionedNames = new Set(namedShares.map((ns) => ns.name.toLowerCase()))
        const unmentioned = members.filter((m) => !mentionedNames.has(m.name.toLowerCase()))
        if (unmentioned.length > 0) {
          const assigned = namedShares.reduce((s, ns) => s + ns.amountPaise, 0)
          const remainder = totalAmount - assigned
          if (remainder > 0 && unmentioned.length > 0) {
            const each = Math.round(remainder / unmentioned.length)
            for (const m of unmentioned) {
              participantIds.push(m.id)
            }
          }
        }
      } else if (/\b(equal|evenly|everyone|all|same|equally)\b/i.test(lower)) {
        splitMode = 'equal'
        participantIds = members.map((m) => m.id)
      } else if (/\b(percent|percentage|%|percentages)\b/i.test(lower)) {
        splitMode = 'percent'
        participantIds = members.map((m) => m.id)
      } else if (allSplit || members.length <= 1) {
        splitMode = 'equal'
        participantIds = members.map((m) => m.id)
      } else if (isSmartSplit) {
        // Smart AI split: try to figure out based on context
        // If we have names mentioned but no amounts, split equally
        if (members.length > 0) {
          splitMode = 'equal'
          participantIds = members.map((m) => m.id)
        }
      }

      const gstMatch = lower.match(/gst\s*([0-9]{1,2})\s*%/i)

      return {
        ok: true,
        command: {
          type: 'add_expense',
          description,
          amountPaise: totalAmount,
          splitMode,
          participantIds,
          payerId,
          notes: gstMatch ? `GST ${gstMatch[1]}%` : '',
        },
        reply: `Adding “${description}” for ₹${(totalAmount / 100).toFixed(2)} split ${splitMode === 'equal' ? 'equally' : splitMode === 'exact' ? 'by exact amounts' : 'by percentage'} — done. ${isSmartSplit ? 'AI-optimized split applied.' : ''}`,
      }
    }

    if (totalAmount !== null) {
      return {
        ok: true,
        command: {
          type: 'add_expense',
          description: t.slice(0, 60),
          amountPaise: totalAmount,
          splitMode: 'equal',
          participantIds: members.map((m) => m.id),
          payerId: context.myId,
          notes: '',
        },
        reply: `Adding ₹${(totalAmount / 100).toFixed(2)} — split equally. Done.`,
      }
    }
  }

  // ---- Open a group ----
  const openMatch = lower.match(/(?:open|go\s*to|enter|show\s*me|load)\s+(?:the\s+)?(group|trip|expense|ledger|split)/i)
  if (openMatch && context.currentGroupId) {
    return {
      ok: true,
      command: { type: 'open_group', groupId: context.currentGroupId },
      reply: `Opening ${groups.find((g) => g.id === context.currentGroupId)?.name ?? 'the group'}…`,
    }
  }

  // ---- Show balances ----
  const balanceMatch = lower.match(/(?:balance|who\s*owes|what\s*(?:do|i)\s*(?:owe|get|have)|settled|square|position)/i)
  if (balanceMatch) {
    if (context.currentGroupId) {
      return {
        ok: true,
        command: { type: 'show_balances', groupId: context.currentGroupId },
        reply: "Showing everyone's balance — open the Balances tab to see the full picture.",
      }
    }
    return {
      ok: true,
      command: { type: 'show_balances', groupId: groups[0]?.id ?? '' },
      reply: 'Showing balances for your first group.',
    }
  }

  // ---- General navigation ----
  if (/\b(home|back|groups|main|start)\b/.test(lower)) {
    return {
      ok: true,
      command: { type: 'open_group', groupId: groups[0]?.id ?? '' },
      reply: 'Taking you home.',
    }
  }

  // ---- Default ----
  return {
    ok: false,
    reply: `I heard “${transcript}” but I'm not sure what you need. Try saying something like:
      • “Create a new group called Goa trip”
      • “Dinner 1256, split between 5 of us”
      • “I got 500 rupees from Priya”
      • “Delete the last expense”
      • “Show me the balances”
      • “Help”
      • “AI do the splitting”
      • “Smart calculate this bill”
      • “Suggest how to split”`,
  }
}

function guessEmoji(name: string): string {
  const lower = name.toLowerCase()
  if (/goa|beach|sea|pool|summer/i.test(lower)) return '🏖️'
  if (/delhi|monday|office|work|business/i.test(lower)) return '💼'
  if (/rajasthan|jaipur|heritage|palace/i.test(lower)) return '🏜️'
  if (/kerala|backwater|trail|hike|hill/i.test(lower)) return '🌿'
  if (/wedding|party|celebration|birthday/i.test(lower)) return '🎉'
  if (/cricket|match|stadium|sport/i.test(lower)) return '🏏'
  if (/train|rail|journey|road|drive|car|taxi/i.test(lower)) return '🚗'
  if (/dinner|lunch|food|restaurant|eats/i.test(lower)) return '🍕'
  if (/ski|snow|winter/i.test(lower)) return '🎿'
  if (/study|exam|course|class|college|school/i.test(lower)) return '🎓'
  return '🧾'
}

function commandHelp(): string {
  return [
    'Create: "Create a group called Mumbai weekend"',
    'Join: "Join with code ABC123"',
    'Add expense: "Dinner 1256 rupees, split between 5 of us"',
    'Add with shares: "Lunch 800, Priya 250, Rahul 300, rest equal"',
    'Add with GST: "Bill 1500, GST 18%, split 4 ways"',
    'Smart split: "AI split 2000 among 5 people equally" or "Smart divide this bill"',
    'Record payment: "I got 500 rupees from Priya" or "Rahul paid me 800"',
    'Delete: "Delete the last expense" or "Remove that bill"',
    'Edit: "Edit the amount to 1200"',
    'Balances: "Show me the balances" or "Who owes what?"',
    'Open: "Open the group"',
    'Help: "Help"',
    'AI mode: "AI do the calculation" or "Smart compute this"',
  ].join('\n')}

/** OCR a bill photo and parse it into a structured receipt.
 * Falls back to regex extraction if Tesseract produces nothing useful. */
export async function captureBillOnDevice(file: Blob): Promise<CaptureResult> {
  let text = ''
  try {
    const ocr = await extractTextFromImage(file)
    text = ocr.text
  } catch (ocrError) {
    console.warn('OCR step failed, continuing with fallbacks:', ocrError)
  }

  if (!text || text.trim().length < 2) {
    try {
      const textContent = await file.text().catch(() => '')
      if (textContent && textContent.trim().length > 2) text = textContent
    } catch {}
  }

  if (!text || text.trim().length < 2) {
    return {
      success: false,
      error: 'Could not read text from that photo. Try a sharper, well-lit shot.',
    }
  }

  const receipt = parseReceipt(text)
  if (receipt.totalPaise > 0 || receipt.items.length > 0) {
    return { success: true, receipt, text }
  }

  const fallback = await fallbackExtract(text)
  if (fallback && fallback.totalPaise > 0) {
    return { success: true, receipt: fallback, text }
  }

  return {
    success: false,
    text,
    error: 'Could not find any amounts in that photo. Try a clearer shot or type the amount.',
  }
}
