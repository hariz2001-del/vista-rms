import { ImageIcon } from 'lucide-react'
import { useCampaignImage, type Campaign } from '../../data/campaigns-api.ts'
import { STATUS_LABEL } from './labels.ts'

/**
 * One campaign on the Campaigns page: a wide tile with its artwork behind it,
 * the way the till's menu buttons carry a picture, but stretched into a banner.
 * The gradient is only there so the words stay readable on any artwork.
 */
export function CampaignTile({ campaign, onOpen }: { campaign: Campaign; onOpen: () => void }) {
  const background = useCampaignImage(campaign.id, 'background', campaign.background)
  const logo = useCampaignImage(campaign.id, 'logo', campaign.logo)
  const dark = campaign.tileTone === 'DARK'
  const counts = campaign.counts
  const waiting = counts?.UNVERIFIED ?? 0

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative block aspect-[16/7] w-full overflow-hidden border border-line bg-rail text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 sm:aspect-[3/1]"
      aria-label={`Open ${campaign.name}`}
    >
      {background ? (
        <img
          src={background}
          alt=""
          className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 grid place-items-center bg-[#e7e2d6] text-muted">
          <ImageIcon size={32} />
        </div>
      )}
      <div
        aria-hidden="true"
        className={`absolute inset-0 ${
          dark
            ? 'bg-gradient-to-r from-white/85 via-white/55 to-white/0'
            : 'bg-gradient-to-r from-black/70 via-black/35 to-black/0'
        }`}
      />
      <div className={`relative flex h-full flex-col justify-between p-4 sm:p-5 ${dark ? 'text-ink' : 'text-white'}`}>
        <div className="flex items-start justify-between gap-3">
          <span
            className={`px-2 py-1 font-mono text-[0.65rem] font-bold uppercase tracking-wide ${
              campaign.status === 'ACTIVE'
                ? 'bg-good text-white'
                : dark
                  ? 'bg-ink/10 text-ink'
                  : 'bg-white/20 text-white backdrop-blur-sm'
            }`}
          >
            {STATUS_LABEL[campaign.status]}
          </span>
          {logo ? <img src={logo} alt="" className="h-10 w-auto max-w-[30%] object-contain drop-shadow sm:h-12" /> : null}
        </div>
        <div>
          <p className="font-display text-2xl font-black leading-tight tracking-[-0.02em] sm:text-3xl">{campaign.name}</p>
          {counts ? (
            <p className="mt-1 text-sm font-semibold opacity-90">
              {counts.orders} {counts.orders === 1 ? 'order' : 'orders'}
              {waiting > 0 ? ` · ${waiting} to check` : ''}
            </p>
          ) : null}
        </div>
      </div>
    </button>
  )
}
