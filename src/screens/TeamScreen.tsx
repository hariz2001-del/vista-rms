import { useState } from 'react'
import { EmptyState, SectionHeading } from '../components/primitives.tsx'
import { IS_DEMO } from '../lib/mode.ts'
import { StaffTab } from './team/StaffTab.tsx'
import { TeamSettingsTab } from './team/TeamSettingsTab.tsx'
import { WorkTypesTab } from './team/WorkTypesTab.tsx'

type TabKey = 'staff' | 'work-types' | 'settings'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'staff', label: 'Staff' },
  { key: 'work-types', label: 'Work types' },
  { key: 'settings', label: 'Settings' },
]

/**
 * Team: the people who work shifts, what they are paid for each kind of work,
 * and the rules rostering and payroll follow. Staff themselves use
 * team.vistahub.my; nothing here is visible to them.
 */
export function TeamScreen() {
  const [tab, setTab] = useState<TabKey>('staff')

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Team"
        hint="Staff sign in at team.vistahub.my with their name and a 4-digit PIN. Ratings and notes you keep here are never shown to them."
      />

      {IS_DEMO ? (
        <EmptyState
          title="Team works with a live business account"
          hint="Sign up at vistahub.my to add staff, build rosters and run payroll."
        />
      ) : (
        <>
          <div role="tablist" aria-label="Team sections" className="flex flex-wrap gap-1 border-b border-line">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                onClick={() => setTab(item.key)}
                className={`-mb-px min-h-11 border-b-2 px-4 text-sm font-bold ${
                  tab === item.key ? 'border-rail text-ink' : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === 'staff' ? <StaffTab /> : null}
          {tab === 'work-types' ? <WorkTypesTab /> : null}
          {tab === 'settings' ? <TeamSettingsTab /> : null}
        </>
      )}
    </div>
  )
}
