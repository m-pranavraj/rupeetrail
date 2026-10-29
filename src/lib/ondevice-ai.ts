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
    await (worker as unknown as { terminate: () => Promise<void> }).terminate().catch(() => { })
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
// Voice command understanding lives in a DOM-free module so the native app
// shares exactly the same parser.
export {
  parseVoiceCommand,
  commandHelp,
  type AiCommand,
  type AiCommandResult,
  type VoiceCommandContext,
} from './voice-command'

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
    } catch { }
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
