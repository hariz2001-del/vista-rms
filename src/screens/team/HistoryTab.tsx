import { useState } from 'react'
import { EmptyState } from '../../components/primitives.tsx'
import { dateTimeText } from '../../data/roster-api.ts'
import { teamApi, useLoad, type AuditEntry } from '../../data/team-api.ts'

/** Plain words for each recorded action. Anything new falls back to its code. */
const ACTION: Record<string, string> = {
  'staff.created': 'Added staff member',
  'staff.updated': 'Changed staff details',
  'staff.active': 'Reactivated staff member',
  'staff.inactive': 'Deactivated staff member',
  'staff.attributes_changed': 'Changed confidential notes',
  'staff.pin_reset': 'Reset PIN',
  'staff.pin_set': 'Set PIN by hand',
  'work_type.created': 'Added work type',
  'work_type.changed': 'Changed work type',
  'team_settings.changed': 'Changed team settings',
  'schedule.hours_changed': 'Changed opening hours',
  'schedule.closed_period_added': 'Added closed dates',
  'schedule.closed_period_removed': 'Removed closed dates',
  'schedule.templates_changed': 'Changed the usual week',
  'roster.week_created': 'Created roster week',
  'roster.week_settings_changed': 'Changed a week’s rules',
  'roster.status_changed': 'Moved roster to another stage',
  'roster.generated': 'Generated suggested roster',
  'roster.published': 'Published roster',
  'roster.unpublished': 'Unpublished roster',
  'roster.week_deleted': 'Deleted roster week',
  'roster.shift_added': 'Added shift',
  'roster.shift_changed': 'Changed shift',
  'roster.shift_removed': 'Removed shift',
  'roster.assigned': 'Put someone on a shift',
  'roster.assigned_over_warning': 'Put someone on a shift despite a warning',
  'roster.manager_removed': 'Took someone off a shift',
  'roster.staff_withdrew': 'Staff member pulled out of a shift',
  'roster.locked': 'Locked an assignment',
  'roster.unlocked': 'Unlocked an assignment',
  'roster.work_type_changed': 'Changed a shift’s work type',
  'pay.rate_overridden': 'Set a one-off rate',
  'application.applied': 'Applied for a shift',
  'application.withdrawn': 'Took back an application',
  'coverage.opened': 'Opened a cover request',
  'coverage.opened_urgent': 'Opened an urgent cover request',
  'coverage.offered': 'Offered a shift as cover',
  'coverage.accepted_by_staff': 'Accepted cover in the app',
  'coverage.rejected_by_staff': 'Said no to cover',
  'coverage.confirmed_by_manager': 'Confirmed cover on someone’s behalf',
  'coverage.skipped_by_manager': 'Skipped someone in the cover queue',
  'coverage.cancelled': 'Cancelled a cover request',
  'attendance.clocked_in': 'Clocked in',
  'attendance.clocked_out': 'Clocked out',
  'attendance.added_manually': 'Added time by hand',
  'attendance.edited': 'Edited attendance',
  'attendance.approved': 'Approved attendance',
  'attendance.rejected': 'Rejected attendance',
  'payroll.approved': 'Approved a payslip',
  'payroll.unapproved': 'Sent a payslip back to draft',
  'payroll.reverted_after_attendance_edit': 'Payslip back to draft after an attendance edit',
  'payroll.paid': 'Marked a payslip paid',
  'payroll.discrepancy_flagged': 'Flagged a change after payment',
  'payroll.adjustment_dismissed': 'Dismissed an adjustment',
  'ledger.wages_entry_created': 'Booked wages in the ledger',
}

export function HistoryTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const { data, error } = useLoad(() => teamApi.audit())
  const [loadingMore, setLoadingMore] = useState(false)
  const all = [...(data?.entries ?? []), ...entries]

  if (error && !data) return <p className="text-sm font-bold text-serious">{error}</p>
  if (!data) return <p className="text-sm text-muted">Loading history…</p>
  if (all.length === 0) return <EmptyState title="Nothing recorded yet" />

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Every change in Team, who made it and when. It cannot be edited or deleted.</p>
      <ul className="divide-y divide-line border border-line bg-surface text-sm">
        {all.map((entry) => (
          <li key={entry.id} className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 py-2">
            <span className="w-36 shrink-0 tabular text-xs text-muted">{dateTimeText(entry.createdAt)}</span>
            <span className="w-28 shrink-0 font-bold">{entry.actorLabel}</span>
            <span>{ACTION[entry.action] ?? entry.action}</span>
          </li>
        ))}
      </ul>
      {all.length % 100 === 0 ? (
        <button
          type="button"
          disabled={loadingMore}
          onClick={async () => {
            setLoadingMore(true)
            const last = all.at(-1)
            const more = await teamApi.audit({ before: last?.id })
            setEntries([...entries, ...more.entries])
            setLoadingMore(false)
          }}
          className="vista-button-secondary min-h-11"
        >
          Load older
        </button>
      ) : null}
    </div>
  )
}
