import { ImagePlus, Plus, Trash2 } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import {
  campaignsApi,
  useCampaignImage,
  type BenefitKind,
  type CampaignDetail,
  type CampaignEdit,
  type CatalogueEdit,
} from '../../data/campaigns-api.ts'
import type { VistaStore } from '../../data/store.ts'
import { errorText } from '../../data/team-api.ts'
import { formatRinggit, parseRinggitToSen } from '../../domain/money.ts'
import { prepareReceiptPhoto } from '../../lib/receipt-photo.ts'
import { Panel, SectionHeading } from '../../components/primitives.tsx'
import { BENEFIT_LABEL, STATUS_LABEL } from './labels.ts'

type Props = { detail: CampaignDetail; store: VistaStore; onSaved: (next: CampaignDetail) => void }

/** Everything that makes a campaign what it is. All of it is data. */
export function CampaignSetup({ detail, store, onSaved }: Props) {
  const archived = detail.campaign.status === 'ARCHIVED'
  return (
    <div className="space-y-5">
      {archived ? (
        <p className="border border-line bg-surface p-3 text-sm font-semibold text-muted">
          This campaign is archived. Change its status to edit it again.
        </p>
      ) : null}
      <DetailsForm detail={detail} store={store} onSaved={onSaved} />
      <Artwork detail={detail} onSaved={onSaved} disabled={archived} />
      <CatalogueForm detail={detail} store={store} onSaved={onSaved} disabled={archived} />
      <WalkInForm detail={detail} store={store} onSaved={onSaved} disabled={archived} />
      <SourceForm detail={detail} onSaved={onSaved} disabled={archived} />
    </div>
  )
}

function useSaver(onSaved: (next: CampaignDetail) => void) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  async function run(work: () => Promise<CampaignDetail>, done = 'Saved.') {
    setBusy(true)
    setMessage(null)
    try {
      onSaved(await work())
      setMessage({ tone: 'good', text: done })
    } catch (caught) {
      setMessage({ tone: 'bad', text: errorText(caught) })
    } finally {
      setBusy(false)
    }
  }
  const note = message ? (
    <p className={`text-sm font-semibold ${message.tone === 'good' ? 'text-good' : 'text-critical'}`} role="status">
      {message.text}
    </p>
  ) : null
  return { busy, run, note }
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="vista-field-label">{label}</span>
      {children}
    </label>
  )
}

function DetailsForm({ detail, store, onSaved }: Props) {
  const { campaign } = detail
  const [form, setForm] = useState<Required<CampaignEdit>>({
    name: campaign.name,
    description: campaign.description ?? '',
    status: campaign.status,
    brandId: campaign.brandId,
    tileTone: campaign.tileTone,
    sortOrder: campaign.sortOrder,
    startsOn: campaign.startsOn,
    endsOn: campaign.endsOn,
  })
  const saver = useSaver(onSaved)
  const set = <K extends keyof CampaignEdit>(key: K, value: Required<CampaignEdit>[K]) => setForm((current) => ({ ...current, [key]: value }))
  const archived = campaign.status === 'ARCHIVED'

  return (
    <Panel>
      <SectionHeading title="Details" />
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          void saver.run(() =>
            campaignsApi.update(campaign.id, {
              ...form,
              description: form.description?.trim() || null,
              startsOn: form.startsOn || null,
              endsOn: form.endsOn || null,
            }),
          )
        }}
      >
        <Field label="Name">
          <input className="vista-control w-full" value={form.name} maxLength={80} disabled={archived} onChange={(event) => set('name', event.target.value)} />
        </Field>
        <Field label="Status">
          <select className="vista-control w-full" value={form.status} onChange={(event) => set('status', event.target.value as typeof form.status)}>
            {(Object.keys(STATUS_LABEL) as Array<keyof typeof STATUS_LABEL>).map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <textarea
            className="vista-control min-h-20 w-full"
            value={form.description ?? ''}
            maxLength={500}
            disabled={archived}
            onChange={(event) => set('description', event.target.value)}
          />
        </Field>
        <Field label="Revenue goes to brand">
          <select
            className="vista-control w-full"
            value={form.brandId ?? ''}
            disabled={archived}
            onChange={(event) => set('brandId', event.target.value || null)}
          >
            <option value="">No brand (shared)</option>
            {store.brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tile text">
          <select className="vista-control w-full" value={form.tileTone} disabled={archived} onChange={(event) => set('tileTone', event.target.value as 'LIGHT' | 'DARK')}>
            <option value="LIGHT">White text (dark artwork)</option>
            <option value="DARK">Dark text (light artwork)</option>
          </select>
        </Field>
        <Field label="Starts">
          <input type="date" className="vista-control w-full" value={form.startsOn ?? ''} disabled={archived} onChange={(event) => set('startsOn', event.target.value || null)} />
        </Field>
        <Field label="Ends">
          <input type="date" className="vista-control w-full" value={form.endsOn ?? ''} disabled={archived} onChange={(event) => set('endsOn', event.target.value || null)} />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button type="submit" className="vista-button-primary" disabled={saver.busy || !form.name.trim()}>
            {saver.busy ? 'Saving…' : 'Save details'}
          </button>
          {saver.note}
        </div>
      </form>
    </Panel>
  )
}

/**
 * Menu items sold over the counter as part of the campaign. Their sales stay
 * ordinary till sales (and keep their brand); the campaign dashboard counts them.
 */
function WalkInForm({ detail, store, onSaved, disabled }: Props & { disabled: boolean }) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(detail.campaign.walkInProductIds))
  const [filter, setFilter] = useState('')
  const saver = useSaver(onSaved)
  const name = detail.campaign.name.toLowerCase()
  const products = store.products
    .filter((product) => product.isActive || chosen.has(product.id))
    .filter((product) => !filter.trim() || product.name.toLowerCase().includes(filter.trim().toLowerCase()) || chosen.has(product.id))
    .sort((a, b) => Number(chosen.has(b.id)) - Number(chosen.has(a.id)) || a.name.localeCompare(b.name))
  const categoryName = (id: string) => store.categories.find((category) => category.id === id)?.name ?? ''

  return (
    <Panel>
      <SectionHeading title="Walk-in items" />
      <p className="mb-3 text-sm text-muted">
        Menu items sold at the counter for {detail.campaign.name}, without a pre-order. They ring up as normal sales; the campaign's
        dashboard counts how many were sold and what they brought in.
      </p>
      <input
        className="vista-control mb-2 w-full sm:max-w-xs"
        placeholder={`Find an item (e.g. ${name.includes('bloom') ? 'SIB' : 'name'})`}
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      <ul className="scrollbar-subtle max-h-64 divide-y divide-line overflow-y-auto border border-line">
        {products.map((product) => (
          <li key={product.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
              <input
                type="checkbox"
                disabled={disabled}
                checked={chosen.has(product.id)}
                onChange={(event) =>
                  setChosen((current) => {
                    const next = new Set(current)
                    if (event.target.checked) next.add(product.id)
                    else next.delete(product.id)
                    return next
                  })
                }
              />
              <span className="flex-1 font-semibold">{product.name}</span>
              <span className="text-xs text-muted">{categoryName(product.categoryId)}</span>
              <span className="tabular text-xs">{formatRinggit(product.basePriceSen)}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          className="vista-button-primary"
          disabled={disabled || saver.busy}
          onClick={() => void saver.run(() => campaignsApi.update(detail.campaign.id, { walkInProductIds: [...chosen] }), 'Walk-in items saved.')}
        >
          {saver.busy ? 'Saving…' : `Save walk-in items (${chosen.size})`}
        </button>
        {saver.note}
      </div>
    </Panel>
  )
}

function Artwork({ detail, onSaved, disabled }: { detail: CampaignDetail; onSaved: (next: CampaignDetail) => void; disabled: boolean }) {
  return (
    <Panel>
      <SectionHeading title="Artwork" hint="The background fills the campaign's tile. It is only for looks; a wide picture works best." />
      <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <ImageSlot detail={detail} kind="background" label="Background" onSaved={onSaved} disabled={disabled} />
        <ImageSlot detail={detail} kind="logo" label="Logo (optional)" onSaved={onSaved} disabled={disabled} />
      </div>
    </Panel>
  )
}

function ImageSlot({
  detail,
  kind,
  label,
  onSaved,
  disabled,
}: {
  detail: CampaignDetail
  kind: 'background' | 'logo'
  label: string
  onSaved: (next: CampaignDetail) => void
  disabled: boolean
}) {
  const { campaign } = detail
  const image = kind === 'background' ? campaign.background : campaign.logo
  const url = useCampaignImage(campaign.id, kind, image)
  const input = useRef<HTMLInputElement>(null)
  const saver = useSaver(onSaved)

  async function choose(file: File) {
    await saver.run(async () => {
      const photo = await prepareReceiptPhoto(file)
      if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl)
      if (photo.mime === 'application/pdf') throw new Error('Choose a picture, not a PDF.')
      return campaignsApi.setImage(campaign.id, kind, { imageBase64: photo.base64, mimeType: photo.mime })
    }, 'Picture updated.')
  }

  return (
    <div>
      <span className="vista-field-label">{label}</span>
      <div className={`relative grid place-items-center overflow-hidden border border-dashed border-line bg-[#e7e2d6] ${kind === 'background' ? 'aspect-[3/1]' : 'aspect-square max-h-40'}`}>
        {url ? <img src={url} alt="" className={`h-full w-full ${kind === 'background' ? 'object-cover' : 'object-contain p-3'}`} /> : <ImagePlus className="text-muted" />}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void choose(file)
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className="vista-button-secondary" disabled={disabled || saver.busy} onClick={() => input.current?.click()}>
          {saver.busy ? 'Uploading…' : image ? 'Replace' : 'Upload'}
        </button>
        {image ? (
          <button
            type="button"
            className="vista-button-secondary"
            disabled={disabled || saver.busy}
            onClick={() => {
              if (window.confirm(`Remove the ${kind}?`)) void saver.run(() => campaignsApi.removeImage(campaign.id, kind), 'Removed.')
            }}
          >
            Remove
          </button>
        ) : null}
        {saver.note}
      </div>
    </div>
  )
}

type ProductRow = CatalogueEdit['products'][number] & { key: string; price: string }
type BenefitRow = Omit<CatalogueEdit['benefits'][number], 'productIndex' | 'valueSen'> & {
  key: string
  productKey: string | null
  value: string
}

let rowKey = 0
const nextKey = () => `row-${++rowKey}`
const money = (sen: number) => (sen / 100).toFixed(2)

function CatalogueForm({ detail, store, onSaved, disabled }: Props & { disabled: boolean }) {
  const [products, setProducts] = useState<ProductRow[]>(() =>
    detail.products.map((product) => ({ ...product, key: product.id, price: money(product.priceSen) })),
  )
  const [benefits, setBenefits] = useState<BenefitRow[]>(() =>
    detail.benefits.map((benefit) => ({
      key: benefit.id,
      productKey: benefit.campaignProductId,
      kind: benefit.kind,
      label: benefit.label,
      value: money(benefit.valueSen),
      productId: benefit.productId,
      categoryIds: benefit.categoryIds,
      expiresOn: benefit.expiresOn,
    })),
  )
  const saver = useSaver(onSaved)

  function save() {
    void saver.run(async () => {
      const body: CatalogueEdit = {
        products: products.map((row) => {
          const priceSen = parseRinggitToSen(row.price)
          if (priceSen === null) throw new Error(`Check the price of ${row.name || 'a product'}.`)
          return { id: row.id, name: row.name.trim(), externalKey: row.externalKey?.trim() || null, priceSen, isActive: row.isActive }
        }),
        benefits: benefits.map((row) => {
          const valueSen = parseRinggitToSen(row.value)
          if (valueSen === null) throw new Error(`Check the value of ${row.label || 'a benefit'}.`)
          const index = row.productKey ? products.findIndex((product) => product.key === row.productKey) : -1
          return {
            productIndex: index >= 0 ? index : null,
            kind: row.kind,
            label: row.label.trim(),
            valueSen,
            productId: row.productId,
            categoryIds: row.kind === 'FIXED_VOUCHER' && !row.productId ? row.categoryIds : [],
            expiresOn: row.expiresOn || null,
          }
        }),
      }
      const next = await campaignsApi.saveCatalogue(detail.campaign.id, body)
      setProducts(next.products.map((product) => ({ ...product, key: product.id, price: money(product.priceSen) })))
      setBenefits(
        next.benefits.map((benefit) => ({
          key: benefit.id,
          productKey: benefit.campaignProductId,
          kind: benefit.kind,
          label: benefit.label,
          value: money(benefit.valueSen),
          productId: benefit.productId,
          categoryIds: benefit.categoryIds,
          expiresOn: benefit.expiresOn,
        })),
      )
      return next
    })
  }

  const updateProduct = (key: string, patch: Partial<ProductRow>) =>
    setProducts((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  const updateBenefit = (key: string, patch: Partial<BenefitRow>) =>
    setBenefits((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  return (
    <Panel>
      <SectionHeading
        title="What customers pre-order"
        hint="Each item and its price. “Name in the source” must match how the order form or sheet names it, so imported orders find it."
      />
      <div className="space-y-2">
        {products.map((row) => (
          <div key={row.key} className="grid gap-2 border border-line/70 p-2 sm:grid-cols-[2fr_2fr_1fr_auto_auto] sm:items-end">
            <Field label="Item">
              <input className="vista-control w-full" value={row.name} disabled={disabled} onChange={(event) => updateProduct(row.key, { name: event.target.value })} />
            </Field>
            <Field label="Name in the source">
              <input
                className="vista-control w-full"
                value={row.externalKey ?? ''}
                disabled={disabled}
                onChange={(event) => updateProduct(row.key, { externalKey: event.target.value })}
              />
            </Field>
            <Field label="Price (RM)">
              <input className="vista-control tabular w-full" inputMode="decimal" value={row.price} disabled={disabled} onChange={(event) => updateProduct(row.key, { price: event.target.value })} />
            </Field>
            <label className="flex items-center gap-2 pb-2 text-sm font-semibold">
              <input type="checkbox" checked={row.isActive} disabled={disabled} onChange={(event) => updateProduct(row.key, { isActive: event.target.checked })} />
              On sale
            </label>
            <button
              type="button"
              className="vista-button-secondary"
              aria-label={`Remove ${row.name || 'item'}`}
              disabled={disabled}
              onClick={() => {
                setProducts((rows) => rows.filter((item) => item.key !== row.key))
                setBenefits((rows) => rows.map((benefit) => (benefit.productKey === row.key ? { ...benefit, productKey: null } : benefit)))
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="vista-button-secondary inline-flex items-center gap-1.5"
          disabled={disabled}
          onClick={() => setProducts((rows) => [...rows, { key: nextKey(), name: '', externalKey: '', priceSen: 0, price: '', isActive: true }])}
        >
          <Plus size={16} /> Add item
        </button>
      </div>

      <div className="mt-6">
        <SectionHeading
          title="What a coupon gives at the till"
          hint="A prepaid item rings up free (it was already paid). A voucher takes up to its amount off, never below zero."
        />
        <div className="space-y-2">
          {benefits.map((row) => (
            <div key={row.key} className="grid gap-2 border border-line/70 p-2 md:grid-cols-3 lg:grid-cols-[1.4fr_1.6fr_1fr_1.6fr_1.4fr_auto] lg:items-end">
              <Field label="Type">
                <select className="vista-control w-full" value={row.kind} disabled={disabled} onChange={(event) => updateBenefit(row.key, { kind: event.target.value as BenefitKind })}>
                  {(Object.keys(BENEFIT_LABEL) as BenefitKind[]).map((kind) => (
                    <option key={kind} value={kind}>
                      {BENEFIT_LABEL[kind]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Label">
                <input className="vista-control w-full" value={row.label} disabled={disabled} onChange={(event) => updateBenefit(row.key, { label: event.target.value })} />
              </Field>
              <Field label={row.kind === 'FIXED_VOUCHER' ? 'Up to (RM)' : 'Worth (RM)'}>
                <input className="vista-control tabular w-full" inputMode="decimal" value={row.value} disabled={disabled} onChange={(event) => updateBenefit(row.key, { value: event.target.value })} />
              </Field>
              {row.kind === 'PREPAID_PRODUCT' ? (
                <Field label="Till item (optional)">
                  <select className="vista-control w-full" value={row.productId ?? ''} disabled={disabled} onChange={(event) => updateBenefit(row.key, { productId: event.target.value || null })}>
                    <option value="">Handed over, no till line</option>
                    {store.products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} · {formatRinggit(product.basePriceSen)}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <div>
                  <span className="vista-field-label">Can be used on</span>
                  <select
                    className="vista-control w-full"
                    value={row.productId ? `p:${row.productId}` : row.categoryIds.length ? 'categories' : ''}
                    disabled={disabled}
                    onChange={(event) => {
                      const value = event.target.value
                      if (value.startsWith('p:')) updateBenefit(row.key, { productId: value.slice(2), categoryIds: [] })
                      else if (value === 'categories') updateBenefit(row.key, { productId: null, categoryIds: row.categoryIds.length ? row.categoryIds : store.categories.slice(0, 1).map((category) => category.id) })
                      else updateBenefit(row.key, { productId: null, categoryIds: [] })
                    }}
                  >
                    <option value="">Anything on the order</option>
                    <option value="categories">Items in chosen categories</option>
                    <optgroup label="One item">
                      {store.products.map((product) => (
                        <option key={product.id} value={`p:${product.id}`}>
                          {product.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  {!row.productId && row.categoryIds.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      {store.categories.map((category) => (
                        <label key={category.id} className="flex items-center gap-1.5 text-sm font-semibold">
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={row.categoryIds.includes(category.id)}
                            onChange={(event) =>
                              updateBenefit(row.key, {
                                categoryIds: event.target.checked
                                  ? [...row.categoryIds, category.id]
                                  : row.categoryIds.filter((id) => id !== category.id),
                              })
                            }
                          />
                          {category.name}
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
              <Field label="For">
                <select className="vista-control w-full" value={row.productKey ?? ''} disabled={disabled} onChange={(event) => updateBenefit(row.key, { productKey: event.target.value || null })}>
                  <option value="">Every coupon</option>
                  {products.map((product) => (
                    <option key={product.key} value={product.key}>
                      {product.name || 'Unnamed item'} coupons
                    </option>
                  ))}
                </select>
              </Field>
              <button
                type="button"
                className="vista-button-secondary"
                aria-label={`Remove ${row.label || 'benefit'}`}
                disabled={disabled}
                onClick={() => setBenefits((rows) => rows.filter((item) => item.key !== row.key))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="vista-button-secondary inline-flex items-center gap-1.5"
            disabled={disabled}
            onClick={() =>
              setBenefits((rows) => [
                ...rows,
                { key: nextKey(), productKey: null, kind: 'FIXED_VOUCHER', label: '', value: '', productId: null, categoryIds: [], expiresOn: null },
              ])
            }
          >
            <Plus size={16} /> Add benefit
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button type="button" className="vista-button-primary" disabled={disabled || saver.busy} onClick={save}>
          {saver.busy ? 'Saving…' : 'Save items and benefits'}
        </button>
        {saver.note}
      </div>
    </Panel>
  )
}

/** Which sheet column holds each thing Vista reads, by its heading. */
const COLUMN_FIELDS = [
  { key: 'orderRef', label: 'Order code column', required: true },
  { key: 'customerName', label: 'Customer name column', required: true },
  { key: 'submittedAt', label: 'Submitted-at column' },
  { key: 'contact', label: 'Contact column' },
  { key: 'product', label: 'Item column' },
  { key: 'total', label: 'Amount column' },
  { key: 'proof', label: 'Payment proof column' },
  { key: 'coupon', label: 'Coupon code column' },
  { key: 'status', label: 'Sheet status column' },
  { key: 'redeemed', label: 'Voucher-used column' },
  { key: 'message', label: 'Customer message column' },
  { key: 'messageStyle', label: 'Lettering style column' },
  { key: 'design', label: 'Design preview column' },
] as const

/** "Classic = Caveat 600" per line ⇄ { Classic: { font: 'Caveat', weight: 600 } }. */
function stylesToText(styles: Record<string, { font: string; weight?: number }> | undefined) {
  return Object.entries(styles ?? {})
    .map(([name, style]) => `${name} = ${style.font}${style.weight ? ` ${style.weight}` : ''}`)
    .join('\n')
}
function textToStyles(text: string) {
  const styles: Record<string, { font: string; weight?: number }> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const match = /^(.+?)\s*=\s*([A-Za-z0-9 ]+?)(?:\s+(\d{3}))?$/.exec(line)
    if (!match) throw new Error(`Lettering styles: write each line as "Style = Font" or "Style = Font 600" (not "${line}").`)
    styles[match[1]!.trim()] = { font: match[2]!.trim(), ...(match[3] ? { weight: Number(match[3]) } : {}) }
  }
  return styles
}

const SECRET_FIELDS = [
  { key: 'clientId', label: 'Google client ID' },
  { key: 'clientSecret', label: 'Google client secret' },
  { key: 'refreshToken', label: 'Google refresh token' },
] as const

function SourceForm({ detail, onSaved, disabled }: { detail: CampaignDetail; onSaved: (next: CampaignDetail) => void; disabled: boolean }) {
  const { source } = detail
  const [kind, setKind] = useState(source.kind)
  const [sheetId, setSheetId] = useState(source.config.sheetId ?? '')
  const [tab, setTab] = useState(source.config.tab ?? '')
  const [columns, setColumns] = useState<Record<string, string>>(source.config.columns ?? {})
  const [totalPer, setTotalPer] = useState<'ORDER' | 'LINE'>(source.config.totalPer ?? 'ORDER')
  const [fulfilment, setFulfilment] = useState((source.config.fulfilmentColumns ?? []).join(', '))
  const [auth, setAuth] = useState<'VISTA' | 'OWN'>(source.config.auth ?? (source.hasSecret ? 'OWN' : 'VISTA'))
  const [writeBack, setWriteBack] = useState(
    source.config.writeBack ?? { enabled: false, verified: 'Paid', rejected: 'Rejected', unverified: 'Pending check', keepWhenVerified: [] },
  )
  const [keep, setKeep] = useState((source.config.writeBack?.keepWhenVerified ?? []).join(', '))
  const [styles, setStyles] = useState(stylesToText(source.config.messageStyles))
  const [secret, setSecret] = useState<Record<string, string>>({})
  const saver = useSaver(onSaved)
  const changingSecret = SECRET_FIELDS.some((field) => secret[field.key])

  return (
    <Panel>
      <SectionHeading
        title="Where orders come from"
        hint="Vista reads new orders from the source. If you switch it on below, it also writes its decisions back to the status and voucher-used cells — nothing else in the sheet, its files, or the order form."
      />
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          void saver.run(async () => {
            if (auth === 'OWN' && changingSecret && SECRET_FIELDS.some((field) => !secret[field.key])) {
              throw new Error('Fill in all three Google fields to replace the connection.')
            }
            const next = await campaignsApi.saveSource(detail.campaign.id, {
              kind,
              config:
                kind === 'GOOGLE_SHEET'
                  ? {
                      ...source.config,
                      sheetId: sheetId.trim(),
                      tab: tab.trim(),
                      columns: Object.fromEntries(Object.entries(columns).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value)),
                      totalPer,
                      fulfilmentColumns: fulfilment.split(',').map((value) => value.trim()).filter(Boolean),
                      auth,
                      writeBack: { ...writeBack, keepWhenVerified: keep.split(',').map((value) => value.trim()).filter(Boolean) },
                      messageStyles: textToStyles(styles),
                    }
                  : {},
              ...(auth === 'OWN' && changingSecret ? { secret } : {}),
            })
            setSecret({})
            return next
          })
        }}
      >
        <Field label="Source">
          <select className="vista-control w-full" value={kind} disabled={disabled} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="NONE">None</option>
            <option value="GOOGLE_SHEET">Google Sheet</option>
          </select>
        </Field>
        {kind === 'GOOGLE_SHEET' ? (
          <>
            <Field label="Sheet ID">
              <input className="vista-control w-full font-mono text-xs" value={sheetId} disabled={disabled} onChange={(event) => setSheetId(event.target.value)} />
            </Field>
            <Field label="Tab name">
              <input className="vista-control w-full" value={tab} disabled={disabled} onChange={(event) => setTab(event.target.value)} />
            </Field>
            <fieldset className="grid gap-3 border border-line/70 p-3 sm:col-span-2 sm:grid-cols-3">
              <legend className="px-1 text-sm font-bold">Columns (type each heading exactly as in the sheet)</legend>
              {COLUMN_FIELDS.map((field) => (
                <Field key={field.key} label={`${field.label}${'required' in field ? ' *' : ''}`}>
                  <input
                    className="vista-control w-full"
                    value={columns[field.key] ?? ''}
                    disabled={disabled}
                    onChange={(event) => setColumns((current) => ({ ...current, [field.key]: event.target.value }))}
                  />
                </Field>
              ))}
              <Field label="The amount column is">
                <select className="vista-control w-full" value={totalPer} disabled={disabled} onChange={(event) => setTotalPer(event.target.value as 'ORDER' | 'LINE')}>
                  <option value="ORDER">The whole order's total</option>
                  <option value="LINE">Each row's own price</option>
                </select>
              </Field>
              <Field label="Pickup columns (comma separated)" className="sm:col-span-2">
                <input className="vista-control w-full" value={fulfilment} disabled={disabled} onChange={(event) => setFulfilment(event.target.value)} />
              </Field>
              <Field label="Lettering styles: one per line, style name = Google font (and weight)" className="sm:col-span-3">
                <textarea
                  className="vista-control w-full font-mono text-xs"
                  rows={4}
                  value={styles}
                  disabled={disabled}
                  placeholder={'Classic = Caveat 600\nCursive = Dancing Script 600'}
                  onChange={(event) => setStyles(event.target.value)}
                />
              </Field>
            </fieldset>
            <fieldset className="grid gap-3 border border-line/70 p-3 sm:col-span-2 sm:grid-cols-3">
              <legend className="px-1 text-sm font-bold">Keep the sheet up to date</legend>
              <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-3">
                <input
                  type="checkbox"
                  checked={writeBack.enabled}
                  disabled={disabled}
                  onChange={(event) => setWriteBack((current) => ({ ...current, enabled: event.target.checked }))}
                />
                Write Vista's decisions to the sheet: the status column, and the voucher-used tick when a coupon is used at the till
              </label>
              {writeBack.enabled ? (
                <>
                  <Field label="Verified becomes">
                    <input className="vista-control w-full" value={writeBack.verified} disabled={disabled} onChange={(event) => setWriteBack((current) => ({ ...current, verified: event.target.value }))} />
                  </Field>
                  <Field label="Rejected becomes">
                    <input className="vista-control w-full" value={writeBack.rejected} disabled={disabled} onChange={(event) => setWriteBack((current) => ({ ...current, rejected: event.target.value }))} />
                  </Field>
                  <Field label="Undone becomes">
                    <input className="vista-control w-full" value={writeBack.unverified} disabled={disabled} onChange={(event) => setWriteBack((current) => ({ ...current, unverified: event.target.value }))} />
                  </Field>
                  <Field label="Leave these alone on verify (comma separated)" className="sm:col-span-3">
                    <input className="vista-control w-full" value={keep} disabled={disabled} placeholder="Ready, Collected" onChange={(event) => setKeep(event.target.value)} />
                  </Field>
                </>
              ) : null}
            </fieldset>
            <Field label="Google access">
              <select className="vista-control w-full" value={auth} disabled={disabled} onChange={(event) => setAuth(event.target.value as 'VISTA' | 'OWN')}>
                <option value="VISTA">Vista's Google connection (share the sheet with it)</option>
                <option value="OWN">Separate Google keys</option>
              </select>
            </Field>
            {auth === 'OWN' ? (
              <p className="self-end pb-2 text-sm font-semibold text-muted">
                {source.hasSecret ? 'Google keys saved. Fill the fields below only to replace them.' : 'No Google keys saved yet.'}
              </p>
            ) : null}
            {auth === 'OWN' && SECRET_FIELDS.map((field) => (
              <Field key={field.key} label={field.label}>
                <input
                  className="vista-control w-full font-mono text-xs"
                  type="password"
                  autoComplete="off"
                  value={secret[field.key] ?? ''}
                  disabled={disabled}
                  onChange={(event) => setSecret((current) => ({ ...current, [field.key]: event.target.value.trim() }))}
                />
              </Field>
            ))}
          </>
        ) : null}
        <div className="flex items-center gap-3 sm:col-span-2">
          <button type="submit" className="vista-button-primary" disabled={disabled || saver.busy}>
            {saver.busy ? 'Saving…' : 'Save source'}
          </button>
          {saver.note}
        </div>
      </form>
    </Panel>
  )
}
