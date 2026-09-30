import { describe, expect, it } from 'vitest'
import type { Brand, Category, Order, OrderLine, SaleCorrection } from './types.ts'
import { CATEGORY_COLOURS, OTHER_KEY, OVERALL_KEY, axisTicks, salesSeries, seriesTotals } from './sales-series.ts'

describe('axisTicks', () => {
  it('gives a day with no sales yet a whole-ringgit axis, not a fraction of a sen', () => {
    // This exact case — an empty morning — blanked the whole RMS.
    const { floor, ceiling, ticks } = axisTicks([0, 0, 0])
    expect(floor).toBe(0)
    expect(ceiling).toBe(100)
    expect(ticks).toEqual([0, 100])
    expect(axisTicks([])).toEqual({ floor: 0, ceiling: 100, ticks: [0, 100] })
  })

  it('uses whole-sen round steps, and reaches below zero when a value does', () => {
    for (const values of [[1], [3], [99], [150], [25_300], [-1_600, 22_350], [7, -3]]) {
      const { floor, ceiling, ticks } = axisTicks(values)
      for (const tick of ticks) expect(Number.isInteger(tick)).toBe(true)
      expect(floor).toBeLessThanOrEqual(Math.min(0, ...values))
      expect(ceiling).toBeGreaterThanOrEqual(Math.max(0, ...values))
    }
    expect(axisTicks([-1_600, 22_350]).ticks).toEqual([-10_000, 0, 10_000, 20_000, 30_000])
  })
})

const BRANDS: Brand[] = [
  { id: 'food', name: 'Food', colour: '#e35f27', softColour: '#fff', chartColour: '#e2601f' },
  { id: 'drinks', name: 'Drinks', colour: '#087f88', softColour: '#fff', chartColour: '#0a8fa0' },
]
const CATEGORIES: Category[] = [
  { id: 'rice', brandId: 'food', name: 'Rice' },
  { id: 'noodles', brandId: 'food', name: 'Noodles' },
  { id: 'cold', brandId: 'drinks', name: 'Cold' },
]

function line(brandId: string, categoryId: string, unitPriceSen: number): OrderLine {
  return {
    productName: 'x',
    brandId,
    categoryId,
    quantity: 1,
    unitPriceSen,
    modifierTotalSen: 0,
    lineDiscountSen: 0,
    allocatedOrderDiscountSen: 0,
  }
}

function order(id: string, businessDate: string, completedAt: string, lines: OrderLine[]): Order {
  const total = lines.reduce((sum, l) => sum + l.unitPriceSen, 0)
  return {
    id,
    shiftId: 's',
    businessDate,
    queueNumber: `#${id}`,
    offlineLabel: null,
    completedAt,
    grossSen: total,
    lineDiscountSen: 0,
    orderDiscountSen: 0,
    totalAmountSen: total,
    flagStatus: 'NONE',
    flagReason: null,
    needsReview: false,
    reviewReason: null,
    lines,
  }
}

const ORDERS = [
  order('1', '2026-09-26', '2026-09-26T12:10:00Z', [line('food', 'rice', 1_200), line('drinks', 'cold', 500)]),
  order('2', '2026-09-28', '2026-09-28T12:05:00Z', [line('food', 'noodles', 900)]),
  order('3', '2026-09-28', '2026-09-28T12:40:00Z', [line('food', 'rice', 1_000), line('drinks', 'cold', 700)]),
]

const CANCEL: SaleCorrection = {
  id: 'c1',
  originalOrderId: '2',
  originalQueueNumber: '#2',
  shiftId: 's',
  businessDate: '2026-09-28',
  createdAt: '2026-09-28T13:00:00Z',
  kind: 'CANCEL',
  reason: 'x',
  deltaSen: -900,
  brandDeltas: [{ brandId: 'food', deltaSen: -900 }],
}

describe('salesSeries by day', () => {
  const range = { startDate: '2026-09-26', endDate: '2026-09-28' }

  it('gives every day in the range a point, closed days as zero', () => {
    const series = salesSeries(ORDERS, [], range, 'OVERALL', BRANDS, CATEGORIES)
    expect(series.kind).toBe('DAY')
    expect(series.points.map((p) => [p.at, p.values[OVERALL_KEY]])).toEqual([
      ['2026-09-26', 1_700],
      ['2026-09-27', 0],
      ['2026-09-28', 2_600],
    ])
  })

  it('splits by brand, with the brand chart colours, and nets off corrections', () => {
    const series = salesSeries(ORDERS, [CANCEL], range, 'BRAND', BRANDS, CATEGORIES)
    expect(series.defs.map((d) => [d.label, d.colour])).toEqual([
      ['Food', '#e2601f'],
      ['Drinks', '#0a8fa0'],
    ])
    expect(series.points[2]?.values).toEqual({ food: 1_000, drinks: 700 })
    expect(seriesTotals(series)).toEqual({ food: 2_200, drinks: 1_200 })
  })

  it('splits one brand by category, dropping a cancelled sale rather than netting it', () => {
    const series = salesSeries(ORDERS, [CANCEL], range, 'CATEGORY', BRANDS, CATEGORIES, 'food')
    expect(series.defs.map((d) => [d.label, d.colour])).toEqual([
      ['Rice', CATEGORY_COLOURS[0]],
      ['Noodles', CATEGORY_COLOURS[1]],
    ])
    expect(series.points[2]?.values).toEqual({ rice: 1_000, noodles: 0 })
  })

  it('puts a category no longer on the menu under Other', () => {
    const offMenu = [order('9', '2026-09-27', '2026-09-27T12:00:00Z', [line('food', 'gone', 400)])]
    const series = salesSeries(offMenu, [], range, 'CATEGORY', BRANDS, CATEGORIES, 'food')
    expect(series.defs.at(-1)?.key).toBe(OTHER_KEY)
    expect(seriesTotals(series)[OTHER_KEY]).toBe(400)
  })
})

describe('salesSeries through a single day, by hour', () => {
  const today = { startDate: '2026-09-28', endDate: '2026-09-28' }
  // Well after the business day, so no hour is in the future.
  const later = new Date('2026-10-05T00:00:00Z')
  const hourly = (
    orders: Order[],
    corrections: SaleCorrection[],
    mode: 'OVERALL' | 'BRAND',
    rollover = 5,
    now = later,
  ) => salesSeries(orders, corrections, today, mode, BRANDS, CATEGORIES, null, rollover, now)
  const overall = (series: ReturnType<typeof hourly>) => series.points.map((p) => p.values[OVERALL_KEY])

  it('always has the 24 hours of the business day, starting at the rollover hour', () => {
    const series = hourly(ORDERS, [], 'OVERALL')
    expect(series.kind).toBe('TIME')
    expect(series.points).toHaveLength(24)
    // 5am on the 28th in Kuala Lumpur is 21:00Z on the 27th; the last hour is 4am.
    expect(series.points[0]?.at).toBe('2026-09-27T21:00:00.000Z')
    expect(series.points[23]?.at).toBe('2026-09-28T20:00:00.000Z')
  })

  it('puts each sale in its own hour, with no carry-over into the next', () => {
    const late = order('4', '2026-09-28', '2026-09-28T14:15:00Z', [line('drinks', 'cold', 450)])
    const values = overall(hourly([...ORDERS, late], [], 'OVERALL'))
    // 12:05Z and 12:40Z are both in the 8pm hour (index 15 from 5am); 14:15Z is 10pm.
    expect(values[15]).toBe(2_600)
    expect(values[16]).toBe(0)
    expect(values[17]).toBe(450)
    expect(values.reduce((sum, v) => sum + (v ?? 0), 0)).toBe(3_050)
    expect(seriesTotals(hourly([...ORDERS, late], [], 'OVERALL'))).toEqual({ [OVERALL_KEY]: 3_050 })
  })

  it('moves with the rollover hour', () => {
    // A 6pm rollover: the day starts at 18:00 in Kuala Lumpur, 10:00Z.
    const series = hourly(ORDERS, [], 'OVERALL', 18)
    expect(series.points[0]?.at).toBe('2026-09-28T10:00:00.000Z')
    // 8pm is now the third hour.
    expect(overall(series)[2]).toBe(2_600)
  })

  it('splits each hour by brand, and the hours add up to the day', () => {
    const series = hourly(ORDERS, [], 'BRAND')
    expect(series.points[15]?.values).toEqual({ food: 1_900, drinks: 700 })
    expect(seriesTotals(series)).toEqual({ food: 1_900, drinks: 700 })
  })

  it('takes a cancel off the hour it was made in, below zero if that hour sold less', () => {
    const series = hourly(ORDERS, [CANCEL], 'BRAND')
    // The cancel at 13:00Z (9pm) refunds 900 in an hour with no sales.
    expect(series.points[16]?.values).toEqual({ food: -900, drinks: 0 })
    expect(seriesTotals(series)).toEqual({ food: 1_000, drinks: 700 })
  })

  it('keeps a cross-midnight shift inside its business day', () => {
    const night = [
      order('5', '2026-09-28', '2026-09-28T15:30:00Z', [line('food', 'rice', 1_000)]), // 11:30pm
      order('6', '2026-09-28', '2026-09-28T17:10:00Z', [line('food', 'rice', 500)]), // 1:10am
    ]
    const values = overall(hourly(night, [], 'OVERALL'))
    expect(values.slice(18, 21)).toEqual([1_000, 0, 500])
  })

  it('marks the hours of today that have not started', () => {
    // 20:30 in Kuala Lumpur: the 8pm hour has started, 9pm has not.
    const series = hourly(ORDERS, [], 'OVERALL', 5, new Date('2026-09-28T12:30:00Z'))
    expect(series.points[15]?.isFuture).toBeUndefined()
    expect(series.points[16]?.isFuture).toBe(true)
    expect(series.points.filter((p) => p.isFuture)).toHaveLength(8)
  })

  it('splits the day into half hours on M30, and four-hour blocks on H4', () => {
    const at = (frame: 240 | 60 | 30) =>
      salesSeries(ORDERS, [], today, 'OVERALL', BRANDS, CATEGORIES, null, 5, later, frame)
    const m30 = at(30)
    expect(m30.points).toHaveLength(48)
    // 12:05Z (8:05pm) and 12:40Z (8:40pm) now fall in different half hours.
    expect(overall(m30).slice(30, 32)).toEqual([900, 1_700])
    expect(m30.points[31]?.at).toBe('2026-09-28T12:30:00.000Z')

    const h4 = at(240)
    expect(h4.points).toHaveLength(6)
    // 5am, 9am, 1pm, 5pm, 9pm, 1am — the 8pm sales are in the 5pm–9pm block.
    expect(overall(h4)).toEqual([0, 0, 0, 2_600, 0, 0])
    // Whatever the frame, the day adds up to the same.
    expect(seriesTotals(m30)).toEqual(seriesTotals(h4))
  })

  it('never hides an hour that already has a sale, whatever the clock says', () => {
    // 19:00 in Kuala Lumpur, before the 8pm sales — yet they are recorded.
    const series = hourly(ORDERS, [], 'OVERALL', 5, new Date('2026-09-28T11:00:00Z'))
    expect(series.points[15]?.isFuture).toBeUndefined()
    expect(series.points[16]?.isFuture).toBe(true)
  })

  it('files a sale outside the window (rollover changed since) under the nearest hour', () => {
    const early = order('7', '2026-09-28', '2026-09-27T20:00:00Z', [line('food', 'rice', 300)]) // 4am, before a 5am start
    expect(overall(hourly([early], [], 'OVERALL'))[0]).toBe(300)
  })

  it('is empty for a past day with no sales', () => {
    const series = salesSeries(ORDERS, [], { startDate: '2026-09-27', endDate: '2026-09-27' }, 'OVERALL', BRANDS, CATEGORIES, null, 5, later)
    expect(series.points).toEqual([])
    expect(seriesTotals(series)).toEqual({ [OVERALL_KEY]: 0 })
  })
})
