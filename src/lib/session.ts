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

export function signOut(): void {
  writeToken(null)
}

export function hasSession(): boolean {
  return readToken() !== null
}
