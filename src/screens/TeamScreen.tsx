import { useState } from 'react'
import { EmptyState, SectionHeading } from '../components/primitives.tsx'
import { IS_DEMO } from '../lib/mode.ts'
import { AttendanceTab } from './team/AttendanceTab.tsx'
import { PayrollTab } from './team/PayrollTab.tsx'
import { RosterTab } from './team/RosterTab.tsx'
import { StaffTab } from './team/StaffTab.tsx'
import { TeamSettingsTab } from './team/TeamSettingsTab.tsx'

/*
 * Kept deliberately small. The Cover, Timetable and History screens still
 * exist in ./team/ and their routes in the API (the audit trail is still
 * written); they are just not offered for now. Work types live inside Staff.
 */
type TabKey = 'roster' | 'attendance' | 'payroll' | 'staff' | 'settings'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'roster', label: 'Roster' },
  { key: 'attendance', label: 'Hours worked' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'staff', label: 'Staff' },
  { key: 'settings', label: 'Settings' },
]

/**
 * Team: the people who work shifts, what they are paid for each kind of work,
 * and the rules rostering and payroll follow. Staff themselves use
 * team.vistahub.my; nothing here is visible to them.
 */
export function TeamScreen() {
  const [tab, setTab] = useState<TabKey>('roster')

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Team"
        hint="Staff sign in at team.vistahub.my with their name and a 4-digit PIN to see their shifts and pay."
      />

      {IS_DEMO ? (
        <EmptyState
          title="Team works with a live business account"
          hint="Sign up at vistahub.my to add staff, build rosters and run payroll."
        />
      ) : (
        <>
          <div role="tablist" aria-label="Team sections" className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:flex-wrap sm:px-0">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                onClick={() => setTab(item.key)}
                className={`-mb-px min-h-11 shrink-0 border-b-2 px-3 text-sm font-bold ${
                  tab === item.key ? 'border-rail text-ink' : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === 'roster' ? <RosterTab /> : null}
          {tab === 'attendance' ? <AttendanceTab /> : null}
          {tab === 'payroll' ? <PayrollTab /> : null}
          {tab === 'staff' ? <StaffTab /> : null}
          {tab === 'settings' ? <TeamSettingsTab /> : null}
        </>
      )}
    </div>
  )
}
