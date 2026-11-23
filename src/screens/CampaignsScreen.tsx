import { ArrowLeft, Plus } from 'lucide-react'
import { useState } from 'react'
import { campaignsApi, type Campaign } from '../data/campaigns-api.ts'
import type { VistaStore } from '../data/store.ts'
import { errorText, useLoad } from '../data/team-api.ts'
import { EmptyState, SectionHeading } from '../components/primitives.tsx'
import { CampaignTile } from './campaigns/CampaignTile.tsx'
import { CampaignView } from './campaigns/CampaignView.tsx'

/**
 * Campaigns: pre-order runs sold outside the till, each a tile. Opening one
 * shows the same dashboard for every campaign; what differs is configuration.
 */
export function CampaignsScreen({ store }: { store: VistaStore }) {
  const list = useLoad(() => campaignsApi.list())
  const [openId, setOpenId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)

  if (openId) {
    return (
      <div>
        <button
          type="button"
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-bold text-muted hover:text-ink"
          onClick={() => {
            setOpenId(null)
            list.reload()
          }}
        >
          <ArrowLeft size={16} /> All campaigns
        </button>
        <CampaignView campaignId={openId} store={store} />
      </div>
    )
  }

  const campaigns = list.data?.campaigns ?? []
  const current = campaigns.filter((campaign) => campaign.status !== 'ARCHIVED')
  const archived = campaigns.filter((campaign) => campaign.status === 'ARCHIVED')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="page-kicker">Pre-orders</p>
          <h1 className="font-display text-3xl font-black tracking-[-0.03em] text-ink">Campaigns</h1>
        </div>
        <button type="button" className="vista-button-primary inline-flex items-center gap-1.5" onClick={() => setCreating(true)}>
          <Plus size={16} /> New campaign
        </button>
      </div>

      {creating ? (
        <NewCampaign
          onCancel={() => setCreating(false)}
          onCreated={(campaign) => {
            setCreating(false)
            setOpenId(campaign.id)
          }}
        />
      ) : null}

      {list.error ? <p className="border border-critical bg-red-50 p-3 text-sm font-semibold text-critical">{list.error}</p> : null}
      {list.data === null && !list.error ? <p className="text-sm text-muted">Loading campaigns…</p> : null}

      {list.data && current.length === 0 ? (
        <EmptyState title="No campaigns yet" hint="Create one to track its pre-orders, check payments and redeem its coupons at the till." />
      ) : null}

      <ul className="grid gap-4 xl:grid-cols-2">
        {current.map((campaign) => (
          <li key={campaign.id}>
            <CampaignTile campaign={campaign} onOpen={() => setOpenId(campaign.id)} />
          </li>
        ))}
      </ul>

      {archived.length > 0 ? (
        <section>
          <button type="button" className="text-sm font-bold text-muted underline" onClick={() => setShowArchived((value) => !value)}>
            {showArchived ? 'Hide' : 'Show'} {archived.length} past {archived.length === 1 ? 'campaign' : 'campaigns'}
          </button>
          {showArchived ? (
            <div className="mt-3">
              <SectionHeading title="Past campaigns" />
              <ul className="grid gap-4 opacity-90 xl:grid-cols-2">
                {archived.map((campaign) => (
                  <li key={campaign.id}>
                    <CampaignTile campaign={campaign} onOpen={() => setOpenId(campaign.id)} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

function NewCampaign({ onCancel, onCreated }: { onCancel: () => void; onCreated: (campaign: Campaign) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const created = await campaignsApi.create({ name: name.trim() })
      onCreated(created.campaign)
    } catch (caught) {
      setError(errorText(caught))
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3 border border-line bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim()) void create()
      }}
    >
      <label className="min-w-[16rem] flex-1">
        <span className="vista-field-label">Campaign name</span>
        <input className="vista-control w-full" value={name} maxLength={80} autoFocus onChange={(event) => setName(event.target.value)} />
      </label>
      <button type="submit" className="vista-button-primary" disabled={busy || !name.trim()}>
        {busy ? 'Creating…' : 'Create'}
      </button>
      <button type="button" className="vista-button-secondary" onClick={onCancel}>
        Cancel
      </button>
      {error ? <p className="w-full text-sm font-semibold text-critical">{error}</p> : null}
    </form>
  )
}
