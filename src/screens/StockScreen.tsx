import { Eye } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '../components/primitives.tsx'
import type { VistaStore } from '../data/store.ts'
import { IS_DEMO } from '../lib/mode.ts'
import { StockCountsTab } from './stock/StockCountsTab.tsx'
import { StockListTab } from './stock/StockListTab.tsx'
import { StockPosPreview } from './stock/StockPosPreview.tsx'

type TabKey = 'counts' | 'list'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'counts', label: 'Counts' },
  { key: 'list', label: 'Stock list' },
]

/**
 * Closing stock: a quick estimate of what is left at the end of the day, for
 * planning tomorrow's restock. Not inventory — no stock on hand, no movements.
 * The counter fills it in on the POS; this is where the list is set up and the
 * counts are read back.
 */
export function StockScreen({ store }: { store: VistaStore }) {
  const [tab, setTab] = useState<TabKey>('counts')
  const [posView, setPosView] = useState(false)

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="border-b border-line pb-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="page-kicker">Closing / store room</p>
            <h1 className="mt-1 text-3xl sm:text-[2.65rem]">Stock</h1>
          </div>
          {IS_DEMO ? null : (
            <button
              type="button"
              onClick={() => setPosView(true)}
              className="vista-button-secondary ml-auto flex min-h-11 items-center gap-2"
              title="See the stock count exactly as the counter shows it"
            >
              <Eye aria-hidden="true" className="size-4" /> POS view
            </button>
          )}
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          A quick closing count from the counter, so tomorrow&rsquo;s restock is planned from what is actually
          left. Set up what gets counted under Stock list.
        </p>
      </div>

      {IS_DEMO ? (
        <EmptyState
          title="Stock works with a live business account"
          hint="Sign up at vistahub.my to set up a closing stock list for your counter."
        />
      ) : (
        <>
          <div role="tablist" aria-label="Stock sections" className="flex gap-1 border-b border-line">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                onClick={() => setTab(item.key)}
                className={`-mb-px min-h-11 shrink-0 border-b-2 px-3 text-sm font-bold ${
                  tab === item.key ? 'border-rail text-ink' : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {tab === 'counts' ? <StockCountsTab today={store.today} /> : null}
          {tab === 'list' ? (
            <StockListTab
              brands={store.brands}
              menuCategories={store.categories}
              businessName={store.settings.outletName || store.settings.businessName}
            />
          ) : null}
          {posView ? <StockPosPreview brands={store.brands} onClose={() => setPosView(false)} /> : null}
        </>
      )}
    </div>
  )
}
