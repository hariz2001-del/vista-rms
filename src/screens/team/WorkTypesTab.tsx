import { useState, type FormEvent } from 'react'
import { EmptyState, Panel } from '../../components/primitives.tsx'
import { errorText, teamApi, useLoad, type WorkType } from '../../data/team-api.ts'
import { formatRinggit, parseRinggitToSen } from '../../domain/money.ts'

function RateField({ workType, onSaved }: { workType: WorkType; onSaved: (next: WorkType) => void }) {
  const [draft, setDraft] = useState((workType.rateSenPerHour / 100).toFixed(2))
  const [error, setError] = useState<string | null>(null)

  async function commit() {
    const sen = parseRinggitToSen(draft)
    if (sen === null) {
      setError('Enter an amount like 7.00')
      return
    }
    if (sen === workType.rateSenPerHour) return
    try {
      onSaved((await teamApi.updateWorkType(workType.id, { rateSenPerHour: sen })).workType)
      setError(null)
    } catch (caught) {
      setError(errorText(caught))
    }
  }

  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex items-center gap-1">
        <span className="text-muted">RM</span>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          inputMode="decimal"
          aria-label={`${workType.name} hourly rate`}
          className="vista-control w-24 px-2 text-right tabular"
        />
        <span className="text-muted">/ hour</span>
      </span>
      {error ? <span className="text-xs font-bold text-serious">{error}</span> : null}
    </span>
  )
}

export function WorkTypesTab() {
  const { data, error, reload, setData } = useLoad(() => teamApi.listWorkTypes())
  const [name, setName] = useState('')
  const [rate, setRate] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  async function add(event: FormEvent) {
    event.preventDefault()
    const sen = parseRinggitToSen(rate)
    if (!name.trim() || sen === null) {
      setFormError('Give it a name and an hourly rate.')
      return
    }
    try {
      await teamApi.createWorkType({ name: name.trim(), rateSenPerHour: sen })
      setName('')
      setRate('')
      setFormError(null)
      reload()
    } catch (caught) {
      setFormError(errorText(caught))
    }
  }

  async function addStarterTypes() {
    try {
      await teamApi.createWorkType({ name: 'Regular', rateSenPerHour: 700 })
      await teamApi.createWorkType({ name: 'Training', rateSenPerHour: 500 })
      reload()
    } catch (caught) {
      setFormError(errorText(caught))
    }
  }

  if (error && !data) return <p className="text-sm font-bold text-serious">{error}</p>
  if (!data) return <p className="text-sm text-muted">Loading work types…</p>

  const replace = (next: WorkType) =>
    setData({ workTypes: data.workTypes.map((type) => (type.id === next.id ? next : type)) })

  return (
    <div className="space-y-4">
      <p className="max-w-[70ch] text-sm text-muted">
        Each kind of work has its own hourly rate. A shift can use a different work type, or a one-off
        rate, without changing these. Changing a rate affects pay not yet approved; approved and paid
        payslips keep the rate they were worked out at.
      </p>

      <Panel>
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
          <label className="block">
            <span className="vista-field-label">Work type</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Event" maxLength={40} className="vista-control mt-1 w-full px-3" />
          </label>
          <label className="block">
            <span className="vista-field-label">RM per hour</span>
            <input value={rate} onChange={(event) => setRate(event.target.value)} inputMode="decimal" placeholder="10.00" className="vista-control mt-1 w-full px-3 tabular" />
          </label>
          <button type="submit" className="vista-button-primary min-h-11">
            Add work type
          </button>
          {formError ? <p className="text-xs font-bold text-serious sm:col-span-3">{formError}</p> : null}
        </form>
      </Panel>

      {data.workTypes.length === 0 ? (
        <div className="space-y-3">
          <EmptyState title="No work types yet" hint="Add your own above, or start from the usual two." />
          <button type="button" onClick={addStarterTypes} className="vista-button-secondary min-h-11">
            Add Regular ({formatRinggit(700)}/h) and Training ({formatRinggit(500)}/h)
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-line border border-line bg-surface">
          {data.workTypes.map((type) => (
            <li key={type.id} className={`flex flex-wrap items-center gap-4 px-4 py-3 ${type.isActive ? '' : 'opacity-60'}`}>
              <span className="min-w-32 font-bold">{type.name}</span>
              <RateField key={type.rateSenPerHour} workType={type} onSaved={replace} />
              <button
                type="button"
                onClick={async () => {
                  try {
                    replace((await teamApi.updateWorkType(type.id, { isActive: !type.isActive })).workType)
                  } catch (caught) {
                    setFormError(errorText(caught))
                  }
                }}
                className="vista-button-secondary ml-auto min-h-10"
              >
                {type.isActive ? 'Retire' : 'Use again'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
