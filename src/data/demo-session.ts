/**
 * The public demo at demorms.vistahub.my keeps a visitor's changes — expenses
 * logged, settings changed, a period closed — across reloads, in their own
 * browser, until the next reset: every 3 hours on the Malaysian clock (00:00,
 * 03:00, 06:00 …) and whenever the date changes. Then it starts again from the
 * generated history. Nothing is ever sent anywhere.
 *
 * IndexedDB rather than localStorage: months of orders run to megabytes, past
 * localStorage's quota.
 */

export const RESET_HOURS = 3
const DB_NAME = 'vista-rms-demo'
const STORE = 'state'
const KEY = 'current'

type Saved<T> = { window: string; state: T }

function malaysiaClock(now: Date): { date: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) }
}

/** `2026-09-28#4` — the Malaysian date and which 3-hour block of it. */
export function demoWindow(now: Date): string {
  const { date, hour } = malaysiaClock(now)
  return `${date}#${Math.floor(hour / RESET_HOURS)}`
}

/** Milliseconds until the next 3-hour boundary in Malaysia (UTC+8, no DST). */
export function msUntilNextReset(now: Date): number {
  const blockMs = RESET_HOURS * 3_600_000
  return blockMs - ((now.getTime() + 8 * 3_600_000) % blockMs)
}

/** "15:00" — when the current demo resets. */
export function nextResetLabel(now: Date): string {
  return new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(now.getTime() + msUntilNextReset(now)))
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.addEventListener('upgradeneeded', () => request.result.createObjectStore(STORE))
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB unavailable')))
  })
}

async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = op(db.transaction(STORE, mode).objectStore(STORE))
      request.addEventListener('success', () => resolve(request.result))
      request.addEventListener('error', () =>
        reject(request.error ?? new Error('IndexedDB request failed')),
      )
    })
  } finally {
    db.close()
  }
}

/** The visitor's saved demo, if it belongs to the current window; otherwise null. */
export async function loadDemoState<T>(now = new Date()): Promise<T | null> {
  try {
    const saved = await run<Saved<T> | undefined>('readonly', (store) => store.get(KEY))
    if (saved && saved.window === demoWindow(now)) return saved.state
    if (saved) await run('readwrite', (store) => store.delete(KEY))
  } catch {
    // Private mode or blocked storage: the demo simply starts fresh each load.
  }
  return null
}

export async function saveDemoState<T>(state: T, now = new Date()): Promise<void> {
  try {
    await run('readwrite', (store) => store.put({ window: demoWindow(now), state } satisfies Saved<T>, KEY))
  } catch {
    // Losing the save only costs the visitor their demo edits on reload.
  }
}

/** Reload into a fresh demo when the window turns over, even with the tab left open. */
export function scheduleDemoReset(now = new Date()): void {
  window.setTimeout(() => window.location.reload(), msUntilNextReset(now) + 1_000)
}
