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

export type Product = {
  id: string
  brandId: string
  categoryId: string
  name: string
  basePriceSen: number
  imageUrl: string
  isSoldOut: boolean
  isActive: boolean
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
// Partners
// ---------------------------------------------------------------------------

export type Partner = {
  id: string
  name: string
  /** Which brand's economics this partner owns. */
  brandId: string
  role: 'FOOD_OWNER' | 'STALL_HOST'
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
  /** Share of shared overheads borne by Food. Drinks takes the remainder. */
  sharedOverheadFoodPct: number
  /** Host's cut of the Food net result. */
  hostCommissionPct: number
  /** Shared capital assets are a 50/50 responsibility, separate from the above. */
  capitalAssetFoodPct: number
}
