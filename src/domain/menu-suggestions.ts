import type { ModifierGroup, Product } from './types.ts'

/**
 * Option groups worth offering for an item, taken from what the rest of the
 * menu already has. A category tends to share its options — every coffee has a
 * cup size, every rice dish a spice level — so those come first. Groups from
 * other categories are offered too, after them: a new "Tea" category still
 * wants the cup size the coffees have.
 */
export type GroupSuggestion = {
  /** The version of the group to copy: the one most items use. */
  group: ModifierGroup
  /** How many of the items looked at have a group by this name. */
  usedBy: number
  /** How many items were looked at. */
  of: number
  /** The categories those items are in, in menu order. */
  categoryIds: string[]
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

/** The groups on `pool`, by name, minus the names in `taken`; most used first. */
function rank(pool: Product[], taken: Set<string>): GroupSuggestion[] {
  const byName = new Map<
    string,
    {
      products: Set<string>
      categories: string[]
      versions: Map<string, { group: ModifierGroup; count: number }>
    }
  >()

  for (const product of pool) {
    for (const group of product.modifierGroups ?? []) {
      const key = nameKey(group.name)
      if (taken.has(key) || group.options.length === 0) continue
      const entry = byName.get(key) ?? {
        products: new Set<string>(),
        categories: [] as string[],
        versions: new Map<string, { group: ModifierGroup; count: number }>(),
      }
      entry.products.add(product.id)
      if (!entry.categories.includes(product.categoryId)) entry.categories.push(product.categoryId)
      const version = entry.versions.get(signature(group))
      if (version) version.count += 1
      else entry.versions.set(signature(group), { group, count: 1 })
      byName.set(key, entry)
    }
  }

  return [...byName.values()]
    .map((entry) => {
      const [best] = [...entry.versions.values()].toSorted((a, b) => b.count - a.count)
      return {
        group: best!.group,
        usedBy: entry.products.size,
        of: pool.length,
        categoryIds: entry.categories,
      }
    })
    .toSorted((a, b) => b.usedBy - a.usedBy || a.group.name.localeCompare(b.group.name))
}

/**
 * Suggestions from the item's own category.
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
  return rank(siblings, new Set(existing.map((group) => nameKey(group.name))))
}

/**
 * Suggestions from every other category — anything the rest of the menu has
 * that the item does not, and that its own category is not already offering.
 */
export function suggestFromElsewhere(
  products: Product[],
  categoryId: string,
  excludeProductId: string | null = null,
  existing: ModifierGroup[] = [],
): GroupSuggestion[] {
  const fromCategory = suggestGroups(products, categoryId, excludeProductId, existing)
  const taken = new Set([
    ...existing.map((group) => nameKey(group.name)),
    ...fromCategory.map((suggestion) => nameKey(suggestion.group.name)),
  ])
  const elsewhere = products.filter(
    (product) => product.categoryId !== categoryId && product.id !== excludeProductId,
  )
  return rank(elsewhere, taken)
}

/** Worth ticking for a new item without asking: at least half its category has it. */
export function isCommon(suggestion: GroupSuggestion): boolean {
  return suggestion.usedBy * 2 >= suggestion.of
}
