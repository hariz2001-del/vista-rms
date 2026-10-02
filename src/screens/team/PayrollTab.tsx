import { useState } from 'react'
import { Badge, EmptyState, Panel } from '../../components/primitives.tsx'
import {
  clockText,
  dateTimeText,
  dayName,
  hoursText,
  payrollApi,
  todayInKl,
  type PayPeriod,
  type PayrollRow,
} from '../../data/roster-api.ts'
import { errorText, useLoad } from '../../data/team-api.ts'
import { formatRinggit, formatSignedRinggit } from '../../domain/money.ts'

const STATUS: Record<PayrollRow['status'], { text: string; tone: 'neutral' | 'good' | 'warning' | 'info' }> = {
  DRAFT: { text: 'Draft', tone: 'warning' },
  APPROVED: { text: 'Approved — unpaid', tone: 'info' },
  PAID: { text: 'Paid', tone: 'good' },
}

function Payslip({ staffId, period, onChanged }: { staffId: string; period: { start: string; end: string }; onChanged: () => void }) {
  const { data, error, reload } = useLoad(() => payrollApi.payslip(staffId, period.start, period.end))
  const [paidOn, setPaidOn] = useState(todayInKl())
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  if (error && !data) return <p className="text-sm font-bold text-serious">{error}</p>
  if (!data) return <p className="text-sm text-muted">Loading payslip…</p>

  async function act(action: () => Promise<unknown>) {
    setBusy(true)
    setProblem(null)
    try {
      await action()
      reload()
      onChanged()
    } catch (caught) {
      setProblem(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel className="space-y-3 sm:p-5">
      <div className="flex flex-wrap items-start gap-2">
        <div>
          <h3 className="font-display text-xl font-bold">{data.staff.name}</h3>
          <p className="text-xs text-muted">
            {dayName(data.start)} – {dayName(data.end)} · {data.staff.staffCode}
          </p>
        </div>
        <span className="ml-auto">
          <Badge tone={STATUS[data.status].tone}>{STATUS[data.status].text}</Badge>
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line font-mono text-[0.62rem] uppercase tracking-[0.07em] text-muted">
              <th className="py-2 pr-3">Date</th>
              <th className="py-2 pr-3">Clock in</th>
              <th className="py-2 pr-3">Clock out</th>
              <th className="py-2 pr-3">Paid hours</th>
              <th className="py-2 pr-3">Work type</th>
              <th className="py-2 pr-3 text-right">Rate</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line, index) => {
              const start = line.approvedStartAt ?? line.clockInAt
              const end = line.approvedEndAt ?? line.clockOutAt
              return (
                <tr key={index} className="border-b border-line align-top last:border-b-0">
                  <td className="py-2 pr-3">{dayName(line.workDate)}</td>
                  {line.kind === 'ADJUSTMENT' ? (
                    <td colSpan={4} className="py-2 pr-3 text-xs">
                      <span className="font-bold">Adjustment</span> — {line.description}
                    </td>
                  ) : (
                    <>
                      <td className="py-2 pr-3 tabular">{start ? clockText(start) : '—'}</td>
                      <td className="py-2 pr-3 tabular">{end ? clockText(end) : '—'}</td>
                      <td className="py-2 pr-3 tabular">{hoursText(line.minutes)}</td>
                      <td className="py-2 pr-3">
                        {line.workTypeName}
                        {line.description ? <span className="block text-xs text-muted">{line.description}</span> : null}
                      </td>
                    </>
                  )}
                  <td className="py-2 pr-3 text-right tabular">{line.kind === 'ADJUSTMENT' ? '' : formatRinggit(line.rateSenPerHour)}</td>
                  <td className="py-2 text-right font-bold tabular">{line.kind === 'ADJUSTMENT' ? formatSignedRinggit(line.amountSen) : formatRinggit(line.amountSen)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink">
              <td colSpan={3} className="py-2 font-bold">
                Total
              </td>
              <td className="py-2 font-bold tabular">{hoursText(data.totalMinutes)}</td>
              <td colSpan={3} className="py-2 text-right font-display text-xl font-bold tabular">
                {formatRinggit(data.totalSen)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {data.problems.length > 0 ? (
        <ul className="space-y-1 bg-amber-50 p-3 text-xs font-bold text-warning">
          {data.problems.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      ) : null}
      {data.pendingCount > 0 ? (
        <p className="text-xs font-bold text-warning">
          {data.pendingCount} clock-in{data.pendingCount === 1 ? '' : 's'} in this period still waiting for approval (Attendance tab) — not included.
        </p>
      ) : null}
      {problem ? <p role="alert" className="text-sm font-bold text-critical">{problem}</p> : null}

      <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
        {data.status === 'DRAFT' ? (
          <button
            type="button"
            disabled={busy || data.lines.length === 0 || data.problems.some((text) => text.startsWith('No work type'))}
            onClick={() => act(() => payrollApi.approve(staffId, period.start, period.end))}
            className="vista-button-primary min-h-11 disabled:opacity-50"
          >
            Approve {formatRinggit(data.totalSen)}
          </button>
        ) : null}
        {data.status === 'APPROVED' && data.payslipId ? (
          <>
            <label className="block">
              <span className="vista-field-label">Paid on</span>
              <input type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} className="vista-control mt-1 px-2" />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Mark ${formatRinggit(data.totalSen)} to ${data.staff.name} as paid? It goes into the books as Staff wages and can no longer change.`)) {
                  void act(() => payrollApi.pay(data.payslipId as string, paidOn))
                }
              }}
              className="vista-button-primary min-h-11 disabled:opacity-50"
            >
              Pay {data.staff.name} {formatRinggit(data.totalSen)}
            </button>
            <button type="button" disabled={busy} onClick={() => act(() => payrollApi.unapprove(data.payslipId as string))} className="vista-button-secondary min-h-11">
              Back to draft
            </button>
          </>
        ) : null}
        {data.status === 'PAID' ? (
          <p className="text-sm text-muted">
            Paid {data.paidOn ? dayName(data.paidOn) : ''} · booked in Cashflow as Staff wages. This payslip can no longer change; later
            corrections appear as adjustments.
            {data.paidAt ? ` (${dateTimeText(data.paidAt)})` : ''}
          </p>
        ) : null}
      </div>
    </Panel>
  )
}

function Adjustments({ onChanged }: { onChanged: () => void }) {
  const { data, reload } = useLoad(() => payrollApi.adjustments())
  const open = (data?.adjustments ?? []).filter((item) => item.status === 'OPEN')
  if (open.length === 0) return null
  return (
    <Panel className="space-y-2 border-warning/60">
      <h3 className="text-sm font-black uppercase tracking-[0.06em]">Changes after payment</h3>
      <p className="text-xs text-muted">
        Attendance edited after it was paid. The paid payslip is untouched; each difference is added to that person’s next
        payslip automatically unless you dismiss it.
      </p>
      <ul className="space-y-2">
        {open.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-bold">{item.staffName}</span>
            <span className="font-bold tabular">{formatSignedRinggit(item.amountSen)}</span>
            <span className="text-xs text-muted">{item.reason}</span>
            <button
              type="button"
              onClick={async () => {
                const note = window.prompt('Why dismiss it? (e.g. settled in cash)')
                if (!note) return
                await payrollApi.dismissAdjustment(item.id, note)
                reload()
                onChanged()
              }}
              className="ml-auto vista-button-secondary min-h-9"
            >
              Dismiss
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function Summary({ period, onPick, picked }: { period: { start: string; end: string }; onPick: (staffId: string) => void; picked: string | null }) {
  const { data, error, reload } = useLoad(() => payrollApi.summary(period.start, period.end))
  if (error && !data) return <p className="text-sm font-bold text-serious">{error}</p>
  if (!data) return <p className="text-sm text-muted">Working out pay…</p>
  if (data.rows.length === 0) return <EmptyState title="No approved time in this period" hint="Approve clock-ins in the Attendance tab first." />

  const types = [...new Set(data.rows.flatMap((row) => Object.keys(row.minutesByType)))].toSorted()
  const total = data.rows.reduce((sum, row) => sum + row.totalSen, 0)
  const unpaid = data.rows.filter((row) => row.status !== 'PAID').reduce((sum, row) => sum + row.totalSen, 0)
  return (
    <div className="space-y-4">
      <Adjustments onChanged={reload} />
      <div className="overflow-x-auto border border-line bg-surface">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line font-mono text-[0.62rem] uppercase tracking-[0.07em] text-muted">
              <th className="px-3 py-2">Staff</th>
              {types.map((type) => (
                <th key={type} className="px-3 py-2 text-right">
                  {type}
                </th>
              ))}
              <th className="px-3 py-2 text-right">Total hours</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr
                key={row.staffId}
                onClick={() => onPick(row.staffId)}
                className={`cursor-pointer border-b border-line last:border-b-0 hover:bg-canvas ${picked === row.staffId ? 'bg-canvas' : ''}`}
              >
                <td className="px-3 py-2 font-bold">
                  <button type="button" onClick={() => onPick(row.staffId)} className="text-left">
                    {row.name}
                  </button>
                  {row.problems.length > 0 || row.pendingCount > 0 ? <span className="ml-1 text-xs text-warning">●</span> : null}
                </td>
                {types.map((type) => (
                  <td key={type} className="px-3 py-2 text-right tabular">
                    {row.minutesByType[type] ? hoursText(row.minutesByType[type]) : '—'}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular">{hoursText(row.totalMinutes)}</td>
                <td className="px-3 py-2 text-right font-bold tabular">{formatRinggit(row.totalSen)}</td>
                <td className="px-3 py-2">
                  <Badge tone={STATUS[row.status].tone}>{STATUS[row.status].text}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink">
              <td className="px-3 py-2 font-bold" colSpan={types.length + 2}>
                Period total · still to pay {formatRinggit(unpaid)}
              </td>
              <td className="px-3 py-2 text-right font-bold tabular">{formatRinggit(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {picked ? <Payslip key={`${picked}:${period.start}`} staffId={picked} period={period} onChanged={reload} /> : <p className="text-sm text-muted">Pick someone to see their payslip line by line, approve it and pay it.</p>}
    </div>
  )
}

export function PayrollTab() {
  const { data, error } = useLoad(() => payrollApi.periods())
  const [chosen, setChosen] = useState<{ start: string; end: string } | null>(null)
  const [custom, setCustom] = useState({ start: '', end: '' })
  const [picked, setPicked] = useState<string | null>(null)

  if (error && !data) return <p className="text-sm font-bold text-serious">{error}</p>
  if (!data) return <p className="text-sm text-muted">Loading pay periods…</p>
  const periods: PayPeriod[] = data.periods
  const period = chosen ?? (periods[1] ?? periods[0] ?? null)

  return (
    <div className="space-y-4">
      <p className="max-w-[70ch] text-sm text-muted">
        Pay is worked out from approved attendance, never from the roster. Approve each person’s payslip, then pay it: paying
        books it in Cashflow as Staff wages, once, and freezes it.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        {periods.length > 0 ? (
          <label className="block">
            <span className="vista-field-label">Pay period</span>
            <select
              value={period ? `${period.start}|${period.end}` : ''}
              onChange={(event) => {
                const [start, end] = event.target.value.split('|')
                setChosen({ start: start ?? '', end: end ?? '' })
                setPicked(null)
              }}
              className="vista-control mt-1 px-2"
            >
              {periods.map((item, index) => (
                <option key={item.start} value={`${item.start}|${item.end}`}>
                  {item.label}
                  {index === 0 ? ' (current)' : ''} · payday {dayName(item.payday)}
                </option>
              ))}
              {chosen && !periods.some((item) => item.start === chosen.start && item.end === chosen.end) ? (
                <option value={`${chosen.start}|${chosen.end}`}>
                  {dayName(chosen.start)} – {dayName(chosen.end)}
                </option>
              ) : null}
            </select>
          </label>
        ) : null}
        <label className="block">
          <span className="vista-field-label">Or from</span>
          <input type="date" value={custom.start} onChange={(event) => setCustom({ ...custom, start: event.target.value })} className="vista-control mt-1 px-2" />
        </label>
        <label className="block">
          <span className="vista-field-label">to</span>
          <input type="date" value={custom.end} onChange={(event) => setCustom({ ...custom, end: event.target.value })} className="vista-control mt-1 px-2" />
        </label>
        <button
          type="button"
          disabled={!custom.start || !custom.end || custom.end < custom.start}
          onClick={() => {
            setChosen({ ...custom })
            setPicked(null)
          }}
          className="vista-button-secondary min-h-11 disabled:opacity-50"
        >
          Use these dates
        </button>
      </div>
      {period ? <Summary key={`${period.start}|${period.end}`} period={period} picked={picked} onPick={setPicked} /> : <EmptyState title="Set a pay cycle in Settings, or pick dates above" />}
    </div>
  )
}
