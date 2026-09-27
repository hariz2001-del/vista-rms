import type { Category, Order, OrderLine, OrderLineModifier, SaleCorrection } from './types.ts'
import { assertSen } from './money.ts'
import { inRange, type DateRange } from './selectors.ts'

/**
 * What sold, broken down by product, by category, and by add-on.
 *
 * Integer sen throughout. Each line's net is exactly what the ledger booked for
 * it: gross minus its own discount minus its share of the order discount. That
 * share is apportioned by largest remainder at checkout and stored on the line,
 * so it is summed here, never re-derived.
 *
 * Cancelled sales are left out: nothing was sold. An exchange counts as it was
 * first rung up — its replacement ticket is not itemised in the RMS snapshot —
 * so the breakdown can differ from period net sales by the exchange deltas.
 */

export type ProductSales = {
  key: string
  name: string
  brandId: string
  categoryId: string
  quantity: number
  /** Menu price × quantity, before options and discounts. */
  baseSen: number
  /** Paid options × quantity, before discounts. */
  modifierSen: number
  discountSen: number
  /** `baseSen + modifierSen − discountSen`. */
  netSen: number
  /** The options chosen on this product, including zero-priced prep notes. */
  modifiers: ModifierSales[]
}

export type CategorySales = {
  categoryId: string
  name: string
  brandId: string
  quantity: number
  netSen: number
  products: ProductSales[]
}

export type ModifierSales = {
  key: string
  /** The option group, or {@link UNGROUPED} when the snapshot does not say. */
  groupName: string
  name: string
  brandId: string
  type: 'ADD_ON' | 'REMOVAL'
  /** Units it was chosen on — an option on a ×2 line counts twice. */
  count: number
  /** Lowest and highest snapshot price, in case the price changed in the period. */
  minPriceSen: number
  maxPriceSen: number
  revenueSen: number
  /** Distinct products it was chosen on, alphabetical. */
  productNames: string[]
}

/** Add-ons under one option group, like every "Cup size" choice together. */
export type ModifierGroupSales = {
  groupName: string
  count: number
  revenueSen: number
  modifiers: ModifierSales[]
}

export const UNGROUPED = 'Other options'

export type SalesBreakdown = {
  products: ProductSales[]
  categories: CategorySales[]
  modifiers: ModifierSales[]
  /** Net of the itemised lines, per brand. The denominator for every share. */
  netByBrand: Map<string, number>
  netSen: number
  /** Sales left out because they were cancelled. */
  cancelledOrderCount: number
}

export function lineNetSen(line: OrderLine): number {
  return (
    assertSen((line.unitPriceSen + line.modifierTotalSen) * line.quantity, 'line gross') -
    line.lineDiscountSen -
    line.allocatedOrderDiscountSen
  )
}

/**
 * Percentage of the brand's net, for display. A ratio rather than money, so a
 * float is fine here; a brand with no sales yields 0 rather than NaN.
 */
export function shareOfBrand(netSen: number, brandNetSen: number): number {
  if (brandNetSen <= 0) return 0
  return (netSen / brandNetSen) * 100
}

/** Product id when the snapshot has one; older rows fall back to brand + name. */
function productKey(line: OrderLine): string {
  return line.productId ?? `${line.brandId}:${line.productName}`
}

type ModifierAccumulator = Map<string, ModifierSales & { products: Set<string> }>

function addModifier(into: ModifierAccumulator, line: OrderLine, modifier: OrderLineModifier) {
  const groupName = modifier.groupName?.trim() || UNGROUPED
  const key = `${line.brandId}:${groupName}:${modifier.type}:${modifier.name}`
  const entry = into.get(key) ?? {
    key,
    groupName,
    name: modifier.name,
    brandId: line.brandId,
    type: modifier.type,
    count: 0,
    minPriceSen: modifier.priceSen,
    maxPriceSen: modifier.priceSen,
    revenueSen: 0,
    productNames: [],
    products: new Set<string>(),
  }
  entry.count += line.quantity
  entry.revenueSen += modifier.priceSen * line.quantity
  entry.minPriceSen = Math.min(entry.minPriceSen, modifier.priceSen)
  entry.maxPriceSen = Math.max(entry.maxPriceSen, modifier.priceSen)
  entry.products.add(line.productName)
  into.set(key, entry)
}

function finishModifiers(from: ModifierAccumulator): ModifierSales[] {
  return [...from.values()].map(({ products: names, ...entry }) => ({
    ...entry,
    productNames: [...names].toSorted((a, b) => a.localeCompare(b)),
  }))
}

/**
 * Sections add-ons by their option group. Groups come out busiest first, and the
 * catch-all for unnamed groups always last.
 */
export function groupModifiers(rows: readonly ModifierSales[]): ModifierGroupSales[] {
  const groups = new Map<string, ModifierGroupSales>()
  for (const row of rows) {
    const group = groups.get(row.groupName) ?? {
      groupName: row.groupName,
      count: 0,
      revenueSen: 0,
      modifiers: [],
    }
    group.count += row.count
    group.revenueSen += row.revenueSen
    group.modifiers.push(row)
    groups.set(row.groupName, group)
  }
  return [...groups.values()].toSorted(
    (a, b) =>
      Number(a.groupName === UNGROUPED) - Number(b.groupName === UNGROUPED) ||
      b.count - a.count ||
      a.groupName.localeCompare(b.groupName),
  )
}

export function salesBreakdown(
  orders: readonly Order[],
  corrections: readonly SaleCorrection[],
  categories: readonly Category[],
  range: DateRange,
): SalesBreakdown {
  // A cancel dated after the range still means the sale did not happen.
  const cancelled = new Set(
    corrections
      .filter((correction) => correction.kind === 'CANCEL')
      .map((correction) => correction.originalOrderId),
  )
  const periodOrders = inRange(orders, range.startDate, range.endDate)
  const counted = periodOrders.filter((order) => !cancelled.has(order.id))

  const products = new Map<string, ProductSales>()
  const modifiers: ModifierAccumulator = new Map()
  const modifiersByProduct = new Map<string, ModifierAccumulator>()

  for (const order of counted) {
    for (const line of order.lines) {
      const key = productKey(line)
      const baseSen = line.unitPriceSen * line.quantity
      const modifierSen = line.modifierTotalSen * line.quantity
      const discountSen = line.lineDiscountSen + line.allocatedOrderDiscountSen

      const row = products.get(key) ?? {
        key,
        name: line.productName,
        brandId: line.brandId,
        categoryId: line.categoryId,
        quantity: 0,
        baseSen: 0,
        modifierSen: 0,
        discountSen: 0,
        netSen: 0,
        modifiers: [],
      }
      row.quantity += line.quantity
      row.baseSen += baseSen
      row.modifierSen += modifierSen
      row.discountSen += discountSen
      row.netSen += baseSen + modifierSen - discountSen
      // Orders run oldest first, so the name shown is the latest one printed.
      row.name = line.productName
      row.categoryId = line.categoryId
      products.set(key, row)

      const ownModifiers = modifiersByProduct.get(key) ?? new Map()
      modifiersByProduct.set(key, ownModifiers)
      for (const modifier of line.modifiers ?? []) {
        addModifier(modifiers, line, modifier)
        addModifier(ownModifiers, line, modifier)
      }
    }
  }

  const productRows = [...products.values()].map((row) => ({
    ...row,
    modifiers: finishModifiers(modifiersByProduct.get(row.key) ?? new Map()),
  }))

  const netByBrand = new Map<string, number>()
  for (const row of productRows) {
    netByBrand.set(row.brandId, (netByBrand.get(row.brandId) ?? 0) + row.netSen)
  }

  const categoryNames = new Map(categories.map((category) => [category.id, category.name]))
  const categoryRows = new Map<string, CategorySales>()
  for (const row of productRows) {
    const category = categoryRows.get(row.categoryId) ?? {
      categoryId: row.categoryId,
      name: categoryNames.get(row.categoryId) ?? 'Uncategorised',
      brandId: row.brandId,
      quantity: 0,
      netSen: 0,
      products: [],
    }
    category.quantity += row.quantity
    category.netSen += row.netSen
    category.products.push(row)
    categoryRows.set(row.categoryId, category)
  }

  return {
    products: productRows,
    categories: [...categoryRows.values()],
    modifiers: finishModifiers(modifiers),
    netByBrand,
    netSen: productRows.reduce((sum, row) => sum + row.netSen, 0),
    cancelledOrderCount: periodOrders.length - counted.length,
  }
}

export type SortKey = 'quantity' | 'net'
export type SortDirection = 'desc' | 'asc'

/** Ties break on name so the order is stable between renders. */
export function sortRows<T extends { name: string }>(
  rows: readonly T[],
  valueOf: (row: T, key: SortKey) => number,
  key: SortKey,
  direction: SortDirection,
): T[] {
  const sign = direction === 'desc' ? -1 : 1
  return rows.toSorted(
    (a, b) => sign * (valueOf(a, key) - valueOf(b, key)) || a.name.localeCompare(b.name),
  )
}

/** Case- and accent-insensitive "contains". */
export function matchesSearch(text: string, query: string): boolean {
  const normalise = (value: string) =>
    value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  const needle = normalise(query.trim())
  return needle === '' || normalise(text).includes(needle)
}
