import { BRANDS } from '../catalogue.ts'
import { badRequest, conflict, demoOnly, newId, notFound, optStr, str, type Ctx, type DemoServerState, type Route, type StockItemRow } from './state.ts'

/**
 * The closing stock list and past counts — api-vista src/routes/stock.ts.
 * Counts themselves are sent from the POS, so the demo's are seeded.
 */

function serialiseItem(item: StockItemRow) {
  const { createdAt: _createdAt, ...rest } = item
  return rest
}

/** The list in the owner's order: by brand, then as arranged within it. */
function orderedItems(state: DemoServerState): StockItemRow[] {
  const rank = new Map(BRANDS.map((brand, index) => [brand.id, index]))
  return state.stockItems
    .toSorted((a, b) => a.sortOrder - b.sortOrder || Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .toSorted((a, b) => (rank.get(a.brandId) ?? 0) - (rank.get(b.brandId) ?? 0))
}

function itemBody(body: Record<string, unknown>) {
  const brandId = str(body, 'brandId')
  if (!BRANDS.some((brand) => brand.id === brandId)) notFound('menu:BRAND_NOT_FOUND')
  const item = {
    brandId,
    category: str(body, 'category'),
    subcategory: optStr(body, 'subcategory') ?? null,
    name: str(body, 'name'),
    unitLabel: optStr(body, 'unitLabel') ?? null,
    trackUnopened: body.trackUnopened === true,
    trackOpened: body.trackOpened === true,
    trackBalance: body.trackBalance === true,
    isActive: body.isActive !== false,
  }
  if (!item.trackUnopened && !item.trackOpened && !item.trackBalance) badRequest('demo:INVALID')
  return item
}

function createItem({ state, body, now }: Ctx) {
  const last = Math.max(-1, ...state.stockItems.map((item) => item.sortOrder))
  const item: StockItemRow = { id: newId(state), ...itemBody(body), sortOrder: last + 1, createdAt: now.toISOString() }
  state.stockItems.push(item)
  return { item: serialiseItem(item) }
}

function updateItem({ state, body, params }: Ctx) {
  const item = state.stockItems.find((row) => row.id === params.id) ?? notFound('stock:ITEM_NOT_FOUND')
  Object.assign(item, itemBody(body))
  return { item: serialiseItem(item) }
}

/** Past counts keep their own copy of the item, so deleting it loses nothing. */
function deleteItem({ state, params }: Ctx) {
  const id = params.id ?? ''
  if (!state.stockItems.some((row) => row.id === id)) notFound('stock:ITEM_NOT_FOUND')
  state.stockItems = state.stockItems.filter((row) => row.id !== id)
  return { id }
}

/** The whole list in its new order. Anything missing or extra is refused. */
function orderItems({ state, body }: Ctx) {
  const ids = Array.isArray(body.ids) ? (body.ids as string[]) : badRequest('demo:INVALID')
  const known = new Set(state.stockItems.map((item) => item.id))
  if (ids.length !== known.size || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
    conflict('stock:ORDER_MISMATCH')
  }
  for (const [index, id] of ids.entries()) {
    const item = state.stockItems.find((row) => row.id === id)
    if (item) item.sortOrder = index
  }
  return { ok: true }
}

function listCounts({ state, query }: Ctx) {
  const from = query.get('from')
  const to = query.get('to')
  const staff = query.get('staff')
  const branch = query.get('branch')
  return {
    counts: state.stockCounts
      .filter(
        (count) =>
          (!from || count.businessDate >= from) &&
          (!to || count.businessDate <= to) &&
          (!staff || count.staffName === staff) &&
          (!branch || count.branchName === branch),
      )
      .toSorted((a, b) => b.businessDate.localeCompare(a.businessDate) || Date.parse(b.submittedAt) - Date.parse(a.submittedAt))
      .slice(0, 500)
      .map(({ lines, ...count }) => ({
        ...count,
        itemCount: lines.length,
        filledCount: lines.filter((line) => line.unopenedMilli !== null || line.openedMilli !== null || line.balance !== null).length,
      })),
  }
}

function getCount({ state, params }: Ctx) {
  const count = state.stockCounts.find((row) => row.id === params.id) ?? notFound('stock:COUNT_NOT_FOUND')
  return { count }
}

const PDF_IN_DEMO = 'Vista’s server makes the stock PDFs, so they are not in the demo. Everything on screen is the same as the PDF.'

export const stockRoutes: Route[] = [
  ['GET', '/rms/stock/items', ({ state }) => ({ items: orderedItems(state).map(serialiseItem) })],
  ['POST', '/rms/stock/items', createItem],
  ['PUT', '/rms/stock/items/order', orderItems],
  ['PUT', '/rms/stock/items/:id', updateItem],
  ['DELETE', '/rms/stock/items/:id', deleteItem],
  ['GET', '/rms/stock/counts', listCounts],
  ['GET', '/rms/stock/checklist/pdf', () => demoOnly(PDF_IN_DEMO)],
  ['GET', '/rms/stock/counts/:id/pdf', () => demoOnly(PDF_IN_DEMO)],
  ['GET', '/rms/stock/counts/:id', getCount],
]
