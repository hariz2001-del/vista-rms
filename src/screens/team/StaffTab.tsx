import { Eye, EyeOff, KeyRound, UserPlus, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Badge, EmptyState, Panel } from '../../components/primitives.tsx'
import { errorText, teamApi, useLoad, type Staff, type WorkType } from '../../data/team-api.ts'
import { formatRinggit } from '../../domain/money.ts'
import { WorkTypesTab } from './WorkTypesTab.tsx'

function loadStaffAndTypes() {
  return Promise.all([teamApi.listStaff(), teamApi.listWorkTypes()]).then(([staff, types]) => ({
    staff: staff.staff,
    workTypes: types.workTypes,
  }))
}

/**
 * The PIN behind an eye button. Fetched only when asked for, and each look is
 * recorded in Team → History. `version` changes when the PIN is reset, so a
 * shown PIN never goes stale.
 */
function PinCell({ staffId, version }: { staffId: string; version: string | null }) {
  const [shown, setShown] = useState<{ version: string | null; pin: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const visible = shown && shown.version === version ? shown : null

  async function toggle() {
    if (visible) {
      setShown(null)
      return
    }
    setBusy(true)
    try {
      const result = await teamApi.viewPin(staffId)
      setShown({ version, pin: result.pin })
    } catch {
      setShown({ version, pin: null })
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
      <span className="w-12 font-mono font-bold tracking-[0.2em]">
        {visible ? (visible.pin ?? <span className="text-[0.65rem] tracking-normal text-muted">reset to see</span>) : '••••'}
      </span>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-label={visible ? 'Hide PIN' : 'Show PIN'}
        title={visible ? 'Hide PIN' : 'Show PIN'}
        className="grid size-8 place-items-center text-muted hover:text-ink"
      >
        {visible ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
      </button>
    </span>
  )
}

/** Shown straight after a PIN is created or reset. It can be looked up again from the list. */
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
          Give it to {name}. You can see it again any time from the staff list (the eye button).
        </p>
        <button type="button" autoFocus onClick={onClose} className="vista-button-primary mt-5 min-h-11 w-full">
          Done
        </button>
      </div>
    </div>
  )
}

function AddStaffForm({ workTypes, onAdded }: { workTypes: WorkType[]; onAdded: (staff: Staff, pin: string) => void }) {
  const [name, setName] = useState('')
  const [staffCode, setStaffCode] = useState('')
  const [workTypeId, setWorkTypeId] = useState('')
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
      })
      setName('')
      setStaffCode('')
      onAdded(result.staff, result.pin)
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[2fr_1fr_1.6fr_auto] sm:items-end">
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
          <span className="vista-field-label">Usual rate</span>
          <select value={workTypeId} onChange={(event) => setWorkTypeId(event.target.value)} className="vista-control mt-1 w-full px-2">
            <option value="">—</option>
            {workTypes.filter((type) => type.isActive).map((type) => (
              <option key={type.id} value={type.id}>
                {type.name} · {formatRinggit(type.rateSenPerHour)}/h
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={saving || !name.trim()} className="vista-button-primary flex min-h-11 items-center justify-center gap-2 disabled:opacity-50">
          <UserPlus aria-hidden="true" className="size-4" /> Add staff
        </button>
        {error ? <p className="text-xs font-bold text-serious sm:col-span-4">{error}</p> : null}
      </form>
    </Panel>
  )
}

function StaffEditor({
  staff,
  workTypes,
  onChanged,
  onPin,
  onDeleted,
  onClose,
}: {
  staff: Staff
  workTypes: WorkType[]
  onChanged: (staff: Staff) => void
  onPin: (pin: string) => void
  onDeleted: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(staff.name)
  const [staffCode, setStaffCode] = useState(staff.staffCode)
  const [workTypeId, setWorkTypeId] = useState(staff.defaultWorkTypeId ?? '')
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
      })
      onChanged(result.staff)
    }, 'Details saved.')

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
          <span className="vista-field-label">Usual rate</span>
          <select value={workTypeId} onChange={(event) => setWorkTypeId(event.target.value)} className="vista-control mt-1 w-full px-2">
            <option value="">—</option>
            {workTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name} · {formatRinggit(type.rateSenPerHour)}/h{type.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </label>
        <div className="sm:col-span-2">
          <button type="button" onClick={saveDetails} className="vista-button-primary min-h-11">
            Save details
          </button>
        </div>
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
        <button
          type="button"
          onClick={async () => {
            if (!window.confirm(`Delete ${staff.name} for good? Their shifts are removed and they can no longer sign in. This cannot be undone.`)) return
            setError(null)
            try {
              await teamApi.deleteStaff(staff.id)
              onDeleted()
            } catch (caught) {
              setError(errorText(caught))
            }
          }}
          className="min-h-11 bg-critical px-4 text-sm font-bold text-white hover:opacity-90"
        >
          Delete
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

  const workTypeName = (id: string | null) => {
    const type = data.workTypes.find((candidate) => candidate.id === id)
    return type ? `${type.name} · ${formatRinggit(type.rateSenPerHour)}/h` : '—'
  }
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
                  {['Name', 'Staff ID', 'PIN', 'Usual rate', 'Status'].map((heading) => (
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
                    <td className="px-3 py-1">
                      {staff.hasPin ? <PinCell staffId={staff.id} version={staff.pinSetAt} /> : <span className="text-xs text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2.5">{workTypeName(staff.defaultWorkTypeId)}</td>
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
              onDeleted={() => {
                setSelectedId(null)
                reload()
              }}
              onPin={(pin) => {
                setShownPin({ name: selected.name, pin })
                reload()
              }}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <p className="hidden self-start border border-dashed border-line p-6 text-sm text-muted xl:block">
              Pick someone to edit their details or change their PIN.
            </p>
          )}
        </div>
      )}

      <section className="space-y-3 border-t border-line pt-5">
        <h3 className="font-display text-lg font-bold">Pay rates</h3>
        <WorkTypesTab />
      </section>

      {shownPin ? <PinNotice name={shownPin.name} pin={shownPin.pin} onClose={() => setShownPin(null)} /> : null}
    </div>
  )
}
