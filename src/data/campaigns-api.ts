import { useEffect, useState } from 'react'
import { apiFile, apiRequest } from '../lib/http.ts'

/**
 * Campaigns: pre-order runs sold outside the till (Sarang in Bloom is the first).
 * Owner only. Everything about a campaign comes from the server; nothing in the
 * screens knows any one campaign by name.
 */

export type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'
export type ImageRef = { version: number; width: number; height: number } | null

export type Campaign = {
  id: string
  name: string
  description: string | null
  status: CampaignStatus
  brandId: string | null
  tileTone: 'LIGHT' | 'DARK'
  sortOrder: number
  /** Menu items sold as walk-ins for the campaign, counted on its dashboard. */
  walkInProductIds: string[]
  startsOn: string | null
  endsOn: string | null
  background: ImageRef
  logo: ImageRef
  sourceKind: 'NONE' | 'GOOGLE_SHEET'
  lastSyncedAt: string | null
  archivedAt: string | null
  counts: { orders: number; UNVERIFIED: number; VERIFIED: number; REJECTED: number } | null
}

export type CampaignProduct = {
  id: string
  name: string
  externalKey: string | null
  priceSen: number
  isActive: boolean
}

export type BenefitKind = 'PREPAID_PRODUCT' | 'FIXED_VOUCHER'

export type CampaignBenefit = {
  id: string
  campaignProductId: string | null
  kind: BenefitKind
  label: string
  valueSen: number
  productId: string | null
  categoryIds: string[]
  expiresOn: string | null
}

export type CampaignSource = {
  kind: 'NONE' | 'GOOGLE_SHEET'
  config: {
    sheetId?: string
    tab?: string
    columns?: Record<string, string>
    totalPer?: 'ORDER' | 'LINE'
    fulfilmentColumns?: string[]
    syncEveryMinutes?: number
    auth?: 'VISTA' | 'OWN'
    writeBack?: { enabled: boolean; verified: string; rejected: string; unverified: string; keepWhenVerified: string[] }
    messageStyles?: Record<string, MessageStyle>
  }
  hasSecret: boolean
}

/** How a lettering style the customer picked is shown: a Google Fonts family and weight. */
export type MessageStyle = { font: string; weight?: number }

export type CampaignDetail = {
  campaign: Campaign
  products: CampaignProduct[]
  benefits: CampaignBenefit[]
  source: CampaignSource
}

export type CampaignEdit = Partial<
  Pick<Campaign, 'name' | 'description' | 'status' | 'brandId' | 'tileTone' | 'sortOrder' | 'startsOn' | 'endsOn'>
>

export type CatalogueEdit = {
  products: Array<{ id?: string; name: string; externalKey: string | null; priceSen: number; isActive: boolean }>
  benefits: Array<{
    productIndex: number | null
    kind: BenefitKind
    label: string
    valueSen: number
    productId: string | null
    categoryIds: string[]
    expiresOn: string | null
  }>
}

export type AuditEntry = {
  id: string
  orderId: string | null
  actorKind: string
  actorLabel: string
  action: string
  before: unknown
  after: unknown
  createdAt: string
}

export type Verification = 'UNVERIFIED' | 'VERIFIED' | 'REJECTED'
export type ProofFlag = 'PASSED' | 'FLAGGED' | 'POSSIBLE_DUPLICATE' | 'AMOUNT_MISMATCH' | 'INVALID_IMAGE' | 'UNREADABLE'

export type Extraction = {
  looksLikeReceipt: boolean
  readable: boolean
  provider: string | null
  date: string | null
  time: string | null
  amountSen: number | null
  reference: string | null
  recipient: string | null
  status: string | null
  concerns: string[]
}

export type CampaignOrder = {
  id: string
  externalRef: string
  customerName: string
  contact: string | null
  submittedAt: string
  expectedSen: number
  paidSen: number | null
  paymentDate: string | null
  paymentRef: string | null
  verification: Verification
  decidedByLabel: string | null
  decidedAt: string | null
  reviewNote: string | null
  posted: boolean
  sourceStatus: string | null
  /** Marked paid in the sheet by hand, not yet verified in Vista: its coupons won't work at the till until it is. */
  sheetSaysPaid: boolean
  fulfilment: Record<string, string>
  /** The pickup date and slot as the form wrote them; isoDate when the date could be read. Only in lists. */
  pickup?: { date: string | null; isoDate: string | null; slot: string | null }
  deletedAt: string | null
  lines: Array<{
    id: string
    lineNo: number
    label: string
    priceSen: number
    campaignProductId: string | null
    /** What the customer wrote, the lettering style they picked, and whether the form saved a design preview. */
    message: string | null
    messageStyle: string | null
    hasDesign: boolean
  }>
  coupons: Array<{ code: string; lineId: string | null; redeemedAt: string | null; prepaidSen: number | null; voucherSen: number | null }>
  proof: {
    hasFile: boolean
    readStatus: 'PENDING' | 'READING' | 'DONE' | 'FAILED' | 'NONE'
    flags: ProofFlag[]
    openFlags: ProofFlag[]
    summary: string | null
    extraction: Extraction | null
    readAt: string | null
    dismissedAt: string | null
  } | null
}

export type CampaignSummary = {
  orders: number
  expectedSen: number
  verifiedSen: number
  unverified: number
  verified: number
  rejected: number
  flagged: number
  unread: number
  couponsIssued: number
  couponsRedeemed: number
  outstandingSen: number
  /** Over-the-counter sales of the campaign's walk-in items (cancelled sales left out). */
  walkIns: { sales: number; units: number; netSen: number; items: Array<{ productId: string; name: string; units: number; netSen: number }> }
  lastSync: { status: 'RUNNING' | 'OK' | 'FAILED'; trigger: string; startedAt: string; finishedAt: string | null; added: number; updated: number; skipped: number; error: string | null } | null
}

export type OrderQuery = {
  q?: string
  verification?: Verification
  flag?: ProofFlag | 'NEEDS_ATTENTION' | 'UNREAD'
  redeemed?: 'yes' | 'no'
  /** yes: handed over (every coupon used, or the sheet says Collected). */
  collected?: 'yes' | 'no'
  pickupDate?: string
  pickupSlot?: string
  sort?: 'submittedAt' | 'customerName' | 'expectedSen' | 'externalRef' | 'verification' | 'pickup'
  dir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
  includeDeleted?: 'yes' | 'no' | 'only'
}

/** Every pickup date on the live orders, in date order, with its slots. */
export type PickupOptions = {
  hasPickup: boolean
  dates: Array<{ value: string; isoDate: string | null; orders: number; slots: Array<{ value: string; orders: number }> }>
}

export type OrderDetail = {
  order: CampaignOrder
  benefits: Array<Pick<CampaignBenefit, 'id' | 'campaignProductId' | 'kind' | 'label' | 'valueSen' | 'expiresOn'>>
  messageStyles: Record<string, MessageStyle>
  sourceData: { rows?: Array<Record<string, string>> }
  history: Array<{ id: string; actorLabel: string; action: string; after: unknown; createdAt: string }>
}

export type BulkAction = 'reject' | 'dismiss' | 'delete' | 'restore'

const queryString = (query: object) => {
  const text = new URLSearchParams(
    Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([key, value]) => [key, String(value)]),
  ).toString()
  return text ? `?${text}` : ''
}

export const campaignsApi = {
  list: () => apiRequest<{ campaigns: Campaign[] }>('GET', '/rms/campaigns'),
  get: (id: string) => apiRequest<CampaignDetail>('GET', `/rms/campaigns/${id}`),
  create: (body: CampaignEdit & { name: string }) => apiRequest<CampaignDetail>('POST', '/rms/campaigns', body),
  update: (id: string, body: CampaignEdit & { walkInProductIds?: string[] }) => apiRequest<CampaignDetail>('PATCH', `/rms/campaigns/${id}`, body),
  saveCatalogue: (id: string, body: CatalogueEdit) => apiRequest<CampaignDetail>('PUT', `/rms/campaigns/${id}/catalogue`, body),
  setImage: (id: string, kind: 'background' | 'logo', body: { imageBase64: string; mimeType: string }) =>
    apiRequest<CampaignDetail>('PUT', `/rms/campaigns/${id}/images/${kind}`, body),
  removeImage: (id: string, kind: 'background' | 'logo') =>
    apiRequest<CampaignDetail>('DELETE', `/rms/campaigns/${id}/images/${kind}`),
  saveSource: (id: string, body: { kind: CampaignSource['kind']; config: CampaignSource['config']; secret?: Record<string, string> | null }) =>
    apiRequest<CampaignDetail>('PUT', `/rms/campaigns/${id}/source`, body),
  audit: (id: string) => apiRequest<{ entries: AuditEntry[] }>('GET', `/rms/campaigns/${id}/audit`),

  summary: (id: string) => apiRequest<CampaignSummary>('GET', `/rms/campaigns/${id}/summary`),
  pickups: (id: string) => apiRequest<PickupOptions>('GET', `/rms/campaigns/${id}/pickups`),
  sync: (id: string) =>
    apiRequest<{ added: number; updated: number; unchanged: number; skipped: number; notes: string[] }>('POST', `/rms/campaigns/${id}/sync`),
  orders: (id: string, query: OrderQuery) =>
    apiRequest<{ total: number; page: number; pageSize: number; orders: CampaignOrder[] }>('GET', `/rms/campaigns/${id}/orders${queryString(query)}`),
  orderIds: (id: string, query: OrderQuery) => apiRequest<{ ids: string[] }>('GET', `/rms/campaigns/${id}/orders/ids${queryString({ ...query, page: undefined, pageSize: undefined })}`),
  order: (id: string, orderId: string) => apiRequest<OrderDetail>('GET', `/rms/campaigns/${id}/orders/${orderId}`),
  proofFile: (id: string, orderId: string) => apiFile(`/rms/campaigns/${id}/orders/${orderId}/proof`),
  designFile: (id: string, orderId: string, lineId: string) => apiFile(`/rms/campaigns/${id}/orders/${orderId}/lines/${lineId}/design`),
  verify: (id: string, orderId: string, body: { paymentDate: string; paidSen?: number; paymentRef?: string | null; note?: string | null }) =>
    apiRequest<{ verification: Verification }>('POST', `/rms/campaigns/${id}/orders/${orderId}/verify`, body),
  reject: (id: string, orderId: string, note: string | null) =>
    apiRequest<{ verification: Verification }>('POST', `/rms/campaigns/${id}/orders/${orderId}/reject`, { note }),
  reopen: (id: string, orderId: string) => apiRequest<{ verification: Verification }>('POST', `/rms/campaigns/${id}/orders/${orderId}/reopen`, {}),
  unverify: (id: string, orderId: string, note: string) =>
    apiRequest<{ verification: Verification }>('POST', `/rms/campaigns/${id}/orders/${orderId}/unverify`, { note }),
  dismissFlags: (id: string, orderId: string) => apiRequest<{ ok: true }>('POST', `/rms/campaigns/${id}/orders/${orderId}/proof/dismiss`, {}),
  reread: (id: string, orderId: string) => apiRequest<{ ok: true }>('POST', `/rms/campaigns/${id}/orders/${orderId}/proof/reread`, {}),
  bulk: (id: string, body: { action: BulkAction; ids: string[]; note?: string | null }) =>
    apiRequest<{ done: string[]; skipped: Array<{ id: string; ref: string | null; reason: string }> }>('POST', `/rms/campaigns/${id}/orders/bulk`, body),
}

/**
 * A campaign image, fetched with the owner's session (images are never public)
 * and shown as an object URL. `version` changes when the image is replaced, so
 * the tile refetches; the URL is revoked when it is no longer shown.
 */
export function useCampaignImage(campaignId: string, kind: 'background' | 'logo', image: ImageRef): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const version = image?.version ?? null
  useEffect(() => {
    if (version === null) {
      setUrl(null)
      return
    }
    let live = true
    let made: string | null = null
    apiFile(`/rms/campaigns/${campaignId}/images/${kind}?v=${version}`)
      .then((file) => {
        if (!live) return
        made = URL.createObjectURL(file)
        setUrl(made)
      })
      .catch(() => {
        if (live) setUrl(null)
      })
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [campaignId, kind, version])
  return url
}
