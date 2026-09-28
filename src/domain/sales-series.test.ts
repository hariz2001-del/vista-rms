import { describe, expect, it } from 'vitest'
import type { Brand, Category, Order, OrderLine, SaleCorrection } from './types.ts'
import { CATEGORY_COLOURS, OTHER_KEY, OVERALL_KEY, salesSeries, seriesTotals } from './sales-series.ts'

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

  it('puts each sale in its own hour, with no carry-over into the next', () => {
    // 12:05Z and 12:40Z are both in the 8pm hour in Kuala Lumpur.
    const late = order('4', '2026-09-28', '2026-09-28T14:15:00Z', [line('drinks', 'cold', 450)])
    const series = salesSeries([...ORDERS, late], [], today, 'OVERALL', BRANDS, CATEGORIES)
    expect(series.kind).toBe('TIME')
    expect(series.points.map((p) => [p.at, p.values[OVERALL_KEY]])).toEqual([
      ['2026-09-28T12:00:00.000Z', 2_600],
      // A quiet hour is a zero, not a gap and not the previous hour's figure.
      ['2026-09-28T13:00:00.000Z', 0],
      ['2026-09-28T14:00:00.000Z', 450],
    ])
    expect(seriesTotals(series)).toEqual({ [OVERALL_KEY]: 3_050 })
  })

  it('splits each hour by brand, and the hours add up to the day', () => {
    const series = salesSeries(ORDERS, [], today, 'BRAND', BRANDS, CATEGORIES)
    expect(series.points).toEqual([
      { at: '2026-09-28T12:00:00.000Z', values: { food: 1_900, drinks: 700 } },
    ])
    expect(seriesTotals(series)).toEqual({ food: 1_900, drinks: 700 })
  })

  it('takes a cancel off the hour it was made in, below zero if that hour sold less', () => {
    const series = salesSeries(ORDERS, [CANCEL], today, 'BRAND', BRANDS, CATEGORIES)
    expect(series.points).toEqual([
      { at: '2026-09-28T12:00:00.000Z', values: { food: 1_900, drinks: 700 } },
      // The cancel at 13:00Z (9pm) refunds 900 in an hour with no sales.
      { at: '2026-09-28T13:00:00.000Z', values: { food: -900, drinks: 0 } },
    ])
    expect(seriesTotals(series)).toEqual({ food: 1_000, drinks: 700 })
  })

  it('runs a cross-midnight shift on past 12am under its business date', () => {
    const night = [
      order('5', '2026-09-28', '2026-09-28T15:30:00Z', [line('food', 'rice', 1_000)]), // 11:30pm
      order('6', '2026-09-28', '2026-09-28T17:10:00Z', [line('food', 'rice', 500)]), // 1:10am
    ]
    const series = salesSeries(night, [], today, 'OVERALL', BRANDS, CATEGORIES)
    expect(series.points.map((p) => p.values[OVERALL_KEY])).toEqual([1_000, 0, 500])
  })

  it('is empty on a day with no sales', () => {
    const series = salesSeries(ORDERS, [], { startDate: '2026-09-27', endDate: '2026-09-27' }, 'OVERALL', BRANDS, CATEGORIES)
    expect(series.points).toEqual([])
    expect(seriesTotals(series)).toEqual({ [OVERALL_KEY]: 0 })
  })
})
