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
            No contact for {state.minutesSince}m — sales made since then have not reached the
            server
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

  const state = bannerState(store.shifts, store.orders, store.corrections, store.terminal, now)

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

    </div>
  )
}

/**
 * Dev-only. Deliberately a separate strip below the banner rather than inside
 * it: controls in the bar stole the right edge from the ⋮ menu and made a demo
 * affordance look like part of the product.
 */
export function BannerPreviewControls({ store }: { store: VistaStore }) {
  if (!import.meta.env.DEV) return null

  const openShift = store.shifts.find((shift) => shift.closedAt === null)

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-canvas px-4 py-1 text-xs text-muted sm:px-6">
      <span className="font-mono uppercase tracking-wider">dev · banner preview</span>
      <button
        type="button"
        onClick={() =>
          store.simulateTerminal({
            lastSeenAt: new Date().toISOString(),
            consecutiveSyncFailures: 0,
          })
        }
        className="border border-line bg-surface px-2 py-0.5 font-bold hover:bg-canvas"
      >
        trading
      </button>
      <button
        type="button"
        onClick={() =>
          store.simulateTerminal({
            lastSeenAt: new Date(Date.now() - 12 * 60_000).toISOString(),
            consecutiveSyncFailures: 0,
          })
        }
        className="border border-line bg-surface px-2 py-0.5 font-bold hover:bg-canvas"
      >
        offline
      </button>
      <button
        type="button"
        onClick={() => store.simulateTerminal({ consecutiveSyncFailures: 3 })}
        className="border border-line bg-surface px-2 py-0.5 font-bold hover:bg-canvas"
      >
        failing
      </button>
      <button
        type="button"
        disabled={!openShift}
        onClick={() => openShift && store.forceCloseShift(openShift.id)}
        title={openShift ? 'Closes the demo shift so the resting state can be seen' : 'Already closed'}
        className="border border-line bg-surface px-2 py-0.5 font-bold hover:bg-canvas disabled:opacity-40"
      >
        closed
      </button>
      <button
        type="button"
        disabled={Boolean(openShift)}
        onClick={() => store.reopenDemoShift()}
        title="Opens a demo shift again — every other state needs one"
        className="border border-line bg-surface px-2 py-0.5 font-bold hover:bg-canvas disabled:opacity-40"
      >
        reopen
      </button>
    </div>
  )
}
