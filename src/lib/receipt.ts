/** Structured receipt extraction.
 *
 * Turns raw OCR text from an Indian bill into a typed receipt: line items with
 * quantity, rate and amount; tax lines (CGST/SGST/IGST); discount; the stated
 * total; and a reconciliation check. It is deliberately deterministic and
 * explainable — every number traces back to a line of text.
 */
import type { ExpenseCategory } from '../types'

export interface ReceiptItem {
  name: string
  quantity: number
  /** price for one unit, in paise */
  unitPaise: number
  /** quantity × unit, in paise */
  amountPaise: number
  /** the line explicitly printed both a rate and an amount */
  explicitRate: boolean
}

export interface ReceiptTax {
  label: string
  rate?: number
  amountPaise: number
}

export interface ParsedReceipt {
  merchant?: string
  items: ReceiptItem[]
  subtotalPaise: number
  taxes: ReceiptTax[]
  discountPaise: number
  totalPaise: number
  gstRate?: number
  confidence: number
  warnings: string[]
  rawText: string
}

const MONEY = /(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi
const QTY_X = /(?:^|\s)([0-9]{1,3})\s*(?:x|×|\*)\s*(?:₹|rs\.?)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i
const QTY_LEAD = /^\s*([0-9]{1,3})\s+(?:x|×|@|nos?\.?|pcs?\.?|qty)?\s*(?:₹|rs\.?)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*$/i
const QTY_AT = /([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:@|x|×)\s*([0-9]{1,3})\b/i
const PERCENT = /([0-9]{1,2}(?:\.[0-9]{1,2})?)\s*%/

const KEY = {
  tax: /\b(cgst|sgst|igst|gst|vat|service\s*tax|sales\s*tax|cess)\b/i,
  subtotal: /\b(sub\s*-?\s*total|subtotal|net\s*amount|taxable\s*(value|amount))\b/i,
  total: /\b(grand\s*total|total\s*amount|amount\s*payable|net\s*(payable|total)|to\s*pay|total|bill\s*amount)\b/i,
  discount: /\b(discount|offer|promo|coupon|savings?|round\s*off)\b/i,
  noise:
    /\b(cash|card|upi|change|balance|invoice|bill\s*(no|number)|gstin|gst\s*no|date|time|phone|mobile|thank|visit\s*again|cashier|table|order\s*no|token|server|www\.|http|fssai|cin|tin)\b/i,
}

/** Repair the letter-for-digit swaps OCR makes inside numbers. */
export function normaliseOcr(raw: string): string {
  return raw
    .replace(/\u00a0/g, ' ')
    // Capture groups instead of lookbehind: Hermes does not guarantee it.
    .replace(/(\d)[Oo](?=\d)/g, (_match, digit: string) => `${digit}0`)
    .replace(/(\d)[lI|](?=\d)/g, (_match, digit: string) => `${digit}1`)
    .replace(/(\d)[Ss](?=\d)/g, (_match, digit: string) => `${digit}5`)
    .replace(/(\d)[Bb](?=\d)/g, (_match, digit: string) => `${digit}8`)
}

/** OCR mixes up these characters inside numbers. Repair only number-like tokens. */
export function repairNumericToken(token: string): string {
  return token
    .replace(/[Oo]/g, '0')
    .replace(/[lI|]/g, '1')
    .replace(/[Ss](?=[0-9])/g, '5')
    .replace(/[B](?=[0-9])/g, '8')
}

function toPaise(raw: string): number {
  const cleaned = repairNumericToken(raw).replace(/[,\s]/g, '')
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0 || value > 10_000_000) return 0
  return Math.round(value * 100)
}

function moneyTokens(line: string): { raw: string; index: number; paise: number }[] {
  const found: { raw: string; index: number; paise: number }[] = []
  MONEY.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = MONEY.exec(line)) !== null) {
    const token = match[1]
    // A bare 1–2 digit number immediately after a word is usually a quantity
    // or a table number, not money, unless it carries decimals or a symbol.
    const hasSymbol = /₹|rs|inr/i.test(match[0])
    const hasDecimals = /\./.test(token)
    if (!hasSymbol && !hasDecimals && token.replace(/[^0-9]/g, '').length <= 2) {
      const after = line.slice(match.index + match[0].length).trim()
      if (after && !/^[-–—|]/.test(after)) continue
    }
    const paise = toPaise(token)
    if (paise === 0) continue
    found.push({ raw: token, index: match.index, paise })
  }
  return found
}

function cleanName(raw: string): string {
  return raw
    .replace(/[*|_~`^]+/g, ' ')
    .replace(/\b(qty|nos?|pcs?)\.?\b/gi, ' ')
    .replace(/\b\d{1,3}\s*(?:x|×|\*|@)\s*$/i, ' ')
    .replace(/^\s*\d{1,3}\s*(?:x|×|\*|@)\s+/i, ' ')
    .replace(/\b\d{1,3}\s*(?:kg|g|ml|l|pcs?|nos?)\.?\b/gi, ' ')
    .replace(/\b\d{1,3}\s*$/, ' ')
    .replace(/[.:;,\-\u2013\u2014]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function isLikelyMerchantLine(line: string): boolean {
  if (line.length < 3 || line.length > 46) return false
  if (/[0-9]{4,}/.test(line)) return false
  if (moneyTokens(line).length > 0) return false
  if (KEY.noise.test(line) || KEY.tax.test(line) || KEY.total.test(line)) return false
  return /[a-zA-Z]{3,}/.test(line)
}

const CATEGORY_WORDS: { category: ExpenseCategory; words: RegExp }[] = [
  {
    category: 'food',
    words:
      /\b(restaurant|cafe|coffee|bar|pub|biryani|pizza|burger|dhaba|kitchen|bakery|food|meal|lunch|dinner|breakfast|swiggy|zomato|chai|sweets|ice\s*cream|hotel\s*shri)\b/i,
  },
  {
    category: 'travel',
    words:
      /\b(uber|ola|rapido|irctc|train|flight|indigo|airlines|petrol|diesel|fuel|hpcl|iocl|bpcl|toll|fastag|parking|metro|bus|cab|auto)\b/i,
  },
  {
    category: 'stay',
    words: /\b(resort|stay|homestay|guest\s*house|oyo|airbnb|lodge|rooms?|check\s*-?\s*in)\b/i,
  },
  {
    category: 'groceries',
    words:
      /\b(mart|supermarket|super\s*market|grocery|groceries|kirana|dmart|bigbasket|blinkit|zepto|instamart|reliance\s*fresh|more\s*retail)\b/i,
  },
  {
    category: 'entertainment',
    words: /\b(cinema|pvr|inox|movie|theatre|ticket|concert|game|bowling|arcade|amusement)\b/i,
  },
  {
    category: 'utilities',
    words: /\b(electricity|water\s*bill|gas\s*bill|broadband|recharge|dth|postpaid|prepaid|bbmp|bescom)\b/i,
  },
  {
    category: 'shopping',
    words: /\b(mall|store|fashion|apparel|clothing|amazon|flipkart|myntra|ajio|footwear|electronics|decathlon)\b/i,
  },
]

/** Guess the expense category from the merchant and item names. */
export function inferCategory(text: string): ExpenseCategory {
  const haystack = text.slice(0, 4000)
  for (const entry of CATEGORY_WORDS) {
    if (entry.words.test(haystack)) return entry.category
  }
  return 'other'
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Parse OCR text into a structured receipt.
 * Never throws; an empty result carries warnings explaining why.
 */
export function parseReceipt(rawText: string): ParsedReceipt {
  const text = normaliseOcr(rawText)
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, ' ').replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean)

  const items: ReceiptItem[] = []
  const taxes: ReceiptTax[] = []
  let subtotalPaise = 0
  let discountPaise = 0
  let statedTotal = 0
  let totalLineSeen = false
  let merchant: string | undefined
  // Some receipts print the item name and its price on separate lines. Hold the
  // name until the next line has a number to attach to it.
  let pendingName: string | null = null

  for (const line of lines) {
    if (!merchant && isLikelyMerchantLine(line)) merchant = cleanName(line).slice(0, 60)

    const amounts = moneyTokens(line)
    if (amounts.length === 0) {
      const candidate = cleanName(line)
      const usableName =
        candidate.length >= 3 &&
        candidate.length <= 60 &&
        /[a-zA-Z]{3,}/.test(candidate) &&
        !KEY.noise.test(line) &&
        !KEY.tax.test(line) &&
        !KEY.total.test(line) &&
        !KEY.subtotal.test(line) &&
        !KEY.discount.test(line) &&
        candidate !== merchant
      if (usableName) pendingName = candidate
      continue
    }

    const lineAmount = amounts[amounts.length - 1].paise

    if (KEY.tax.test(line)) {
      const pct = PERCENT.exec(line)
      const rate = pct ? Number(pct[1]) : undefined
      const label =
        /\bcgst\b/i.test(line)
          ? 'CGST'
          : /\bsgst\b/i.test(line)
            ? 'SGST'
            : /\bigst\b/i.test(line)
              ? 'IGST'
              : 'GST'
      taxes.push({ label, rate, amountPaise: lineAmount })
      continue
    }

    if (KEY.discount.test(line) && !KEY.subtotal.test(line)) {
      discountPaise += lineAmount
      continue
    }

    if (KEY.subtotal.test(line)) {
      subtotalPaise = Math.max(subtotalPaise, lineAmount)
      continue
    }

    if (KEY.total.test(line)) {
      statedTotal = Math.max(statedTotal, lineAmount)
      totalLineSeen = true
      continue
    }

    if (KEY.noise.test(line)) continue

    // Item line: name followed by an amount (optionally qty × rate).
    const nameEnd = amounts[0].index
    const rawName = line.slice(0, nameEnd)
    const printedName = cleanName(rawName)
    const name = printedName.length >= 2 ? printedName : (pendingName ?? '')
    if (printedName.length >= 2) pendingName = null
    if (name.length < 2) continue

    let quantity = 1
    let unitPaise = lineAmount
    let explicitRate = false

    const at = QTY_AT.exec(line)
    const x = QTY_X.exec(line)
    const lead = QTY_LEAD.exec(line)

    if (at) {
      const rate = toPaise(at[1])
      const qty = Number(at[2])
      if (rate > 0 && qty > 0 && qty <= 99) {
        quantity = qty
        unitPaise = rate
        explicitRate = true
      }
    } else if (x && Number(x[1]) > 0 && Number(x[1]) <= 99) {
      quantity = Number(x[1])
      const rate = toPaise(x[2])
      if (rate > 0) {
        unitPaise = rate
        explicitRate = true
      }
    } else if (lead) {
      quantity = Number(lead[1])
      const rate = toPaise(lead[2])
      if (rate > 0) unitPaise = rate
    }

    if (amounts.length >= 2 && !explicitRate) {
      // Columns like "Name 150.00 300.00": last is amount, second-last is rate.
      const rate = amounts[amounts.length - 2].paise
      if (rate > 0) {
        const impliedQty = Math.round(lineAmount / rate)
        if (impliedQty >= 2 && impliedQty <= 99 && Math.abs(impliedQty * rate - lineAmount) <= 100) {
          quantity = impliedQty
          unitPaise = rate
          explicitRate = true
        }
      }
    }

    if (!explicitRate && quantity > 1) unitPaise = Math.round(lineAmount / quantity)

    items.push({
      name: name.slice(0, 70),
      quantity,
      unitPaise,
      amountPaise: lineAmount,
      explicitRate,
    })
  }

  const itemTotal = items.reduce((sum, item) => sum + item.amountPaise, 0)
  const taxTotal = taxes.reduce((sum, tax) => sum + tax.amountPaise, 0)

  if (subtotalPaise === 0) subtotalPaise = itemTotal

  const computedTotal = subtotalPaise + taxTotal - discountPaise
  const totalPaise = statedTotal > 0 ? statedTotal : Math.max(computedTotal, itemTotal)

  // GST rate: the sum of the tax rates printed (CGST 2.5 + SGST 2.5 = 5%).
  const rateSum = taxes.reduce((sum, tax) => sum + (tax.rate ?? 0), 0)
  const gstRate =
    rateSum > 0
      ? round1(rateSum)
      : taxes.length > 0
        ? undefined
        : detectPrintedGst(text)

  const warnings: string[] = []
  if (items.length === 0) warnings.push('No item lines were recognised.')
  if (!totalLineSeen) warnings.push('No printed total found — using the item lines.')

  const delta = totalPaise - (computedTotal || itemTotal)
  if (items.length > 0 && totalPaise > 0 && Math.abs(delta) > 100) {
    const dir = delta > 0 ? 'less' : 'more'
    warnings.push(
      `Lines add up to ₹${((computedTotal || itemTotal) / 100).toFixed(2)}, which is ₹${(
        Math.abs(delta) / 100
      ).toFixed(2)} ${dir} than the printed total.`,
    )
  }

  // Confidence: how much of the receipt actually reconciled.
  let confidence = 0
  if (items.length > 0) confidence += 0.35
  if (totalLineSeen) confidence += 0.25
  if (merchant) confidence += 0.1
  if (items.length > 0 && Math.abs(delta) <= 100) confidence += 0.2
  if (taxes.length > 0 && gstRate !== undefined) confidence += 0.1
  confidence = Math.min(1, Math.round(confidence * 100) / 100)

  return {
    merchant,
    items,
    subtotalPaise,
    taxes,
    discountPaise,
    totalPaise,
    gstRate,
    confidence,
    warnings,
    rawText: text,
  }
}

export function detectPrintedGst(text: string): number | undefined {
  const match = /\b(?:gst|tax)\b[^\n%]{0,12}?([0-9]{1,2}(?:\.[0-9]{1,2})?)\s*%/i.exec(text)
  if (!match) return undefined
  const rate = Number(match[1])
  return rate > 0 && rate <= 28 ? rate : undefined
}

/** True when the extraction is trustworthy enough to save without edits. */
export function isReceiptConfident(receipt: ParsedReceipt): boolean {
  return receipt.totalPaise > 0 && receipt.items.length > 0 && receipt.confidence >= 0.7
}
