import React, { useCallback, useRef, useState } from 'react'
import { Sheet, StatusPill } from './ui'
import { formatPaise } from '../lib/money'
import { captureBillOnDevice, isVoiceSupported, transcribeVoiceOnDevice } from '../lib/ondevice-ai'
import { buildExpenseFromReceipt, buildExpenseFromVoice } from '../lib/billParser'
import { parseVoiceSplit, type ParsedVoice } from '../lib/voice'
import type { ParsedReceipt } from '../lib/receipt'
import type { Expense } from '../types'

type Stage = 'choose' | 'photo' | 'voice'

/**
 * BillCapture — an on-device sheet. A photo is cleaned up and OCR'd in the
 * browser, a sentence is transcribed with the Web Speech API, and both are
 * parsed into a structured draft. Nothing is uploaded.
 */
export function BillCapture({
  open,
  onClose,
  groupMembers,
  meMemberId,
  onSave,
}: {
  open: boolean
  onClose: () => void
  groupMembers: { id: string; name: string }[]
  meMemberId?: string
  onSave: (expense: Partial<Expense>) => void
}) {
  const [stage, setStage] = useState<Stage>('choose')
  const [receipt, setReceipt] = useState<ParsedReceipt | null>(null)
  const [voice, setVoice] = useState<ParsedVoice | null>(null)
  const [transcript, setTranscript] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const cancelVoice = useRef<(() => void) | null>(null)

  const reset = useCallback(() => {
    cancelVoice.current?.()
    cancelVoice.current = null
    setStage('choose')
    setReceipt(null)
    setVoice(null)
    setTranscript('')
    setBusy(false)
    setProgress('')
    setError('')
  }, [])

  const close = useCallback(() => {
    reset()
    onClose()
  }, [onClose, reset])

  const onPhoto = useCallback(async (file: File) => {
    setBusy(true)
    setError('')
    setProgress('Cleaning up the photo…')
    try {
      // Give the browser a frame to paint the progress line before the worker starts.
      await new Promise((resolve) => setTimeout(resolve, 30))
      setProgress('Reading the text…')
      const result = await captureBillOnDevice(file)
      if (!result.success || !result.receipt) {
        setError(result.error ?? 'Could not read that bill.')
        return
      }
      setReceipt(result.receipt)
    } finally {
      setBusy(false)
      setProgress('')
    }
  }, [])

  const startVoice = useCallback(async () => {
    setBusy(true)
    setError('')
    setTranscript('')
    setStage('voice')
    try {
      const session = transcribeVoiceOnDevice()
      cancelVoice.current = session.cancel
      const spoken = await session.promise
      cancelVoice.current = null
      setTranscript(spoken)
      setVoice(parseVoiceSplit(spoken, groupMembers, meMemberId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Voice input failed.')
    } finally {
      setBusy(false)
    }
  }, [groupMembers, meMemberId])

  const payer = meMemberId ?? groupMembers[0]?.id ?? ''
  const memberIds = groupMembers.map((member) => member.id)

  const useReceipt = useCallback(() => {
    if (!receipt) return
    onSave(buildExpenseFromReceipt(receipt, payer, new Set(memberIds)))
    close()
  }, [receipt, payer, memberIds, onSave, close])

  const useVoice = useCallback(() => {
    if (!voice) return
    onSave(buildExpenseFromVoice(voice, payer, new Set(memberIds)))
    close()
  }, [voice, payer, memberIds, onSave, close])

  const confidenceLabel = (value: number): { tone: 'ok' | 'warn' | 'bad'; text: string } => {
    if (value >= 0.8) return { tone: 'ok', text: 'High confidence' }
    if (value >= 0.55) return { tone: 'warn', text: 'Check the numbers' }
    return { tone: 'bad', text: 'Low confidence' }
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Scan a bill"
      subtitle="Reads the photo on this phone — no upload, no API key."
    >
      {stage === 'choose' && (
        <div className="form">
          <label className="btn btn--primary btn--block" style={{ cursor: 'pointer' }}>
            {busy ? 'Working…' : 'Take or upload a photo'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void onPhoto(file)
              }}
            />
          </label>

          {isVoiceSupported() && (
            <button className="btn btn--ghost btn--block" onClick={startVoice} disabled={busy}>
              Explain it with your voice
            </button>
          )}

          {progress && <p className="hint">{progress}</p>}

          <p className="hint">
            The photo is greyscaled and contrast-boosted, then read with Tesseract OCR in a
            browser worker. Line items, quantity, GST and the total are extracted and
            cross-checked. Nothing leaves the device.
          </p>

          {error && <p className="form-error">{error}</p>}
        </div>
      )}

      {stage === 'photo' && (
        <div className="form">
          {busy && <p className="hint">{progress || 'Reading the bill…'}</p>}
          {error && <p className="form-error">{error}</p>}
          {!busy && (
            <button className="btn btn--ghost btn--block" onClick={reset}>
              Try another photo
            </button>
          )}
        </div>
      )}

      {stage === 'voice' && (
        <div className="form">
          {busy && <p className="hint">Listening… say something like “Dinner 1200, Priya 400, I paid”.</p>}
          {error && <p className="form-error">{error}</p>}
          {!busy && (
            <>
              <button className="btn btn--ghost btn--block" onClick={startVoice}>
                Say it again
              </button>
              <button className="btn btn--ghost btn--block" onClick={reset}>
                Back
              </button>
            </>
          )}
        </div>
      )}

      {receipt && (
        <div className="form">
          {receipt.merchant && <h3 className="bill-capture__merchant">{receipt.merchant}</h3>}

          <div className="bill-capture__badges">
            <StatusPill tone={confidenceLabel(receipt.confidence).tone}>
              {confidenceLabel(receipt.confidence).text} · {Math.round(receipt.confidence * 100)}%
            </StatusPill>
            {receipt.gstRate !== undefined && (
              <StatusPill tone="muted">GST {receipt.gstRate}%</StatusPill>
            )}
          </div>

          {receipt.items.length > 0 ? (
            <ul className="bill-capture__items">
              {receipt.items.map((item, index) => (
                <li key={`${item.name}-${index}`} className="bill-capture__item">
                  <span>
                    {item.name}
                    {item.quantity > 1 && (
                      <em className="bill-capture__qty">
                        {' '}
                        {item.quantity} × {formatPaise(item.unitPaise)}
                      </em>
                    )}
                  </span>
                  <strong>{formatPaise(item.amountPaise)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">No item lines were found — only a total.</p>
          )}

          <dl className="bill-capture__totals">
            {receipt.subtotalPaise > 0 && (
              <>
                <dt>Subtotal</dt>
                <dd>{formatPaise(receipt.subtotalPaise)}</dd>
              </>
            )}
            {receipt.taxes.map((tax, index) => (
              <React.Fragment key={`${tax.label}-${index}`}>
                <dt>
                  {tax.label}
                  {tax.rate !== undefined ? ` ${tax.rate}%` : ''}
                </dt>
                <dd>{formatPaise(tax.amountPaise)}</dd>
              </React.Fragment>
            ))}
            {receipt.discountPaise > 0 && (
              <>
                <dt>Discount</dt>
                <dd>−{formatPaise(receipt.discountPaise)}</dd>
              </>
            )}
            <dt className="bill-capture__grand">Total</dt>
            <dd className="bill-capture__grand">{formatPaise(receipt.totalPaise)}</dd>
          </dl>

          {receipt.warnings.map((warning) => (
            <p key={warning} className="form-error">
              {warning}
            </p>
          ))}

          <details className="hint">
            <summary>Text read from the photo</summary>
            <pre className="bill-capture__raw">{receipt.rawText.slice(0, 1200)}</pre>
          </details>

          <p className="hint">This fills the form — confirm the amount and the split before saving.</p>

          <button className="btn btn--primary btn--block" onClick={useReceipt}>
            Use these details
          </button>
          <button
            className="btn btn--ghost btn--block"
            onClick={() => {
              setReceipt(null)
              setStage('choose')
            }}
          >
            Scan again
          </button>
        </div>
      )}

      {voice && (
        <div className="form">
          <div className="bill-capture__badges">
            <StatusPill tone="muted">
              {voice.mode === 'equal' ? 'Equal split' : voice.mode === 'exact' ? 'Exact shares' : 'Percentages'}
            </StatusPill>
            {voice.gstRate !== undefined && <StatusPill tone="muted">GST {voice.gstRate}%</StatusPill>}
          </div>

          <p className="hint">“{transcript}”</p>

          {voice.people.length > 0 ? (
            <ul className="bill-capture__items">
              {voice.people.map((person, index) => (
                <li key={`${person.name}-${index}`} className="bill-capture__item">
                  <span>
                    {person.name}
                    {!person.memberId && <em className="bill-capture__qty"> (not in group)</em>}
                  </span>
                  <strong>
                    {person.percent !== undefined
                      ? `${person.percent}%`
                      : person.amountPaise !== undefined
                        ? formatPaise(person.amountPaise)
                        : 'equal share'}
                  </strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">No people were recognised.</p>
          )}

          <div className="bill-capture__total">
            <span>Total</span>
            <strong>{formatPaise(voice.totalPaise)}</strong>
          </div>

          {voice.payerName && <p className="hint">Paid by {voice.payerName}</p>}

          {voice.warnings.map((warning) => (
            <p key={warning} className="form-error">
              {warning}
            </p>
          ))}

          <button className="btn btn--primary btn--block" onClick={useVoice} disabled={voice.totalPaise <= 0}>
            Use these details
          </button>
          <button
            className="btn btn--ghost btn--block"
            onClick={() => {
              setVoice(null)
              setStage('choose')
            }}
          >
            Start over
          </button>
        </div>
      )}
    </Sheet>
  )
}
