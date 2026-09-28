/**
 * Move every date in a value by whole days.
 *
 * The demo history is generated once, on a fixed canonical calendar, and then
 * slid forward so its last day is the real today: the same sales, expenses and
 * oddities, relabelled. Only strings that are wholly a date (`2026-09-08`) or an
 * ISO timestamp (`2026-09-08T12:04:00Z`) move; ids and descriptions that merely
 * contain a date are left alone, so references between records stay intact.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

export function addDays(date: string, days: number): string {
  const shifted = new Date(`${date}T12:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

/** Whole days from `from` to `to`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)
}

export function shiftDates<T>(value: T, days: number): T {
  if (days === 0) return value
  if (typeof value === 'string') {
    if (DATE.test(value)) return addDays(value, days) as T
    if (TIMESTAMP.test(value)) {
      return new Date(Date.parse(value) + days * 86_400_000).toISOString() as T
    }
    return value
  }
  if (Array.isArray(value)) return value.map((item) => shiftDates(item, days)) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, shiftDates(item, days)]),
    ) as T
  }
  return value
}

/** Today's date on the clock in Kuala Lumpur. */
export function malaysiaToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
