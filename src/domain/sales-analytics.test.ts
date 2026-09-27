import { describe, expect, it } from 'vitest'
import type { Category, Order, OrderLine, SaleCorrection } from './types.ts'
import {
  lineNetSen,
  matchesSearch,
  salesBreakdown,
  shareOfBrand,
  sortRows,
} from './sales-analytics.ts'

const RANGE = { startDate: '2026-09-01', endDate: '2026-09-30' }

const CATEGORIES: Category[] = [
  { id: 'rice', brandId: 'food', name: 'Rice' },
  { id: 'cold', brandId: 'drinks', name: 'Cold Drinks' },
]

function line(overrides: Partial<OrderLine>): OrderLine {
  return {
    productId: 'nasi-lemak',
    productName: 'Nasi Lemak',
    brandId: 'food',
    categoryId: 'rice',
    quantity: 1,
    unitPriceSen: 1_200,
    modifierTotalSen: 0,
    lineDiscountSen: 0,
    allocatedOrderDiscountSen: 0,
    modifiers: [],
    ...overrides,
  }
}

function order(id: string, lines: OrderLine[], businessDate = '2026-09-10'): Order {
  const grossSen = lines.reduce(
    (sum, item) => sum + (item.unitPriceSen + item.modifierTotalSen) * item.quantity,
    0,
  )
  const lineDiscountSen = lines.reduce((sum, item) => sum + item.lineDiscountSen, 0)
  const orderDiscountSen = lines.reduce((sum, item) => sum + item.allocatedOrderDiscountSen, 0)
  return {
    id,
    shiftId: 'shift-1',
    businessDate,
    queueNumber: `#${id}`,
    offlineLabel: null,
    completedAt: `${businessDate}T12:00:00Z`,
    grossSen,
    lineDiscountSen,
    orderDiscountSen,
    totalAmountSen: grossSen - lineDiscountSen - orderDiscountSen,
    flagStatus: 'NONE',
    flagReason: null,
    needsReview: false,
    reviewReason: null,
    lines,
  }
}

function cancel(originalOrderId: string): SaleCorrection {
  return {
    id: `cancel-${originalOrderId}`,
    originalOrderId,
    originalQueueNumber: `#${originalOrderId}`,
    shiftId: 'shift-1',
    businessDate: '2026-10-02',
    createdAt: '2026-10-02T09:00:00Z',
    kind: 'CANCEL',
    reason: 'Customer cancelled after paying',
    deltaSen: -1_200,
    brandDeltas: [{ brandId: 'food', deltaSen: -1_200 }],
  }
}

describe('salesBreakdown', () => {
  it('adds base, add-ons and discounts in whole sen, per product', () => {
    const orders = [
      order('1', [
        line({
          quantity: 2,
          modifierTotalSen: 150,
          lineDiscountSen: 100,
          allocatedOrderDiscountSen: 33,
          modifiers: [{ name: 'Telur Mata', priceSen: 150, type: 'ADD_ON' }],
        }),
      ]),
      order('2', [line({ allocatedOrderDiscountSen: 67 })]),
    ]

    const [row] = salesBreakdown(orders, [], CATEGORIES, RANGE).products
    expect(row).toMatchObject({
      name: 'Nasi Lemak',
      quantity: 3,
      baseSen: 3_600,
      modifierSen: 300,
      discountSen: 200,
      netSen: 3_700,
    })
    // Reconciles to what the orders were charged.
    expect(row?.netSen).toBe(orders.reduce((sum, o) => sum + o.totalAmountSen, 0))
  })

  it('agrees with lineNetSen for every line', () => {
    const item = line({ quantity: 3, modifierTotalSen: 250, allocatedOrderDiscountSen: 17 })
    const [row] = salesBreakdown([order('1', [item])], [], CATEGORIES, RANGE).products
    expect(row?.netSen).toBe(lineNetSen(item))
  })

  it('computes shares against the product’s own brand, not the whole counter', () => {
    const breakdown = salesBreakdown(
      [
        order('1', [
          line({}),
          line({ productId: 'otak', productName: 'Otak-otak', unitPriceSen: 400 }),
          line({
            productId: 'soda',
            productName: 'Soda Laici',
            brandId: 'drinks',
            categoryId: 'cold',
            unitPriceSen: 700,
          }),
        ]),
      ],
      [],
      CATEGORIES,
      RANGE,
    )

    expect(breakdown.netByBrand.get('food')).toBe(1_600)
    expect(breakdown.netByBrand.get('drinks')).toBe(700)
    const soda = breakdown.products.find((row) => row.name === 'Soda Laici')
    expect(shareOfBrand(soda?.netSen ?? 0, breakdown.netByBrand.get('drinks') ?? 0)).toBe(100)
    const nasi = breakdown.products.find((row) => row.name === 'Nasi Lemak')
    expect(shareOfBrand(nasi?.netSen ?? 0, breakdown.netByBrand.get('food') ?? 0)).toBe(75)
  })

  it('rolls products up into their category, with the category name', () => {
    const breakdown = salesBreakdown(
      [
        order('1', [line({ quantity: 2 }), line({ productId: 'goreng', productName: 'Nasi Goreng', unitPriceSen: 1_000 })]),
      ],
      [],
      CATEGORIES,
      RANGE,
    )
    expect(breakdown.categories).toHaveLength(1)
    expect(breakdown.categories[0]).toMatchObject({ name: 'Rice', quantity: 3, netSen: 3_400 })
    expect(breakdown.categories[0]?.products.map((row) => row.name)).toEqual([
      'Nasi Lemak',
      'Nasi Goreng',
    ])
  })

  it('counts an add-on once per unit and multiplies its revenue by quantity', () => {
    const breakdown = salesBreakdown(
      [
        order('1', [
          line({
            quantity: 2,
            modifierTotalSen: 150,
            modifiers: [{ name: 'Telur Mata', priceSen: 150, type: 'ADD_ON' }],
          }),
          line({
            productId: 'goreng',
            productName: 'Nasi Goreng',
            modifierTotalSen: 200,
            modifiers: [{ name: 'Telur Mata', priceSen: 200, type: 'ADD_ON' }],
          }),
        ]),
      ],
      [],
      CATEGORIES,
      RANGE,
    )

    expect(breakdown.modifiers).toEqual([
      expect.objectContaining({
        name: 'Telur Mata',
        count: 3,
        revenueSen: 500,
        minPriceSen: 150,
        maxPriceSen: 200,
        productNames: ['Nasi Goreng', 'Nasi Lemak'],
      }),
    ])
  })

  it('keeps zero-priced prep notes as counts with no revenue', () => {
    const breakdown = salesBreakdown(
      [
        order('1', [
          line({ quantity: 2, modifiers: [{ name: 'Tak Nak Timun', priceSen: 0, type: 'REMOVAL' }] }),
        ]),
      ],
      [],
      CATEGORIES,
      RANGE,
    )
    expect(breakdown.modifiers[0]).toMatchObject({
      name: 'Tak Nak Timun',
      type: 'REMOVAL',
      count: 2,
      revenueSen: 0,
      maxPriceSen: 0,
    })
    expect(breakdown.products[0]?.modifierSen).toBe(0)
  })

  it('leaves out cancelled sales, even when the cancel falls after the range', () => {
    const breakdown = salesBreakdown(
      [order('1', [line({})]), order('2', [line({})])],
      [cancel('1')],
      CATEGORIES,
      RANGE,
    )
    expect(breakdown.products[0]?.quantity).toBe(1)
    expect(breakdown.cancelledOrderCount).toBe(1)
  })

  it('only counts orders inside the date range', () => {
    const breakdown = salesBreakdown(
      [order('1', [line({})], '2026-08-31'), order('2', [line({})], '2026-09-30')],
      [],
      CATEGORIES,
      RANGE,
    )
    expect(breakdown.netSen).toBe(1_200)
  })

  it('returns empty totals — not NaN — for a period with no sales', () => {
    const breakdown = salesBreakdown([], [], CATEGORIES, RANGE)
    expect(breakdown.products).toEqual([])
    expect(breakdown.netSen).toBe(0)
    expect(shareOfBrand(0, 0)).toBe(0)
    expect(shareOfBrand(500, breakdown.netByBrand.get('food') ?? 0)).toBe(0)
  })

  it('reads snapshots from before lines carried a product id or modifiers', () => {
    const { productId: _id, modifiers: _mods, ...legacy } = line({ modifierTotalSen: 100 })
    const breakdown = salesBreakdown(
      [order('1', [legacy, legacy])],
      [],
      CATEGORIES,
      RANGE,
    )
    expect(breakdown.products).toHaveLength(1)
    expect(breakdown.products[0]).toMatchObject({ quantity: 2, modifierSen: 200 })
    expect(breakdown.modifiers).toEqual([])
  })
})

describe('sortRows', () => {
  const rows = [
    { name: 'B', quantity: 2, netSen: 900 },
    { name: 'A', quantity: 2, netSen: 100 },
    { name: 'C', quantity: 5, netSen: 300 },
  ]
  const value = (row: (typeof rows)[number], key: 'quantity' | 'net') =>
    key === 'net' ? row.netSen : row.quantity

  it('sorts descending by default and breaks ties by name', () => {
    expect(sortRows(rows, value, 'quantity', 'desc').map((row) => row.name)).toEqual(['C', 'A', 'B'])
  })

  it('sorts by net sales ascending', () => {
    expect(sortRows(rows, value, 'net', 'asc').map((row) => row.name)).toEqual(['A', 'C', 'B'])
  })
})

describe('matchesSearch', () => {
  it('ignores case, accents and surrounding space', () => {
    expect(matchesSearch('Kopi Ais', '  ais ')).toBe(true)
    expect(matchesSearch('Crème Caramel', 'creme')).toBe(true)
    expect(matchesSearch('Teh Tarik', 'kopi')).toBe(false)
    expect(matchesSearch('anything', '')).toBe(true)
  })
})
