import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { rosterApi } from '../../data/roster-api.ts'
import { errorText, teamApi, useLoad } from '../../data/team-api.ts'
import { TEAM_CHANGED } from '../../lib/http.ts'

type Go = (tab: 'roster' | 'pay' | 'staff') => void

/**
 * The four things to do before Team is useful, in order, until they are done.
 * A first-time owner should never have to guess what comes first — and never
 * add staff with no pay rate, which would only surface weeks later at payroll.
 * Remounted (and so re-checked) by its parent whenever the tab changes.
 */
export function GettingStarted({ current, onGo, onChanged }: { current: 'roster' | 'pay' | 'staff'; onGo: Go; onChanged: () => void }) {
  const { data, reload } = useLoad(() =>
    Promise.all([teamApi.listWorkTypes(), teamApi.listStaff(), teamApi.getSettings(), rosterApi.weeks()]).then(
      ([types, staff, settings, weeks]) => ({
        hasRates: types.workTypes.some((type) => type.isActive),
        hasStaff: staff.staff.length > 0,
        hasCode: Boolean(settings.settings.orgCode),
        hasWeek: weeks.weeks.length > 0,
      }),
    ),
  )
  useEffect(() => {
    window.addEventListener(TEAM_CHANGED, reload)
    return () => window.removeEventListener(TEAM_CHANGED, reload)
  }, [reload])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!data) return null
  if (data.hasRates && data.hasStaff && data.hasCode && data.hasWeek) return null

  async function addRates() {
    setBusy(true)
    setError(null)
    try {
      await teamApi.createWorkType({ name: 'Regular', rateSenPerHour: 700 })
      await teamApi.createWorkType({ name: 'Training', rateSenPerHour: 500 })
      reload()
      onChanged()
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  const steps = [
    {
      done: data.hasRates,
      title: 'Set your pay rates',
      hint: 'What staff earn per hour. You can change the amounts any time.',
      action: (
        <button type="button" disabled={busy} onClick={addRates} className="vista-button-primary min-h-10 disabled:opacity-50">
          Add Regular RM 7.00/h and Training RM 5.00/h
        </button>
      ),
    },
    {
      done: data.hasStaff,
      title: 'Add your staff',
      hint: 'Each person gets a 4-digit PIN to sign in on their phone. Use the form under Staff.',
      action:
        current === 'staff' ? null : (
          <button type="button" onClick={() => onGo('staff')} className="vista-button-primary min-h-10">
            Add staff
          </button>
        ),
    },
    {
      done: data.hasCode,
      title: 'Choose a workplace code',
      hint: 'Staff type this once on their phone, e.g. SARANG. Without it they need your account email. It is under Staff → Settings.',
      action:
        current === 'staff' ? null : (
          <button type="button" onClick={() => onGo('staff')} className="vista-button-primary min-h-10">
            Set the code
          </button>
        ),
    },
    {
      done: data.hasWeek,
      title: 'Make your first roster',
      hint: 'Create a week on the left of Roster and add shifts. Open it for applications, give out the shifts, then publish.',
      action:
        current === 'roster' ? null : (
          <button type="button" onClick={() => onGo('roster')} className="vista-button-primary min-h-10">
            Go to Roster
          </button>
        ),
    },
  ]
  const next = steps.findIndex((step) => !step.done)

  return (
    <section aria-label="Getting started" className="space-y-3 border-2 border-rail/50 bg-surface p-4">
      <h3 className="font-display text-lg font-bold">Getting started</h3>
      <ol className="space-y-2">
        {steps.map((step, index) => (
          <li key={step.title} className={`flex flex-wrap items-center gap-3 ${step.done ? 'text-muted' : ''}`}>
            <span
              className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-black ${
                step.done ? 'bg-good text-white' : index === next ? 'bg-rail text-white' : 'bg-canvas text-muted'
              }`}
            >
              {step.done ? <Check aria-hidden="true" className="size-4" /> : index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block font-bold ${step.done ? 'line-through' : ''}`}>{step.title}</span>
              {step.done ? null : <span className="block text-xs text-muted">{step.hint}</span>}
            </span>
            {index === next ? step.action : null}
          </li>
        ))}
      </ol>
      {error ? <p className="text-xs font-bold text-serious">{error}</p> : null}
    </section>
  )
}
