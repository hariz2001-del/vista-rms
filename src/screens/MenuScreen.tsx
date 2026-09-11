import { useMemo, useState } from 'react'
import { Badge, Panel, SectionHeading } from '../components/primitives.tsx'
import type { VistaStore } from '../data/store.ts'
import { formatRinggit, parseRinggitToSen } from '../domain/money.ts'

export function MenuScreen({ store }: { store: VistaStore }) {
  const [brandFilter, setBrandFilter] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draftPrice, setDraftPrice] = useState('')

  const grouped = useMemo(() => {
    const visible = store.products.filter(
      (product) => brandFilter === null || product.brandId === brandFilter,
    )
    return store.categories
      .filter((category) => brandFilter === null || category.brandId === brandFilter)
      .map((category) => ({
        category,
        products: visible.filter((product) => product.categoryId === category.id),
      }))
      .filter((group) => group.products.length > 0)
  }, [store.products, store.categories, brandFilter])

  function commitPrice(productId: string) {
    const sen = parseRinggitToSen(draftPrice)
    if (sen !== null && sen >= 0) store.updatePrice(productId, sen)
    setEditing(null)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="border-b border-line pb-5">
        <p className="page-kicker">Catalogue / live availability</p>
        <h1 className="mt-1 text-3xl sm:text-[2.65rem]">Menu</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Prices here are what the register charges. Changing one never alters a sale already made —
          past orders keep the price they were rung up at.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setBrandFilter(null)}
          className={`min-h-11 border px-4 text-sm font-bold ${
            brandFilter === null ? 'border-rail bg-rail text-white' : 'border-line bg-surface text-slate-700'
          }`}
        >
          All
        </button>
        {store.brands.map((brand) => (
          <button
            key={brand.id}
            type="button"
            onClick={() => setBrandFilter(brand.id)}
            style={brandFilter === brand.id ? { backgroundColor: brand.colour } : undefined}
            className={`min-h-11 border px-4 text-sm font-bold ${
              brandFilter === brand.id ? 'border-transparent text-white' : 'border-line bg-surface text-slate-700'
            }`}
          >
            {brand.name}
          </button>
        ))}
      </div>

      {grouped.map(({ category, products }) => (
        <Panel key={category.id}>
          <SectionHeading title={category.name} />
          <ul className="divide-y divide-slate-100">
            {products.map((product) => (
              <li key={product.id} className="flex flex-wrap items-center gap-3 py-3">
                <img
                  src={product.imageUrl}
                  alt=""
                  className="size-12 shrink-0 object-cover ring-1 ring-line"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-ink">{product.name}</p>
                  {product.isSoldOut ? <Badge tone="critical">Sold out</Badge> : null}
                </div>

                {editing === product.id ? (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center border-2 border-rail px-2">
                      <span className="text-xs font-black text-muted">RM</span>
                      <input
                        autoFocus
                        inputMode="decimal"
                        value={draftPrice}
                        onChange={(event) => setDraftPrice(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitPrice(product.id)
                          if (event.key === 'Escape') setEditing(null)
                        }}
                        className="min-h-10 w-20 bg-transparent px-1 text-right font-black tabular outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => commitPrice(product.id)}
                      className="vista-button-primary min-h-10"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(product.id)
                      setDraftPrice((product.basePriceSen / 100).toFixed(2))
                    }}
                    className="min-h-10 border-b border-dotted border-muted px-2 text-base font-black tabular hover:bg-canvas"
                  >
                    {formatRinggit(product.basePriceSen)}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => store.toggleSoldOut(product.id)}
                  className={`min-h-10 border px-3 text-xs font-bold ${
                    product.isSoldOut
                      ? 'border-good bg-good text-white'
                      : 'border-line bg-surface text-slate-600 hover:bg-canvas'
                  }`}
                >
                  {product.isSoldOut ? 'Back in stock' : 'Mark sold out'}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  )
}
