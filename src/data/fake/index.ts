import type { AccountSettings } from '../../domain/types.ts'
import { generateHistory, PERIOD_START, TODAY } from './generate.ts'

export const ACCOUNT: AccountSettings = {
  businessName: 'Vista Demo Enterprise',
  outletName: 'Vista Counter · Section 7',
  sharedOverheadFoodPct: 70,
  hostCommissionPct: 30,
  capitalAssetFoodPct: 50,
}

/**
 * Generated once per page load and treated as read-only. When `api-vista` grows
 * the expense and settlement endpoints, this is the module that gets replaced by
 * `fetch` — nothing else has to change.
 */
export const HISTORY = generateHistory()

export { PERIOD_START, TODAY }
export * from './catalogue.ts'
