import { describe, expect, it } from 'vitest'
import {
  parsePastedExpenses,
  parseReceiptAmount,
  parseReceiptDate,
  receiptPrompt,
} from './receipt-paste.ts'
import { rangeLength, shiftRange } from './selectors.ts'

describe('parseReceiptDate', () => {
  it('reads ISO and the day-first forms Malaysian receipts print', () => {
    expect(parseReceiptDate('2026-09-27')).toBe('2026-09-27')
    expect(parseReceiptDate('27/09/2026')).toBe('2026-09-27')
    expect(parseReceiptDate('27-09-26')).toBe('2026-09-27')
    expect(parseReceiptDate('7 Sep 2026')).toBe('2026-09-07')
    expect(parseReceiptDate('3 Ogos 2026')).toBe('2026-08-03')
    expect(parseReceiptDate('12 Dis 2026')).toBe('2026-12-12')
  })

  it('refuses dates that do not exist', () => {
    expect(parseReceiptDate('31/02/2026')).toBeNull()
    expect(parseReceiptDate('yesterday')).toBeNull()
  })
})

describe('parseReceiptAmount', () => {
  it('reads RM prefixes and thousands commas into whole sen', () => {
    expect(parseReceiptAmount('45.80')).toBe(4_580)
    expect(parseReceiptAmount('RM 1,234.50')).toBe(123_450)
    expect(parseReceiptAmount('MYR45')).toBe(4_500)
    expect(parseReceiptAmount('12.5')).toBe(1_250)
  })

  it('refuses anything that is not money', () => {
    expect(parseReceiptAmount('about 40')).toBeNull()
    expect(parseReceiptAmount('12.345')).toBeNull()
  })
})

describe('parsePastedExpenses', () => {
  const BRANDS = { food: 'Bites', drinks: 'Drinks' }

  it('reads one block into every field', () => {
    const [expense] = parsePastedExpenses(
      `=== VISTA EXPENSE ===
DATE: 2026-09-27
AMOUNT: 45.80
WHAT: Pasar restock – ayam 3kg, telur 1 tray
CATEGORY: STOCK
CHARGE TO: SHARED
SPLIT: 70/30
=== END ===`,
      BRANDS,
    )
    expect(expense).toEqual({
      businessDate: '2026-09-27',
      amountSen: 4_580,
      description: 'Pasar restock – ayam 3kg, telur 1 tray',
      category: 'RAW_MATERIALS',
      chargeTo: 'SHARED',
      foodSplitPct: 70,
      problems: [],
      items: [],
    })
  })

  it('reads the receipt details and its item lines', () => {
    const [expense] = parsePastedExpenses(
      `=== VISTA EXPENSE ===
VENDOR: Pasar Borong Selayang
RECEIPT NO: INV-20931
DATE: 2026-09-27
TIME: 6:45 AM
AMOUNT: 101.98
PAYMENT: DuitNow QR
WHAT: Ayam dan telur
CATEGORY: STOCK
ITEM: Ayam bulat | 10 | ekor | 8.50
ITEM: Telur Gred A | 2 | papan | 8.25 | 16.50
ITEM: Rounding adjustment | 1 | | -0.02
=== END ===`,
    )
    expect(expense).toMatchObject({
      vendor: 'Pasar Borong Selayang',
      receiptNo: 'INV-20931',
      receiptTime: '06:45',
      paymentMethod: 'DUITNOW_QR',
      amountSen: 10_198,
      problems: [],
    })
    expect(expense?.items).toEqual([
      { name: 'Ayam bulat', quantityMilli: 10_000, unit: 'ekor', unitPriceSen: 850 },
      { name: 'Telur Gred A', quantityMilli: 2_000, unit: 'papan', unitPriceSen: 825 },
      { name: 'Rounding adjustment', quantityMilli: 1_000, unit: null, unitPriceSen: -2 },
    ])
  })

  it('reads the short item forms and fractional quantities', () => {
    const [expense] = parsePastedExpenses(
      'ITEM: Ice block | 12.00\nITEM: Daging | 2.5 | kg | 32.90\nITEM: ??? | lots | kg | 3',
    )
    expect(expense?.items).toEqual([
      { name: 'Ice block', quantityMilli: 1_000, unit: null, unitPriceSen: 1_200 },
      { name: 'Daging', quantityMilli: 2_500, unit: 'kg', unitPriceSen: 3_290 },
    ])
    expect(expense?.problems).toEqual(['Item "??? | lots | kg | 3" is not name | quantity | unit | price'])
  })

  it('files ice and gas under their own category, not utilities', () => {
    expect(parsePastedExpenses('AMOUNT: 5\nCATEGORY: ICE_GAS')[0]?.category).toBe('ICE_GAS')
    expect(parsePastedExpenses('AMOUNT: 5\nCATEGORY: Tong gas')[0]?.category).toBe('ICE_GAS')
    expect(parsePastedExpenses('AMOUNT: 5\nCATEGORY: TNB bill')[0]?.category).toBe('UTILITIES')
  })

  it('survives what a chat app does to the reply', () => {
    const [expense] = parsePastedExpenses(
      "Here you go!\n```\n**=== VISTA EXPENSE ===**\n- **Date:** 27/09/2026\n- **Amount:** RM 1,020.00\n* What: Chiller repair\n- Category: repair\n- Charge to: bites\n**=== END ===**\n```",
      BRANDS,
    )
    expect(expense).toMatchObject({
      businessDate: '2026-09-27',
      amountSen: 102_000,
      description: 'Chiller repair',
      category: 'MAINTENANCE',
      chargeTo: 'FOOD',
    })
  })

  it('returns one expense per block when several receipts are pasted', () => {
    const expenses = parsePastedExpenses(
      `=== VISTA EXPENSE ===
DATE: 2026-09-26
AMOUNT: 12.00
WHAT: Cups
CATEGORY: PACKAGING
=== END ===
=== VISTA EXPENSE ===
DATE: 2026-09-27
AMOUNT: 30.00
WHAT: Ice
CATEGORY: STOCK
=== END ===`,
    )
    expect(expenses.map((e) => [e.description, e.amountSen])).toEqual([
      ['Cups', 1_200],
      ['Ice', 3_000],
    ])
  })

  it('reads a reply that dropped the markers as a single expense', () => {
    const expenses = parsePastedExpenses('DATE: 2026-09-27\nAMOUNT: 8.50\nWHAT: Gas refill')
    expect(expenses).toHaveLength(1)
    expect(expenses[0]).toMatchObject({ amountSen: 850, description: 'Gas refill' })
  })

  it('leaves UNKNOWN fields blank and reports the unreadable ones', () => {
    const [expense] = parsePastedExpenses(
      'DATE: UNKNOWN\nAMOUNT: forty\nWHAT: Something\nCATEGORY: Snacks',
    )
    expect(expense?.businessDate).toBeUndefined()
    expect(expense?.amountSen).toBeUndefined()
    expect(expense?.problems).toEqual([
      'Amount "forty" is not an amount',
      'Category "Snacks" is not one of the list',
    ])
  })

  it('finds nothing in text that is not a reply', () => {
    expect(parsePastedExpenses('hello there')).toEqual([])
    expect(parsePastedExpenses('')).toEqual([])
  })

  it('rejects a split that does not add up to 100', () => {
    const [expense] = parsePastedExpenses('AMOUNT: 10\nSPLIT: 70/40')
    expect(expense?.foodSplitPct).toBeUndefined()
  })
})

describe('receiptPrompt', () => {
  it('names the brands and asks for the split only when there are two sides', () => {
    const withBrands = receiptPrompt({ foodName: 'Bites', drinksName: 'Drinks', withBrands: true })
    expect(withBrands).toContain('CHARGE TO')
    expect(withBrands).toContain('(Bites)')
    const single = receiptPrompt({ foodName: 'Bites', drinksName: 'Drinks', withBrands: false })
    expect(single).not.toContain('CHARGE TO')
  })

  it('round-trips: a reply in the prompt’s own format parses', () => {
    const prompt = receiptPrompt({ foodName: 'Food', drinksName: 'Drinks', withBrands: true })
    expect(prompt).toContain('=== VISTA EXPENSE ===')
    expect(prompt).toContain('=== END ===')
  })
})

describe('shiftRange', () => {
  it('steps a single day back and forward', () => {
    const day = { startDate: '2026-09-28', endDate: '2026-09-28' }
    expect(shiftRange(day, -1, '2026-09-28')).toEqual({ startDate: '2026-09-27', endDate: '2026-09-27' })
    expect(shiftRange({ startDate: '2026-09-01', endDate: '2026-09-01' }, -1, '2026-09-28')).toEqual({
      startDate: '2026-08-31',
      endDate: '2026-08-31',
    })
  })

  it('steps a longer window by its own length, never past today', () => {
    const week = { startDate: '2026-09-15', endDate: '2026-09-21' }
    expect(rangeLength(week)).toBe(7)
    expect(shiftRange(week, -1, '2026-09-28')).toEqual({ startDate: '2026-09-08', endDate: '2026-09-14' })
    expect(shiftRange(week, 1, '2026-09-25')).toEqual({ startDate: '2026-09-22', endDate: '2026-09-25' })
  })
})
