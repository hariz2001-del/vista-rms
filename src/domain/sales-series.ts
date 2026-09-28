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
}

export type SalesSeries = {
  kind: 'DAY' | 'TIME'
  defs: SeriesDef[]
  points: SeriesPoint[]
}

export const OVERALL_KEY = 'overall'
export const OTHER_KEY = 'other'
export const HOUR_MS = 3_600_000

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

  // ---- One day: net sales inside each hour, from the first sale's hour to the last's ----
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
  if (events.length === 0) return { kind: 'TIME', defs, points: [] }

  // Malaysia is a whole number of hours from UTC, so a UTC hour is a local hour.
  const hourOf = (ms: number) => Math.floor(ms / HOUR_MS) * HOUR_MS
  const firstHour = Math.min(...events.map((event) => hourOf(event.ms)))
  const lastHour = Math.max(...events.map((event) => hourOf(event.ms)))
  const buckets = new Map<number, Record<string, number>>()
  // Every hour of the shift gets a point, quiet hours included as zero; a
  // cross-midnight shift simply runs on past 12am under the same business date.
  for (let hour = firstHour; hour <= lastHour; hour += HOUR_MS) buckets.set(hour, emptyValues(defs))
  for (const event of events) {
    const values = buckets.get(hourOf(event.ms))
    if (!values) continue
    for (const [key, sen] of event.amounts) add(values, key, sen)
  }
  return {
    kind: 'TIME',
    defs,
    points: [...buckets.entries()].map(([hour, values]) => ({ at: new Date(hour).toISOString(), values })),
  }
}

/** Each line's figure for the whole period: its days, or its hours, summed. */
export function seriesTotals(series: SalesSeries): Record<string, number> {
  const totals = emptyValues(series.defs)
  for (const point of series.points) {
    for (const def of series.defs) totals[def.key] = (totals[def.key] ?? 0) + (point.values[def.key] ?? 0)
  }
  return totals
}
