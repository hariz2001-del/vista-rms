import { payrollRoutes } from './payroll.ts'
import { rosterRoutes } from './roster.ts'
import { fail, type DemoServerState, type Method, type Route } from './state.ts'
import { stockRoutes } from './stock.ts'
import { teamRoutes } from './team.ts'

const ROUTES: Route[] = [...teamRoutes, ...rosterRoutes, ...payrollRoutes, ...stockRoutes]

function match(pattern: string, pathname: string): Record<string, string> | null {
  const want = pattern.split('/')
  const got = pathname.split('/')
  if (want.length !== got.length) return null
  const params: Record<string, string> = {}
  for (const [index, part] of want.entries()) {
    const value = got[index] ?? ''
    if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(value)
    else if (part !== value) return null
  }
  return params
}

/** Answer one request against the records, as api-vista's route would. First match wins. */
export function handle(state: DemoServerState, method: Method, path: string, body: unknown, now: Date): unknown {
  const [pathname = '', search = ''] = path.split('?')
  for (const [routeMethod, pattern, handler] of ROUTES) {
    if (routeMethod !== method) continue
    const params = match(pattern, pathname)
    if (!params) continue
    const fields = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    return handler({ state, now, params, query: new URLSearchParams(search), body: fields })
  }
  return fail('demo:NOT_FOUND', 404)
}
