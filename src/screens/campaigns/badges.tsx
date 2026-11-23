import type { CampaignOrder, ProofFlag } from '../../data/campaigns-api.ts'
import { Badge } from '../../components/primitives.tsx'

export const FLAG_LABEL: Record<ProofFlag, string> = {
  PASSED: 'Looks right',
  FLAGGED: 'Check this',
  POSSIBLE_DUPLICATE: 'Possible duplicate',
  AMOUNT_MISMATCH: 'Amount differs',
  INVALID_IMAGE: 'Not a receipt',
  UNREADABLE: 'Unreadable',
}

/** What the reader thought of the proof. Always words, never colour alone. */
export function FlagBadges({ order }: { order: CampaignOrder }) {
  const proof = order.proof
  if (!proof || !proof.hasFile) return <Badge tone="critical">No proof</Badge>
  if (proof.readStatus === 'PENDING' || proof.readStatus === 'READING') return <Badge tone="info">Reading…</Badge>
  if (proof.flags.length === 0) return <Badge>Not read</Badge>
  if (proof.dismissedAt && proof.openFlags.length === 0 && !proof.flags.includes('PASSED')) return <Badge>Flags cleared</Badge>
  return (
    <span className="flex flex-wrap gap-1">
      {proof.flags.map((flag) => (
        <Badge key={flag} tone={flag === 'PASSED' ? 'good' : proof.dismissedAt ? 'neutral' : 'warning'}>
          {FLAG_LABEL[flag]}
        </Badge>
      ))}
    </span>
  )
}

export function VerificationBadge({ order }: { order: CampaignOrder }) {
  if (order.deletedAt) return <Badge>Deleted</Badge>
  if (order.verification === 'VERIFIED') return <Badge tone="good">Verified</Badge>
  if (order.verification === 'REJECTED') return <Badge tone="critical">Rejected</Badge>
  if (order.sheetSaysPaid) return <Badge tone="warning">Paid in sheet · verify</Badge>
  return <Badge tone="warning">Unverified</Badge>
}
