import { ExternalLink, ImageOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { campaignsApi, type CampaignOrder, type MessageStyle, type OrderDetail } from '../../data/campaigns-api.ts'
import { errorText } from '../../data/team-api.ts'
import { code128Bars } from '../../domain/code128.ts'
import { formatRinggit } from '../../domain/money.ts'

const DAY = new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' })

/**
 * What the customer made, one card per item: the design preview the order form
 * rendered, the message in the lettering they picked, and the coupon they were
 * given — drawn here from Vista's own records, with a scannable barcode.
 */
export function OrderSets({ campaignId, detail }: { campaignId: string; detail: OrderDetail }) {
  const { order, benefits, messageStyles } = detail
  useStyleFonts(messageStyles)
  const looseCoupons = order.coupons.filter((coupon) => !order.lines.some((line) => line.id === coupon.lineId))

  return (
    <section>
      <h3 className="vista-field-label">{order.lines.length > 1 ? `What they ordered (${order.lines.length})` : 'What they ordered'}</h3>
      <div className="space-y-4">
        {order.lines.map((line) => {
          const coupon = order.coupons.find((item) => item.lineId === line.id)
          const gives = benefits.filter((benefit) => benefit.campaignProductId === null || benefit.campaignProductId === line.campaignProductId)
          return (
            <article key={line.id} className="border border-line/70 p-3">
              <header className="mb-2 flex items-baseline justify-between gap-2 text-sm">
                <p className="font-bold">
                  {order.lines.length > 1 ? `${line.lineNo}. ` : ''}
                  {line.label}
                </p>
                <span className="tabular text-muted">{formatRinggit(line.priceSen)}</span>
              </header>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
                <DesignPreview campaignId={campaignId} orderId={order.id} line={line} />
                <div className="min-w-0 space-y-2">
                  <ChalkMessage text={line.message} styleName={line.messageStyle} style={line.messageStyle ? messageStyles[line.messageStyle] : undefined} />
                  {coupon ? <CouponTicket order={order} coupon={coupon} label={line.label} gives={gives} /> : null}
                </div>
              </div>
            </article>
          )
        })}
        {looseCoupons.map((coupon) => (
          <CouponTicket key={coupon.code} order={order} coupon={coupon} label={null} gives={benefits.filter((benefit) => benefit.campaignProductId === null)} />
        ))}
      </div>
    </section>
  )
}

/** Load the Google Fonts the campaign's lettering styles use, once per page. */
function useStyleFonts(styles: Record<string, MessageStyle>) {
  const families = [...new Set(Object.values(styles).map((style) => `${style.font}:${style.weight ?? 400}`))].toSorted().join('|')
  useEffect(() => {
    if (!families) return
    const href = `https://fonts.googleapis.com/css2?${families
      .split('|')
      .map((entry) => {
        const [font, weight] = entry.split(':')
        return `family=${encodeURIComponent(font!).replace(/%20/g, '+')}:wght@${weight}`
      })
      .join('&')}&display=swap`
    if (document.head.querySelector(`link[data-campaign-fonts="${CSS.escape(href)}"]`)) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.dataset.campaignFonts = href
    document.head.appendChild(link)
  }, [families])
}

function ChalkMessage({ text, styleName, style }: { text: string | null; styleName: string | null; style: MessageStyle | undefined }) {
  if (!text) return <p className="text-sm text-muted">No message written.</p>
  return (
    <div className="bg-[#1d2420] px-3 py-2.5 text-white">
      <p
        dir="auto"
        className="break-words text-2xl leading-tight"
        style={style ? { fontFamily: `'${style.font}', cursive`, fontWeight: style.weight ?? 400 } : undefined}
      >
        {text}
      </p>
      <p className="mt-1.5 text-[11px] uppercase tracking-[0.14em] text-white/60">
        {styleName ? `Style: ${styleName}` : 'No style picked'}
        {styleName && !style ? ' · font not set up in Setup' : ''}
      </p>
    </div>
  )
}

/** The rendered design, fetched with the owner's session like the payment proof. */
function DesignPreview({ campaignId, orderId, line }: { campaignId: string; orderId: string; line: CampaignOrder['lines'][number] }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!line.hasDesign) return
    let live = true
    let made: string | null = null
    setUrl(null)
    setError(null)
    campaignsApi
      .designFile(campaignId, orderId, line.id)
      .then((file) => {
        if (!live) return
        made = URL.createObjectURL(file)
        setUrl(made)
      })
      .catch((caught) => live && setError(errorText(caught, 'Could not load the design.')))
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [campaignId, orderId, line.id, line.hasDesign])

  const frame = 'grid aspect-[4/5] w-full place-items-center border border-line/60 bg-[#f6f3ec] text-center text-xs text-muted'
  if (!line.hasDesign) {
    return (
      <div className={frame}>
        <span className="flex flex-col items-center gap-1 p-2">
          <ImageOff size={18} />
          No design preview saved
        </span>
      </div>
    )
  }
  if (error) return <div className={`${frame} p-2 font-semibold text-critical`}>{error}</div>
  if (!url) return <div className={frame}>Loading design…</div>
  return (
    <a href={url} target="_blank" rel="noreferrer" className="group relative block" aria-label="Open the design full size">
      <img src={url} alt={`Design preview: ${line.label}`} className="aspect-[4/5] w-full border border-line/60 object-cover" />
      <span className="absolute right-1.5 top-1.5 bg-white/90 p-1 opacity-80 group-hover:opacity-100">
        <ExternalLink size={14} />
      </span>
    </a>
  )
}

type Coupon = CampaignOrder['coupons'][number]

function couponState(order: CampaignOrder, coupon: Coupon): { text: string; tone: string } {
  if (coupon.redeemedAt) return { text: `Used ${DAY.format(new Date(coupon.redeemedAt))}`, tone: 'bg-[#e4e1d8] text-ink' }
  if (order.deletedAt || order.verification === 'REJECTED') return { text: 'Void', tone: 'bg-red-100 text-critical' }
  if (order.verification === 'VERIFIED') return { text: 'Ready to use', tone: 'bg-green-100 text-good' }
  return { text: 'Not valid until payment is verified', tone: 'bg-amber-100 text-warning' }
}

function CouponTicket({ order, coupon, label, gives }: { order: CampaignOrder; coupon: Coupon; label: string | null; gives: OrderDetail['benefits'] }) {
  const state = couponState(order, coupon)
  const bars = code128Bars(coupon.code)
  const width = bars ? bars.reduce((sum, bar) => sum + bar, 0) + 20 : 0
  let x = 10
  return (
    <div className="overflow-hidden border border-line/70 text-sm">
      <div className="bg-[#2f3a25] px-3 py-2.5 text-white">
        <p className="text-[10px] uppercase tracking-[0.18em] text-white/60">Coupon gives</p>
        {gives.length ? (
          <ul className="mt-1 space-y-0.5">
            {gives.map((benefit) => (
              <li key={benefit.id} className="flex justify-between gap-3">
                <span className="font-semibold">{benefit.label}</span>
                <span className="tabular">
                  {benefit.kind === 'FIXED_VOUCHER' ? 'up to ' : ''}
                  {formatRinggit(benefit.valueSen)}
                  {benefit.expiresOn ? ` · until ${benefit.expiresOn}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-white/70">No benefits set up in Setup.</p>
        )}
      </div>
      <div className="border-t-2 border-dashed border-line bg-[#f6f3ec] px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted">Coupon no.</p>
            <p className="font-mono text-lg font-bold tracking-[0.08em]">{coupon.code}</p>
          </div>
          <span className={`shrink-0 px-2 py-0.5 text-xs font-bold ${state.tone}`}>{state.text}</span>
        </div>
        {bars ? (
          <svg viewBox={`0 0 ${width} 50`} preserveAspectRatio="none" className="mt-1.5 block h-12 w-full fill-current text-ink" role="img" aria-label={`Barcode for coupon ${coupon.code}`}>
            {bars.map((bar, index) => {
              const at = x
              x += bar
              return index % 2 === 0 ? <rect key={index} x={at} y={0} width={bar} height={50} /> : null
            })}
          </svg>
        ) : null}
        <p className="mt-1.5 flex justify-between gap-2 text-xs text-muted">
          <span>{label ?? 'Whole order'}</span>
          <span className="font-mono">{order.externalRef}</span>
        </p>
        {coupon.redeemedAt && (coupon.prepaidSen || coupon.voucherSen) ? (
          <p className="mt-1 text-xs text-muted">
            Took off {formatRinggit((coupon.prepaidSen ?? 0) + (coupon.voucherSen ?? 0))} at the till
            {coupon.prepaidSen ? ` (${formatRinggit(coupon.prepaidSen)} prepaid` : ''}
            {coupon.prepaidSen && coupon.voucherSen ? `, ${formatRinggit(coupon.voucherSen)} voucher)` : coupon.prepaidSen ? ')' : ''}
            {!coupon.prepaidSen && coupon.voucherSen ? ` (voucher)` : ''}.
          </p>
        ) : null}
      </div>
    </div>
  )
}
