import { ArrowDown, ArrowUp, ChevronRight, Search } from 'lucide-react'
import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { formatRinggit } from '../domain/money.ts'
import {
  matchesSearch,
  salesBreakdown,
  shareOfBrand,
  sortRows,
  type CategorySales,
  type ModifierSales,
  type ProductSales,
  type SortDirection,
  type SortKey,
} from '../domain/sales-analytics.ts'
import type { DateRange } from '../domain/selectors.ts'
import type { Brand, Category, Order, SaleCorrection } from '../domain/types.ts'
import { Badge, BrandDot, EmptyState, Money, SectionHeading } from './primitives.tsx'

type Dimension = 'product' | 'category' | 'modifier'

type Props = {
  range: DateRange
  orders: Order[]
  corrections: SaleCorrection[]
  categories: Category[]
  brands: Brand[]
  /** Net sales for the period as the summary above reports it, for the reconciliation line. */
  periodNetSalesSen: number
}

const DIMENSIONS: Array<{ key: Dimension; label: string }> = [
  { key: 'product', label: 'By product' },
  { key: 'category', label: 'By category' },
  { key: 'modifier', label: 'By add-on' },
]

function formatShare(value: number): string {
  return `${value.toFixed(1)}%`
}

function priceLabel(row: ModifierSales): string {
  return row.minPriceSen === row.maxPriceSen
    ? formatRinggit(row.minPriceSen)
    : `${formatRinggit(row.minPriceSen)}–${formatRinggit(row.maxPriceSen)}`
}

function productsLabel(row: ModifierSales): string {
  if (row.productNames.length === 1) return row.productNames[0] ?? ''
  if (row.productNames.length === 2) return row.productNames.join(', ')
  return `Multiple (${row.productNames.length})`
}

const productValue = (row: ProductSales, key: SortKey) => (key === 'net' ? row.netSen : row.quantity)
const categoryValue = (row: CategorySales, key: SortKey) =>
  key === 'net' ? row.netSen : row.quantity
const modifierValue = (row: ModifierSales, key: SortKey) =>
  key === 'net' ? row.revenueSen : row.count

/**
 * What sold in the period — by product, by category, or by add-on.
 *
 * Every share is of the product's own brand, never of the counter's turnover:
 * each partner reads their own menu against their own takings.
 */
export function SalesPerformanceBreakdown({
  range,
  orders,
  corrections,
  categories,
  brands,
  periodNetSalesSen,
}: Props) {
  const [brandId, setBrandId] = useState<string | null>(null)
  const [dimension, setDimension] = useState<Dimension>('product')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('quantity')
  const [direction, setDirection] = useState<SortDirection>('desc')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const breakdown = useMemo(
    () => salesBreakdown(orders, corrections, categories, range),
    [orders, corrections, categories, range],
  )
  const brandsById = useMemo(() => new Map(brands.map((brand) => [brand.id, brand])), [brands])
  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  )

  const inBrand = <T extends { brandId: string }>(rows: T[]) =>
    brandId === null ? rows : rows.filter((row) => row.brandId === brandId)

  const productRows = sortRows(
    inBrand(breakdown.products).filter(
      (row) =>
        matchesSearch(row.name, search) ||
        matchesSearch(categoryNames.get(row.categoryId) ?? '', search),
    ),
    productValue,
    sortKey,
    direction,
  )
  const categoryRows = sortRows(
    inBrand(breakdown.categories).filter(
      (row) =>
        matchesSearch(row.name, search) ||
        row.products.some((product) => matchesSearch(product.name, search)),
    ),
    categoryValue,
    sortKey,
    direction,
  )
  const modifierRows = sortRows(
    inBrand(breakdown.modifiers).filter(
      (row) =>
        matchesSearch(row.name, search) ||
        row.productNames.some((name) => matchesSearch(name, search)),
    ),
    modifierValue,
    sortKey,
    direction,
  )

  const brandNet = (id: string) => breakdown.netByBrand.get(id) ?? 0
  const brandTag = (id: string) => {
    const brand = brandsById.get(id)
    return brand ? <BrandDot colour={brand.colour} name={brand.name} /> : '—'
  }

  function sortBy(key: SortKey) {
    if (key === sortKey) setDirection((current) => (current === 'desc' ? 'asc' : 'desc'))
    else {
      setSortKey(key)
      setDirection('desc')
    }
  }

  function toggleCategory(id: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const countLabel = dimension === 'modifier' ? 'Times chosen' : 'Qty sold'
  const netLabel = dimension === 'modifier' ? 'Add-on revenue' : 'Net sales'
  const differenceSen = periodNetSalesSen - breakdown.netSen
  const rowCount =
    dimension === 'product'
      ? productRows.length
      : dimension === 'category'
        ? categoryRows.length
        : modifierRows.length

  const sortHeader = (key: SortKey, label: string) => (
    <th
      scope="col"
      aria-sort={sortKey === key ? (direction === 'desc' ? 'descending' : 'ascending') : 'none'}
      className="px-3 py-2 text-right font-mono text-[0.65rem] font-bold uppercase tracking-[0.08em]"
    >
      {/* Font set on the cell: the global `button { font: inherit }` beats utilities. */}
      <button
        type="button"
        onClick={() => sortBy(key)}
        className={`inline-flex min-h-8 items-center gap-1 uppercase hover:text-ink ${
          sortKey === key ? 'text-ink' : 'text-muted'
        }`}
      >
        {label}
        {sortKey === key ? (
          direction === 'desc' ? (
            <ArrowDown aria-hidden="true" className="size-3" />
          ) : (
            <ArrowUp aria-hidden="true" className="size-3" />
          )
        ) : null}
      </button>
    </th>
  )

  const plainHeader = (label: string, align: 'left' | 'right' = 'left') => (
    <th
      scope="col"
      className={`px-3 py-2 font-mono text-[0.65rem] font-bold uppercase tracking-[0.08em] text-muted ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {label}
    </th>
  )

  return (
    <section aria-labelledby="sales-breakdown-title">
      <div id="sales-breakdown-title">
        <SectionHeading
          title="What sold"
          hint="Items, categories and add-ons for the period. Shares are of each brand's own net sales. Cancelled sales are left out."
        />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3 text-xs font-bold">
        <div role="group" aria-label="Brand" className="flex flex-wrap gap-1">
          <Pill active={brandId === null} onClick={() => setBrandId(null)}>
            All brands
          </Pill>
          {brands.map((brand) => (
            <Pill key={brand.id} active={brandId === brand.id} onClick={() => setBrandId(brand.id)}>
              {brand.name}
            </Pill>
          ))}
        </div>

        <div role="group" aria-label="Break down by" className="flex border border-line">
          {DIMENSIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={dimension === option.key}
              onClick={() => setDimension(option.key)}
              className={`min-h-9 px-3 text-xs font-bold ${
                dimension === option.key ? 'bg-rail text-white' : 'text-muted hover:bg-canvas'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="flex min-h-9 w-full items-center gap-2 border border-line bg-surface px-3 text-sm font-normal sm:ml-auto sm:w-56">
          <Search aria-hidden="true" className="size-4 shrink-0 text-muted" />
          <span className="sr-only">Search</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={dimension === 'modifier' ? 'Search add-ons' : 'Search items'}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>

        {/* Phones have no column headers to tap, so sorting gets its own control. */}
        <label className="flex min-h-9 items-center gap-2 text-xs font-bold text-muted md:hidden">
          Sort
          <select
            value={`${sortKey}:${direction}`}
            onChange={(event) => {
              const [key, dir] = event.target.value.split(':') as [SortKey, SortDirection]
              setSortKey(key)
              setDirection(dir)
            }}
            className="min-h-9 border border-line bg-surface px-2 text-ink"
          >
            <option value="quantity:desc">{countLabel}, most first</option>
            <option value="quantity:asc">{countLabel}, least first</option>
            <option value="net:desc">{netLabel}, highest first</option>
            <option value="net:asc">{netLabel}, lowest first</option>
          </select>
        </label>
      </div>

      {rowCount === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={search ? 'Nothing matches that search' : 'No sales in this period'}
            hint={search ? 'Try a shorter name.' : 'Pick another date range above.'}
          />
        </div>
      ) : null}

      {/* By product */}
      {dimension === 'product' && rowCount > 0 ? (
        <>
          <table className="mt-2 hidden w-full text-sm md:table">
            <thead className="border-b border-line">
              <tr>
                {plainHeader('Product')}
                {plainHeader('Brand')}
                {sortHeader('quantity', 'Qty sold')}
                {plainHeader('Base', 'right')}
                {plainHeader('Add-ons', 'right')}
                {sortHeader('net', 'Net sales')}
                {plainHeader('% of brand', 'right')}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {productRows.map((row) => (
                <tr key={row.key} className="hover:bg-canvas/60">
                  <td className="px-3 py-2.5">
                    <p className="font-bold text-ink">{row.name}</p>
                    <p className="text-xs text-muted">{categoryNames.get(row.categoryId) ?? 'Uncategorised'}</p>
                  </td>
                  <td className="px-3 py-2.5 text-xs font-bold">{brandTag(row.brandId)}</td>
                  <td className="px-3 py-2.5 text-right font-mono font-bold tabular">{row.quantity}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular">
                    <Money sen={row.baseSen} tone="muted" />
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular">
                    <Money sen={row.modifierSen} tone="muted" />
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono font-bold tabular">
                    <Money sen={row.netSen} />
                    {row.discountSen > 0 ? (
                      <span className="block text-[0.7rem] font-semibold text-muted">
                        after −{formatRinggit(row.discountSen)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <ShareBar value={shareOfBrand(row.netSen, brandNet(row.brandId))} colour={brandsById.get(row.brandId)?.chartColour} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="mt-2 divide-y divide-slate-100 md:hidden">
            {productRows.map((row) => (
              <li key={row.key} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-ink">{row.name}</p>
                    <p className="text-xs text-muted">
                      {categoryNames.get(row.categoryId) ?? 'Uncategorised'} · {brandTag(row.brandId)}
                    </p>
                  </div>
                  <div className="text-right font-mono">
                    <Money sen={row.netSen} className="font-bold" />
                    <p className="text-xs text-muted">×{row.quantity}</p>
                  </div>
                </div>
                <p className="mt-1.5 flex flex-wrap gap-x-3 font-mono text-[0.7rem] text-muted">
                  <span>Base {formatRinggit(row.baseSen)}</span>
                  <span>Add-ons {formatRinggit(row.modifierSen)}</span>
                  {row.discountSen > 0 ? <span>Disc −{formatRinggit(row.discountSen)}</span> : null}
                  <span className="ml-auto font-bold text-ink">
                    {formatShare(shareOfBrand(row.netSen, brandNet(row.brandId)))} of brand
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {/* By category */}
      {dimension === 'category' && rowCount > 0 ? (
        <table className="mt-2 w-full text-sm">
          <thead className="border-b border-line">
            <tr>
              {plainHeader('Category')}
              <th scope="col" className="hidden px-3 py-2 text-left font-mono text-[0.65rem] font-bold uppercase tracking-[0.08em] text-muted sm:table-cell">
                Brand
              </th>
              {sortHeader('quantity', 'Units')}
              {sortHeader('net', 'Net sales')}
              <th scope="col" className="hidden px-3 py-2 text-right font-mono text-[0.65rem] font-bold uppercase tracking-[0.08em] text-muted sm:table-cell">
                % of brand
              </th>
            </tr>
          </thead>
          <tbody>
            {categoryRows.map((row) => {
              const isOpen = expanded.has(row.categoryId)
              const brandShare = shareOfBrand(row.netSen, brandNet(row.brandId))
              return (
                <Fragment key={row.categoryId}>
                  <tr className="border-t border-slate-100 hover:bg-canvas/60">
                    <td className="px-1 py-1.5 font-bold">
                      <button
                        type="button"
                        onClick={() => toggleCategory(row.categoryId)}
                        aria-expanded={isOpen}
                        className="flex min-h-10 w-full items-center gap-2 px-2 text-left font-bold text-ink"
                      >
                        <ChevronRight
                          aria-hidden="true"
                          className={`size-4 shrink-0 text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`}
                        />
                        <span>
                          {row.name}
                          <span className="block text-xs font-semibold text-muted sm:hidden">
                            {brandsById.get(row.brandId)?.name} · {formatShare(brandShare)}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="hidden px-3 py-2 text-xs font-bold sm:table-cell">{brandTag(row.brandId)}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold tabular">{row.quantity}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold tabular">
                      <Money sen={row.netSen} />
                    </td>
                    <td className="hidden px-3 py-2 text-right sm:table-cell">
                      <ShareBar value={brandShare} colour={brandsById.get(row.brandId)?.chartColour} />
                    </td>
                  </tr>
                  {isOpen
                    ? sortRows(row.products, productValue, sortKey, direction).map((product) => (
                        <tr key={product.key} className="bg-canvas/50 text-[0.8rem]">
                          <td className="py-1.5 pl-10 pr-3 text-ink">{product.name}</td>
                          <td className="hidden sm:table-cell" />
                          <td className="px-3 py-1.5 text-right font-mono tabular">{product.quantity}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular">
                            <Money sen={product.netSen} />
                          </td>
                          <td className="hidden px-3 py-1.5 text-right font-mono text-xs text-muted sm:table-cell">
                            {formatShare(shareOfBrand(product.netSen, brandNet(product.brandId)))}
                          </td>
                        </tr>
                      ))
                    : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      ) : null}

      {/* By add-on */}
      {dimension === 'modifier' && rowCount > 0 ? (
        <>
          <table className="mt-2 hidden w-full text-sm md:table">
            <thead className="border-b border-line">
              <tr>
                {plainHeader('Add-on')}
                {plainHeader('Brand')}
                {plainHeader('Chosen on')}
                {sortHeader('quantity', 'Times chosen')}
                {plainHeader('Unit price', 'right')}
                {sortHeader('net', 'Add-on revenue')}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {modifierRows.map((row) => (
                <tr key={row.key} className="hover:bg-canvas/60">
                  <td className="px-3 py-2.5 font-bold text-ink">
                    {row.type === 'REMOVAL' ? '− ' : ''}
                    {row.name}
                  </td>
                  <td className="px-3 py-2.5 text-xs font-bold">{brandTag(row.brandId)}</td>
                  <td className="px-3 py-2.5 text-xs text-muted" title={row.productNames.join(', ')}>
                    {productsLabel(row)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono font-bold tabular">{row.count}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular text-muted">{priceLabel(row)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular">
                    {row.maxPriceSen === 0 ? (
                      <span className="inline-flex items-center gap-2">
                        <Badge>Prep note</Badge>
                        <Money sen={0} tone="muted" />
                      </span>
                    ) : (
                      <Money sen={row.revenueSen} className="font-bold" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="mt-2 divide-y divide-slate-100 md:hidden">
            {modifierRows.map((row) => (
              <li key={row.key} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-bold text-ink">
                    {row.type === 'REMOVAL' ? '− ' : ''}
                    {row.name}
                  </p>
                  <p className="text-xs text-muted">
                    {brandTag(row.brandId)} · {productsLabel(row)}
                  </p>
                </div>
                <div className="text-right font-mono">
                  {row.maxPriceSen === 0 ? (
                    <Badge>Prep note</Badge>
                  ) : (
                    <Money sen={row.revenueSen} className="font-bold" />
                  )}
                  <p className="text-xs text-muted">
                    ×{row.count} · {priceLabel(row)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-muted">
        {dimension === 'modifier'
          ? 'Add-on revenue is before discounts: a discount comes off the whole line, not a single option. Zero-priced options are kitchen notes and carry no money.'
          : `Items total ${formatRinggit(breakdown.netSen)}.`}
        {dimension !== 'modifier' && differenceSen !== 0
          ? ` Net sales above is ${formatRinggit(periodNetSalesSen)}; the ${formatRinggit(Math.abs(differenceSen))} gap is exchanges and refunds, which the books record on the day they happen rather than against the items.`
          : null}
        {breakdown.cancelledOrderCount > 0
          ? ` ${breakdown.cancelledOrderCount} cancelled sale${breakdown.cancelledOrderCount === 1 ? '' : 's'} not counted.`
          : null}
      </p>
    </section>
  )
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-9 border px-3 text-xs font-bold ${
        active ? 'border-ink bg-ink text-white' : 'border-line text-muted hover:bg-canvas'
      }`}
    >
      {children}
    </button>
  )
}

function ShareBar({ value, colour }: { value: number; colour?: string }) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span aria-hidden="true" className="hidden h-1 w-14 bg-slate-100 lg:block">
        <span
          className="block h-full"
          style={{ width: `${Math.min(100, value)}%`, backgroundColor: colour ?? 'currentColor' }}
        />
      </span>
      <span className="w-12 font-mono text-xs font-bold tabular">{formatShare(value)}</span>
    </span>
  )
}
