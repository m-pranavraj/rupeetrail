/** RupeeTrail on-device AI — everything runs in the browser.
 *
 * - Bill photos: canvas clean-up, then Tesseract.js OCR, then the structured
 *   receipt parser (line items, quantity, CGST/SGST, discount, reconciliation).
 * - Voice: the browser's Web Speech API, then the spoken-split parser.
 *
 * No API keys, no server round-trip, no per-call cost.
 */
import { prepareImageForOcr } from './image-prep'
import { parseReceipt, type ParsedReceipt } from './receipt'

export interface OcrText {
  text: string
}

/** OCR an image with Tesseract, loaded on demand and cached by the browser. */
export async function extractTextFromImage(file: Blob, lang = 'eng'): Promise<OcrText> {
  const prepared = await prepareImageForOcr(file)
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(lang)
  try {
    const { data } = await worker.recognize(prepared)
    return { text: (data.text ?? '').trim() }
  } finally {
    await worker.terminate()
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
export async function captureBillOnDevice(file: Blob): Promise<CaptureResult> {
  try {
    const { text } = await extractTextFromImage(file)
    if (!text) {
      return {
        success: false,
        error: 'No text found in that photo. Try a sharper, straight-on shot.',
      }
    }

    const receipt = parseReceipt(text)
    if (receipt.totalPaise === 0 && receipt.items.length === 0) {
      return {
        success: false,
        text,
        error: 'Could not find any amounts. Try a clearer photo or type it in.',
      }
    }

    return { success: true, receipt, text }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Bill scanning failed.'
    return { success: false, error: message }
  }
}
