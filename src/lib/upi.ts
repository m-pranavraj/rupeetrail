const UPI_PATTERN = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z0-9.-]{2,64}$/

export function isValidUpi(value: string): boolean {
  return UPI_PATTERN.test(value.trim())
}

/**
 * Build a UPI intent link. Every Indian UPI app (GPay, PhonePe, Paytm, bank
 * apps) understands this scheme, so the payer lands on their own app with the
 * amount prefilled instead of copying numbers across.
 */
export function upiPayLink(input: {
  upiId: string
  payeeName: string
  amountPaise: number
  note?: string
}): string {
  const params = new URLSearchParams({
    pa: input.upiId,
    pn: input.payeeName,
    am: (input.amountPaise / 100).toFixed(2),
    cu: 'INR',
  })
  if (input.note) params.set('tn', input.note.slice(0, 50))
  return `upi://pay?${params.toString()}`
}
