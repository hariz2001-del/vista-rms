import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { BrandDot, EmptyState, Panel, SectionHeading } from '../../components/primitives.tsx'
import { stockApi, type StockItem, type StockItemInput } from '../../data/stock-api.ts'
import { errorText, useLoad } from '../../data/team-api.ts'
import { groupStock, moveStock } from '../../domain/stock.ts'
import type { Brand, Category } from '../../domain/types.ts'

const fieldClass =
  'mt-1 min-h-11 w-full border-2 border-line bg-surface px-3 font-semibold outline-none focus:border-rail'

const TRACKING = [
  { key: 'trackUnopened', label: 'Unopened qty', hint: 'Sealed packs, bottles, tubs' },
  { key: 'trackOpened', label: 'Opened qty', hint: 'How many are open' },
  { key: 'trackBalance', label: 'Balance', hint: '> ½ · ½ · < ½ of the open one' },
] as const

type Draft = StockItemInput

function blankDraft(brandId: string, keep?: Draft): Draft {
  return {
    brandId: keep?.brandId ?? brandId,
    category: keep?.category ?? '',
    subcategory: keep?.subcategory ?? null,
    name: '',
    unitLabel: keep?.unitLabel ?? null,
    trackUnopened: keep?.trackUnopened ?? true,
    trackOpened: keep?.trackOpened ?? false,
    trackBalance: keep?.trackBalance ?? true,
    isActive: true,
  }
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid size-9 place-items-center text-muted hover:bg-canvas disabled:opacity-25 ${
        danger ? 'hover:text-serious' : 'hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * What the counter checks at closing. The owner names every item and decides
 * what is counted for it; nothing about the list is built in.
 */
export function StockListTab({ brands, menuCategories }: { brands: Brand[]; menuCategories: Category[] }) {
  const { data, error, reload } = useLoad(stockApi.listItems)
  const items = useMemo(() => data?.items ?? [], [data])
  const [draft, setDraft] = useState<Draft>(() => blankDraft(brands[0]?.id ?? ''))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const brandName = (id: string) => brands.find((brand) => brand.id === id)?.name ?? '—'
  const brandColour = (id: string) => brands.find((brand) => brand.id === id)?.colour ?? '#888'

  const rows = useMemo(() => items.map((item) => ({ ...item, brandKey: item.brandId })), [items])
  const groups = useMemo(() => groupStock(rows), [rows])

  // Suggestions only: anything can be typed.
  const categoryOptions = useMemo(
    () =>
      [...new Set([
        ...items.filter((item) => item.brandId === draft.brandId).map((item) => item.category),
        ...menuCategories.filter((category) => category.brandId === draft.brandId).map((category) => category.name),
      ])].toSorted(),
    [items, menuCategories, draft.brandId],
  )
  const subcategoryOptions = useMemo(
    () =>
      [...new Set(
        items
          .filter((item) => item.category === draft.category && item.subcategory)
          .map((item) => item.subcategory as string),
      )].toSorted(),
    [items, draft.category],
  )
  const unitOptions = useMemo(
    () => [...new Set(items.map((item) => item.unitLabel).filter((unit): unit is string => Boolean(unit)))].toSorted(),
    [items],
  )

  const tracksSomething = draft.trackUnopened || draft.trackOpened || draft.trackBalance
  const canSave =
    !busy && draft.brandId !== '' && draft.category.trim() !== '' && draft.name.trim() !== '' && tracksSomething

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true)
    setProblem(null)
    try {
      await action()
      reload()
      return true
    } catch (caught) {
      setProblem(errorText(caught))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!canSave) return
    const body = { ...draft, category: draft.category.trim(), name: draft.name.trim() }
    const saved = await run(() =>
      editingId ? stockApi.updateItem(editingId, body) : stockApi.createItem(body),
    )
    if (!saved) return
    // Keep the group and settings, so the next item in the same place is one name away.
    setDraft(blankDraft(brands[0]?.id ?? '', editingId ? undefined : draft))
    setEditingId(null)
  }

  function startEditing(item: StockItem) {
    setEditingId(item.id)
    setDraft({
      brandId: item.brandId,
      category: item.category,
      subcategory: item.subcategory,
      name: item.name,
      unitLabel: item.unitLabel,
      trackUnopened: item.trackUnopened,
      trackOpened: item.trackOpened,
      trackBalance: item.trackBalance,
      isActive: item.isActive,
    })
  }

  function move(target: Parameters<typeof moveStock>[1], direction: -1 | 1) {
    const ids = moveStock(rows, target, direction)
    if (ids) void run(() => stockApi.orderItems(ids))
  }

  function toggleActive(item: StockItem) {
    const { id: _id, sortOrder: _sortOrder, ...rest } = item
    void run(() => stockApi.updateItem(item.id, { ...rest, isActive: !item.isActive }))
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <Panel className="p-4 sm:p-5 lg:sticky lg:top-4">
        <SectionHeading
          title={editingId ? 'Edit item' : 'Add an item'}
          hint="Brand, then your own category and subcategory. The counter sees the list grouped the same way."
        />
        <form onSubmit={(event) => void save(event)} className="space-y-3">
          <label className="block">
            <span className="vista-field-label">Brand</span>
            <select
              value={draft.brandId}
              onChange={(event) => setDraft({ ...draft, brandId: event.target.value })}
              className={fieldClass}
            >
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="vista-field-label">Category</span>
              <input
                list="stock-categories"
                value={draft.category}
                onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                placeholder="Sauce tubs"
                maxLength={60}
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className="vista-field-label">Subcategory</span>
              <input
                list="stock-subcategories"
                value={draft.subcategory ?? ''}
                onChange={(event) => setDraft({ ...draft, subcategory: event.target.value || null })}
                placeholder="Optional"
                maxLength={60}
                className={fieldClass}
              />
            </label>
          </div>
          <datalist id="stock-categories">
            {categoryOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          <datalist id="stock-subcategories">
            {subcategoryOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          <datalist id="stock-units">
            {unitOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
            <label className="block">
              <span className="vista-field-label">Item</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Fresh milk"
                maxLength={80}
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className="vista-field-label">Unit</span>
              <input
                list="stock-units"
                value={draft.unitLabel ?? ''}
                onChange={(event) => setDraft({ ...draft, unitLabel: event.target.value || null })}
                placeholder="packs"
                maxLength={60}
                className={fieldClass}
              />
            </label>
          </div>

          <fieldset>
            <legend className="vista-field-label">Count on the counter</legend>
            <div className="mt-1 grid gap-2">
              {TRACKING.map((option) => {
                const on = draft[option.key]
                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setDraft({ ...draft, [option.key]: !on })}
                    className={`flex min-h-11 items-center gap-3 border px-3 text-left ${
                      on ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink hover:border-slate-400'
                    }`}
                  >
                    <span
                      className={`grid size-5 shrink-0 place-items-center border ${on ? 'border-white' : 'border-slate-400'}`}
                    >
                      {on ? <Check aria-hidden="true" className="size-3.5" /> : null}
                    </span>
                    <span>
                      <span className="block text-sm font-bold">{option.label}</span>
                      <span className={`block text-[0.7rem] ${on ? 'text-slate-300' : 'text-muted'}`}>
                        {option.hint}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
            {!tracksSomething ? (
              <p className="mt-1 text-xs font-bold text-serious">Turn on at least one.</p>
            ) : null}
          </fieldset>

          {problem ? (
            <p role="alert" className="text-sm font-bold text-serious">
              {problem}
            </p>
          ) : null}

          <div className="flex gap-2">
            {editingId ? (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null)
                  setDraft(blankDraft(brands[0]?.id ?? ''))
                }}
                className="min-h-12 border border-line px-4 font-bold hover:bg-canvas"
              >
                Cancel
              </button>
            ) : null}
            <button
              type="submit"
              disabled={!canSave}
              className="flex min-h-12 flex-1 items-center justify-center gap-2 bg-rail font-bold text-white hover:bg-[#24554a] disabled:bg-slate-300"
            >
              {editingId ? <Check aria-hidden="true" className="size-4" /> : <Plus aria-hidden="true" className="size-4" />}
              {editingId ? 'Save changes' : 'Add to the list'}
            </button>
          </div>
        </form>
      </Panel>

      <div className="space-y-4">
        {error ? (
          <p role="alert" className="text-sm font-bold text-serious">
            {error}
          </p>
        ) : null}
        {data && items.length === 0 ? (
          <EmptyState
            title="Nothing on the stock list yet"
            hint="Add what the counter should check at closing. Each item can count unopened, opened and how full the open one is."
          />
        ) : null}

        {groups.map((brand) => (
          <Panel key={brand.brandKey} className="p-0">
            <h3 className="border-b border-line px-4 py-3 text-base font-black">
              <BrandDot colour={brandColour(brand.brandKey)} name={brandName(brand.brandKey)} />
            </h3>
            {brand.categories.map((category, categoryIndex) => (
              <section key={category.category} className="border-b border-line last:border-b-0">
                <div className="flex items-center gap-1 bg-canvas px-4 py-1.5">
                  <h4 className="flex-1 text-xs font-black uppercase tracking-[0.08em] text-ink">{category.category}</h4>
                  <IconButton
                    label={`Move ${category.category} up`}
                    disabled={busy || categoryIndex === 0}
                    onClick={() => move({ kind: 'category', brandKey: brand.brandKey, category: category.category }, -1)}
                  >
                    <ArrowUp aria-hidden="true" className="size-4" />
                  </IconButton>
                  <IconButton
                    label={`Move ${category.category} down`}
                    disabled={busy || categoryIndex === brand.categories.length - 1}
                    onClick={() => move({ kind: 'category', brandKey: brand.brandKey, category: category.category }, 1)}
                  >
                    <ArrowDown aria-hidden="true" className="size-4" />
                  </IconButton>
                </div>
                {category.subcategories.map((group, groupIndex) => (
                  <div key={group.subcategory ?? '—'}>
                    {group.subcategory ? (
                      <div className="flex items-center gap-1 px-4 pt-2">
                        <p className="flex-1 text-xs font-bold text-muted">{group.subcategory}</p>
                        <IconButton
                          label={`Move ${group.subcategory} up`}
                          disabled={busy || groupIndex === 0}
                          onClick={() =>
                            move(
                              { kind: 'subcategory', brandKey: brand.brandKey, category: category.category, subcategory: group.subcategory },
                              -1,
                            )
                          }
                        >
                          <ArrowUp aria-hidden="true" className="size-3.5" />
                        </IconButton>
                        <IconButton
                          label={`Move ${group.subcategory} down`}
                          disabled={busy || groupIndex === category.subcategories.length - 1}
                          onClick={() =>
                            move(
                              { kind: 'subcategory', brandKey: brand.brandKey, category: category.category, subcategory: group.subcategory },
                              1,
                            )
                          }
                        >
                          <ArrowDown aria-hidden="true" className="size-3.5" />
                        </IconButton>
                      </div>
                    ) : null}
                    <ul className="divide-y divide-slate-100 px-4">
                      {group.items.map((item, itemIndex) => (
                        <li
                          key={item.id}
                          className={`flex flex-wrap items-center gap-2 py-2 ${item.id === editingId ? '-mx-4 bg-canvas px-4' : ''}`}
                        >
                          <div className={`min-w-0 flex-1 ${item.isActive ? '' : 'opacity-50'}`}>
                            <p className="text-sm font-bold text-ink">
                              {item.name}
                              {item.unitLabel ? <span className="font-semibold text-muted"> · {item.unitLabel}</span> : null}
                            </p>
                            <p className="text-xs font-semibold text-muted">
                              {[
                                item.trackUnopened ? 'Unopened' : null,
                                item.trackOpened ? 'Opened' : null,
                                item.trackBalance ? 'Balance' : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                              {item.isActive ? '' : ' · hidden from the counter'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleActive(item)}
                            disabled={busy}
                            className="min-h-9 border border-line px-2 text-xs font-bold text-muted hover:bg-canvas"
                          >
                            {item.isActive ? 'Hide' : 'Show'}
                          </button>
                          <IconButton
                            label={`Move ${item.name} up`}
                            disabled={busy || itemIndex === 0}
                            onClick={() => move({ kind: 'item', id: item.id }, -1)}
                          >
                            <ArrowUp aria-hidden="true" className="size-4" />
                          </IconButton>
                          <IconButton
                            label={`Move ${item.name} down`}
                            disabled={busy || itemIndex === group.items.length - 1}
                            onClick={() => move({ kind: 'item', id: item.id }, 1)}
                          >
                            <ArrowDown aria-hidden="true" className="size-4" />
                          </IconButton>
                          <IconButton label={`Edit ${item.name}`} onClick={() => startEditing(item)}>
                            <Pencil aria-hidden="true" className="size-4" />
                          </IconButton>
                          <IconButton
                            label={`Delete ${item.name}`}
                            danger
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm(`Delete "${item.name}" from the stock list? Past counts keep it.`)) {
                                void run(() => stockApi.deleteItem(item.id))
                              }
                            }}
                          >
                            <Trash2 aria-hidden="true" className="size-4" />
                          </IconButton>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ))}
          </Panel>
        ))}
      </div>
    </div>
  )
}
