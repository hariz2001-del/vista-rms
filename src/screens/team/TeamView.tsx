import { ExternalLink, RefreshCw, Smartphone, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { errorText, teamApi, useLoad } from '../../data/team-api.ts'
import { API_BASE_URL } from '../../lib/http.ts'

/**
 * The Team app as one staff member sees it, inside the RMS: the real app in a
 * phone-sized frame, signed in with a look-only session (an hour long). The
 * server refuses every change made from it, and the staff member's own phone
 * is not affected.
 */

const TEAM_URL = (
  import.meta.env.VITE_TEAM_URL ?? (/127\.0\.0\.1|localhost/.test(API_BASE_URL) ? 'http://localhost:5176' : 'https://team.vistahub.my')
).replace(/\/$/, '')

export function TeamView({ onClose }: { onClose: () => void }) {
  const { data, error } = useLoad(teamApi.listStaff)
  const active = (data?.staff ?? []).filter((member) => member.status === 'ACTIVE')
  const [staffId, setStaffId] = useState('')
  const [frame, setFrame] = useState<{ url: string; key: number } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const chosen = staffId || active[0]?.id || ''

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // A fresh look-only session each time someone is picked.
  useEffect(() => {
    if (!chosen) return
    let cancelled = false
    teamApi
      .viewAs(chosen)
      .then(({ token }) => {
        if (cancelled) return
        setProblem(null)
        setFrame({ url: `${TEAM_URL}/#view=${token}`, key: Date.now() })
      })
      .catch((caught: unknown) => {
        if (!cancelled) setProblem(errorText(caught))
      })
    return () => {
      cancelled = true
    }
  }, [chosen])

  return (
    <div role="dialog" aria-modal="true" aria-label="Team view" className="fixed inset-0 z-50 flex flex-col bg-ink/70 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-3 bg-surface px-4 py-3 shadow">
        <Smartphone aria-hidden="true" className="size-5 shrink-0 text-rail" />
        <div className="min-w-0">
          <p className="font-black">Team view</p>
          <p className="text-xs text-muted">The staff app exactly as they see it. Look only — nothing can be changed.</p>
        </div>
        <label className="ml-auto flex items-center gap-2 text-sm font-bold">
          <span className="text-muted">Viewing as</span>
          <select
            value={chosen}
            onChange={(event) => setStaffId(event.target.value)}
            disabled={active.length === 0}
            className="vista-control min-w-44 px-2"
          >
            {active.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        {frame ? (
          <>
            <button
              type="button"
              onClick={() => setFrame({ ...frame, key: Date.now() })}
              aria-label="Reload"
              title="Reload"
              className="grid size-11 place-items-center border border-line hover:bg-canvas"
            >
              <RefreshCw aria-hidden="true" className="size-4" />
            </button>
            <a
              href={frame.url}
              target="_blank"
              rel="noreferrer"
              title="Open in a new tab"
              className="grid size-11 place-items-center border border-line hover:bg-canvas"
            >
              <ExternalLink aria-hidden="true" className="size-4" />
              <span className="sr-only">Open in a new tab</span>
            </a>
          </>
        ) : null}
        <button type="button" onClick={onClose} className="vista-button-secondary flex min-h-11 items-center gap-2">
          <X aria-hidden="true" className="size-4" /> Close
        </button>
      </div>

      <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-4">
        {error && !data ? (
          <p className="bg-surface p-4 text-sm font-bold text-serious">{error}</p>
        ) : data && active.length === 0 ? (
          <p className="bg-surface p-4 text-sm font-bold">Add a staff member under Staff first.</p>
        ) : problem ? (
          <p className="bg-surface p-4 text-sm font-bold text-serious">{problem}</p>
        ) : frame ? (
          // About the size of a phone; scrolls inside like one.
          <iframe
            key={frame.key}
            src={frame.url}
            title="Staff app preview"
            className="h-[min(52rem,100%)] w-[min(24.5rem,100%)] rounded-[2rem] border-[10px] border-ink bg-white shadow-2xl"
          />
        ) : (
          <p className="text-sm font-bold text-white">Opening…</p>
        )}
      </div>
    </div>
  )
}
