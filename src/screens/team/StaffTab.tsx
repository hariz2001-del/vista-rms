import { KeyRound, Lock, UserPlus, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Badge, EmptyState, Panel } from '../../components/primitives.tsx'
import {
  errorText,
  teamApi,
  useLoad,
  type SoloSuitability,
  type Staff,
  type StaffAttributes,
  type WorkType,
} from '../../data/team-api.ts'
import { formatRinggit } from '../../domain/money.ts'

function loadStaffAndTypes() {
  return Promise.all([teamApi.listStaff(), teamApi.listWorkTypes()]).then(([staff, types]) => ({
    staff: staff.staff,
    workTypes: types.workTypes,
  }))
}

function parseTags(text: string): string[] {
  return [...new Set(text.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean))]
}

/** Shown once: the database keeps only the PIN's hash, so it cannot be looked up later. */
function PinNotice({ name, pin, onClose }: { name: string; pin: string; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-title"
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-5"
    >
      <div className="w-full max-w-sm border border-line bg-surface p-6 text-center shadow-xl">
        <KeyRound aria-hidden="true" className="mx-auto size-7 text-rail" />
        <h2 id="pin-title" className="mt-3 font-display text-lg font-bold">
          {name}’s PIN
        </h2>
        <p className="mt-3 font-mono text-5xl font-bold tracking-[0.3em]">{pin}</p>
        <p className="mt-3 text-sm text-muted">
          Give it to {name} now. It is not stored anywhere readable and will not be shown again — if
          it is lost, reset it.
        </p>
        <button type="button" autoFocus onClick={onClose} className="vista-button-primary mt-5 min-h-11 w-full">
          I have given it to them
        </button>
      </div>
    </div>
  )
}

function AddStaffForm({ workTypes, onAdded }: { workTypes: WorkType[]; onAdded: (staff: Staff, pin: string) => void }) {
  const [name, setName] = useState('')
  const [staffCode, setStaffCode] = useState('')
  const [workTypeId, setWorkTypeId] = useState('')
  const [tags, setTags] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const result = await teamApi.createStaff({
        name: name.trim(),
        staffCode: staffCode.trim() || null,
        defaultWorkTypeId: workTypeId || null,
        roleTags: parseTags(tags),
      })
      setName('')
      setStaffCode('')
      setTags('')
      onAdded(result.staff, result.pin)
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[2fr_1fr_1.4fr_1.4fr_auto] sm:items-end">
        <label className="block">
          <span className="vista-field-label">Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required className="vista-control mt-1 w-full px-3" />
        </label>
        <label className="block">
          <span className="vista-field-label">Staff ID</span>
          <input
            value={staffCode}
            onChange={(event) => setStaffCode(event.target.value)}
            placeholder="Auto"
            maxLength={20}
            className="vista-control mt-1 w-full px-3 uppercase"
          />
        </label>
        <label className="block">
          <span className="vista-field-label">Usual work type</span>
          <select value={workTypeId} onChange={(event) => setWorkTypeId(event.target.value)} className="vista-control mt-1 w-full px-2">
            <option value="">—</option>
            {workTypes.filter((type) => type.isActive).map((type) => (
              <option key={type.id} value={type.id}>
                {type.name} · {formatRinggit(type.rateSenPerHour)}/h
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="vista-field-label">Roles (comma-separated)</span>
          <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="barista, kitchen" className="vista-control mt-1 w-full px-3" />
        </label>
        <button type="submit" disabled={saving || !name.trim()} className="vista-button-primary flex min-h-11 items-center justify-center gap-2 disabled:opacity-50">
          <UserPlus aria-hidden="true" className="size-4" /> Add staff
        </button>
        {error ? <p className="text-xs font-bold text-serious sm:col-span-5">{error}</p> : null}
      </form>
    </Panel>
  )
}

const SOLO_LABEL: Record<SoloSuitability, string> = {
  SUITABLE: 'Fine on their own',
  CAUTION: 'Use caution on their own',
  NOT_RECOMMENDED: 'Not recommended on their own',
}

function ScoreSelect({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  return (
    <label className="block">
      <span className="vista-field-label">{label}</span>
      <select
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
        className="vista-control mt-1 w-full px-2"
      >
        <option value="">Not assessed</option>
        {[1, 2, 3, 4, 5].map((score) => (
          <option key={score} value={score}>
            {score} / 5
          </option>
        ))}
      </select>
    </label>
  )
}

const EMPTY_ATTRIBUTES: StaffAttributes = {
  reliability: null,
  capability: null,
  experience: null,
  soloSuitability: 'SUITABLE',
  trainingStatus: 'TRAINED',
  managementPriority: 0,
  notes: null,
  extra: {},
}

function StaffEditor({
  staff,
  workTypes,
  onChanged,
  onPin,
  onClose,
}: {
  staff: Staff
  workTypes: WorkType[]
  onChanged: (staff: Staff) => void
  onPin: (pin: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(staff.name)
  const [staffCode, setStaffCode] = useState(staff.staffCode)
  const [workTypeId, setWorkTypeId] = useState(staff.defaultWorkTypeId ?? '')
  const [tags, setTags] = useState(staff.roleTags.join(', '))
  const [attributes, setAttributes] = useState<StaffAttributes>(staff.attributes ?? EMPTY_ATTRIBUTES)
  const [typedPin, setTypedPin] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<void>, done: string) {
    setError(null)
    setMessage(null)
    try {
      await action()
      setMessage(done)
    } catch (caught) {
      setError(errorText(caught))
    }
  }

  const saveDetails = () =>
    run(async () => {
      const result = await teamApi.updateStaff(staff.id, {
        name: name.trim(),
        staffCode: staffCode.trim(),
        defaultWorkTypeId: workTypeId || null,
        roleTags: parseTags(tags),
      })
      onChanged(result.staff)
    }, 'Details saved.')

  const saveAttributes = () =>
    run(async () => {
      const result = await teamApi.saveAttributes(staff.id, {
        reliability: attributes.reliability,
        capability: attributes.capability,
        experience: attributes.experience,
        soloSuitability: attributes.soloSuitability,
        trainingStatus: attributes.trainingStatus,
        managementPriority: attributes.managementPriority,
        notes: attributes.notes?.trim() || null,
      })
      onChanged(result.staff)
    }, 'Confidential notes saved.')

  const toggleStatus = () =>
    run(async () => {
      const result = await teamApi.updateStaff(staff.id, {
        status: staff.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      })
      onChanged(result.staff)
    }, staff.status === 'ACTIVE' ? 'Deactivated — they are signed out and cannot sign in.' : 'Active again.')

  const resetPin = (pin?: string) =>
    run(async () => {
      const result = await teamApi.resetPin(staff.id, pin)
      setTypedPin('')
      onPin(result.pin)
    }, 'New PIN set. They have been signed out of every phone.')

  const set = <K extends keyof StaffAttributes>(key: K, value: StaffAttributes[K]) =>
    setAttributes((current) => ({ ...current, [key]: value }))

  return (
    <Panel className="space-y-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div>
          <h3 className="font-display text-xl font-bold">{staff.name}</h3>
          <p className="font-mono text-xs text-muted">
            {staff.staffCode} · {staff.status === 'ACTIVE' ? 'Active' : 'Inactive'}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto grid size-10 place-items-center hover:bg-canvas">
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>

      <section className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="vista-field-label">Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className="vista-control mt-1 w-full px-3" />
        </label>
        <label className="block">
          <span className="vista-field-label">Staff ID</span>
          <input value={staffCode} onChange={(event) => setStaffCode(event.target.value)} maxLength={20} className="vista-control mt-1 w-full px-3 uppercase" />
        </label>
        <label className="block">
          <span className="vista-field-label">Usual work type</span>
          <select value={workTypeId} onChange={(event) => setWorkTypeId(event.target.value)} className="vista-control mt-1 w-full px-2">
            <option value="">—</option>
            {workTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name} · {formatRinggit(type.rateSenPerHour)}/h{type.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="vista-field-label">Roles</span>
          <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="barista, kitchen" className="vista-control mt-1 w-full px-3" />
        </label>
        <div className="sm:col-span-2">
          <button type="button" onClick={saveDetails} className="vista-button-primary min-h-11">
            Save details
          </button>
        </div>
      </section>

      <section className="space-y-3 border border-rail/40 bg-canvas p-4">
        <div className="flex items-center gap-2">
          <Lock aria-hidden="true" className="size-4 text-rail" />
          <h4 className="text-sm font-black uppercase tracking-[0.06em]">Confidential — management only</h4>
        </div>
        <p className="text-xs text-muted">
          Used by the rostering engine as signals, never as rules. Never shown on the staff app, in
          exports or in anything staff can see.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <ScoreSelect label="Reliability" value={attributes.reliability} onChange={(value) => set('reliability', value)} />
          <ScoreSelect label="Capability" value={attributes.capability} onChange={(value) => set('capability', value)} />
          <ScoreSelect label="Experience" value={attributes.experience} onChange={(value) => set('experience', value)} />
          <label className="block">
            <span className="vista-field-label">On their own</span>
            <select
              value={attributes.soloSuitability}
              onChange={(event) => set('soloSuitability', event.target.value as SoloSuitability)}
              className="vista-control mt-1 w-full px-2"
            >
              {(Object.keys(SOLO_LABEL) as SoloSuitability[]).map((key) => (
                <option key={key} value={key}>
                  {SOLO_LABEL[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="vista-field-label">Training</span>
            <select
              value={attributes.trainingStatus}
              onChange={(event) => set('trainingStatus', event.target.value as StaffAttributes['trainingStatus'])}
              className="vista-control mt-1 w-full px-2"
            >
              <option value="TRAINED">Trained</option>
              <option value="TRAINEE">Trainee</option>
            </select>
          </label>
          <label className="block">
            <span className="vista-field-label">Management priority</span>
            <select
              value={attributes.managementPriority}
              onChange={(event) => set('managementPriority', Number(event.target.value))}
              className="vista-control mt-1 w-full px-2"
            >
              {[2, 1, 0, -1, -2].map((value) => (
                <option key={value} value={value}>
                  {value > 0 ? `+${value}` : value}
                  {value === 0 ? ' (neutral)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="vista-field-label">Notes</span>
          <textarea
            value={attributes.notes ?? ''}
            onChange={(event) => set('notes', event.target.value)}
            maxLength={2000}
            rows={3}
            className="mt-1 w-full border border-line bg-surface p-2 text-sm"
          />
        </label>
        <button type="button" onClick={saveAttributes} className="vista-button-primary min-h-11">
          Save confidential notes
        </button>
      </section>

      <section className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <button type="button" onClick={() => resetPin()} className="vista-button-secondary flex min-h-11 items-center gap-2">
          <KeyRound aria-hidden="true" className="size-4" /> Reset PIN (random)
        </button>
        <label className="block">
          <span className="vista-field-label">Or set a PIN</span>
          <input
            value={typedPin}
            onChange={(event) => setTypedPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            placeholder="4 digits"
            className="vista-control mt-1 w-28 px-3 font-mono"
          />
        </label>
        <button
          type="button"
          disabled={typedPin.length !== 4}
          onClick={() => resetPin(typedPin)}
          className="vista-button-secondary min-h-11 disabled:opacity-50"
        >
          Set PIN
        </button>
        <button
          type="button"
          onClick={toggleStatus}
          className={`ml-auto min-h-11 border px-4 text-sm font-bold ${
            staff.status === 'ACTIVE' ? 'border-critical/40 text-critical' : 'border-line text-ink'
          }`}
        >
          {staff.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
        </button>
      </section>

      {message ? <p className="text-sm font-bold text-good" role="status">{message}</p> : null}
      {error ? <p className="text-sm font-bold text-serious" role="alert">{error}</p> : null}
    </Panel>
  )
}

export function StaffTab() {
  const { data, error, reload, setData } = useLoad(loadStaffAndTypes)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [shownPin, setShownPin] = useState<{ name: string; pin: string } | null>(null)

  if (error && !data) return <p className="text-sm font-bold text-serious">{error}</p>
  if (!data) return <p className="text-sm text-muted">Loading staff…</p>

  const workTypeName = (id: string | null) => data.workTypes.find((type) => type.id === id)?.name ?? '—'
  const selected = data.staff.find((staff) => staff.id === selectedId) ?? null

  const replace = (next: Staff) =>
    setData({ ...data, staff: data.staff.map((staff) => (staff.id === next.id ? next : staff)) })

  return (
    <div className="space-y-4">
      <AddStaffForm
        workTypes={data.workTypes}
        onAdded={(staff, pin) => {
          setShownPin({ name: staff.name, pin })
          reload()
        }}
      />

      {data.staff.length === 0 ? (
        <EmptyState title="No staff yet" hint="Add someone above. They get a PIN to sign in at team.vistahub.my." />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="overflow-x-auto border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  {['Name', 'Staff ID', 'Usual work', 'Roles', 'Status'].map((heading) => (
                    <th key={heading} className="px-3 py-2 font-mono text-[0.66rem] font-bold uppercase tracking-[0.07em] text-muted">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.staff.map((staff) => (
                  <tr
                    key={staff.id}
                    onClick={() => setSelectedId(staff.id)}
                    className={`cursor-pointer border-b border-line last:border-b-0 hover:bg-canvas ${
                      selectedId === staff.id ? 'bg-canvas' : ''
                    } ${staff.status === 'INACTIVE' ? 'text-muted' : ''}`}
                  >
                    <td className="px-3 py-2.5 font-bold">
                      <button type="button" className="text-left" onClick={() => setSelectedId(staff.id)}>
                        {staff.name}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">{staff.staffCode}</td>
                    <td className="px-3 py-2.5">{workTypeName(staff.defaultWorkTypeId)}</td>
                    <td className="px-3 py-2.5 text-xs text-muted">{staff.roleTags.join(', ') || '—'}</td>
                    <td className="px-3 py-2.5">
                      {staff.status === 'ACTIVE' ? <Badge tone="good">Active</Badge> : <Badge>Inactive</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected ? (
            <StaffEditor
              key={selected.id}
              staff={selected}
              workTypes={data.workTypes}
              onChanged={replace}
              onPin={(pin) => setShownPin({ name: selected.name, pin })}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <p className="hidden self-start border border-dashed border-line p-6 text-sm text-muted xl:block">
              Pick someone to edit their details, reset their PIN, or keep confidential notes.
            </p>
          )}
        </div>
      )}

      {shownPin ? <PinNotice name={shownPin.name} pin={shownPin.pin} onClose={() => setShownPin(null)} /> : null}
    </div>
  )
}
