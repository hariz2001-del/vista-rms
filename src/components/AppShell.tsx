import { ChopperChat } from './ChopperChat.tsx'
import {
  BookOpenText,
  Boxes,
  LayoutDashboard,
  MoreHorizontal,
  Receipt,
  ReceiptText,
  Contact,
  Settings as SettingsIcon,
  UtensilsCrossed,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { nextResetLabel } from '../data/demo-session.ts'

export type ScreenKey =
  | 'overview'
  | 'cashflow'
  | 'receipts'
  | 'expenses'
  | 'settlement'
  | 'menu'
  | 'stock'
  | 'team'
  | 'settings'

/**
 * Nine sections, not the predecessor's sprawl. Receipts is the counter's own
 * tickets, read-only: it shows what was sold, never a total of its own.
 *
 * That product ended up with five overlapping places to look at money, two of
 * which disagreed with each other. The rule here: money movement lives in
 * Cashflow, money owed between partners lives in Settlement, and Overview only
 * ever summarises and links — it never becomes a sixth place a number is
 * computed differently.
 */
export const NAV: Array<{
  key: ScreenKey
  label: string
  mobileLabel: string
  icon: typeof LayoutDashboard
}> = [
  { key: 'overview', label: 'Overview', mobileLabel: 'Home', icon: LayoutDashboard },
  { key: 'cashflow', label: 'Cashflow', mobileLabel: 'Cash', icon: BookOpenText },
  { key: 'receipts', label: 'Receipts', mobileLabel: 'Sales', icon: ReceiptText },
  { key: 'expenses', label: 'Expenses', mobileLabel: 'Spend', icon: Receipt },
  { key: 'settlement', label: 'Settlement', mobileLabel: 'Owed', icon: Users },
  { key: 'menu', label: 'Menu', mobileLabel: 'Menu', icon: UtensilsCrossed },
  { key: 'stock', label: 'Stock', mobileLabel: 'Stock', icon: Boxes },
  { key: 'team', label: 'Team', mobileLabel: 'Team', icon: Contact },
  { key: 'settings', label: 'Settings', mobileLabel: 'Setup', icon: SettingsIcon },
]

/** On a phone, four sections get a tab; the rest sit under More — nine tabs were too small to tap. */
const MOBILE_TABS = new Set<ScreenKey>(['overview', 'receipts', 'expenses', 'team'])

type Props = {
  current: ScreenKey
  onNavigate: (key: ScreenKey) => void
  businessName: string
  outletName: string
  attentionCount: number
  /** Settlement is only for a business with partner settlement switched on. */
  showSettlement?: boolean
  /** Rendered above the content, pinned across every screen. */
  banner?: ReactNode
  /** True when the figures are the generated demo history, not the real books. */
  isDemo?: boolean
  /** Shown only when signed in to the real books. */
  onSignOut?: () => void
  children: ReactNode
}

export function AppShell({
  current,
  onNavigate,
  businessName,
  outletName,
  attentionCount,
  showSettlement = true,
  banner,
  isDemo = false,
  onSignOut,
  children,
}: Props) {
  const nav = showSettlement ? NAV : NAV.filter((item) => item.key !== 'settlement')
  const tabs = nav.filter((item) => MOBILE_TABS.has(item.key))
  const more = nav.filter((item) => !MOBILE_TABS.has(item.key))
  const inMore = more.find((item) => item.key === current)
  const [moreOpen, setMoreOpen] = useState(false)
  useEffect(() => setMoreOpen(false), [current])
  const go = (key: ScreenKey) => {
    setMoreOpen(false)
    onNavigate(key)
  }

  return (
    <div className="paper-canvas min-h-dvh bg-canvas lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/* Desktop rail */}
      <aside className="hidden bg-rail text-white lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <div className="border-b border-white/15 px-5 pb-5 pt-6">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-[1.7rem] font-bold leading-none tracking-[-0.06em]">Vista</span>
            <span className="font-mono text-[0.58rem] font-bold uppercase tracking-[0.18em] text-food">RMS</span>
          </div>
          <div className="mt-5 border-l-2 border-drink pl-3">
            <p className="truncate text-[0.62rem] font-bold uppercase tracking-[0.13em] text-rail-muted">
              {businessName}
            </p>
            <p className="mt-1 truncate text-sm font-bold text-white">{outletName}</p>
          </div>
        </div>

        <nav aria-label="Primary" className="flex-1 py-5">
          {nav.map((item) => {
            const Icon = item.icon
            const isActive = current === item.key
            return (
              <button
                key={item.key}
                type="button"
                aria-label={item.label}
                onClick={() => onNavigate(item.key)}
                aria-current={isActive ? 'page' : undefined}
                className={`group relative flex min-h-12 w-full items-center gap-3 border-l-2 px-5 text-sm font-bold transition-colors ${
                  isActive
                    ? 'border-food bg-white/10 text-white'
                    : 'border-transparent text-rail-muted hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon aria-hidden="true" strokeWidth={isActive ? 2 : 1.6} className="size-[1.1rem] shrink-0" />
                {item.label}
                {item.key === 'overview' && attentionCount > 0 ? (
                  <span className="ml-auto min-w-6 border border-food/60 px-1.5 py-0.5 text-center font-mono text-[0.66rem] font-bold text-[#ffd8c5]">
                    {attentionCount}
                  </span>
                ) : null}
              </button>
            )
          })}
        </nav>

        <div className="border-t border-white/15 px-5 py-5 text-[0.66rem] leading-relaxed text-rail-muted">
          <p className="font-mono uppercase tracking-[0.12em] text-white/70">Working note</p>
          <p className="mt-2">
            {isDemo
              ? `Demo data — your changes are kept until ${nextResetLabel(new Date())}, then it starts fresh. `
              : ''}
            Figures are an operating result, not accounting profit.
          </p>
          {onSignOut ? (
            <button
              type="button"
              onClick={onSignOut}
              className="mt-4 min-h-9 text-xs font-bold text-white/80 underline hover:text-white"
            >
              Sign out
            </button>
          ) : null}
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col">
        {/* Mobile header */}
        <header className="flex min-h-16 items-center justify-between border-b border-white/15 bg-rail px-4 text-white lg:hidden">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-xl font-bold tracking-[-0.05em]">Vista</span>
            <span className="font-mono text-[0.55rem] font-bold uppercase tracking-[0.18em] text-food">RMS</span>
          </div>
          <div className="min-w-0 text-right">
            <p className="truncate text-[0.58rem] font-bold uppercase tracking-[0.14em] text-rail-muted">{businessName}</p>
            <p className="truncate text-xs font-bold">{outletName}</p>
            {onSignOut ? (
              <button
                type="button"
                onClick={onSignOut}
                className="text-[0.62rem] font-bold text-white/70 underline"
              >
                Sign out
              </button>
            ) : null}
          </div>
        </header>

        {banner}

        <main className="flex-1 p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-7 sm:pb-28 lg:px-10 lg:py-8 xl:px-12">{children}</main>

        {/* Chopper, the receipt bot, to chat with from any screen. Live accounts only. */}
        {isDemo ? null : (
          <ChopperChat
            onOpenReceipt={(key) => {
              // The Expenses screen opens this receipt in its Stash tab.
              try { sessionStorage.setItem('vista.openReceipt', key) } catch { /* private window */ }
              window.dispatchEvent(new CustomEvent('vista:open-receipt', { detail: key }))
              go('expenses')
            }}
          />
        )}

        {/* Mobile tab bar — the owner reads this on a phone as often as a laptop. */}
        {moreOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="More sections">
            <button type="button" aria-label="Close" onClick={() => setMoreOpen(false)} className="absolute inset-0 bg-ink/40" />
            <div className="absolute inset-x-0 bottom-0 border-t border-line bg-surface pb-[calc(4.5rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(24,33,29,0.12)]">
              <div className="flex items-center justify-between px-5 pb-1 pt-4">
                <p className="text-sm font-black uppercase tracking-[0.08em] text-muted">More</p>
                <button type="button" aria-label="Close" onClick={() => setMoreOpen(false)} className="grid size-11 place-items-center">
                  <X aria-hidden="true" className="size-5" />
                </button>
              </div>
              <ul>
                {more.map((item) => {
                  const Icon = item.icon
                  const isActive = current === item.key
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        onClick={() => go(item.key)}
                        aria-current={isActive ? 'page' : undefined}
                        className={`flex min-h-14 w-full items-center gap-4 border-l-4 px-5 text-base font-bold ${
                          isActive ? 'border-food bg-canvas text-rail' : 'border-transparent text-ink'
                        }`}
                      >
                        <Icon aria-hidden="true" strokeWidth={isActive ? 2.2 : 1.8} className="size-6 shrink-0" />
                        {item.label}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        ) : null}
        <nav
          aria-label="Primary"
          style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}
          className="fixed inset-x-0 bottom-0 z-[45] grid border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_18px_rgba(24,33,29,0.06)] backdrop-blur-sm lg:hidden"
        >
          {tabs.map((item) => {
            const Icon = item.icon
            const isActive = current === item.key && !moreOpen
            return (
              <button
                key={item.key}
                type="button"
                aria-label={item.label}
                onClick={() => go(item.key)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex min-h-[4.25rem] flex-col items-center justify-center gap-1.5 border-t-2 ${
                  isActive ? 'border-food text-rail' : 'border-transparent text-slate-500'
                }`}
              >
                <Icon aria-hidden="true" strokeWidth={isActive ? 2.2 : 1.8} className="size-6" />
                {/* Size on the span: the global `button { font: inherit }` beats utilities on the button. */}
                <span className="text-xs font-bold leading-none">{item.mobileLabel}</span>
                {item.key === 'overview' && attentionCount > 0 ? (
                  <span className="absolute right-[30%] top-2.5 size-2 rounded-full bg-food" />
                ) : null}
              </button>
            )
          })}
          {(() => {
            const isActive = Boolean(inMore) || moreOpen
            const Icon = inMore && !moreOpen ? inMore.icon : MoreHorizontal
            return (
              <button
                type="button"
                aria-label="More sections"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((open) => !open)}
                className={`relative flex min-h-[4.25rem] flex-col items-center justify-center gap-1.5 border-t-2 ${
                  isActive ? 'border-food text-rail' : 'border-transparent text-slate-500'
                }`}
              >
                <Icon aria-hidden="true" strokeWidth={isActive ? 2.2 : 1.8} className="size-6" />
                <span className="text-xs font-bold leading-none">{inMore && !moreOpen ? inMore.mobileLabel : 'More'}</span>
              </button>
            )
          })()}
        </nav>
      </div>
    </div>
  )
}
