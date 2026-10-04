import { apiRequest } from '../lib/http.ts'
import type { StockBalance } from '../domain/stock.ts'

/** One thing on the closing-stock list, as the owner set it up. */
export type StockItem = {
  id: string
  brandId: string
  category: string
  subcategory: string | null
  name: string
  unitLabel: string | null
  trackUnopened: boolean
  trackOpened: boolean
  trackBalance: boolean
  isActive: boolean
  sortOrder: number
}

export type StockItemInput = Omit<StockItem, 'id' | 'sortOrder'>

export type StockCountSummary = {
  id: string
  businessDate: string
  submittedAt: string
  branchName: string
  staffName: string
  remarks: string | null
  itemCount: number
  filledCount: number
}

/** A submitted line, carrying the item's set-up as it was when counted. */
export type StockCountLine = {
  brandId: string | null
  brandName: string
  category: string
  subcategory: string | null
  name: string
  unitLabel: string | null
  trackUnopened: boolean
  trackOpened: boolean
  trackBalance: boolean
  unopenedMilli: number | null
  openedMilli: number | null
  balance: StockBalance | null
}

export type StockCount = Omit<StockCountSummary, 'itemCount' | 'filledCount'> & {
  lines: StockCountLine[]
}

export const stockApi = {
  listItems: () => apiRequest<{ items: StockItem[] }>('GET', '/rms/stock/items'),
  createItem: (body: StockItemInput) => apiRequest<{ item: StockItem }>('POST', '/rms/stock/items', body),
  updateItem: (id: string, body: StockItemInput) =>
    apiRequest<{ item: StockItem }>('PUT', `/rms/stock/items/${id}`, body),
  deleteItem: (id: string) => apiRequest<{ id: string }>('DELETE', `/rms/stock/items/${id}`),
  orderItems: (ids: string[]) => apiRequest<{ ok: true }>('PUT', '/rms/stock/items/order', { ids }),

  listCounts: (range: { from: string; to: string }) =>
    apiRequest<{ counts: StockCountSummary[] }>(
      'GET',
      `/rms/stock/counts?${new URLSearchParams(range).toString()}`,
    ),
  getCount: (id: string) => apiRequest<{ count: StockCount }>('GET', `/rms/stock/counts/${id}`),
}
