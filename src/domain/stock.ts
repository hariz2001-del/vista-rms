/**
 * Closing stock, grouped the way the counter reads it: brand, then category,
 * then subcategory, then item. Groups appear in the order of their first item,
 * so the owner's arrangement of the list is the arrangement of every report.
 */

export type StockBalance =
  | 'EMPTY'
  | 'QUARTER'
  | 'HALF'
  | 'THREE_QUARTERS'
  | 'FULL'
  // The old three-step scale, on counts sent before the five-step bar.
  | 'MORE_THAN_HALF'
  | 'LESS_THAN_HALF'

export type StockLevel = {
  value: StockBalance
  /** How full, 0–100: the width of the bar. */
  pct: number
  label: string
  /** The bar's colour at this level: red when finished, through to green when full. */
  colour: string
  /** Said at the end of the line: finished, or running low. */
  note: string | null
}

/** The five steps on the bar, emptiest first. */
export const LEVELS: StockLevel[] = [
  { value: 'EMPTY', pct: 0, label: '0%', colour: '#dc2626', note: 'Finished stock' },
  { value: 'QUARTER', pct: 25, label: '25%', colour: '#ea580c', note: 'Low stock' },
  { value: 'HALF', pct: 50, label: '50%', colour: '#eab308', note: null },
  { value: 'THREE_QUARTERS', pct: 75, label: '75%', colour: '#84cc16', note: null },
  { value: 'FULL', pct: 100, label: '100%', colour: '#16a34a', note: null },
]

/** Any balance as a level to draw. The old scale shows at its nearest step, under its old name. */
export function levelOf(balance: StockBalance | null | undefined): StockLevel | null {
  if (!balance) return null
  if (balance === 'MORE_THAN_HALF') return { ...LEVELS[3]!, value: balance, label: '> ½' }
  if (balance === 'LESS_THAN_HALF') return { ...LEVELS[1]!, value: balance, label: '< ½', note: null }
  return LEVELS.find((level) => level.value === balance) ?? null
}

export type Groupable = {
  brandKey: string
  category: string
  subcategory: string | null
}

export type SubcategoryGroup<T> = { subcategory: string | null; items: T[] }
export type CategoryGroup<T> = { category: string; subcategories: Array<SubcategoryGroup<T>> }
export type BrandGroup<T> = { brandKey: string; categories: Array<CategoryGroup<T>> }

export function groupStock<T extends Groupable>(rows: readonly T[]): Array<BrandGroup<T>> {
  const brands: Array<BrandGroup<T>> = []
  for (const row of rows) {
    let brand = brands.find((group) => group.brandKey === row.brandKey)
    if (!brand) {
      brand = { brandKey: row.brandKey, categories: [] }
      brands.push(brand)
    }
    let category = brand.categories.find((group) => group.category === row.category)
    if (!category) {
      category = { category: row.category, subcategories: [] }
      brand.categories.push(category)
    }
    let subcategory = category.subcategories.find((group) => group.subcategory === row.subcategory)
    if (!subcategory) {
      subcategory = { subcategory: row.subcategory, items: [] }
      category.subcategories.push(subcategory)
    }
    subcategory.items.push(row)
  }
  return brands
}

export function flattenStock<T>(groups: ReadonlyArray<BrandGroup<T>>): T[] {
  return groups.flatMap((brand) =>
    brand.categories.flatMap((category) => category.subcategories.flatMap((group) => group.items)),
  )
}

function swap<T>(list: T[], index: number, direction: -1 | 1): boolean {
  const other = index + direction
  if (index < 0 || other < 0 || other >= list.length) return false
  const held = list[index] as T
  list[index] = list[other] as T
  list[other] = held
  return true
}

/**
 * The list in its new order after moving one item, one category or one
 * subcategory a place up or down among its neighbours. Null when it is already
 * at that end. Moves never cross a parent: a subcategory stays in its category.
 */
export function moveStock<T extends Groupable & { id: string }>(
  rows: readonly T[],
  target:
    | { kind: 'item'; id: string }
    | { kind: 'category'; brandKey: string; category: string }
    | { kind: 'subcategory'; brandKey: string; category: string; subcategory: string | null },
  direction: -1 | 1,
): string[] | null {
  const groups = groupStock(rows)
  let moved = false

  for (const brand of groups) {
    if (target.kind === 'category' && brand.brandKey === target.brandKey) {
      const index = brand.categories.findIndex((group) => group.category === target.category)
      moved = swap(brand.categories, index, direction)
    }
    for (const category of brand.categories) {
      if (
        target.kind === 'subcategory' &&
        brand.brandKey === target.brandKey &&
        category.category === target.category
      ) {
        const index = category.subcategories.findIndex(
          (group) => group.subcategory === target.subcategory,
        )
        moved = swap(category.subcategories, index, direction)
      }
      for (const group of category.subcategories) {
        if (target.kind === 'item') {
          const index = group.items.findIndex((item) => item.id === target.id)
          if (index >= 0) moved = swap(group.items, index, direction)
        }
      }
    }
  }

  return moved ? flattenStock(groups).map((row) => row.id) : null
}

/** Thousandths of a unit, as the API stores a count. `2.5` → 2500; blank → null. */
export function parseCountMilli(input: string): number | null | 'invalid' {
  const text = input.trim()
  if (text === '') return null
  const match = /^(\d{1,6})(?:\.(\d{0,3}))?$/.exec(text)
  if (!match) return 'invalid'
  return Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'))
}

/** 2500 → "2.5", 0 → "0". */
export function formatCount(milli: number): string {
  const whole = Math.trunc(milli / 1000)
  const fraction = (milli % 1000).toString().padStart(3, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}
