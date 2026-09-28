import { parseRinggitToSen } from './money.ts'
import type { ExpenseCategory } from './types.ts'

/**
 * Receipt entry without built-in OCR: the owner sends a receipt photo to an AI
 * chat (Gemini) with the prompt below, then pastes the reply back. The reply is
 * read here into the expense form's fields.
 *
 * The parser is forgiving about everything a chat app does to text — markdown
 * bold, code fences, bullets, "RM" prefixes, day-first dates — because the
 * owner should never have to tidy the reply by hand. Nothing is saved from
 * here: it only fills the form, and the owner checks and logs it.
 */

export type ChargeTo = 'FOOD' | 'DRINKS' | 'SHARED'

export type PastedExpense = {
  businessDate?: string
  amountSen?: number
  description?: string
  category?: ExpenseCategory
  chargeTo?: ChargeTo
  /** Food's share of a shared cost, 0–100. */
  foodSplitPct?: number
  /** Lines that looked like a field but could not be read, for the owner to see. */
  problems: string[]
}

export const BLOCK_START = '=== VISTA EXPENSE ==='
export const BLOCK_END = '=== END ==='

const CATEGORY_WORDS: Array<[ExpenseCategory, string[]]> = [
  ['RAW_MATERIALS', ['STOCK', 'RAW MATERIALS', 'RAW MATERIAL', 'INGREDIENTS', 'INGREDIENT', 'GROCERIES', 'RESTOCK']],
  ['PACKAGING', ['PACKAGING', 'PACKING', 'CONTAINERS', 'CUPS']],
  ['RENT', ['RENT', 'RENTAL', 'SEWA']],
  ['UTILITIES', ['UTILITIES', 'UTILITY', 'ELECTRICITY', 'WATER', 'GAS', 'INTERNET']],
  ['OPERATIONS', ['OPERATIONS', 'OPERATION', 'OPERATING', 'SUPPLIES', 'CLEANING']],
  ['MAINTENANCE', ['MAINTENANCE', 'REPAIR', 'REPAIRS', 'SERVICE']],
  ['CAPITAL_ASSET', ['EQUIPMENT', 'CAPITAL', 'CAPITAL ASSET', 'ASSET', 'MACHINE']],
]

/** The words the prompt asks for, in the order the form shows them. */
export const CATEGORY_CODES: Array<[ExpenseCategory, string]> = [
  ['RAW_MATERIALS', 'STOCK'],
  ['PACKAGING', 'PACKAGING'],
  ['RENT', 'RENT'],
  ['UTILITIES', 'UTILITIES'],
  ['OPERATIONS', 'OPERATIONS'],
  ['MAINTENANCE', 'MAINTENANCE'],
  ['CAPITAL_ASSET', 'EQUIPMENT'],
]

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
  // Malay spellings printed on local receipts (Jan, Feb, Apr, Jun, Jul, Sep, Nov match English).
  MAC: 3, MEI: 5, OGO: 8, OGOS: 8, OKT: 10, DIS: 12,
}

function isoDate(year: number, month: number, day: number): string | null {
  if (year < 100) year += 2000
  const date = new Date(Date.UTC(year, month - 1, day, 12))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }
  return date.toISOString().slice(0, 10)
}

/**
 * `2026-09-27`, or the day-first forms a Malaysian receipt prints:
 * `27/09/2026`, `27-09-26`, `27 Sep 2026`.
 */
export function parseReceiptDate(input: string): string | null {
  const text = input.trim().toUpperCase()
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text)
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]))
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text)
  if (match) return isoDate(Number(match[3]), Number(match[2]), Number(match[1]))
  match = /^(\d{1,2})[\s-]+([A-Z]{3,4})[A-Z]*[\s,-]+(\d{2}|\d{4})$/.exec(text)
  if (match) {
    const month = MONTHS[match[2] ?? ''] ?? MONTHS[(match[2] ?? '').slice(0, 3)]
    if (month) return isoDate(Number(match[3]), month, Number(match[1]))
  }
  return null
}

/** `RM 1,234.50`, `1234.5`, `RM45` → sen. Thousands commas are dropped. */
export function parseReceiptAmount(input: string): number | null {
  const cleaned = input.replace(/^\s*(?:MYR|RM)\s*/i, '').replace(/,(?=\d{3}\b)/g, '').trim()
  return parseRinggitToSen(cleaned)
}

function parseCategory(input: string): ExpenseCategory | null {
  const text = input.trim().toUpperCase().replace(/[_-]/g, ' ')
  for (const [category, words] of CATEGORY_WORDS) {
    if (words.includes(text)) return category
  }
  for (const [category, words] of CATEGORY_WORDS) {
    if (words.some((word) => text.includes(word))) return category
  }
  return null
}

function parseChargeTo(input: string, brandNames: { food: string; drinks: string }): ChargeTo | null {
  const text = input.trim().toUpperCase()
  if (text === 'SHARED' || text === 'BOTH' || text.includes('SHARED')) return 'SHARED'
  if (text === 'FOOD' || text === brandNames.food.toUpperCase()) return 'FOOD'
  if (text === 'DRINKS' || text === 'DRINK' || text === brandNames.drinks.toUpperCase()) return 'DRINKS'
  return null
}

/** `70/30`, `70%`, `70` → Food's share. */
function parseSplit(input: string): number | null {
  const match = /^(\d{1,3})\s*%?\s*(?:\/\s*(\d{1,3})\s*%?)?$/.exec(input.trim())
  if (!match) return null
  const food = Number(match[1])
  if (food > 100) return null
  if (match[2] !== undefined && food + Number(match[2]) !== 100) return null
  return food
}

/** Strip what chat apps wrap around a line: bullets, bold, backticks. */
function cleanLine(line: string): string {
  return line
    .replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/, '')
    .replace(/\*\*|__|`/g, '')
    .trim()
}

function readBlock(lines: string[], brandNames: { food: string; drinks: string }): PastedExpense {
  const result: PastedExpense = { problems: [] }
  for (const raw of lines) {
    const line = cleanLine(raw)
    const match = /^([A-Za-z][A-Za-z ]*?)\s*[:=]\s*(.*)$/.exec(line)
    if (!match) continue
    const key = (match[1] ?? '').toUpperCase().replace(/\s+/g, ' ')
    const value = (match[2] ?? '').trim()
    if (value === '' || /^(N\/?A|UNKNOWN|-)$/i.test(value)) continue

    switch (key) {
      case 'DATE': {
        const date = parseReceiptDate(value)
        if (date) result.businessDate = date
        else result.problems.push(`Date "${value}" is not a date`)
        break
      }
      case 'AMOUNT':
      case 'TOTAL': {
        const sen = parseReceiptAmount(value)
        if (sen !== null && sen > 0) result.amountSen = sen
        else result.problems.push(`Amount "${value}" is not an amount`)
        break
      }
      case 'WHAT':
      case 'WHAT FOR':
      case 'DESCRIPTION':
      case 'ITEMS':
        result.description = value.slice(0, 200)
        break
      case 'CATEGORY': {
        const category = parseCategory(value)
        if (category) result.category = category
        else result.problems.push(`Category "${value}" is not one of the list`)
        break
      }
      case 'CHARGE TO':
      case 'BRAND': {
        const chargeTo = parseChargeTo(value, brandNames)
        if (chargeTo) result.chargeTo = chargeTo
        else result.problems.push(`Charge to "${value}" is not Food, Drinks or Shared`)
        break
      }
      case 'SPLIT': {
        const pct = parseSplit(value)
        if (pct !== null) result.foodSplitPct = pct
        else result.problems.push(`Split "${value}" is not like 70/30`)
        break
      }
      default:
        break
    }
  }
  return result
}

function hasAnyField(expense: PastedExpense): boolean {
  return (
    expense.businessDate !== undefined ||
    expense.amountSen !== undefined ||
    expense.description !== undefined ||
    expense.category !== undefined ||
    expense.chargeTo !== undefined
  )
}

/**
 * Every expense in a pasted reply. Replies with the `=== VISTA EXPENSE ===`
 * markers yield one entry per block; a reply that dropped the markers is read
 * as a single expense.
 */
export function parsePastedExpenses(
  text: string,
  brandNames: { food: string; drinks: string } = { food: 'Food', drinks: 'Drinks' },
): PastedExpense[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: string[][] = []
  let current: string[] | null = null

  for (const line of lines) {
    const marker = cleanLine(line).toUpperCase()
    if (marker.startsWith('=== VISTA EXPENSE')) {
      current = []
      blocks.push(current)
    } else if (marker.startsWith('=== END')) {
      current = null
    } else if (current) {
      current.push(line)
    }
  }

  const parsed = (blocks.length > 0 ? blocks : [lines]).map((block) => readBlock(block, brandNames))
  return parsed.filter(hasAnyField)
}

/** The prompt the owner copies into Gemini alongside the receipt photo(s). */
export function receiptPrompt({
  foodName,
  drinksName,
  withBrands,
}: {
  foodName: string
  drinksName: string
  withBrands: boolean
}): string {
  const categories = CATEGORY_CODES.map(([, code]) => code).join(', ')
  return [
    'Read the attached receipt photo(s) and reply with ONLY the blocks below — one block per receipt, no other text, no markdown.',
    '',
    BLOCK_START,
    'DATE: the receipt date as YYYY-MM-DD',
    'AMOUNT: the final total paid, as a number like 45.80 (no RM, no commas)',
    'WHAT: a short description of what was bought, under 80 characters',
    `CATEGORY: exactly one of ${categories}`,
    ...(withBrands
      ? [
          `CHARGE TO: FOOD if everything is for the food side (${foodName}), DRINKS if for the drinks side (${drinksName}), SHARED if for both or unclear`,
          'SPLIT: only when CHARGE TO is SHARED, the food share as FOOD/DRINKS percentages like 70/30; otherwise leave this line out',
        ]
      : []),
    BLOCK_END,
    '',
    'Rules: STOCK is ingredients and drinks supplies for resale; PACKAGING is cups, boxes, bags; EQUIPMENT is anything that lasts more than a year. If a value cannot be read, write UNKNOWN. Never guess the amount.',
  ].join('\n')
}
