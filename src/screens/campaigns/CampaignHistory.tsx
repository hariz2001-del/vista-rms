import { campaignsApi } from '../../data/campaigns-api.ts'
import { useLoad } from '../../data/team-api.ts'
import { EmptyState } from '../../components/primitives.tsx'

const WHEN = new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' })

/** Who changed what on this campaign. Read-only; the trail cannot be edited. */
export function CampaignHistory({ campaignId }: { campaignId: string }) {
  const audit = useLoad(() => campaignsApi.audit(campaignId))
  if (audit.error) return <p className="text-sm font-semibold text-critical">{audit.error}</p>
  if (!audit.data) return <p className="text-sm text-muted">Loading…</p>
  if (audit.data.entries.length === 0) return <EmptyState title="Nothing has happened yet" />
  return (
    <div className="overflow-x-auto border border-line bg-surface">
      <table className="w-full text-left sm:min-w-[36rem] text-sm">
        <thead className="border-b border-line font-mono text-[0.65rem] uppercase text-muted">
          <tr>
            <th className="px-3 py-2">When</th>
            <th className="hidden px-3 py-2 sm:table-cell">Who</th>
            <th className="px-3 py-2">What</th>
          </tr>
        </thead>
        <tbody>
          {audit.data.entries.map((entry) => (
            <tr key={entry.id} className="border-b border-line/60">
              <td className="tabular whitespace-nowrap px-3 py-2 text-muted">{WHEN.format(new Date(entry.createdAt))}</td>
              <td className="hidden whitespace-nowrap px-3 py-2 sm:table-cell">{entry.actorLabel}</td>
              <td className="px-3 py-2 font-mono text-xs">
                {entry.action}
                <span className="block font-sans text-muted sm:hidden">{entry.actorLabel}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
