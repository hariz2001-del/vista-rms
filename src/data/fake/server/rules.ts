/**
 * Clock and pay arithmetic for the demo's fake server: copies of api-vista
 * src/domain/team-time.ts and src/domain/payroll.ts, so demo pay comes out to
 * the same sen as the real thing. Change both together.
 *
 * Malaysia is UTC+8 all year with no daylight saving, so a wall-clock time
 * converts to an instant by a fixed offset.
 */

const OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** `YYYY-MM-DD` + `HH:MM` in Malaysia → the instant. */
export function mytInstant(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  if (!y || !m || !d || hh === undefined || mm === undefined) throw new Error(`bad date/time ${date} ${time}`)
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - OFFSET_MS)
}

/** The Malaysia calendar date an instant falls on. */
export function mytDate(instant: Date | string): string {
  return new Date(new Date(instant).getTime() + OFFSET_MS).toISOString().slice(0, 10)
}

/** The Malaysia wall-clock time of an instant, `HH:MM`. */
export function mytTime(instant: Date | string): string {
  return new Date(new Date(instant).getTime() + OFFSET_MS).toISOString().slice(11, 16)
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10)
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const sundayFirst = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()
  return (sundayFirst + 6) % 7
}

export function mondayOf(date: string): string {
  return addDays(date, -weekdayOf(date))
}

/** An end at or before the start runs past midnight: 22:00–02:00 is four hours. */
export function shiftInstants(date: string, start: string, end: string): { startsAt: Date; endsAt: Date } {
  const startsAt = mytInstant(date, start)
  let endsAt = mytInstant(date, end)
  if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + DAY_MS)
  return { startsAt, endsAt }
}

export function minutesBetween(start: Date | string, end: Date | string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000)
}

function dayLabel(date: string, withMonth: boolean): string {
  return new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    ...(withMonth ? { month: 'short' } : {}),
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}

/** "21–27 Sept", "28 Sept – 4 Oct". */
export function rangeLabel(start: string, end: string): string {
  if (start === end) return dayLabel(start, true)
  return start.slice(0, 7) === end.slice(0, 7)
    ? `${dayLabel(start, false)}–${dayLabel(end, true)}`
    : `${dayLabel(start, true)} – ${dayLabel(end, true)}`
}

/** The trading day: a 1am sale belongs to the night before (5am cutoff, as the server). */
export function businessToday(now: Date): string {
  return mytDate(new Date(now.getTime() - 5 * 3_600_000))
}

/** The instant range covering Malaysia dates `start`…`end` inclusive. */
export function dateRange(start: string, end: string): { gte: number; lt: number } {
  return {
    gte: Date.parse(`${start}T00:00:00Z`) - OFFSET_MS,
    lt: Date.parse(`${end}T00:00:00Z`) + 16 * 3_600_000,
  }
}

// ---------------------------------------------------------------------------
// Pay
// ---------------------------------------------------------------------------

export type Rounding = { minutes: number; mode: 'FLOOR' | 'NEAREST' }

/** With half-hour floor rounding, 17:00–22:20 pays 300 minutes and 17:00–22:30 pays 330. */
export function payableMinutes(start: Date | string, end: Date | string, rounding: Rounding): number {
  const raw = Math.max(0, minutesBetween(start, end))
  const block = Math.max(1, rounding.minutes)
  return rounding.mode === 'NEAREST' ? Math.round(raw / block) * block : Math.floor(raw / block) * block
}

/** minutes × sen-per-hour ÷ 60, rounded half up to the sen. */
export function lineAmountSen(minutes: number, rateSenPerHour: number): number {
  return Math.round((minutes * rateSenPerHour) / 60)
}

type NamedRate = { name: string; rateSenPerHour: number }

export type RateSource = {
  rateOverrideSen: number | null
  attendanceWorkType: NamedRate | null
  assignmentWorkType: NamedRate | null
  slotWorkType: NamedRate | null
  staffDefaultWorkType: NamedRate | null
}

export type ResolvedRate = { workTypeName: string; rateSenPerHour: number; overridden: boolean } | null

/** Most specific first: the shift's one-off rate, the record's work type, the assignment's, the slot's, the person's usual one. */
export function resolveRate(source: RateSource): ResolvedRate {
  const workType =
    source.attendanceWorkType ?? source.assignmentWorkType ?? source.slotWorkType ?? source.staffDefaultWorkType
  if (source.rateOverrideSen !== null) {
    return { workTypeName: `${workType?.name ?? 'Shift'} (special rate)`, rateSenPerHour: source.rateOverrideSen, overridden: true }
  }
  if (!workType) return null
  return { workTypeName: workType.name, rateSenPerHour: workType.rateSenPerHour, overridden: false }
}

export type PayFrequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'CUSTOM'

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** The pay period containing `date`, counted from the anchor. Custom has none. */
export function periodContaining(date: string, frequency: PayFrequency, anchor: string): { start: string; end: string } | null {
  if (frequency === 'CUSTOM') return null
  if (frequency === 'MONTHLY') {
    const anchorDay = Number(anchor.slice(8, 10))
    const [y, m, d] = date.split('-').map(Number) as [number, number, number]
    const startIn = (year: number, month: number) => {
      const day = Math.min(anchorDay, lastDayOfMonth(year, month))
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
    let start = startIn(y, m)
    if (d < Number(start.slice(8, 10))) start = startIn(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1)
    const [sy, sm] = start.split('-').map(Number) as [number, number]
    const nextStart = startIn(sm === 12 ? sy + 1 : sy, sm === 12 ? 1 : sm + 1)
    return { start, end: addDays(nextStart, -1) }
  }
  const length = frequency === 'WEEKLY' ? 7 : 14
  const offset = ((daysBetween(anchor, date) % length) + length) % length
  const start = addDays(date, -offset)
  return { start, end: addDays(start, length - 1) }
}

/** The current period and the `count − 1` before it, newest first. */
export function recentPeriods(today: string, frequency: PayFrequency, anchor: string, count: number): Array<{ start: string; end: string }> {
  const periods: Array<{ start: string; end: string }> = []
  let cursor = today
  for (let index = 0; index < count; index += 1) {
    const period = periodContaining(cursor, frequency, anchor)
    if (!period) break
    periods.push(period)
    cursor = addDays(period.start, -1)
  }
  return periods
}
