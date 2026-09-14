import { ApiError, apiRequest, readToken, writeToken } from './http'

export type SessionUser = {
  id: string
  name: string
  email: string
  role: 'CASHIER' | 'OWNER_FOOD' | 'OWNER_DRINKS'
}

/**
 * Sign in to the owner dashboard. Only a partner account gets in: the counter
 * account is refused here for a clear message, and by the server regardless.
 */
export async function signIn(email: string, password: string): Promise<SessionUser> {
  const result = await apiRequest<{ token: string; user: SessionUser }>('POST', '/auth/login', {
    email,
    password,
  })

  if (result.user.role === 'CASHIER') {
    throw new ApiError(
      'auth:FORBIDDEN',
      'That is the counter account. Sign in with a partner account to see the books.',
      403,
    )
  }

  writeToken(result.token)
  return result.user
}

export function signOut(): void {
  writeToken(null)
}

export function hasSession(): boolean {
  return readToken() !== null
}
