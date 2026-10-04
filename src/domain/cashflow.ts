import type {
  Brand,
  Expense,
  LedgerEntry,
  Partner,
  PaymentMethod,
  SaleCorrection,
} from './types.ts'

/**
 * Where a ringgit that left the stall came from, and who it went to.
 *
 * The cash book row does not point at the expense that wrote it, but every
 * writer leaves the same fingerprint: an expense paid from stall funds books
 * its own date, amount and description; paying back a partner books
 * "Reimbursed · <description>"; a refund carries its correction. So the detail
 * is read back from those, and a row nothing matches still says what it can.
 */

export type MoneyOutDetail = {
  /** How it was paid: the till, a QR, a card, a transfer — or the kind of payment. */
  source: string
  /** Who received it, and which brand it is charged to. */
  forWho: string
}

const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  DUITNOW_QR: 'DuitNow QR',
  DEBIT_CARD: 'Debit card',
  BANK_TRANSFER: 'Bank transfer',
}

const REIMBURSED = 'Reimbursed · '

export type MoneyOutContext = {
  brands: readonly Brand[]
  partners: readonly Partner[]
  expenses: readonly Expense[]
  corrections: readonly SaleCorrection[]
}

export function moneyOutDescriber({ brands, partners, expenses, corrections }: MoneyOutContext) {
  const brandName = (brandId: string | null) =>
    brandId === null ? 'Shared' : (brands.find((brand) => brand.id === brandId)?.name ?? '—')
  const partnerFor = (brandId: string | null | undefined) => {
    const partner = partners.find((candidate) => candidate.brandId === brandId)
    return partner ? `${partner.name} (${brandName(partner.brandId)} partner)` : `${brandName(brandId ?? null)} partner`
  }

  const paidFromStall = new Map<string, Expense>()
  const advances = new Map<string, Expense>()
  for (const expense of expenses) {
    if (expense.paidBy === 'STALL_FUNDS') {
      paidFromStall.set(`${expense.businessDate}|${expense.amountSen}|${expense.description}`, expense)
    } else {
      advances.set(`${expense.amountSen}|${expense.description}`, expense)
    }
  }
  const correctionById = new Map(corrections.map((correction) => [correction.id, correction]))

  return function describe(entry: LedgerEntry): MoneyOutDetail {
    const charged = brandName(entry.brandId)

    if (entry.category === 'REFUND') {
      const correction = entry.correctionId ? correctionById.get(entry.correctionId) : undefined
      return {
        source: 'Counter refund',
        forWho: correction ? `Customer · ${correction.originalQueueNumber} · ${charged}` : `Customer · ${charged}`,
      }
    }

    if (entry.category === 'OWNER_DRAWING') {
      return { source: 'Stall funds', forWho: partnerFor(entry.brandId) }
    }

    if (entry.category === 'RECONCILIATION_ADJUSTMENT') {
      return { source: 'Balance adjustment', forWho: '—' }
    }

    if (entry.category === 'LOAN_REPAYMENT') {
      return { source: 'Stall funds', forWho: 'Lender' }
    }

    if (entry.description.startsWith(REIMBURSED)) {
      const advance = advances.get(`${entry.amountSen}|${entry.description.slice(REIMBURSED.length)}`)
      const payerBrand =
        advance?.paidBy === 'PARTNER_FOOD' ? brands[0]?.id : advance?.paidBy === 'PARTNER_DRINKS' ? brands[1]?.id : undefined
      return {
        source: 'Paid back to partner',
        forWho: advance ? `${partnerFor(payerBrand)} · ${charged}` : charged,
      }
    }

    const expense = paidFromStall.get(`${entry.businessDate}|${entry.amountSen}|${entry.description}`)
    if (expense?.category === 'WAGES') {
      // Payroll writes "<staff name> — Payroll <period>".
      const staff = expense.description.split(' — ')[0] ?? 'Staff'
      return { source: 'Payroll', forWho: `${staff} (wages) · ${charged}` }
    }
    if (expense) {
      return {
        source: expense.paymentMethod ? METHOD_LABEL[expense.paymentMethod] : 'Stall funds',
        forWho: expense.vendor ? `${expense.vendor} · ${charged}` : charged,
      }
    }

    return { source: 'Stall funds', forWho: charged }
  }
}
