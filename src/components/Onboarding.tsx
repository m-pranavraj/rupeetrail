import React, { useState } from 'react'
import { useStore } from '../lib/store'
import { isValidUpi } from '../lib/upi'

/**
 * Onboarding — create or enter the account that owns this phone number.
 *
 * The mobile number is the unique account key (enforced by a UNIQUE column in
 * D1); the 4-digit PIN is the secret. Signing in with the same number on another
 * phone restores every group this number belongs to.
 */
export function Onboarding({
  title,
  subtitle,
  submitLabel,
  onDone,
  onClose,
}: {
  title?: string
  subtitle?: string
  submitLabel?: string
  onDone: () => void | Promise<void>
  onClose?: () => void
}) {
  const { signUp, signIn } = useStore()
  const [mode, setMode] = useState<'signup' | 'signin'>('signup')
  const [name, setName] = useState('')
  const [upiId, setUpi] = useState('')
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')

    const digits = phone.replace(/\D/g, '').slice(-10)
    const trimmedName = name.trim()
    const trimmedUpi = upiId.trim()

    if (mode === 'signup') {
      if (!trimmedName) return setError('Your name is how friends see you.')
      if (trimmedUpi && !isValidUpi(trimmedUpi)) {
        return setError('UPI ids look like name@bank. Fix it or leave it blank.')
      }
    }
    if (!/^[6-9]\d{9}$/.test(digits)) {
      return setError('Enter a 10-digit mobile number starting with 6, 7, 8 or 9.')
    }
    if (!/^\d{4}$/.test(pin)) return setError('Choose a 4-digit PIN.')

    setSaving(true)
    try {
      if (mode === 'signup') {
        await signUp({ name: trimmedName, upiId: trimmedUpi, phone: digits, pin })
      } else {
        await signIn({ phone: digits, pin })
      }
      await onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not do that. Try again in a moment.')
    } finally {
      setSaving(false)
    }
  }

  const signingIn = mode === 'signin'

  return (
    <div className="screen onboarding">
      {onClose && (
        <header className="join__head">
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
          <span className="join__brand">RupeeSplit</span>
        </header>
      )}

      <div className="join__card">
        <span className="join__emoji" aria-hidden>
          ₹
        </span>
        <h1 className="join__title">
          {title ?? (signingIn ? 'Sign in with your number' : 'Two things, then you’re in')}
        </h1>
        <p className="join__sub">
          {subtitle ??
            (signingIn
              ? 'Your groups come back with you on any phone.'
              : 'Your mobile number is your account. No OTP, no email — just a PIN you choose.')}
        </p>

        <div className="segmented" role="tablist" style={{ marginBottom: '14px' }}>
          <button
            role="tab"
            type="button"
            aria-selected={!signingIn}
            className={`segmented__item${!signingIn ? ' is-active' : ''}`}
            onClick={() => {
              setMode('signup')
              setError('')
            }}
          >
            New account
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={signingIn}
            className={`segmented__item${signingIn ? ' is-active' : ''}`}
            onClick={() => {
              setMode('signin')
              setError('')
            }}
          >
            Sign in
          </button>
        </div>

        <form className="form" onSubmit={submit}>
          {!signingIn && (
            <>
              <label className="field">
                <span>Name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Arjun"
                  maxLength={40}
                  autoComplete="name"
                />
              </label>

              <label className="field">
                <span>UPI id (optional)</span>
                <input
                  value={upiId}
                  onChange={(event) => setUpi(event.target.value)}
                  placeholder="name@okhdfcbank"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={100}
                  autoComplete="off"
                />
              </label>
            </>
          )}

          <label className="field">
            <span>Mobile number</span>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="9876543210"
              type="tel"
              inputMode="numeric"
              maxLength={14}
              autoComplete="tel"
              autoFocus={signingIn}
            />
            <small>
              {signingIn
                ? 'The number this account was created with.'
                : 'One account per number. This is how you sign in again.'}
            </small>
          </label>

          <label className="field">
            <span>4-digit PIN</span>
            <input
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="••••"
              type="password"
              inputMode="numeric"
              maxLength={4}
              autoComplete={signingIn ? 'current-password' : 'new-password'}
            />
            <small>Kept hashed on the server. Five wrong tries lock it for 15 minutes.</small>
          </label>

          {error && <p className="form-error">{error}</p>}

          <button className="btn btn--primary btn--block" type="submit" disabled={saving}>
            {saving ? 'Please wait…' : signingIn ? 'Sign in' : (submitLabel ?? 'Continue')}
          </button>
        </form>
      </div>
    </div>
  )
}
