import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Badge, Panel, SectionHeading } from '../components/primitives.tsx'
import type { VistaStore } from '../data/store.ts'
import { formatRinggit, parseRinggitToSen } from '../domain/money.ts'
import { formatDate } from '../domain/selectors.ts'
import type { Category, Product, Promotion, PromotionTarget } from '../domain/types.ts'

/**
 * Promotions, each over a range of trading days:
 *  - off the whole order — picked by the cashier from the discount screen, or
 *    applied to every order automatically;
 *  - off certain items or categories — applied automatically when they are in
 *    the order;
 *  - off a combo bought together — applied automatically once the whole combo
 *    is in the order;
 * to every match, or once per receipt. The counter shows automatic promos on
 * the order, and the cashier can take one off.
 *
 * On a two-brand stall any promo spanning both brands — a whole-order promo, a
 * combo — is shared between them by each one's value, like any order discount.
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

/** "Whole order · automatic", "Kopi Ais, any Coffee · once per receipt", "Combo: 1 × Nasi + 1 × any Drinks". */
export function describeRule(
  promotion: Pick<Promotion, 'scope' | 'autoApply' | 'limit' | 'targets'>,
  nameOf: (target: PromotionTarget) => string,
): string {
  if (promotion.scope === 'ORDER') {
    return promotion.autoApply ? 'Whole order · automatic on every order' : 'Whole order · cashier picks it'
  }
  const often = promotion.limit === 'ONCE_PER_ORDER' ? 'once per receipt' : promotion.scope === 'COMBO' ? 'every combo' : 'every item'
  if (promotion.scope === 'COMBO') {
    return `Combo: ${promotion.targets.map((target) => `${target.quantity} × ${nameOf(target)}`).join(' + ')} · ${often}`
  }
  return `${promotion.targets.map(nameOf).join(', ')} · ${often}`
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div>
      <span className="vista-field-label">{label}</span>
      <div className="mt-1 flex flex-wrap" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`min-h-[2.6rem] border px-3 text-sm font-bold ${
              value === option.value ? 'border-rail bg-rail text-white' : 'border-line bg-surface text-muted hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Tick whole categories, or single items. */
function ItemsPicker({
  categories,
  products,
  targets,
  onChange,
}: {
  categories: Category[]
  products: Product[]
  targets: PromotionTarget[]
  onChange: (targets: PromotionTarget[]) => void
}) {
  const hasCategory = (id: string) => targets.some((target) => target.categoryId === id)
  const hasProduct = (id: string) => targets.some((target) => target.productId === id)
  const toggle = (target: PromotionTarget, on: boolean) =>
    onChange(
      on
        ? [...targets, target]
        : targets.filter((candidate) =>
            target.productId ? candidate.productId !== target.productId : candidate.categoryId !== target.categoryId,
          ),
    )

  return (
    <div className="max-h-72 space-y-3 overflow-y-auto border border-line bg-surface p-3">
      {categories.map((category) => {
        const whole = hasCategory(category.id)
        const items = products.filter((product) => product.categoryId === category.id)
        return (
          <div key={category.id}>
            <label className="flex min-h-9 items-center gap-2 text-sm font-black">
              <input
                type="checkbox"
                checked={whole}
                onChange={(event) => toggle({ productId: null, categoryId: category.id, quantity: 1 }, event.target.checked)}
                className="size-5"
              />
              All of {category.name}
            </label>
            <div className="ml-7 flex flex-wrap gap-x-4">
              {items.map((product) => (
                <label key={product.id} className={`flex min-h-9 items-center gap-2 text-sm ${whole ? 'text-muted' : ''}`}>
                  <input
                    type="checkbox"
                    disabled={whole}
                    checked={whole || hasProduct(product.id)}
                    onChange={(event) => toggle({ productId: product.id, categoryId: null, quantity: 1 }, event.target.checked)}
                    className="size-5"
                  />
                  {product.name}
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** A combo, row by row: an item or "any from a category", and how many. */
function ComboBuilder({
  categories,
  products,
  targets,
  onChange,
}: {
  categories: Category[]
  products: Product[]
  targets: PromotionTarget[]
  onChange: (targets: PromotionTarget[]) => void
}) {
  const keyOf = (target: PromotionTarget) =>
    target.productId ? `p:${target.productId}` : target.categoryId ? `c:${target.categoryId}` : ''
  const fromKey = (key: string, quantity: number): PromotionTarget =>
    key.startsWith('p:')
      ? { productId: key.slice(2), categoryId: null, quantity }
      : { productId: null, categoryId: key.slice(2), quantity }
  const firstKey = products[0] ? `p:${products[0].id}` : categories[0] ? `c:${categories[0].id}` : ''
  const set = (index: number, next: PromotionTarget) =>
    onChange(targets.map((target, position) => (position === index ? next : target)))

  return (
    <div className="space-y-2 border border-line bg-surface p-3">
      {targets.map((target, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <input
            value={target.quantity}
            inputMode="numeric"
            aria-label="How many"
            onChange={(event) => {
              const quantity = Number(event.target.value.replace(/\D/g, '')) || 1
              set(index, { ...target, quantity: Math.min(quantity, 20) })
            }}
            className="vista-control w-14 px-2 text-center text-sm"
          />
          <span className="text-sm font-bold text-muted">×</span>
          <select
            value={keyOf(target)}
            aria-label="Item or category"
            onChange={(event) => set(index, fromKey(event.target.value, target.quantity))}
            className="vista-control min-w-0 flex-1 px-2 text-sm font-bold"
          >
            <optgroup label="Any item from a category">
              {categories.map((category) => (
                <option key={category.id} value={`c:${category.id}`}>
                  Any {category.name}
                </option>
              ))}
            </optgroup>
            {categories.map((category) => (
              <optgroup key={category.id} label={category.name}>
                {products
                  .filter((product) => product.categoryId === category.id)
                  .map((product) => (
                    <option key={product.id} value={`p:${product.id}`}>
                      {product.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            aria-label="Remove this part of the combo"
            onClick={() => onChange(targets.filter((_, position) => position !== index))}
            className="grid size-10 place-items-center border border-line text-critical"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={!firstKey}
        onClick={() => onChange([...targets, fromKey(firstKey, 1)])}
        className="flex min-h-9 items-center gap-1 text-sm font-bold text-ink underline disabled:opacity-40"
      >
        <Plus aria-hidden="true" className="size-4" /> Add to the combo
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="vista-field-label">{label}</span>
      <div className="mt-1">{children}</div>
    </div>
  )
}

function PromotionForm({
  initial,
  today,
  categories,
  products,
  onSave,
  onCancel,
}: {
  initial: Draft | null
  today: string
  categories: Category[]
  products: Product[]
  onSave: (draft: Draft) => Promise<boolean>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [kind, setKind] = useState<Draft['kind']>(initial?.kind ?? 'PERCENT')
  const [value, setValue] = useState(
    initial ? (initial.kind === 'PERCENT' ? String(initial.value) : (initial.value / 100).toFixed(2)) : '',
  )
  const [scope, setScope] = useState<Draft['scope']>(initial?.scope ?? 'ORDER')
  const [autoApply, setAutoApply] = useState(initial?.autoApply ?? false)
  const [limit, setLimit] = useState<Draft['limit']>(initial?.limit ?? 'EACH')
  // Each scope keeps its own targets, so switching back and forth loses nothing.
  const [itemTargets, setItemTargets] = useState<PromotionTarget[]>(initial?.scope === 'ITEMS' ? initial.targets : [])
  const [comboTargets, setComboTargets] = useState<PromotionTarget[]>(initial?.scope === 'COMBO' ? initial.targets : [])
  const [startsOn, setStartsOn] = useState(initial?.startsOn ?? today)
  const [hasEnd, setHasEnd] = useState(initial ? initial.endsOn !== null : true)
  const [endsOn, setEndsOn] = useState(initial?.endsOn ?? today)
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)
  const [busy, setBusy] = useState(false)

  const targets = scope === 'ITEMS' ? itemTargets : scope === 'COMBO' ? comboTargets : []
  const parsed =
    kind === 'PERCENT'
      ? /^\d{1,3}$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= 100
        ? Number(value)
        : null
      : parseRinggitToSen(value)
  const rangeOk = !hasEnd || endsOn >= startsOn
  const targetsOk = scope === 'ORDER' || targets.length > 0
  const canSave = name.trim().length > 0 && parsed !== null && parsed > 0 && rangeOk && startsOn !== '' && targetsOk

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSave || parsed === null || busy) return
    setBusy(true)
    const saved = await onSave({
      name: name.trim(),
      kind,
      value: parsed,
      scope,
      autoApply: scope === 'ORDER' ? autoApply : true,
      limit,
      targets,
      startsOn,
      endsOn: hasEnd ? endsOn : null,
      isActive,
    })
    setBusy(false)
    if (saved) onCancel()
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4 border border-line bg-canvas p-3">
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
        <Field label="Discount">
          <div className="flex">
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
        </Field>
      </div>

      <Choice
        label="Applies to"
        value={scope}
        onChange={setScope}
        options={[
          { value: 'ORDER', label: 'Whole order' },
          { value: 'ITEMS', label: 'Certain items' },
          { value: 'COMBO', label: 'A combo' },
        ]}
      />

      {scope === 'ORDER' ? (
        <Choice
          label="At the counter"
          value={autoApply ? 'auto' : 'pick'}
          onChange={(next) => setAutoApply(next === 'auto')}
          options={[
            { value: 'pick', label: 'Cashier picks it' },
            { value: 'auto', label: 'Automatic on every order' },
          ]}
        />
      ) : null}

      {scope === 'ITEMS' ? (
        <Field label="Which items">
          <ItemsPicker categories={categories} products={products} targets={itemTargets} onChange={setItemTargets} />
        </Field>
      ) : null}

      {scope === 'COMBO' ? (
        <Field label="The combo">
          <ComboBuilder categories={categories} products={products} targets={comboTargets} onChange={setComboTargets} />
        </Field>
      ) : null}

      {scope !== 'ORDER' ? (
        <Choice
          label="How often"
          value={limit}
          onChange={setLimit}
          options={[
            { value: 'EACH', label: scope === 'COMBO' ? 'Every combo in the order' : 'Every matching item' },
            { value: 'ONCE_PER_ORDER', label: 'Once per receipt' },
          ]}
        />
      ) : null}

      {scope !== 'ORDER' ? (
        <p className="text-xs text-muted">
          Applies by itself when the order has {scope === 'COMBO' ? 'the whole combo' : 'a matching item'}; the
          cashier can remove it from that order. {kind === 'AMOUNT' ? (scope === 'COMBO' ? 'The amount comes off each combo.' : 'The amount comes off each item.') : ''}
        </p>
      ) : null}

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
      {!targetsOk ? (
        <p className="text-sm font-bold text-critical" role="alert">
          {scope === 'COMBO' ? 'Add what the combo is made of.' : 'Choose which items it applies to.'}
        </p>
      ) : null}
      <p className="text-xs text-muted">
        Dates are trading days, both ends included.
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

  const nameOf = (target: PromotionTarget) =>
    target.productId
      ? (store.products.find((product) => product.id === target.productId)?.name ?? 'a removed item')
      : `any ${store.categories.find((category) => category.id === target.categoryId)?.name ?? 'removed category'}`

  const form = (initial: Draft | null, id: string | undefined) => (
    <PromotionForm
      initial={initial}
      today={store.today}
      categories={store.categories}
      products={store.products.filter((product) => product.isActive)}
      onSave={save(id)}
      onCancel={() => setEditing(null)}
    />
  )

  return (
    <Panel>
      <SectionHeading
        title="Promotions"
        hint="Discounts for a promo, over the days it runs: off the whole order, certain items, or a combo. Automatic ones go on the order by themselves; the cashier can take one off."
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
                form(promotion, promotion.id)
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black">
                      {promotion.name} <span className="font-bold text-muted">· {describeValue(promotion)}</span>
                    </p>
                    <p className="text-xs text-muted">{describeRule(promotion, nameOf)}</p>
                    <p className="text-xs text-muted">
                      {formatDate(promotion.startsOn)}
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
          <div className="mt-2">{form(null, undefined)}</div>
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
