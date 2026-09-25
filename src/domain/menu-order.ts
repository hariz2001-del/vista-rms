/**
 * The menu's arrangement while it is being dragged about: which items sit in
 * which category, in what order. Kept apart from the screen so the moves can be
 * tested without a pointer.
 */

/** Category id → item ids, in order. */
export type Layout = Record<string, string[]>

/** Items grouped by category, in the order given. Categories with no items get an empty list. */
export function layoutOf(
  categoryIds: string[],
  products: Array<{ id: string; categoryId: string }>,
): Layout {
  const layout: Layout = Object.fromEntries(categoryIds.map((id) => [id, [] as string[]]))
  for (const product of products) layout[product.categoryId]?.push(product.id)
  return layout
}

/** Which category an item is in, or null. */
export function categoryOf(layout: Layout, itemId: string): string | null {
  for (const [categoryId, ids] of Object.entries(layout)) if (ids.includes(itemId)) return categoryId
  return null
}

/**
 * Move an item to `toCategory`, before `beforeItemId` — or to the end when that
 * is null or not in the category. Returns a new layout; the one given is not
 * changed. Unknown items and categories leave it as it was.
 */
export function moveItem(
  layout: Layout,
  itemId: string,
  toCategory: string,
  beforeItemId: string | null,
): Layout {
  const from = categoryOf(layout, itemId)
  if (from === null || !(toCategory in layout)) return layout

  const next: Layout = { ...layout, [from]: layout[from]!.filter((id) => id !== itemId) }
  const target = [...next[toCategory]!]
  const at = beforeItemId === null ? -1 : target.indexOf(beforeItemId)
  target.splice(at === -1 ? target.length : at, 0, itemId)
  next[toCategory] = target
  return next
}

/** A list with one entry moved from one position to another. */
export function arrayMove<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved as T)
  return next
}

/**
 * Reorder the categories on screen, when only some of them are shown (one
 * brand's). The shown ones swap among the slots they already hold; the hidden
 * ones stay where they are. The server needs the whole order.
 */
export function reorderWithin(all: string[], shownInNewOrder: string[]): string[] {
  const shown = new Set(shownInNewOrder)
  const queue = [...shownInNewOrder]
  return all.map((id) => (shown.has(id) ? (queue.shift() as string) : id))
}
