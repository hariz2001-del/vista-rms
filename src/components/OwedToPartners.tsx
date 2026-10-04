import { ChevronDown, HandCoins } from 'lucide-react'
import { useState } from 'react'
import { Panel } from './primitives.tsx'
import type { VistaStore } from '../data/store.ts'
import { formatRinggit } from '../domain/money.ts'
import { formatDate, partnerAdvances } from '../domain/selectors.ts'

/**
 * Money partners paid from their own pocket and are still owed, one line per
 * partner. The receipts behind each total stay folded away until asked for,
 * and each is marked reimbursed from there.
 */
export function OwedToPartners({ store }: { store: VistaStore }) {
  const [open, setOpen] = useState<'FOOD' | 'DRINKS' | null>(null)
  const advances = partnerAdvances(store.expenses)
  if (advances.length === 0) return null

  const sides = (['FOOD', 'DRINKS'] as const)
    .map((side) => {
      const brand = store.brands[side === 'FOOD' ? 0 : 1]
      const partner = store.partners.find((candidate) => candidate.brandId === brand?.id)
      const lines = advances
        .filter((advance) => advance.payer === side)
        .toSorted((a, b) => b.expense.businessDate.localeCompare(a.expense.businessDate))
      return {
        side,
        name: partner?.name ? `${partner.name} (${brand?.name ?? side})` : `${brand?.name ?? side} partner`,
        lines,
        totalSen: lines.reduce((sum, line) => sum + line.owedToPayerSen, 0),
      }
    })
    .filter((group) => group.lines.length > 0)

  return (
    <Panel className="border-t-2 border-t-warning p-0">
      <div className="flex items-center gap-2 px-4 pt-3 sm:px-5">
        <HandCoins aria-hidden="true" className="size-4 text-muted" />
        <h2 className="text-sm font-black uppercase tracking-[0.06em] text-ink">Owed to partners</h2>
        <span className="text-xs text-muted">Paid from their own pocket, not yet paid back</span>
      </div>
      <ul className="divide-y divide-slate-100">
        {sides.map((group) => {
          const isOpen = open === group.side
          return (
            <li key={group.side}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : group.side)}
                className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left hover:bg-canvas sm:px-5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-black text-ink">{group.name}</span>
                  <span className="block text-xs font-semibold text-muted">
                    {group.lines.length} receipt{group.lines.length === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="tabular text-sm font-black text-ink">{formatRinggit(group.totalSen)}</span>
                <ChevronDown
                  aria-hidden="true"
                  className={`size-4 text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {isOpen ? (
                <ul className="divide-y divide-slate-100 bg-canvas px-4 sm:px-5">
                  {group.lines.map(({ expense, owedToPayerSen }) => (
                    <li key={expense.id} className="flex flex-wrap items-center gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-ink">
                          {expense.vendor ? `${expense.vendor} · ` : ''}
                          {expense.description}
                        </p>
                        <p className="text-xs font-semibold text-muted">{formatDate(expense.businessDate)}</p>
                      </div>
                      <span className="tabular text-sm font-black">{formatRinggit(owedToPayerSen)}</span>
                      <button
                        type="button"
                        onClick={() => store.settleAdvance(expense.id)}
                        className="min-h-9 border border-line bg-surface px-3 text-xs font-bold text-ink hover:bg-white"
                      >
                        Mark reimbursed
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
