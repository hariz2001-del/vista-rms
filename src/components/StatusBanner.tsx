import { AlertTriangle, Circle, CircleDot, MoreVertical, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { VistaStore } from '../data/store.ts'
import { formatRinggit } from '../domain/money.ts'
import { bannerState, type BannerState } from '../domain/selectors.ts'

/**
 * One banner, by strict precedence, carrying **live state only**.
 *
 * Anything that needs a decision belongs in the attention list on Overview
 * instead. Duplicating an item in both is how two views of the same fact start
 * disagreeing, which is the failure the predecessor product shipped.
 *
 * Precedence — a green "all fine" line must never sit on top of a red one:
 *   1. Sync failing repeatedly  (red)     something is broken
 *   2. Tablet offline           (amber)   gone quiet mid-service
 *   3. Counter open             (green)   trading normally
 *   4. Counter closed           (grey)    resting
 */

function clockTime(iso: string): string {
  return new Intl.DateTimeFormat('en-MY', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(iso))
}

const TONE = {
  SYNC_FAILING: 'bg-critical text-white',
  TABLET_OFFLINE: 'bg-warning text-white',
  COUNTER_OPEN: 'bg-good text-white',
  COUNTER_CLOSED: 'bg-slate-200 text-slate-700',
} satisfies Record<BannerState['kind'], string>

function Content({ state }: { state: BannerState }) {
  switch (state.kind) {
    case 'SYNC_FAILING':
      return (
        <>
          <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
          <span className="font-black">Counter sync failing repeatedly</span>
          <span className="opacity-90">
            {state.failures} attempts in a row have failed — sales may not be reaching the server
          </span>
        </>
      )
    case 'TABLET_OFFLINE':
      return (
        <>
          <WifiOff aria-hidden="true" className="size-4 shrink-0" />
          <span className="font-black">Counter tablet offline</span>
          <span className="opacity-90">
            No contact for {state.minutesSince}m
            {state.unsentSaleCount > 0
              ? ` · ${state.unsentSaleCount} sale${state.unsentSaleCount === 1 ? '' : 's'} still on the device`
              : ''}
          </span>
        </>
      )
    case 'COUNTER_OPEN':
      return (
        <>
          <CircleDot aria-hidden="true" className="size-4 shrink-0" />
          <span className="font-black">Counter open</span>
          <span className="opacity-90">
            since {clockTime(state.openedAt)} · {state.orderCount} order
            {state.orderCount === 1 ? '' : 's'} · {formatRinggit(state.takingsSen)}
          </span>
        </>
      )
    case 'COUNTER_CLOSED':
      return (
        <>
          <Circle aria-hidden="true" className="size-4 shrink-0" />
          <span className="font-black">Counter closed</span>
          <span className="opacity-80">
            {state.lastClosedAt ? `Last shift ended ${clockTime(state.lastClosedAt)}` : 'No shifts yet'}
          </span>
        </>
      )
  }
}

export function StatusBanner({ store }: { store: VistaStore }) {
  // Re-derived on a timer because the state is time-dependent: a tablet does not
  // announce that it has gone quiet, it simply stops speaking.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menuOpen])

  const state = bannerState(store.shifts, store.orders, store.terminal, now)

  return (
    <div
      className={`flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-6 ${TONE[state.kind]}`}
      role="status"
      aria-live="polite"
    >
      <Content state={state} />

      {state.kind === 'COUNTER_OPEN' ? (
        <div className="relative ml-auto" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            aria-label="Counter actions"
            aria-expanded={menuOpen}
            className="grid size-8 place-items-center rounded-sm hover:bg-black/15"
          >
            <MoreVertical aria-hidden="true" className="size-4" />
          </button>

          {menuOpen ? (
            <div className="absolute right-0 top-9 z-40 w-72 border border-line bg-surface p-2 text-ink shadow-xl">
              <button
                type="button"
                onClick={() => {
                  store.forceCloseShift(state.shiftId)
                  setMenuOpen(false)
                }}
                className="w-full px-2 py-2 text-left text-sm font-bold hover:bg-canvas"
              >
                Force close shift
              </button>
              <p className="px-2 pb-1 pt-2 text-xs text-muted">
                Closes the shift in the database. It cannot lock the tablet — that needs a
                connection to the device that does not exist yet, so the cashier may keep
                selling into a closed shift.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Dev-only: step through each state without waiting for real conditions. */}
      {import.meta.env.DEV ? (
        <div className="ml-auto flex items-center gap-1 text-xs">
          <span className="opacity-70">preview:</span>
          {(
            [
              ['ok', { lastSeenAt: new Date().toISOString(), consecutiveSyncFailures: 0, unsentSaleCount: 0 }],
              ['offline', { lastSeenAt: new Date(Date.now() - 12 * 60_000).toISOString(), consecutiveSyncFailures: 0, unsentSaleCount: 6 }],
              ['failing', { consecutiveSyncFailures: 3 }],
            ] as const
          ).map(([label, patch]) => (
            <button
              key={label}
              type="button"
              onClick={() => store.simulateTerminal(patch)}
              className="rounded-sm bg-black/15 px-1.5 py-0.5 font-bold hover:bg-black/25"
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
