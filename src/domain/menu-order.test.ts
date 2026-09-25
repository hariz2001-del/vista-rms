import { describe, expect, it } from 'vitest'
import { arrayMove, categoryOf, layoutOf, moveItem, reorderWithin } from './menu-order.ts'

const products = [
  { id: 'kopi', categoryId: 'coffee' },
  { id: 'milo', categoryId: 'coffee' },
  { id: 'teh', categoryId: 'coffee' },
  { id: 'kuih', categoryId: 'snacks' },
]

describe('menu layout', () => {
  it('groups items by category in the order given, with empty categories kept', () => {
    expect(layoutOf(['coffee', 'snacks', 'rice'], products)).toEqual({
      coffee: ['kopi', 'milo', 'teh'],
      snacks: ['kuih'],
      rice: [],
    })
  })

  it('moves an item within its category', () => {
    const layout = layoutOf(['coffee', 'snacks'], products)
    expect(moveItem(layout, 'teh', 'coffee', 'kopi').coffee).toEqual(['teh', 'kopi', 'milo'])
  })

  it('moves an item into another category, before a given item or at the end', () => {
    const layout = layoutOf(['coffee', 'snacks', 'rice'], products)
    const before = moveItem(layout, 'milo', 'snacks', 'kuih')
    expect(before).toMatchObject({ coffee: ['kopi', 'teh'], snacks: ['milo', 'kuih'] })
    expect(moveItem(layout, 'milo', 'rice', null).rice).toEqual(['milo'])
    expect(categoryOf(moveItem(layout, 'milo', 'rice', null), 'milo')).toBe('rice')
  })

  it('leaves the layout alone for an unknown item or category, and never mutates it', () => {
    const layout = layoutOf(['coffee', 'snacks'], products)
    const copy = structuredClone(layout)
    expect(moveItem(layout, 'nope', 'snacks', null)).toBe(layout)
    expect(moveItem(layout, 'kopi', 'nope', null)).toBe(layout)
    moveItem(layout, 'kopi', 'snacks', null)
    expect(layout).toEqual(copy)
  })

  it('moves one entry of a list', () => {
    expect(arrayMove(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(arrayMove(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(arrayMove(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
  })

  it('reorders the shown categories among their own slots, leaving hidden ones in place', () => {
    // Food: f1, f2 · Drinks: d1, d2, interleaved; only Drinks shown and swapped.
    expect(reorderWithin(['f1', 'd1', 'f2', 'd2'], ['d2', 'd1'])).toEqual(['f1', 'd2', 'f2', 'd1'])
  })
})
