import { useState, type ReactNode } from 'react'
import { Panel } from '../../components/primitives.tsx'
import { errorText, teamApi, useLoad, type TeamSettings } from '../../data/team-api.ts'

function NumberField({
  label,
  hint,
  value,
  min = 0,
  max,
  suffix,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  min?: number
  max?: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <label className="block">
      <span className="vista-field-label">{label}</span>
      <span className="mt-1 flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(event) => onChange(Number(event.target.value))}
          className="vista-control w-24 px-2 tabular"
        />
        {suffix ? <span className="text-sm text-muted">{suffix}</span> : null}
      </span>
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel className="space-y-4">
      <h3 className="text-sm font-black uppercase tracking-[0.06em]">{title}</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </Panel>
  )
}

function SettingsForm({ initial }: { initial: TeamSettings }) {
  const [draft, setDraft] = useState(initial)
  const [maxHours, setMaxHours] = useState(String(initial.assignmentMaxMinutes / 60))
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof TeamSettings>(key: K, value: TeamSettings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  async function save() {
    setMessage(null)
    setError(null)
    const hours = Number(maxHours)
    if (!Number.isFinite(hours) || hours < 0) {
      setError('Enter the weekly hour cap as a number, like 45 or 37.5.')
      return
    }
    try {
      const { engineWeights: _weights, ...rest } = draft
      const result = await teamApi.saveSettings({
        ...rest,
        assignmentMaxMinutes: Math.round(hours * 60),
        orgCode: draft.orgCode?.trim() ? draft.orgCode.trim().toUpperCase() : null,
      })
      setDraft(result.settings)
      setMessage('Saved. Weeks already created keep the rules they were created with.')
    } catch (caught) {
      setError(errorText(caught))
    }
  }

  return (
    <div className="space-y-4">
      <Group title="How staff find you">
        <label className="block sm:col-span-2">
          <span className="vista-field-label">Workplace code (optional)</span>
          <input
            value={draft.orgCode ?? ''}
            onChange={(event) => set('orgCode', event.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase())}
            maxLength={16}
            placeholder="e.g. SARANG"
            className="vista-control mt-1 w-48 px-3 font-mono uppercase"
          />
          <span className="mt-1 block text-xs text-muted">
            The first time on a phone, staff type this (or your account email) at team.vistahub.my. 4–16
            letters or digits. The phone remembers it after that.
          </span>
        </label>
      </Group>

      <Group title="Applications and rostering">
        <NumberField label="Shifts a person may apply for" suffix="per week" value={draft.applicationLimit} max={100} onChange={(value) => set('applicationLimit', value)} />
        <NumberField label="Usual shifts given" suffix="per week" value={draft.assignmentTargetShifts} max={50} onChange={(value) => set('assignmentTargetShifts', value)} />
        <NumberField label="Most shifts given" suffix="per week" value={draft.assignmentMaxShifts} max={50} onChange={(value) => set('assignmentMaxShifts', value)} />
        <label className="block">
          <span className="vista-field-label">Most hours given</span>
          <span className="mt-1 flex items-center gap-2">
            <input value={maxHours} onChange={(event) => setMaxHours(event.target.value)} inputMode="decimal" className="vista-control w-24 px-2 tabular" />
            <span className="text-sm text-muted">hours per week</span>
          </span>
        </label>
        <NumberField
          label="Staff can pull out until"
          suffix="hours before the shift"
          value={draft.withdrawalDeadlineHours}
          max={336}
          onChange={(value) => set('withdrawalDeadlineHours', value)}
          hint="After this, only management can take them off."
        />
        <NumberField
          label="Urgent cover when within"
          suffix="hours of the start"
          value={draft.urgentCoverageHours}
          max={336}
          onChange={(value) => set('urgentCoverageHours', value)}
        />
      </Group>

      <Group title="Payroll">
        <label className="block">
          <span className="vista-field-label">Pay cycle</span>
          <select value={draft.payFrequency} onChange={(event) => set('payFrequency', event.target.value as TeamSettings['payFrequency'])} className="vista-control mt-1 w-full px-2">
            <option value="WEEKLY">Weekly</option>
            <option value="BIWEEKLY">Every two weeks</option>
            <option value="MONTHLY">Monthly</option>
            <option value="CUSTOM">Custom dates each time</option>
          </select>
        </label>
        <label className="block">
          <span className="vista-field-label">Cycle starts on</span>
          <input type="date" value={draft.payAnchorDate} onChange={(event) => set('payAnchorDate', event.target.value)} className="vista-control mt-1 w-full px-2" />
          <span className="mt-1 block text-xs text-muted">Any day a pay period has started on; the rest follow from it.</span>
        </label>
        <NumberField label="Payday" suffix="days after the period ends" value={draft.paydayOffsetDays} max={60} onChange={(value) => set('paydayOffsetDays', value)} />
        <label className="block">
          <span className="vista-field-label">Paid time is counted in</span>
          <select value={draft.payRoundingMinutes} onChange={(event) => set('payRoundingMinutes', Number(event.target.value))} className="vista-control mt-1 w-full px-2">
            <option value={1}>Exact minutes</option>
            <option value={15}>Quarter hours</option>
            <option value={30}>Half hours</option>
            <option value={60}>Whole hours</option>
          </select>
        </label>
        <label className="block">
          <span className="vista-field-label">Part of a block</span>
          <select value={draft.payRoundingMode} onChange={(event) => set('payRoundingMode', event.target.value as TeamSettings['payRoundingMode'])} className="vista-control mt-1 w-full px-2">
            <option value="FLOOR">Counts once complete</option>
            <option value="NEAREST">Rounds to the nearest</option>
          </select>
          <span className="mt-1 block text-xs text-muted">
            With half hours and “once complete”, 5:00–10:20 pays 5 h and 5:00–10:30 pays 5.5 h.
          </span>
        </label>
      </Group>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} className="vista-button-primary min-h-11 px-6">
          Save settings
        </button>
        {message ? <p className="text-sm font-bold text-good" role="status">{message}</p> : null}
        {error ? <p className="text-sm font-bold text-serious" role="alert">{error}</p> : null}
      </div>
    </div>
  )
}

export function TeamSettingsTab() {
  const { data, error } = useLoad(() => teamApi.getSettings())
  if (error && !data) return <p className="text-sm font-bold text-serious">{error}</p>
  if (!data) return <p className="text-sm text-muted">Loading settings…</p>
  return <SettingsForm initial={data.settings} />
}
