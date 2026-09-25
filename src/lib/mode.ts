/**
 * Demo mode keeps the generated history in `src/data/fake/`, so the dashboard
 * still runs with no server at all. Everything else reads the real books from
 * api-vista. Never set in production.
 */
export const IS_DEMO = import.meta.env.VITE_DEMO === '1'

/** vistahub.my: where a new business registers and where the app picker lives. */
export const HUB_URL = (import.meta.env.VITE_HUB_URL ?? 'https://vistahub.my').replace(/\/$/, '')
