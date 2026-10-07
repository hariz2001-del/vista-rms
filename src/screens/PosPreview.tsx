import { Ban, Eye, Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { layoutOf } from '../domain/menu-order.ts'
import { formatRinggit } from '../domain/money.ts'
import type { Brand, Category, Product } from '../domain/types.ts'

/**
 * The menu as the counter shows it — same brands, categories, order, prices,
 * pictures, sold-out marks and option choices — without opening the POS.
 * Read-only: tapping an item shows its options; nothing can be rung up.
 *
 * Mirrors pos-vista's FilterBar, ProductGrid and ModifierModal. Only active
 * items are on the counter, so only active items are shown here.
 */

const POS_INK = '#101826'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase()
}

function OptionsSheet({ product, brand, categoryName, onClose }: { product: Product; brand?: Brand; categoryName: string; onClose: () => void }) {
  const groups = product.modifierGroups ?? []
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pos-preview-item"
      className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-slate-50 shadow-2xl ring-1 ring-black/5"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex min-h-20 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-5">
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-12 shrink-0 place-items-center rounded-xl bg-slate-100 hover:bg-slate-200">
            <X aria-hidden="true" className="size-6" />
          </button>
          <div className="min-w-0">
            <p style={{ color: brand?.colour ?? POS_INK }} className="truncate text-xs font-black uppercase tracking-wider">
              {brand?.name ?? '—'} · {categoryName}
            </p>
            <h2 id="pos-preview-item" className="truncate text-2xl font-black">
              {product.name}
            </h2>
          </div>
          <p className="ml-auto shrink-0 text-xl font-black">{formatRinggit(product.basePriceSen)}</p>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {groups.length === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
              No options — on the counter this item goes straight into the order.
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-black">{group.name}</h3>
                    <p className="mt-1 text-sm text-slate-500">Choose up to {group.maxSelect}</p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-black ${group.minSelect > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}
                  >
                    {group.minSelect > 0 ? `Required · pick ${group.minSelect}` : `Up to ${group.maxSelect}`}
                  </span>
                </div>
                <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
                  {group.options.map((option) => (
                    <li
                      key={option.id}
                      className={`min-h-16 rounded-xl border-2 border-slate-200 bg-white px-4 py-3 ${option.isSoldOut ? 'opacity-50' : ''}`}
                    >
                      <p className="font-bold">{option.name}</p>
                      <p className="text-sm text-slate-500">
                        {option.isSoldOut
                          ? 'Sold out'
                          : option.priceSen === 0
                            ? option.type === 'REMOVAL'
                              ? 'Remove'
                              : 'No charge'
                            : `+${formatRinggit(option.priceSen)}`}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export function PosPreview({
  brands,
  categories,
  products,
  onClose,
}: {
  brands: Brand[]
  categories: Category[]
  products: Product[]
  onClose: () => void
}) {
  const [brandId, setBrandId] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<Product | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (open) setOpen(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const brandsById = useMemo(() => new Map(brands.map((brand) => [brand.id, brand])), [brands])
  const categoryName = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories])
  // The counter's order: categories in their order, items in theirs, active only.
  const ordered = useMemo(() => {
    const active = products.filter((product) => product.isActive)
    const byId = new Map(active.map((product) => [product.id, product]))
    const layout = layoutOf(categories.map((category) => category.id), active)
    return categories.flatMap((category) => (layout[category.id] ?? []).flatMap((id) => byId.get(id) ?? []))
  }, [categories, products])
  const shownCategories = brandId === null ? categories : categories.filter((category) => category.brandId === brandId)
  const needle = search.trim().toLowerCase()
  const shown = ordered.filter(
    (product) =>
      (brandId === null || product.brandId === brandId) &&
      (categoryId === null || product.categoryId === categoryId) &&
      (!needle || product.name.toLowerCase().includes(needle)),
  )

  return (
    <div role="dialog" aria-modal="true" aria-label="POS view" className="fixed inset-0 z-50 flex flex-col bg-slate-100 text-slate-900">
      <header className="flex min-h-16 shrink-0 items-center gap-3 px-4 text-white sm:px-6" style={{ backgroundColor: POS_INK }}>
        <Eye aria-hidden="true" className="size-5 shrink-0" />
        <div className="min-w-0">
          <p className="font-black">POS view</p>
          <p className="truncate text-xs text-slate-300">What the counter shows right now. Look only — nothing here rings up a sale.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-bold hover:bg-white/20"
        >
          <X aria-hidden="true" className="size-4" /> Close
        </button>
      </header>

      <div className="space-y-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-2" aria-label="Filter by brand">
            <button
              type="button"
              onClick={() => {
                setBrandId(null)
                setCategoryId(null)
              }}
              style={brandId === null ? { backgroundColor: POS_INK } : undefined}
              className={`min-h-11 min-w-20 rounded-xl px-4 text-sm font-extrabold ${brandId === null ? 'text-white shadow-md' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              All
            </button>
            {brands.map((brand) => (
              <button
                key={brand.id}
                type="button"
                onClick={() => {
                  setBrandId(brand.id)
                  setCategoryId(null)
                }}
                style={brandId === brand.id ? { backgroundColor: brand.colour } : undefined}
                className={`min-h-11 min-w-20 rounded-xl px-4 text-sm font-extrabold ${brandId === brand.id ? 'text-white shadow-md' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                {brand.name}
              </button>
            ))}
          </div>
          <div className="relative ml-auto min-w-[10rem] flex-1 sm:max-w-xs">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search items…"
              aria-label="Search items"
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm font-semibold"
            />
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Filter by category">
          {[{ id: null, name: 'All categories' }, ...shownCategories].map((category) => (
            <button
              key={category.id ?? 'all'}
              type="button"
              onClick={() => setCategoryId(category.id)}
              className={`min-h-10 shrink-0 rounded-full border px-4 text-sm font-bold ${
                categoryId === category.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'
              }`}
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {shown.length === 0 ? (
          <div className="grid h-full place-items-center p-8 text-center">
            <div>
              <p className="text-xl font-black">No items</p>
              <p className="mt-1 text-slate-500">{ordered.length === 0 ? 'Nothing is on the counter yet.' : 'Try another brand or category.'}</p>
            </div>
          </div>
        ) : (
          <ul className="grid h-full auto-rows-max grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {shown.map((product) => {
              const brand = brandsById.get(product.brandId)
              return (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(product)}
                    className="group relative block min-h-52 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
                  >
                    <div className="relative h-28 overflow-hidden bg-slate-100">
                      {product.imageUrl ? (
                        <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div
                          aria-hidden="true"
                          className="grid h-full w-full place-items-center text-3xl font-black"
                          style={{ backgroundColor: brand?.softColour ?? '#eef1f0', color: brand?.colour ?? POS_INK }}
                        >
                          {initials(product.name)}
                        </div>
                      )}
                      <span
                        style={{ backgroundColor: brand?.colour ?? POS_INK }}
                        className="absolute left-2 top-2 rounded-full px-2.5 py-1 text-[0.65rem] font-black uppercase tracking-wider text-white"
                      >
                        {brand?.name ?? '—'}
                      </span>
                      {(product.modifierGroups?.length ?? 0) > 0 ? (
                        <span className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-white/95 shadow">
                          <SlidersHorizontal aria-label="Has options" className="size-4" />
                        </span>
                      ) : null}
                      {product.isSoldOut ? (
                        <div className="absolute inset-0 grid place-items-center bg-slate-900/75 text-white">
                          <span className="flex items-center gap-2 rounded-full bg-red-600 px-3 py-1.5 text-sm font-black uppercase tracking-wide">
                            <Ban aria-hidden="true" className="size-4" /> Sold out
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <div className="p-3.5">
                      <p className="line-clamp-1 font-black">{product.name}</p>
                      <p className="mt-1 line-clamp-1 text-xs text-slate-500">{product.description}</p>
                      <p className="mt-3 text-lg font-black">{formatRinggit(product.basePriceSen)}</p>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {open ? (
          <OptionsSheet product={open} brand={brandsById.get(open.brandId)} categoryName={categoryName.get(open.categoryId) ?? ''} onClose={() => setOpen(null)} />
        ) : null}
      </div>
    </div>
  )
}
