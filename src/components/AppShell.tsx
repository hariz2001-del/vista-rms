import {
  BookOpenText,
  LayoutDashboard,
  Receipt,
  Settings as SettingsIcon,
  UtensilsCrossed,
  Users,
} from 'lucide-react'
import type { ReactNode } from 'react'

export type ScreenKey =
  | 'overview'
  | 'cashflow'
  | 'expenses'
  | 'settlement'
  | 'menu'
  | 'settings'

/**
 * Six sections, not the predecessor's sprawl.
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
  { key: 'expenses', label: 'Expenses', mobileLabel: 'Spend', icon: Receipt },
  { key: 'settlement', label: 'Settlement', mobileLabel: 'Owed', icon: Users },
  { key: 'menu', label: 'Menu', mobileLabel: 'Menu', icon: UtensilsCrossed },
  { key: 'settings', label: 'Settings', mobileLabel: 'Setup', icon: SettingsIcon },
]

type Props = {
  current: ScreenKey
  onNavigate: (key: ScreenKey) => void
  businessName: string
  outletName: string
  attentionCount: number
  /** Rendered above the content, pinned across every screen. */
  banner?: ReactNode
  children: ReactNode
}

export function AppShell({
  current,
  onNavigate,
  businessName,
  outletName,
  attentionCount,
  banner,
  children,
}: Props) {
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
          {NAV.map((item) => {
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
          <p className="mt-2">Demo data. Figures are an operating result, not accounting profit.</p>
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
          </div>
        </header>

        {banner}

        <main className="flex-1 p-4 pb-24 sm:p-7 lg:px-10 lg:py-8 xl:px-12">{children}</main>

        {/* Mobile tab bar — the owner reads this on a phone as often as a laptop. */}
        <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-line bg-surface/95 shadow-[0_-4px_18px_rgba(24,33,29,0.06)] backdrop-blur-sm lg:hidden">
          {NAV.map((item) => {
            const Icon = item.icon
            const isActive = current === item.key
            return (
              <button
                key={item.key}
                type="button"
                aria-label={item.label}
                onClick={() => onNavigate(item.key)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex min-h-16 flex-col items-center justify-center gap-1 border-t-2 text-[0.58rem] font-bold ${
                  isActive ? 'border-food text-rail' : 'border-transparent text-slate-400'
                }`}
              >
                <Icon aria-hidden="true" strokeWidth={isActive ? 2.2 : 1.7} className="size-[1.15rem]" />
                <span>{item.mobileLabel}</span>
                {item.key === 'overview' && attentionCount > 0 ? (
                  <span className="absolute right-1/4 top-2 size-1.5 rounded-full bg-food" />
                ) : null}
              </button>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
