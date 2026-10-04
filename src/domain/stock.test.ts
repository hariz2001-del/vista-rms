import { describe, expect, it } from 'vitest'
import { formatCount, groupStock, moveStock, parseCountMilli } from './stock.ts'

const row = (id: string, brandKey: string, category: string, subcategory: string | null = null) => ({
  id,
  brandKey,
  category,
  subcategory,
})

const LIST = [
  row('fresh', 'drinks', 'Drinks', 'Milk'),
  row('oat', 'drinks', 'Drinks', 'Milk'),
  row('syrup', 'drinks', 'Drinks', 'Syrups'),
  row('cups', 'drinks', 'Packaging'),
  row('mix', 'food', 'Raw materials'),
]

describe('closing stock grouping', () => {
  it('groups brand → category → subcategory in the order items first appear', () => {
    const groups = groupStock(LIST)
    expect(groups.map((brand) => brand.brandKey)).toEqual(['drinks', 'food'])
    expect(groups[0]?.categories.map((category) => category.category)).toEqual(['Drinks', 'Packaging'])
    expect(groups[0]?.categories[0]?.subcategories.map((group) => group.subcategory)).toEqual(['Milk', 'Syrups'])
  })

  it('moves an item only within its own group', () => {
    expect(moveStock(LIST, { kind: 'item', id: 'oat' }, -1)).toEqual(['oat', 'fresh', 'syrup', 'cups', 'mix'])
    // First in its subcategory: no further up, even though another group sits above it.
    expect(moveStock(LIST, { kind: 'item', id: 'syrup' }, -1)).toBeNull()
  })

  it('moves a whole category or subcategory, items and all', () => {
    expect(moveStock(LIST, { kind: 'category', brandKey: 'drinks', category: 'Packaging' }, -1)).toEqual([
      'cups',
      'fresh',
      'oat',
      'syrup',
      'mix',
    ])
    expect(
      moveStock(LIST, { kind: 'subcategory', brandKey: 'drinks', category: 'Drinks', subcategory: 'Milk' }, 1),
    ).toEqual(['syrup', 'fresh', 'oat', 'cups', 'mix'])
  })

  it('reads counts in thousandths and writes them back', () => {
    expect(parseCountMilli('2.5')).toBe(2500)
    expect(parseCountMilli('0')).toBe(0)
    expect(parseCountMilli('')).toBeNull()
    expect(parseCountMilli('two')).toBe('invalid')
    expect(formatCount(2500)).toBe('2.5')
    expect(formatCount(3000)).toBe('3')
  })
})
