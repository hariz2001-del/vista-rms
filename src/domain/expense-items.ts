/**
 * Receipt lines in integer money — the same rule as api-vista's
 * `domain/expense-items.ts`, which recomputes every line and refuses a total
 * that disagrees. A quantity is held in thousandths of a unit (2.5 kg = 2500),
 * so a line total is one integer product divided once, rounded half away from
 * zero. Never a float.
 */

export function lineTotalSen(quantityMilli: number, unitPriceSen: number): number {
  const product = quantityMilli * unitPriceSen
  if (!Number.isSafeInteger(product)) throw new Error('line total out of range')
  const magnitude = Math.floor((Math.abs(product) + 500) / 1000)
  return product < 0 ? -magnitude : magnitude
}

/** `2`, `2.5`, `0.125` → thousandths. Null for anything else, or zero. */
export function parseQuantityMilli(input: string): number | null {
  const match = /^\s*(\d{1,6})(?:\.(\d{0,3}))?\s*$/.exec(input)
  if (!match) return null
  const milli = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'))
  return milli > 0 ? milli : null
}

/** 2500 → "2.5", 1000 → "1". */
export function formatQuantity(quantityMilli: number): string {
  const whole = Math.trunc(quantityMilli / 1000)
  const fraction = (quantityMilli % 1000).toString().padStart(3, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}

/** `12.90`, `-0.02`, `RM 8.50` → sen, allowing the sign a discount line needs. */
export function parseSignedPriceSen(input: string): number | null {
  const match = /^\s*(-)?\s*(?:RM\s*)?(\d{1,7})(?:\.(\d{0,2}))?\s*$/i.exec(input)
  if (!match) return null
  const sen = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'))
  return match[1] ? -sen : sen
}
