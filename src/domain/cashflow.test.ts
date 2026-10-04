import { describe, expect, it } from 'vitest'
import { moneyOutDescriber } from './cashflow.ts'
import type { Brand, Expense, LedgerEntry, Partner, SaleCorrection } from './types.ts'

const brand = (id: string, name: string): Brand => ({ id, name, colour: '#000', softColour: '#fff', chartColour: '#000' })
const BRANDS = [brand('food', 'Food'), brand('drinks', 'Drinks')]
const PARTNERS: Partner[] = [
  { id: 'p1', name: 'Hariz', brandId: 'food', role: 'FOOD_OWNER' },
  { id: 'p2', name: 'Iman', brandId: 'drinks', role: 'STALL_HOST' },
]

function expense(partial: Partial<Expense>): Expense {
  return {
    id: 'e',
    businessDate: '2026-10-01',
    amountSen: 1000,
    category: 'RAW_MATERIALS',
    paidBy: 'STALL_FUNDS',
    brandId: 'food',
    foodSplitPct: 100,
    foodAmountSen: 1000,
    drinksAmountSen: 0,
    description: 'Market',
    receiptUrl: null,
    isSettled: true,
    isLocked: false,
    ...partial,
  }
}

function entry(partial: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: 1,
    businessDate: '2026-10-01',
    entryAt: '2026-10-01T10:00:00Z',
    direction: 'MONEY_OUT',
    amountSen: 1000,
    category: 'OPERATING_EXPENSE',
    description: 'Market',
    brandId: 'food',
    orderId: null,
    shiftId: null,
    ...partial,
  }
}

const CORRECTION = { id: 'c1', originalQueueNumber: '#003' } as SaleCorrection

const describeOut = moneyOutDescriber({
  brands: BRANDS,
  partners: PARTNERS,
  corrections: [CORRECTION],
  expenses: [
    expense({ vendor: 'Pasar Borong', paymentMethod: 'DUITNOW_QR' }),
    expense({
      description: 'Aina — Payroll 1–15 Oct',
      category: 'WAGES',
      brandId: null,
      amountSen: 50000,
    }),
    expense({ description: 'Exhaust fan', paidBy: 'PARTNER_DRINKS', amountSen: 18500, brandId: null }),
  ],
})

describe('money out: source and for who', () => {
  it('reads how an expense was paid and who it went to', () => {
    expect(describeOut(entry({}))).toEqual({ source: 'DuitNow QR', forWho: 'Pasar Borong · Food' })
  })

  it('names the staff member on wages', () => {
    expect(
      describeOut(entry({ description: 'Aina — Payroll 1–15 Oct', amountSen: 50000, brandId: null })),
    ).toEqual({ source: 'Payroll', forWho: 'Aina (wages) · Shared' })
  })

  it('names the partner paid back, whatever day it was paid', () => {
    expect(
      describeOut(
        entry({ businessDate: '2026-10-05', description: 'Reimbursed · Exhaust fan', amountSen: 18500, brandId: null }),
      ),
    ).toEqual({ source: 'Paid back to partner', forWho: 'Iman (Drinks partner) · Shared' })
  })

  it('names the order on a refund and the partner on a drawing', () => {
    expect(describeOut(entry({ category: 'REFUND', correctionId: 'c1' }))).toEqual({
      source: 'Counter refund',
      forWho: 'Customer · #003 · Food',
    })
    expect(describeOut(entry({ category: 'OWNER_DRAWING', brandId: 'drinks' })).forWho).toBe(
      'Iman (Drinks partner)',
    )
  })

  it('still says what it can when nothing matches', () => {
    expect(describeOut(entry({ description: 'Unknown', brandId: null }))).toEqual({
      source: 'Stall funds',
      forWho: 'Shared',
    })
  })
})
