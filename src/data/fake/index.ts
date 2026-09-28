import type { AccountSettings } from '../../domain/types.ts'
import {
  generateHistory,
  PERIOD_START as CANONICAL_START,
  TODAY as CANONICAL_TODAY,
} from './generate.ts'
import { addDays, daysBetween, malaysiaToday, shiftDates } from './shift-dates.ts'

export const ACCOUNT: AccountSettings = {
  businessName: 'Vista Demo Enterprise',
  outletName: 'Vista Counter · Section 7',
  settlementEnabled: true,
  sharedOverheadFoodPct: 70,
  hostCommissionPct: 30,
  capitalAssetFoodPct: 50,
}

/**
 * The demo always ends today. The history is generated on its canonical
 * calendar, then every date is slid forward to the real Malaysian today — so a
 * visitor sees the same months of trading whichever day they open it, with
 * today's shift still running.
 */
const OFFSET_DAYS = daysBetween(CANONICAL_TODAY, malaysiaToday(new Date()))

export const TODAY = addDays(CANONICAL_TODAY, OFFSET_DAYS)
export const PERIOD_START = addDays(CANONICAL_START, OFFSET_DAYS)

const generated = generateHistory()

/**
 * Generated once per page load and treated as read-only. The terminal's
 * heartbeat is already relative to the real clock, so it is not shifted.
 */
export const HISTORY = { ...shiftDates(generated, OFFSET_DAYS), terminal: generated.terminal }

export * from './catalogue.ts'
