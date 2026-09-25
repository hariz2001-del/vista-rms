/**
 * Client-side shapes for the Owner RMS.
 *
 * These mirror `api-vista/prisma/schema.prisma`, converted to the camelCase the
 * UI reads. Everything monetary is an integer number of sen.
 */

export type Brand = {
  id: string
  name: string
  colour: string
  softColour: string
  /** Validated chart mark colour. Not the same as `colour` — see index.css. */
  chartColour: string
}

export type Category = {
  id: string
  brandId: string
  name: string
}

export type ModifierOption = {
  id: string
  name: string
  priceSen: number
  type: 'ADD_ON' | 'REMOVAL'
  isSoldOut: boolean
}

/** Choices on an item, like a size or extras. `minSelect > 0` means required. */
export type ModifierGroup = {
  id: string
  name: string
  minSelect: number
  maxSelect: number
  options: ModifierOption[]
}

export type Product = {
  id: string
  brandId: string
  categoryId: string
  name: string
  /** Absent in the demo catalogue. */
  description?: string
  basePriceSen: number
  imageUrl: string
  isSoldOut: boolean
  isActive: boolean
  /** Absent in the demo catalogue. */
  modifierGroups?: ModifierGroup[]
}

// ---------------------------------------------------------------------------
// Trading
// ---------------------------------------------------------------------------

export type ReconciliationStatus = 'NOT_REQUIRED' | 'UNRECONCILED' | 'RECONCILED'

export type Shift = {
  id: string
  businessDate: string
  openedAt: string
  closedAt: string | null
  systemNetSalesSen: number | null
  declaredBankTotalSen: number | null
  varianceSen: number | null
  reconciliationStatus: ReconciliationStatus
}

export type FlagStatus = 'NONE' | 'FLAGGED' | 'DISMISSED' | 'RESOLVED_REFUND' | 'RESOLVED_ADJUSTMENT'

export type OrderLine = {
  productName: string
  brandId: string
  categoryId: string
  quantity: number
  unitPriceSen: number
  modifierTotalSen: number
  lineDiscountSen: number
  allocatedOrderDiscountSen: number
}

export type Order = {
  id: string
  shiftId: string
  businessDate: string
  queueNumber: string
  offlineLabel: string | null
  completedAt: string
  grossSen: number
  lineDiscountSen: number
  orderDiscountSen: number
  totalAmountSen: number
  flagStatus: FlagStatus
  flagReason: string | null
  needsReview: boolean
  reviewReason: string | null
  lines: OrderLine[]
}

export type CorrectionKind = 'CANCEL' | 'EXCHANGE'

export type SaleCorrection = {
  id: string
  originalOrderId: string
  originalQueueNumber: string
  shiftId: string
  businessDate: string
  createdAt: string
  kind: CorrectionKind
  reason: string
  /** Signed: negative was returned to the customer; positive was collected. */
  deltaSen: number
  brandDeltas: Array<{ brandId: string; deltaSen: number }>
}

// ---------------------------------------------------------------------------
// Money movement
// ---------------------------------------------------------------------------

export type LedgerDirection = 'MONEY_IN' | 'MONEY_OUT'

export type LedgerCategory =
  | 'REVENUE'
  | 'REFUND'
  | 'OPERATING_EXPENSE'
  | 'CAPITAL_INJECTION'
  | 'CAPITAL_ASSET'
  | 'OWNER_DRAWING'
  | 'LOAN_PROCEEDS'
  | 'LOAN_REPAYMENT'
  | 'RECONCILIATION_ADJUSTMENT'

export type LedgerEntry = {
  id: number
  businessDate: string
  entryAt: string
  direction: LedgerDirection
  amountSen: number
  category: LedgerCategory
  description: string
  /** Null means the entry is shared across brands rather than belonging to one. */
  brandId: string | null
  orderId: string | null
  shiftId: string | null
  /** Present when this row came from a cashier cancel or exchange. */
  correctionId?: string | null
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export type ExpenseCategory =
  | 'RAW_MATERIALS'
  | 'PACKAGING'
  | 'RENT'
  | 'UTILITIES'
  | 'OPERATIONS'
  | 'MAINTENANCE'
  | 'CAPITAL_ASSET'

/** Who actually paid. A partner paying out of pocket creates a debt, not an outflow. */
export type PaymentSource = 'STALL_FUNDS' | 'PARTNER_FOOD' | 'PARTNER_DRINKS'

export type Expense = {
  id: string
  businessDate: string
  amountSen: number
  category: ExpenseCategory
  paidBy: PaymentSource
  /** Null means shared between brands and subject to the split below. */
  brandId: string | null
  foodSplitPct: number
  foodAmountSen: number
  drinksAmountSen: number
  description: string
  receiptUrl: string | null
  /** For a partner-paid expense: has the stall settled up with them? */
  isSettled: boolean
  isLocked: boolean
}

// ---------------------------------------------------------------------------
// Live counter state
// ---------------------------------------------------------------------------

/**
 * What the owner can know about the tablet right now.
 *
 * None of this exists on the server yet — there is no heartbeat endpoint and no
 * failure reporting from the device. The shape is here so the banner can be
 * built and reviewed, and so the eventual `/status` endpoint has a target.
 */
export type TerminalStatus = {
  /** ISO timestamp of the last contact from the tablet. Null means never. */
  lastSeenAt: string | null
  /** Consecutive 5xx or timeout responses the tablet has reported. */
  consecutiveSyncFailures: number
  /** Sales the tablet is still holding locally. */
  unsentSaleCount: number
}

/** A counter tablet signed in right now. The owner can sign it out from Settings. */
export type CounterSession = {
  id: string
  signedInAt: string
  lastUsedAt: string
}

// ---------------------------------------------------------------------------
// Partners
// ---------------------------------------------------------------------------

export type Partner = {
  id: string
  name: string
  /** Which brand's economics this partner owns. */
  brandId: string
  role: 'FOOD_OWNER' | 'STALL_HOST'
}

/**
 * A discount preset for a promo. The cashier picks it from the discount screen
 * for one item or the whole order, on business dates inside its range.
 */
export type PromotionTarget = {
  /** Exactly one of an item or a category. */
  productId: string | null
  categoryId: string | null
  /** For a combo: how many of it the combo needs. */
  quantity: number
}

export type Promotion = {
  id: string
  name: string
  /** PERCENT: `value` is 1–100. AMOUNT: `value` is sen off. */
  kind: 'PERCENT' | 'AMOUNT'
  value: number
  /** Off the whole order; off certain items; or off a combo bought together. */
  scope: 'ORDER' | 'ITEMS' | 'COMBO'
  /** Whole-order promos: applied to every order without the cashier picking it. Item and combo promos always are. */
  autoApply: boolean
  /** Every matching item or complete combo, or once per receipt. */
  limit: 'EACH' | 'ONCE_PER_ORDER'
  targets: PromotionTarget[]
  startsOn: string
  /** Null runs until switched off. */
  endsOn: string | null
  isActive: boolean
}

export type PeriodClosure = {
  id: string
  startDate: string
  endDate: string
  closedAt: string
  foodNetSalesSen: number
  foodDirectExpensesSen: number
  foodOverheadShareSen: number
  foodNetResultSen: number
  openingIouSen: number
  hostCommissionSen: number
  closingIouSen: number
}

export type AccountSettings = {
  businessName: string
  outletName: string
  /**
   * Partner settlement: two brands, one partner each, and a payout between
   * them. Off for a new business, which then never sees partners or splits.
   */
  settlementEnabled: boolean
  /**
   * When one trading day ends and the next begins: an hour of the morning,
   * 0–12, Malaysia time. With 5, a 1am sale counts for the night before.
   * Absent in older data, which means 5.
   */
  dayRolloverHour?: number
  /** Share of shared overheads borne by Food. Drinks takes the remainder. */
  sharedOverheadFoodPct: number
  /** Host's cut of the Food net result. */
  hostCommissionPct: number
  /** Shared capital assets are a 50/50 responsibility, separate from the above. */
  capitalAssetFoodPct: number
}
