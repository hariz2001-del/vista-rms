import { ApiError } from '../../lib/http.ts'
import { demoWindow, loadDemoState, saveDemoState } from '../demo-session.ts'
import { handle } from './server/router.ts'
import { seedDemoServer } from './server/seed.ts'
import type { DemoServerState, Method } from './server/state.ts'

/**
 * The demo's stand-in for api-vista's Team and Stock routes. In demo mode
 * `apiRequest` sends every /rms/team and /rms/stock call here instead of over
 * the network, and gets back what the real route would send.
 *
 * The records are seeded from a believable small team, kept in the visitor's
 * browser beside the rest of the demo, and start again at the same moment it
 * does: every 3 hours on the Malaysian clock, or a new day.
 */

type Options = {
  now?: () => Date
  load?: (now: Date) => Promise<DemoServerState | null>
  save?: (state: DemoServerState, now: Date) => Promise<void>
}

const SAVE_KEY = 'team'

export function createDemoServer({
  now = () => new Date(),
  load = (at) => loadDemoState<DemoServerState>(at, SAVE_KEY),
  save = (state, at) => saveDemoState(state, at, SAVE_KEY),
}: Options = {}) {
  let loaded: { window: string; state: DemoServerState } | null = null
  let loading: { window: string; done: Promise<void> } | null = null
  let saving = Promise.resolve()

  /** The visitor's records for this window: saved ones, or a fresh seed. */
  async function ready(at: Date): Promise<string> {
    const window = demoWindow(at)
    if (loaded?.window === window) return window
    if (loading?.window !== window) {
      loading = {
        window,
        done: load(at).then((saved) => {
          loaded = { window, state: saved ?? seedDemoServer(at) }
        }),
      }
    }
    await loading.done
    return window
  }

  async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const at = now()
    const window = await ready(at)
    // Read only after the wait, so two changes in flight never overwrite each other.
    const records = loaded?.window === window ? loaded.state : seedDemoServer(at)
    if (method === 'GET') return structuredClone(handle(records, method, path, body, at)) as T

    // Like a transaction: made on a copy, kept only if the whole change succeeds.
    const draft = structuredClone(records)
    const result = handle(draft, method, path, body, at)
    loaded = { window, state: draft }
    saving = saving.then(() => save(draft, at)).catch(() => undefined)
    return structuredClone(result) as T
  }

  /** Files are drawn by the server, so in the demo every one is a friendly refusal. */
  async function file(path: string): Promise<File> {
    await request('GET', path)
    throw new ApiError('demo:NOT_AVAILABLE', 'That file is made by Vista’s server, so it is not in the demo.', 409)
  }

  return { request, file }
}

const server = createDemoServer()

export const demoRequest = server.request
export const demoFile = server.file
