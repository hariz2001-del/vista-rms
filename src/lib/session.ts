import { apiRequest, readToken, writeToken } from './http'

export type SessionUser = {
  id: string
  name: string
  email: string
  role: string
}

/**
 * Sign in to the owner dashboard.
 *
 * The business has one account. Signing in here asks for an owner session,
 * which can see the books and expires after a working day. The counter tablet
 * signs in with the same account but gets a counter session, which cannot open
 * any of this — so a stolen tablet can sell, but cannot reach the money.
 */
export async function signIn(email: string, password: string): Promise<SessionUser> {
  const result = await apiRequest<{ token: string; user: SessionUser }>('POST', '/auth/login', {
    email,
    password,
    scope: 'OWNER',
  })
  writeToken(result.token)
  return result.user
}

/**
 * Arriving from vistahub.my: swap the one-time code in the URL for an owner
 * session. The hub puts it in the fragment (`#handoff=…`), which the browser
 * never sends to any server.
 */
export async function redeemHandoff(code: string): Promise<SessionUser> {
  const result = await apiRequest<{ token: string; user: SessionUser }>(
    'POST',
    '/auth/handoff/redeem',
    { code },
  )
  writeToken(result.token)
  return result.user
}

/** The handoff code in the address bar, if the owner just came from the hub. */
export function handoffCodeInUrl(): string | null {
  const match = /(?:^#|&)handoff=([^&]+)/.exec(window.location.hash)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

/** Take the code out of the address bar, so a reload or a shared link cannot reuse it. */
export function clearHandoffFromUrl(): void {
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
}

export function signOut(): void {
  writeToken(null)
}

export function hasSession(): boolean {
  return readToken() !== null
}
