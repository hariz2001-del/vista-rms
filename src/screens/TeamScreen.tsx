import { useState, type ReactNode } from 'react'
import { EmptyState, SectionHeading } from '../components/primitives.tsx'
import { IS_DEMO } from '../lib/mode.ts'
import { AttendanceTab } from './team/AttendanceTab.tsx'
import { PayrollTab } from './team/PayrollTab.tsx'
import { RosterTab } from './team/RosterTab.tsx'
import { StaffTab } from './team/StaffTab.tsx'
import { GettingStarted } from './team/GettingStarted.tsx'
import { TeamSettingsTab } from './team/TeamSettingsTab.tsx'

/*
 * Kept deliberately small. The Cover, Timetable and History screens still
 * exist in ./team/ and their routes in the API (the audit trail is still
 * written); they are just not offered for now. Work types live inside Staff.
 */
type TabKey = 'roster' | 'pay' | 'staff'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'roster', label: 'Roster' },
  { key: 'pay', label: 'Pay' },
  { key: 'staff', label: 'Staff' },
]

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="font-display text-lg font-bold">{title}</h3>
      {children}
    </section>
  )
}

/**
 * Team: the people who work shifts, what they are paid for each kind of work,
 * and the rules rostering and payroll follow. Staff themselves use
 * team.vistahub.my; nothing here is visible to them.
 */
export function TeamScreen() {
  const [tab, setTab] = useState<TabKey>('roster')
  // Bumped when the checklist changes something, so the open tab reloads too.
  const [version, setVersion] = useState(0)

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

          <GettingStarted key={`${tab}:${version}`} onGo={setTab} onChanged={() => setVersion((value) => value + 1)} />

          <div key={version} className="space-y-5">
          {tab === 'roster' ? <RosterTab /> : null}
          {tab === 'pay' ? (
            <div className="space-y-8">
              <Step title="1. Confirm the hours worked">
                <AttendanceTab />
              </Step>
              <Step title="2. Approve and pay">
                <PayrollTab />
              </Step>
            </div>
          ) : null}
          {tab === 'staff' ? (
            <div className="space-y-8">
              <StaffTab />
              <Step title="Settings">
                <TeamSettingsTab />
              </Step>
            </div>
          ) : null}
          </div>
        </>
      )}
    </div>
  )
}
