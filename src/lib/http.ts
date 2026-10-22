import { IS_DEMO } from './mode.ts'

/**
 * The one way the RMS talks to api-vista.
 *
 * Errors come back typed so the caller can tell a refusal (`ApiError`, show the
 * server's message) from an expired session (`SessionExpiredError`, sign in
 * again) from no answer at all (`NetworkError`, keep the last figures on screen).
 */

const TOKEN_KEY = 'vista.rms.token'

/** Fired after any successful change under /rms/team. */
export const TEAM_CHANGED = 'vista:team-changed'
const TIMEOUT_MS = 20_000

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
)

export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super('You have been signed out. Sign in again to continue.')
    this.name = 'SessionExpiredError'
  }
}

export class NetworkError extends Error {
  constructor() {
    super('Cannot reach the server. The figures shown may be out of date.')
    this.name = 'NetworkError'
  }
}

// Storage can throw outright in some contexts (private mode, blocked site data),
// so every access is guarded. Losing the token only means signing in again.
export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function writeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Nothing to do — the session simply will not survive a reload.
  }
}

const expiryListeners = new Set<() => void>()

/** Called whenever the server rejects the token. Returns an unsubscribe. */
export function onSessionExpired(listener: () => void): () => void {
  expiryListeners.add(listener)
  return () => {
    expiryListeners.delete(listener)
  }
}

type ErrorBody = { error?: string; message?: string }

/** In the demo, Team and Stock are answered in the browser (src/data/fake/demo-server.ts). */
function servedByDemo(path: string): boolean {
  return IS_DEMO && (path.startsWith('/rms/team/') || path.startsWith('/rms/stock/'))
}

export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  if (servedByDemo(path)) {
    const { demoRequest } = await import('../data/fake/demo-server.ts')
    const result = await demoRequest<T>(method, path, body)
    if (method !== 'GET' && path.startsWith('/rms/team')) window.dispatchEvent(new Event(TEAM_CHANGED))
    return result
  }

  const token = readToken()
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      // Only present when there is one: a GET must not carry a body at all.
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    })
  } catch {
    throw new NetworkError()
  } finally {
    window.clearTimeout(timer)
  }

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const error = (payload ?? {}) as ErrorBody
    const code = error.error ?? 'server:UNEXPECTED'

    if (code === 'auth:UNAUTHORIZED') {
      writeToken(null)
      for (const listener of expiryListeners) listener()
      throw new SessionExpiredError()
    }

    throw new ApiError(code, error.message ?? 'The server could not complete that.', response.status)
  }

  // Lets the Team checklist tick itself off the moment something changes.
  if (method !== 'GET' && path.startsWith('/rms/team')) window.dispatchEvent(new Event(TEAM_CHANGED))

  return payload as T
}

/**
 * A file Vista makes on the server (a PDF, the roster picture). Made there so
 * the RMS and Sarang AI hand out the same file.
 */
export async function apiFile(path: string): Promise<File> {
  if (servedByDemo(path)) {
    const { demoFile } = await import('../data/fake/demo-server.ts')
    return demoFile(path)
  }
  const token = readToken()
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  } catch {
    throw new NetworkError()
  }
  if (!response.ok) {
    const error = ((await response.json().catch(() => null)) ?? {}) as ErrorBody
    if (error.error === 'auth:UNAUTHORIZED') {
      writeToken(null)
      for (const listener of expiryListeners) listener()
      throw new SessionExpiredError()
    }
    throw new ApiError(error.error ?? 'server:UNEXPECTED', error.message ?? 'The file could not be made.', response.status)
  }
  const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'vista-file'
  const blob = await response.blob()
  return new File([blob], name, { type: blob.type })
}

/** Saves a file to the device's downloads. */
export function saveFile(file: File): void {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
