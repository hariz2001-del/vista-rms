import type { Brand, Category, Order, OrderLine, SaleCorrection } from './types.ts'
import { lineNetSen } from './sales-analytics.ts'
import { inRange, type DateRange } from './selectors.ts'

/**
 * The lines on the Overview sales chart.
 *
 * A range of days plots net sales per day. A single day plots net sales per
 * hour — each hour on its own, never carried into the next — so the rush and
 * the quiet stretches of the shift stand out. Integer sen throughout.
 *
 * Overall and by-brand figures are the books' figures: sales plus every cancel
 * and exchange, as "Net sales" above the chart counts them. By-category figures
 * are sale lines only — a correction is recorded per brand, not per category —
 * so cancelled sales are left out and exchanges count as first rung up.
 */

export type SeriesMode = 'OVERALL' | 'BRAND' | 'CATEGORY'

export type SeriesDef = { key: string; label: string; colour: string }

export type SeriesPoint = {
  /** A date (`2026-09-28`) for day points; an ISO timestamp for time points. */
  at: string
  values: Record<string, number>
  /** An hour of today that has not started yet: on the axis, but no figure. */
  isFuture?: boolean
}

export type SalesSeries = {
  kind: 'DAY' | 'TIME'
  defs: SeriesDef[]
  points: SeriesPoint[]
}

export const OVERALL_KEY = 'overall'
export const OTHER_KEY = 'other'
export const HOUR_MS = 3_600_000

/** Minutes per point on a single day's chart, trading-chart style: H4, H1, M30. */
export type TimeFrame = 240 | 60 | 30
export const TIME_FRAMES: Array<{ minutes: TimeFrame; label: string }> = [
  { minutes: 240, label: 'H4' },
  { minutes: 60, label: 'H1' },
  { minutes: 30, label: 'M30' },
]

/** The validated categorical order (light surface #fffdf8), assigned by menu position. */
export const CATEGORY_COLOURS = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#4a3aa7',
  '#e34948',
] as const
const OTHER_COLOUR = '#898781'
const OVERALL_COLOUR = '#2a78d6'

function eachDate(from: string, to: string): string[] {
  const dates: string[] = []
  const cursor = new Date(`${from}T12:00:00Z`)
  const end = new Date(`${to}T12:00:00Z`)
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

/**
 * The lines to draw, in a fixed order. A category keeps the colour of its place
 * on the menu whatever else is shown; past eight, the rest share one "Other".
 */
export function seriesDefs(
  mode: SeriesMode,
  brands: readonly Brand[],
  categories: readonly Category[],
  brandId: string | null,
  /** A sold category no longer on the menu needs somewhere to go. */
  forceOther = false,
): { defs: SeriesDef[]; keyFor: (line: OrderLine) => string | null } {
  if (mode === 'OVERALL') {
    return {
      defs: [{ key: OVERALL_KEY, label: 'Net sales', colour: OVERALL_COLOUR }],
      keyFor: () => OVERALL_KEY,
    }
  }
  if (mode === 'BRAND') {
    return {
      defs: brands.map((brand) => ({ key: brand.id, label: brand.name, colour: brand.chartColour })),
      keyFor: (line) => line.brandId,
    }
  }
  const own = categories.filter((category) => category.brandId === brandId)
  const named = own.slice(0, CATEGORY_COLOURS.length)
  const folded = new Set(own.slice(CATEGORY_COLOURS.length).map((category) => category.id))
  const defs: SeriesDef[] = named.map((category, index) => ({
    key: category.id,
    label: category.name,
    colour: CATEGORY_COLOURS[index] ?? OTHER_COLOUR,
  }))
  if (folded.size > 0 || forceOther) defs.push({ key: OTHER_KEY, label: 'Other', colour: OTHER_COLOUR })
  const namedIds = new Set(named.map((category) => category.id))
  return {
    defs,
    keyFor: (line) =>
      line.brandId !== brandId ? null : namedIds.has(line.categoryId) ? line.categoryId : OTHER_KEY,
  }
}

function emptyValues(defs: readonly SeriesDef[]): Record<string, number> {
  return Object.fromEntries(defs.map((def) => [def.key, 0]))
}

/** Adds a correction's per-brand money to the right lines. None for categories. */
function correctionAmounts(
  mode: SeriesMode,
  correction: SaleCorrection,
): Array<[string, number]> {
  if (mode === 'OVERALL') return [[OVERALL_KEY, correction.deltaSen]]
  if (mode === 'BRAND') return correction.brandDeltas.map((delta) => [delta.brandId, delta.deltaSen])
  return []
}

export function salesSeries(
  orders: readonly Order[],
  corrections: readonly SaleCorrection[],
  range: DateRange,
  mode: SeriesMode,
  brands: readonly Brand[],
  categories: readonly Category[],
  brandId: string | null = null,
  /** The owner's "day starts at" hour: a business day's 24 hours begin here. */
  dayRolloverHour = 5,
  now: Date = new Date(),
  /** A single day's time frame: 240 (H4), 60 (H1) or 30 (M30). */
  frameMinutes: TimeFrame = 60,
): SalesSeries {
  const cancelled = new Set(
    corrections.filter((c) => c.kind === 'CANCEL').map((c) => c.originalOrderId),
  )
  const periodOrders = inRange(orders, range.startDate, range.endDate).filter(
    // Category lines cannot net off a cancel, so the cancelled sale is dropped.
    (order) => mode !== 'CATEGORY' || !cancelled.has(order.id),
  )
  const periodCorrections = inRange(corrections, range.startDate, range.endDate)

  const onMenu = new Set(categories.map((category) => category.id))
  const soldOffMenu =
    mode === 'CATEGORY' &&
    periodOrders.some((order) =>
      order.lines.some((line) => line.brandId === brandId && !onMenu.has(line.categoryId)),
    )
  const { defs, keyFor } = seriesDefs(mode, brands, categories, brandId, soldOffMenu)

  const add = (values: Record<string, number>, key: string | null, sen: number) => {
    if (key === null || !(key in values)) return
    values[key] = (values[key] ?? 0) + sen
  }

  // ---- A range of days: one point per day, closed days included as zero ----
  if (range.startDate !== range.endDate) {
    const byDate = new Map(eachDate(range.startDate, range.endDate).map((date) => [date, emptyValues(defs)]))
    for (const order of periodOrders) {
      const values = byDate.get(order.businessDate)
      if (!values) continue
      for (const line of order.lines) add(values, keyFor(line), lineNetSen(line))
    }
    for (const correction of periodCorrections) {
      const values = byDate.get(correction.businessDate)
      if (!values) continue
      for (const [key, sen] of correctionAmounts(mode, correction)) add(values, key, sen)
    }
    return {
      kind: 'DAY',
      defs,
      points: [...byDate.entries()].map(([at, values]) => ({ at, values })),
    }
  }

  // ---- One day: net sales inside each time frame of its 24 hours ----
  type Event = { ms: number; amounts: Array<[string | null, number]> }
  const events: Event[] = [
    ...periodOrders.map((order) => ({
      ms: Date.parse(order.completedAt),
      amounts: order.lines.map((line): [string | null, number] => [keyFor(line), lineNetSen(line)]),
    })),
    // A cancel or exchange counts against the hour it was made in, so an hour
    // with more refunded than sold goes below zero.
    ...periodCorrections.map((correction) => ({
      ms: Date.parse(correction.createdAt),
      amounts: correctionAmounts(mode, correction),
    })),
  ]
  // The business day runs from the rollover hour on its date to the same hour
  // the next day, on the Malaysian clock (UTC+8): with a 5am rollover, 5am to
  // 4:59am. A night shift therefore sits inside one day, past 12am included.
  const dayStart = Date.parse(`${range.startDate}T00:00:00Z`) + (dayRolloverHour - 8) * HOUR_MS
  const frameMs = frameMinutes * 60_000
  const frameCount = (24 * HOUR_MS) / frameMs
  const buckets = Array.from({ length: frameCount }, () => emptyValues(defs))
  for (const event of events) {
    // A sale filed under this date but outside its window (the rollover was
    // changed since) goes to the nearest end rather than being lost.
    const index = Math.min(frameCount - 1, Math.max(0, Math.floor((event.ms - dayStart) / frameMs)))
    const values = buckets[index]
    if (!values) continue
    for (const [key, sen] of event.amounts) add(values, key, sen)
  }
  if (events.length === 0 && dayStart + 24 * HOUR_MS <= now.getTime()) {
    return { kind: 'TIME', defs, points: [] }
  }
  // Still to come: after the clock AND after the last recorded sale, so a sale
  // is never hidden by a device clock that runs slow.
  const lastEvent = Math.max(-Infinity, ...events.map((event) => event.ms))
  return {
    kind: 'TIME',
    defs,
    points: buckets.map((values, index) => {
      const start = dayStart + index * frameMs
      return start > now.getTime() && start > lastEvent
        ? { at: new Date(start).toISOString(), values, isFuture: true }
        : { at: new Date(start).toISOString(), values }
    }),
  }
}

/** 1, 2, 2.5, 5 or 10 × a power of ten, at or above `value`. */
function niceStep(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const scaled = value / magnitude
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10
  return step * magnitude
}

/**
 * The y-axis for a set of sen values: round gridlines on one step, spanning
 * zero and everything plotted. The step is whole sen and at least RM 1, so a
 * day with no sales yet — every value zero — still gets a sane axis rather
 * than a gridline at a fraction of a sen (which the money formatter rightly
 * refuses, and which took the whole RMS down on an empty morning).
 */
export function axisTicks(values: readonly number[]): { floor: number; ceiling: number; ticks: number[] } {
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const step = Math.max(100, Math.round(niceStep(Math.max(1, max - min) / 4)))
  const floor = Math.floor(min / step) * step
  const ceiling = Math.max(floor + step, Math.ceil(max / step) * step)
  const ticks: number[] = []
  for (let tick = floor; tick <= ceiling; tick += step) ticks.push(tick)
  return { floor, ceiling, ticks }
}

/** Each line's figure for the whole period: its days, or its hours, summed. */
export function seriesTotals(series: SalesSeries): Record<string, number> {
  const totals = emptyValues(series.defs)
  for (const point of series.points) {
    for (const def of series.defs) totals[def.key] = (totals[def.key] ?? 0) + (point.values[def.key] ?? 0)
  }
  return totals
}
