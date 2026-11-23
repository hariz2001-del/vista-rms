import { useState } from 'react'
import { campaignsApi } from '../../data/campaigns-api.ts'
import type { VistaStore } from '../../data/store.ts'
import { useLoad } from '../../data/team-api.ts'
import { Badge } from '../../components/primitives.tsx'
import { CampaignHistory } from './CampaignHistory.tsx'
import { CampaignOrders } from './CampaignOrders.tsx'
import { CampaignSetup } from './CampaignSetup.tsx'
import { STATUS_LABEL } from './labels.ts'

type Tab = 'orders' | 'setup' | 'history'
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'orders', label: 'Orders' },
  { key: 'setup', label: 'Setup' },
  { key: 'history', label: 'History' },
]

/** One campaign. Every campaign gets this same dashboard. */
export function CampaignView({ campaignId, store }: { campaignId: string; store: VistaStore }) {
  const detail = useLoad(() => campaignsApi.get(campaignId))
  const [tab, setTab] = useState<Tab>('orders')

  if (detail.error && !detail.data) return <p className="border border-critical bg-red-50 p-3 text-sm font-semibold text-critical">{detail.error}</p>
  if (!detail.data) return <p className="text-sm text-muted">Loading…</p>
  const { campaign } = detail.data

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-black tracking-[-0.03em] text-ink">{campaign.name}</h1>
        <Badge tone={campaign.status === 'ACTIVE' ? 'good' : campaign.status === 'ARCHIVED' ? 'neutral' : 'warning'}>
          {STATUS_LABEL[campaign.status]}
        </Badge>
      </div>

      <div role="tablist" className="flex gap-1 border-b border-line">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => setTab(item.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-bold ${
              tab === item.key ? 'border-rail text-ink' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'orders' ? <CampaignOrders detail={detail.data} onChanged={detail.reload} /> : null}
      {tab === 'setup' ? <CampaignSetup detail={detail.data} store={store} onSaved={(next) => detail.setData(next)} /> : null}
      {tab === 'history' ? <CampaignHistory campaignId={campaignId} /> : null}
    </div>
  )
}
