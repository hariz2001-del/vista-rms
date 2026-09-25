import { describe, expect, it } from 'vitest'
import { isCommon, suggestGroups } from './menu-suggestions.ts'
import type { ModifierGroup, Product } from './types.ts'

function group(id: string, name: string, options: Array<[string, number]>, min = 0, max = 1): ModifierGroup {
  return {
    id,
    name,
    minSelect: min,
    maxSelect: max,
    options: options.map(([optionName, priceSen], index) => ({
      id: `${id}-${index}`,
      name: optionName,
      priceSen,
      type: priceSen > 0 ? 'ADD_ON' : 'REMOVAL',
      isSoldOut: false,
    })),
  }
}

function product(id: string, categoryId: string, groups: ModifierGroup[]): Product {
  return {
    id,
    brandId: 'brand',
    categoryId,
    name: id,
    basePriceSen: 500,
    imageUrl: '',
    isSoldOut: false,
    isActive: true,
    modifierGroups: groups,
  }
}

const SIZE = (id: string) => group(id, 'Cup size', [['Regular', 0], ['Large', 150]], 1, 1)

describe('suggested option groups', () => {
  const menu = [
    product('kopi', 'coffee', [SIZE('g1'), group('g2', 'Extra shot', [['Shot', 250]])]),
    product('milo', 'coffee', [SIZE('g3')]),
    product('latte', 'coffee', [SIZE('g4'), group('g5', 'Milk', [['Oat', 200]])]),
    product('nasi', 'rice', [group('g6', 'Spice level', [['Mild', 0]])]),
  ]

  it('offers what the category’s items share, most common first', () => {
    const suggestions = suggestGroups(menu, 'coffee')
    expect(suggestions.map((s) => [s.group.name, s.usedBy, s.of])).toEqual([
      ['Cup size', 3, 3],
      ['Extra shot', 1, 3],
      ['Milk', 1, 3],
    ])
    // Nothing from another category.
    expect(suggestions.some((s) => s.group.name === 'Spice level')).toBe(false)
  })

  it('leaves out the item itself and anything it already has', () => {
    const kopi = menu[0]!
    const suggestions = suggestGroups(menu, 'coffee', 'kopi', kopi.modifierGroups)
    expect(suggestions.map((s) => s.group.name)).toEqual(['Milk'])
    expect(suggestions[0]?.of).toBe(2)
  })

  it('treats names that differ only by case and spacing as one group', () => {
    const suggestions = suggestGroups(menu, 'coffee', null, [group('x', '  cup   SIZE ', [['A', 0]])])
    expect(suggestions.some((s) => s.group.name === 'Cup size')).toBe(false)
  })

  it('copies the version most items use when they differ', () => {
    const mixed = [
      product('a', 'tea', [group('t1', 'Size', [['Small', 0], ['Big', 100]])]),
      product('b', 'tea', [group('t2', 'Size', [['Small', 0], ['Big', 120]])]),
      product('c', 'tea', [group('t3', 'Size', [['Small', 0], ['Big', 120]])]),
    ]
    const [size] = suggestGroups(mixed, 'tea')
    expect(size?.usedBy).toBe(3)
    expect(size?.group.options.map((o) => o.priceSen)).toEqual([0, 120])
  })

  it('skips empty groups, and suggests nothing in an empty category', () => {
    expect(suggestGroups([product('a', 'x', [group('e', 'Empty', [])])], 'x')).toEqual([])
    expect(suggestGroups(menu, 'desserts')).toEqual([])
  })

  it('pre-ticks a group for a new item only when at least half the category has it', () => {
    const [size, shot] = suggestGroups(menu, 'coffee')
    expect(isCommon(size!)).toBe(true)
    expect(isCommon(shot!)).toBe(false)
  })
})
