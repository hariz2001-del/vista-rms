import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Badge, Panel, SectionHeading } from '../components/primitives.tsx'
import type { VistaStore } from '../data/store.ts'
import { formatRinggit, parseRinggitToSen } from '../domain/money.ts'
import { formatDate } from '../domain/selectors.ts'
import type { Promotion } from '../domain/types.ts'

/**
 * Promotions: discount presets for a promo, each over a range of business
 * dates. The cashier picks one from the discount screen — for one item or the
 * whole order — and it works the amount out. On an order with two brands, a
 * whole-order promo is split between them by each brand's share, like any
 * order discount.
 */

type Draft = Omit<Promotion, 'id'>

/** Where a promo stands on `today`. */
export function promotionStatus(promotion: Promotion, today: string): {
  label: string
  tone: 'good' | 'neutral' | 'warning'
} {
  if (!promotion.isActive) return { label: 'Off', tone: 'neutral' }
  if (promotion.startsOn > today) return { label: `Starts ${formatDate(promotion.startsOn)}`, tone: 'warning' }
  if (promotion.endsOn !== null && promotion.endsOn < today) return { label: 'Ended', tone: 'neutral' }
  return { label: 'Running', tone: 'good' }
}

export function describeValue(promotion: Pick<Promotion, 'kind' | 'value'>): string {
  return promotion.kind === 'PERCENT' ? `${promotion.value}% off` : `${formatRinggit(promotion.value)} off`
}

function PromotionForm({
  initial,
  today,
  onSave,
  onCancel,
}: {
  initial: Draft | null
  today: string
  onSave: (draft: Draft) => Promise<boolean>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [kind, setKind] = useState<Draft['kind']>(initial?.kind ?? 'PERCENT')
  const [value, setValue] = useState(
    initial ? (initial.kind === 'PERCENT' ? String(initial.value) : (initial.value / 100).toFixed(2)) : '',
  )
  const [startsOn, setStartsOn] = useState(initial?.startsOn ?? today)
  const [hasEnd, setHasEnd] = useState(initial ? initial.endsOn !== null : true)
  const [endsOn, setEndsOn] = useState(initial?.endsOn ?? today)
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)
  const [busy, setBusy] = useState(false)

  const parsed =
    kind === 'PERCENT'
      ? /^\d{1,3}$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= 100
        ? Number(value)
        : null
      : parseRinggitToSen(value)
  const rangeOk = !hasEnd || endsOn >= startsOn
  const canSave = name.trim().length > 0 && parsed !== null && parsed > 0 && rangeOk && startsOn !== ''

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSave || parsed === null || busy) return
    setBusy(true)
    const saved = await onSave({
      name: name.trim(),
      kind,
      value: parsed,
      startsOn,
      endsOn: hasEnd ? endsOn : null,
      isActive,
    })
    setBusy(false)
    if (saved) onCancel()
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-3 border border-line bg-canvas p-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="block">
          <span className="vista-field-label">Promo name</span>
          <input
            autoFocus
            value={name}
            maxLength={60}
            placeholder="e.g. Merdeka week"
            onChange={(event) => setName(event.target.value)}
            className="vista-control mt-1 w-full px-3"
          />
        </label>
        <div>
          <span className="vista-field-label">Discount</span>
          <div className="mt-1 flex">
            {(['PERCENT', 'AMOUNT'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={kind === option}
                onClick={() => {
                  setKind(option)
                  setValue('')
                }}
                className={`min-h-[2.6rem] border px-3 text-sm font-bold ${
                  kind === option ? 'border-rail bg-rail text-white' : 'border-line bg-surface text-muted'
                }`}
              >
                {option === 'PERCENT' ? '% off' : 'RM off'}
              </button>
            ))}
            <input
              value={value}
              inputMode="decimal"
              aria-label={kind === 'PERCENT' ? 'Percentage off' : 'Amount off in RM'}
              placeholder={kind === 'PERCENT' ? '10' : '2.00'}
              onChange={(event) => setValue(event.target.value)}
              className="vista-control w-24 px-3 tabular"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="vista-field-label">Starts</span>
          <input
            type="date"
            value={startsOn}
            onChange={(event) => setStartsOn(event.target.value)}
            className="vista-control mt-1 px-2"
          />
        </label>
        <label className="block">
          <span className="vista-field-label">Ends</span>
          <input
            type="date"
            value={endsOn}
            disabled={!hasEnd}
            min={startsOn}
            onChange={(event) => setEndsOn(event.target.value)}
            className="vista-control mt-1 px-2 disabled:opacity-40"
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-bold text-muted">
          <input type="checkbox" checked={!hasEnd} onChange={(event) => setHasEnd(!event.target.checked)} className="size-5" />
          No end date
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-bold text-muted">
          <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} className="size-5" />
          On
        </label>
      </div>
      {!rangeOk ? (
        <p className="text-sm font-bold text-critical" role="alert">
          It has to end on or after the day it starts.
        </p>
      ) : null}
      <p className="text-xs text-muted">
        Dates are trading days. The counter offers it on every trading day from the start to the end, both included.
      </p>

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!canSave || busy} className="vista-button-primary min-h-11 px-4 disabled:opacity-50">
          Save promo
        </button>
        <button type="button" onClick={onCancel} className="vista-button-secondary min-h-11 px-4">
          Cancel
        </button>
      </div>
    </form>
  )
}

export function PromotionsPanel({ store }: { store: VistaStore }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const canEdit = store.canEditMenu

  const save = (id: string | undefined) => (promotion: Draft) =>
    store.editMenu({ kind: 'savePromotion', ...(id ? { id } : {}), promotion })

  return (
    <Panel>
      <SectionHeading
        title="Promotions"
        hint="Discount presets for a promo. The cashier picks one from the discount screen, for one item or the whole order, on the days it runs."
      />

      {store.promotions.length === 0 && editing !== 'new' ? (
        <p className="text-sm text-muted">No promotions yet.</p>
      ) : null}

      <ul className="divide-y divide-slate-100">
        {store.promotions.map((promotion) => {
          const status = promotionStatus(promotion, store.today)
          return (
            <li key={promotion.id} className="py-3">
              {editing === promotion.id ? (
                <PromotionForm
                  initial={promotion}
                  today={store.today}
                  onSave={save(promotion.id)}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black">{promotion.name}</p>
                    <p className="text-xs text-muted">
                      {describeValue(promotion)} · {formatDate(promotion.startsOn)}
                      {promotion.endsOn ? ` – ${formatDate(promotion.endsOn)}` : ' onwards'}
                    </p>
                  </div>
                  <Badge tone={status.tone}>{status.label}</Badge>
                  {canEdit ? (
                    <>
                      <button
                        type="button"
                        aria-label={`Edit ${promotion.name}`}
                        onClick={() => setEditing(promotion.id)}
                        className="grid size-10 place-items-center border border-line bg-surface text-slate-600 hover:bg-canvas"
                      >
                        <Pencil aria-hidden="true" className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${promotion.name}`}
                        onClick={() => {
                          if (window.confirm(`Delete "${promotion.name}"? Sales it was used on keep their discount.`)) {
                            void store.editMenu({ kind: 'deletePromotion', id: promotion.id })
                          }
                        }}
                        className="grid size-10 place-items-center border border-line bg-surface text-critical hover:bg-canvas"
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </button>
                    </>
                  ) : null}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {canEdit ? (
        editing === 'new' ? (
          <div className="mt-2">
            <PromotionForm initial={null} today={store.today} onSave={save(undefined)} onCancel={() => setEditing(null)} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="mt-2 flex min-h-11 items-center gap-1 px-1 text-sm font-bold text-ink underline"
          >
            <Plus aria-hidden="true" className="size-4" /> Add promotion
          </button>
        )
      ) : null}
    </Panel>
  )
}
