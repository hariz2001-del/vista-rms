/** Integer sen throughout, as everywhere else in Vista. */

export function assertSen(value: number, fieldName = 'amount'): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${fieldName} must be an integer number of sen`)
  }
  return value
}

export function formatRinggit(sen: number): string {
  assertSen(sen)
  const negative = sen < 0
  const absolute = Math.abs(sen)
  const ringgit = Math.trunc(absolute / 100)
  const cents = absolute % 100
  return `${negative ? '−' : ''}RM ${ringgit.toLocaleString('en-MY')}.${cents
    .toString()
    .padStart(2, '0')}`
}

export function formatSignedRinggit(sen: number): string {
  assertSen(sen)
  if (sen === 0) return formatRinggit(0)
  return sen > 0 ? `+${formatRinggit(sen)}` : formatRinggit(sen)
}

/** Compact form for chart axes and dense tables: RM 1.2k. */
export function formatRinggitShort(sen: number): string {
  assertSen(sen)
  const ringgit = sen / 100
  const absolute = Math.abs(ringgit)
  if (absolute >= 1000) return `RM ${(ringgit / 1000).toFixed(1)}k`
  return `RM ${Math.round(ringgit)}`
}

export function parseRinggitToSen(input: string): number | null {
  const match = /^\s*(?:RM\s*)?(-?\d+)(?:\.(\d{0,2}))?\s*$/i.exec(input)
  if (!match) return null

  const whole = Number(match[1])
  const cents = Number((match[2] ?? '').padEnd(2, '0'))
  const sen = whole < 0 ? whole * 100 - cents : whole * 100 + cents
  return Number.isSafeInteger(sen) ? sen : null
}

export function formatPercent(value: number): string {
  return `${value}%`
}
