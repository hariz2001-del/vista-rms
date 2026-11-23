import type { BenefitKind, CampaignStatus } from '../../data/campaigns-api.ts'

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Running',
  INACTIVE: 'Paused',
  ARCHIVED: 'Archived',
}

export const BENEFIT_LABEL: Record<BenefitKind, string> = {
  PREPAID_PRODUCT: 'Prepaid item',
  FIXED_VOUCHER: 'Voucher (amount off)',
}
