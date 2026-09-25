import type { ModifierGroup, Product } from './types.ts'

/**
 * Option groups worth offering for an item, taken from what the other items in
 * its category already have. A category tends to share its options — every
 * coffee has a cup size, every rice dish a spice level — so a new item should
 * not need them typed in again.
 */
export type GroupSuggestion = {
  /** The version of the group to copy: the one most items in the category use. */
  group: ModifierGroup
  /** How many other items in the category have a group by this name. */
  usedBy: number
  /** How many other items the category has. */
  of: number
}

/** Same group, as far as the owner is concerned: same name, ignoring case and spacing. */
function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Two versions of a group are the same version when their rules and options match. */
function signature(group: ModifierGroup): string {
  const options = group.options.map((option) => `${option.name}:${option.priceSen}:${option.type}`)
  return `${group.minSelect}-${group.maxSelect}|${options.join(',')}`
}

/**
 * Suggestions for an item in `categoryId`.
 *
 * @param excludeProductId The item itself, when editing one that already exists.
 * @param existing Groups the item already has; a suggestion by the same name is left out.
 */
export function suggestGroups(
  products: Product[],
  categoryId: string,
  excludeProductId: string | null = null,
  existing: ModifierGroup[] = [],
): GroupSuggestion[] {
  const siblings = products.filter(
    (product) => product.categoryId === categoryId && product.id !== excludeProductId,
  )
  const taken = new Set(existing.map((group) => nameKey(group.name)))

  // name → the products using it, and how often each version appears.
  const byName = new Map<string, { products: Set<string>; versions: Map<string, { group: ModifierGroup; count: number }> }>()

  for (const product of siblings) {
    for (const group of product.modifierGroups ?? []) {
      const key = nameKey(group.name)
      if (taken.has(key) || group.options.length === 0) continue
      const entry = byName.get(key) ?? { products: new Set<string>(), versions: new Map() }
      entry.products.add(product.id)
      const version = entry.versions.get(signature(group))
      if (version) version.count += 1
      else entry.versions.set(signature(group), { group, count: 1 })
      byName.set(key, entry)
    }
  }

  return [...byName.values()]
    .map((entry) => {
      const [best] = [...entry.versions.values()].toSorted((a, b) => b.count - a.count)
      return { group: best!.group, usedBy: entry.products.size, of: siblings.length }
    })
    .toSorted((a, b) => b.usedBy - a.usedBy || a.group.name.localeCompare(b.group.name))
}

/** Worth ticking for a new item without asking: at least half the category has it. */
export function isCommon(suggestion: GroupSuggestion): boolean {
  return suggestion.usedBy * 2 >= suggestion.of
}
