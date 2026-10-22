import type { StockBalance } from '../../../domain/stock.ts'
import type { WeekDetail } from '../../roster-api.ts'
import { BRAND_DRINKS, BRAND_FOOD } from '../catalogue.ts'
import { ACCOUNT } from '../index.ts'
import { openCoverage, touchWeek } from './roster.ts'
import { handle } from './router.ts'
import { addDays, mondayOf, mytDate, mytInstant, weekdayOf } from './rules.ts'
import { audit, newId, type AttendanceRow, type DemoServerState, type Method, type StaffRow } from './state.ts'

/**
 * The demo stall's team, built the way a real one would be: weeks created,
 * applied for, given out and published; shifts worked and approved; payroll
 * approved and paid — by calling the fake routes on a clock that runs from
 * three weeks ago up to now. So every figure on screen is one the real rules
 * produced, and the audit trail reads like a real one.
 *
 * Everything is relative to today: two finished weeks, this week (published,
 * partly worked) and next week (open for applications).
 */

/** FNV-1a: a fixed "random" number per name, the same on every machine. */
function hash(text: string): number {
  let value = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

const minutes = (count: number) => count * 60_000

const STAFF: Array<{
  name: string
  tags: string[]
  type: 'regular' | 'lead' | 'training'
  pin: string
  attributes: StaffRow['attributes']
}> = [
  {
    name: 'Aina Sofea',
    tags: ['cashier', 'drinks'],
    type: 'lead',
    pin: '4821',
    attributes: { reliability: 5, capability: 4, experience: 4, soloSuitability: 'SUITABLE', trainingStatus: 'TRAINED', managementPriority: 1, notes: 'Can close the till on her own.', extra: {} },
  },
  {
    name: 'Danish Hakimi',
    tags: ['grill'],
    type: 'regular',
    pin: '7305',
    attributes: { reliability: 4, capability: 5, experience: 3, soloSuitability: 'SUITABLE', trainingStatus: 'TRAINED', managementPriority: 0, notes: null, extra: {} },
  },
  {
    name: 'Mei Ling Tan',
    tags: ['cashier'],
    type: 'regular',
    pin: '1964',
    attributes: { reliability: 4, capability: 4, experience: 4, soloSuitability: 'SUITABLE', trainingStatus: 'TRAINED', managementPriority: 0, notes: null, extra: {} },
  },
  {
    name: 'Arjun Raj',
    tags: ['grill', 'cashier'],
    type: 'lead',
    pin: '5530',
    attributes: { reliability: 5, capability: 4, experience: 5, soloSuitability: 'SUITABLE', trainingStatus: 'TRAINED', managementPriority: 0, notes: 'Knows the grill and the till.', extra: {} },
  },
  {
    name: 'Nurul Izzah',
    tags: ['drinks'],
    type: 'training',
    pin: '2817',
    attributes: { reliability: 3, capability: 2, experience: 1, soloSuitability: 'CAUTION', trainingStatus: 'TRAINEE', managementPriority: 0, notes: 'Started this month. Pair with Aina or Siti.', extra: {} },
  },
  {
    name: 'Farhan Azmi',
    tags: ['grill'],
    type: 'regular',
    pin: '6402',
    attributes: { reliability: 2, capability: 3, experience: 2, soloSuitability: 'NOT_RECOMMENDED', trainingStatus: 'TRAINED', managementPriority: -1, notes: 'Late twice last month.', extra: {} },
  },
  {
    name: 'Siti Khadijah',
    tags: ['cashier', 'drinks'],
    type: 'regular',
    pin: '3159',
    attributes: { reliability: 4, capability: 3, experience: 3, soloSuitability: 'SUITABLE', trainingStatus: 'TRAINED', managementPriority: 0, notes: null, extra: {} },
  },
  // Left a fortnight ago: deactivated, and kept for his hours and pay.
  { name: 'Haziq Rahman', tags: ['grill'], type: 'regular', pin: '9046', attributes: null },
]

const STOCK: Array<{
  brandId: string
  category: string
  subcategory: string | null
  name: string
  unitLabel: string | null
  track: 'U' | 'UB' | 'UO' | 'B'
  isActive?: boolean
}> = [
  { brandId: BRAND_FOOD, category: 'Chiller', subcategory: 'Meat', name: 'Ayam perap', unitLabel: 'tray', track: 'UB' },
  { brandId: BRAND_FOOD, category: 'Chiller', subcategory: 'Meat', name: 'Daging burger', unitLabel: 'pack', track: 'UB' },
  { brandId: BRAND_FOOD, category: 'Chiller', subcategory: null, name: 'Telur', unitLabel: 'tray', track: 'UB' },
  { brandId: BRAND_FOOD, category: 'Dry store', subcategory: null, name: 'Beras', unitLabel: 'bag (10kg)', track: 'UB' },
  { brandId: BRAND_FOOD, category: 'Dry store', subcategory: null, name: 'Mee kuning', unitLabel: 'pack', track: 'U' },
  { brandId: BRAND_FOOD, category: 'Sauces', subcategory: null, name: 'Sambal', unitLabel: 'tub', track: 'UB' },
  { brandId: BRAND_FOOD, category: 'Packaging', subcategory: null, name: 'Polystyrene box', unitLabel: 'pack of 50', track: 'U' },
  { brandId: BRAND_DRINKS, category: 'Syrups', subcategory: null, name: 'Sirap ros', unitLabel: 'bottle', track: 'UB' },
  { brandId: BRAND_DRINKS, category: 'Syrups', subcategory: null, name: 'Laici syrup', unitLabel: 'bottle', track: 'UB' },
  { brandId: BRAND_DRINKS, category: 'Dairy', subcategory: null, name: 'Susu pekat', unitLabel: 'can', track: 'UO' },
  { brandId: BRAND_DRINKS, category: 'Powders', subcategory: null, name: 'Milo', unitLabel: 'pack (1.5kg)', track: 'UB' },
  { brandId: BRAND_DRINKS, category: 'Powders', subcategory: null, name: 'Kopi', unitLabel: 'pack', track: 'UB' },
  { brandId: BRAND_DRINKS, category: 'Packaging', subcategory: null, name: 'Cup 16oz', unitLabel: 'sleeve', track: 'U' },
  { brandId: BRAND_DRINKS, category: 'Chiller', subcategory: null, name: 'Air kelapa', unitLabel: 'bottle', track: 'B', isActive: false },
]

const LEVELS: StockBalance[] = ['EMPTY', 'QUARTER', 'HALF', 'THREE_QUARTERS', 'FULL']
const REMARKS = ['Sambal tinggal sikit, buat baru esok.', 'Cup 16oz dah order, sampai Rabu.', 'Ayam perap cukup untuk esok.']

function emptyState(today: string): DemoServerState {
  return {
    seq: 0,
    settings: {
      applicationLimit: 8,
      assignmentTargetShifts: 4,
      assignmentMaxShifts: 5,
      assignmentMaxMinutes: 1800,
      withdrawalDeadlineHours: 48,
      urgentCoverageHours: 24,
      payRoundingMinutes: 15,
      payRoundingMode: 'FLOOR',
      payFrequency: 'WEEKLY',
      payAnchorDate: addDays(mondayOf(today), -84),
      paydayOffsetDays: 3,
      engineWeights: {},
      orgCode: 'VISTADEMO',
    },
    workTypes: [],
    staff: [],
    hours: [],
    closed: [],
    templates: [],
    weeks: [],
    slots: [],
    applications: [],
    assignments: [],
    coverage: [],
    offers: [],
    attendance: [],
    payslips: [],
    adjustments: [],
    audit: [],
    stockItems: [],
    stockCounts: [],
  }
}

export function seedDemoServer(now: Date): DemoServerState {
  const today = mytDate(now)
  const monday = mondayOf(today)
  const state = emptyState(today)
  const at = (date: string, time: string, extra = 0) => new Date(mytInstant(date, time).getTime() + extra)
  const latest = now.getTime() - minutes(1)

  // Work types, staff, hours, the usual week and the stock list: set up long ago.
  const setUp = at(addDays(monday, -90), '10:00')
  const typeId = { regular: newId(state), lead: newId(state), training: newId(state) }
  state.workTypes = [
    { id: typeId.regular, name: 'Regular', rateSenPerHour: 800, description: 'Counter, grill and drinks', isActive: true },
    { id: typeId.lead, name: 'Shift lead', rateSenPerHour: 1000, description: 'Runs the stall and closes the till', isActive: true },
    { id: typeId.training, name: 'Training', rateSenPerHour: 600, description: 'First month', isActive: true },
  ]
  state.staff = STAFF.map((member, index) => ({
    id: newId(state),
    name: member.name,
    staffCode: `S${String(index + 1).padStart(3, '0')}`,
    status: 'ACTIVE',
    defaultWorkTypeId: typeId[member.type],
    roleTags: member.tags,
    pin: member.pin,
    pinSetAt: new Date(setUp.getTime() + index * 86_400_000).toISOString(),
    createdAt: new Date(setUp.getTime() + index * 86_400_000).toISOString(),
    attributes: member.attributes,
  }))
  const staffNamed = (name: string) => state.staff.find((member) => member.name === name) as StaffRow
  // Mondays closed, like the sales history; open into the small hours.
  state.hours = Array.from({ length: 7 }, (_, weekday) => ({ weekday, isClosed: weekday === 0, opensAt: '19:00', closesAt: '03:30' }))
  state.templates = Array.from({ length: 6 }, (_, index) => index + 1).flatMap((weekday) => [
    { id: newId(state), weekday, startTime: '19:00', endTime: '00:00', requiredStaff: weekday >= 4 ? 3 : 2, canRunSolo: true, roleTags: [], workTypeId: null, label: 'Open' },
    { id: newId(state), weekday, startTime: '23:30', endTime: '03:30', requiredStaff: 2, canRunSolo: false, roleTags: [], workTypeId: null, label: 'Close' },
  ])
  state.stockItems = STOCK.map((item, index) => ({
    id: newId(state),
    brandId: item.brandId,
    category: item.category,
    subcategory: item.subcategory,
    name: item.name,
    unitLabel: item.unitLabel,
    trackUnopened: item.track.includes('U'),
    trackOpened: item.track.includes('O'),
    trackBalance: item.track.includes('B'),
    isActive: item.isActive ?? true,
    sortOrder: index,
    createdAt: setUp.toISOString(),
  }))

  // Everything after that happens in time order, through the routes.
  const events: Array<{ when: number; order: number; run: (now: Date) => void }> = []
  const on = (when: Date, run: (now: Date) => void) => events.push({ when: when.getTime(), order: events.length, run })
  const call = <T>(when: Date, method: Method, path: string, body?: unknown): T => handle(state, method, path, body, when) as T
  /** For steps that may not apply this week (nobody on that shift, say). */
  const attempt = (run: () => void) => {
    try {
      run()
    } catch {
      // Left out of this demo; everything else still stands.
    }
  }
  const slotsOf = (weekId: string) => state.slots.filter((slot) => slot.weekId === weekId)
  /** The Team app stops anyone applying for more shifts a week than the limit. */
  const canPick = (weekId: string, staffId: string) => {
    const ids = new Set(slotsOf(weekId).map((slot) => slot.id))
    return state.applications.filter((row) => row.staffId === staffId && ids.has(row.slotId)).length < state.settings.applicationLimit
  }
  const onShift = (slotId: string) => state.assignments.filter((row) => row.slotId === slotId && row.status === 'ACTIVE')
  const slotsOn = (weekId: string, date: string) =>
    slotsOf(weekId)
      .filter((slot) => mytDate(slot.startsAt) === date)
      .toSorted((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))

  /** A clock-in from the Team app, as the staff member's phone sent it. */
  const clockedIn = (assignmentId: string, withClockOut: boolean): AttendanceRow => {
    const assignment = state.assignments.find((row) => row.id === assignmentId)!
    const slot = state.slots.find((row) => row.id === assignment.slotId)!
    const record: AttendanceRow = {
      id: newId(state),
      staffId: assignment.staffId,
      assignmentId,
      clockInAt: new Date(Date.parse(assignment.startsAt ?? slot.startsAt) + minutes((hash(`${assignmentId}:in`) % 13) - 5)).toISOString(),
      clockOutAt: withClockOut
        ? new Date(Date.parse(assignment.endsAt ?? slot.endsAt) + minutes((hash(`${assignmentId}:out`) % 21) - 6)).toISOString()
        : null,
      approvedStartAt: null,
      approvedEndAt: null,
      workTypeId: null,
      note: null,
      source: 'TEAM_APP',
      status: 'PENDING',
      approvedAt: null,
      version: 1,
    }
    state.attendance.push(record)
    return record
  }

  const weekIds: Record<number, string> = {}
  const forgot = new Set<string>()
  for (const offset of [-2, -1, 0]) {
    const weekStart = addDays(monday, offset * 7)
    on(at(addDays(weekStart, -6), '10:00'), (time) => {
      weekIds[offset] = call<WeekDetail>(time, 'POST', '/rms/team/weeks', { weekStart, fromTemplate: true }).week.id
      call(time, 'POST', `/rms/team/weeks/${weekIds[offset]}/status`, { status: 'APPLICATIONS_OPEN' })
      if (offset === 0) {
        // Saturday's opening takes an extra pair of hands.
        const saturday = slotsOn(weekIds[0], addDays(weekStart, 5))[0]
        if (saturday) call(time, 'PATCH', `/rms/team/slots/${saturday.id}`, { allowsBackup: true })
      }
    })
    // Staff pick the shifts they can do over the next two days.
    on(at(addDays(weekStart, -5), '09:00'), () => {
      for (const slot of slotsOf(weekIds[offset] ?? '')) {
        const date = mytDate(slot.startsAt)
        for (const member of state.staff.filter((row) => row.status === 'ACTIVE')) {
          // Haziq only picked his last few shifts before leaving.
          if (member.name === 'Haziq Rahman' && (offset !== -2 || weekdayOf(date) > 3)) continue
          const roll = hash(`${member.name}|${date}|${slot.label}`)
          if (roll % 100 >= 70 || !canPick(weekIds[offset] ?? '', member.id)) continue
          const applied = at(addDays(weekStart, -5), '09:00', minutes(roll % 2_000))
          state.applications.push({ slotId: slot.id, staffId: member.id, createdAt: applied.toISOString() })
        }
      }
    })
    if (offset === -1) on(at(addDays(weekStart, -3), '09:00'), (time) => call(time, 'PATCH', `/rms/team/staff/${staffNamed('Haziq Rahman').id}`, { status: 'INACTIVE' }))
    on(at(addDays(weekStart, -3), '10:00'), (time) => {
      call(time, 'POST', `/rms/team/weeks/${weekIds[offset]}/status`, { status: 'APPLICATIONS_CLOSED' })
      call(time, 'POST', `/rms/team/weeks/${weekIds[offset]}/generate`)
      call(new Date(time.getTime() + minutes(20)), 'POST', `/rms/team/weeks/${weekIds[offset]}/publish`)
      if (offset === 0) {
        const saturday = slotsOf(weekIds[0] ?? '').find((slot) => slot.allowsBackup)
        if (saturday) {
          attempt(() =>
            call(new Date(time.getTime() + minutes(25)), 'POST', `/rms/team/slots/${saturday.id}/backups`, { staffId: staffNamed('Nurul Izzah').id, minutes: 180 }),
          )
        }
      }
    })

    // The morning after each night: hours confirmed or approved.
    for (let day = 0; day < 7; day += 1) {
      const date = addDays(weekStart, day)
      on(at(addDays(date, 1), '11:00'), (time) => {
        const finished = slotsOn(weekIds[offset] ?? '', date)
          .filter((slot) => Date.parse(slot.endsAt) <= time.getTime())
          .flatMap((slot) => onShift(slot.id))
        if (finished.length === 0) return
        if (offset === -2) {
          call(time, 'POST', '/rms/team/attendance/from-roster', { assignmentIds: finished.map((row) => row.id) })
          return
        }
        for (const assignment of finished) {
          const name = state.staff.find((row) => row.id === assignment.staffId)?.name ?? ''
          const ofThem = (row: AttendanceRow) => row.staffId === assignment.staffId && row.source === 'TEAM_APP'
          if (offset === 0 && addDays(date, 2) >= today) {
            // The last two nights: a couple of clock-ins wait for approval; the rest are still to confirm.
            const waiting = state.attendance.filter((row) => row.status === 'PENDING' && row.clockOutAt && Date.parse(row.clockInAt) >= Date.parse(`${monday}T00:00:00+08:00`))
            if (waiting.length < 2) clockedIn(assignment.id, true)
            continue
          }
          // Last week: Siti forgot to clock in once, so that shift is still to confirm.
          if (name === 'Siti Khadijah' && !forgot.has(assignment.staffId)) {
            forgot.add(assignment.staffId)
            continue
          }
          const record = clockedIn(assignment.id, true)
          // Waiting for approval: Nurul's first, and Siti's latest.
          if (name === 'Nurul Izzah' && state.attendance.filter(ofThem).length === 1) continue
          if (name === 'Siti Khadijah' && day === 6) continue
          if (name === 'Farhan Azmi' && state.attendance.filter(ofThem).length === 1) {
            // Left early: approved to when he actually went.
            const slot = state.slots.find((row) => row.id === assignment.slotId)!
            const left = new Date(Date.parse(slot.endsAt) - minutes(75)).toISOString()
            call(time, 'POST', `/rms/team/attendance/${record.id}/approve`, { approvedEndAt: left })
            call(time, 'PATCH', `/rms/team/attendance/${record.id}`, { note: 'Left early, felt unwell.' })
            continue
          }
          call(time, 'POST', `/rms/team/attendance/${record.id}/approve`)
        }
      })
    }
  }

  // Danish covered a shift at short notice last week, on a special rate.
  on(at(addDays(monday, -6), '15:00'), (time) => {
    const danish = staffNamed('Danish Hakimi').id
    const row = state.assignments.findLast((candidate) => candidate.staffId === danish && slotsOf(weekIds[-1] ?? '').some((slot) => slot.id === candidate.slotId))
    if (row) call(time, 'PATCH', `/rms/team/assignments/${row.id}`, { rateOverrideSen: 1200, rateOverrideReason: 'Covered at short notice' })
  })

  // The fortnight before: approved and paid in full on payday.
  const before = { start: addDays(monday, -14), end: addDays(monday, -8) }
  const payslipIds: string[] = []
  on(at(addDays(monday, -7), '11:30'), (time) => {
    for (const member of state.staff) {
      attempt(() => payslipIds.push(call<{ payslipId: string }>(time, 'POST', '/rms/team/payroll/approve', { staffId: member.id, ...before }).payslipId))
    }
  })
  on(at(addDays(monday, -5), '12:00'), (time) => {
    for (const id of payslipIds) call(time, 'POST', `/rms/team/payslips/${id}/pay`, { paidOn: addDays(monday, -5) })
  })
  // Then a paid shift's hours were corrected: an adjustment for the next payslip.
  on(at(addDays(monday, -4), '15:00'), (time) => {
    for (const name of ['Mei Ling Tan', 'Siti Khadijah', 'Farhan Azmi']) {
      const paid = new Set(state.payslips.filter((row) => row.status === 'PAID').flatMap((row) => row.lines.map((line) => line.attendanceId)))
      const record = state.attendance.findLast((row) => row.staffId === staffNamed(name).id && paid.has(row.id))
      if (!record?.approvedEndAt) continue
      call(time, 'PATCH', `/rms/team/attendance/${record.id}`, {
        approvedEndAt: new Date(Date.parse(record.approvedEndAt) + minutes(30)).toISOString(),
        note: 'Stayed back to help clean up. Added after payday.',
      })
      return
    }
  })
  // Last week: one paid already, two approved, the rest still to do.
  const last = { start: addDays(monday, -7), end: addDays(monday, -1) }
  on(at(monday, '11:30'), (time) => {
    for (const name of ['Aina Sofea', 'Danish Hakimi', 'Arjun Raj']) {
      attempt(() => {
        const { payslipId } = call<{ payslipId: string }>(time, 'POST', '/rms/team/payroll/approve', { staffId: staffNamed(name).id, ...last })
        if (name === 'Aina Sofea') call(new Date(time.getTime() + minutes(10)), 'POST', `/rms/team/payslips/${payslipId}/pay`)
      })
    }
  })

  // Next week: open for applications, a few picks in already.
  on(at(addDays(monday, 1), '10:00'), (time) => {
    weekIds[1] = call<WeekDetail>(time, 'POST', '/rms/team/weeks', { weekStart: addDays(monday, 7), copyFromWeekId: weekIds[0] }).week.id
    call(time, 'POST', `/rms/team/weeks/${weekIds[1]}/status`, { status: 'APPLICATIONS_OPEN' })
  })
  on(at(addDays(monday, 1), '13:00'), (time) => {
    const pickers = ['Aina Sofea', 'Danish Hakimi', 'Mei Ling Tan', 'Arjun Raj', 'Siti Khadijah']
    for (const slot of slotsOf(weekIds[1] ?? '')) {
      const date = mytDate(slot.startsAt)
      for (const name of pickers) {
        const roll = hash(`${name}|${date}|${slot.label}|next`)
        if (roll % 100 >= 45 || !canPick(weekIds[1] ?? '', staffNamed(name).id)) continue
        state.applications.push({ slotId: slot.id, staffId: staffNamed(name).id, createdAt: new Date(time.getTime() + minutes(roll % 300)).toISOString() })
      }
    }
  })

  // Closing stock, sent from the counter each night that traded.
  for (let back = 8; back >= 1; back -= 1) {
    const date = addDays(today, -back)
    if (weekdayOf(date) === 0) continue
    const sent = at(addDays(date, 1), '03:10', minutes(hash(date) % 25))
    if (sent.getTime() > latest) continue
    on(sent, () => {
      const weekId = Object.values(weekIds).find((id) => state.weeks.find((week) => week.id === id)?.weekStart === mondayOf(date))
      const closing = slotsOn(weekId ?? '', date).at(-1)
      const counter = closing ? onShift(closing.id)[0] : undefined
      const remark = hash(`${date}:remark`) % 3 === 0 ? (REMARKS[hash(date) % REMARKS.length] ?? null) : null
      state.stockCounts.push({
        id: newId(state),
        businessDate: date,
        submittedAt: sent.toISOString(),
        branchName: ACCOUNT.outletName,
        staffName: state.staff.find((row) => row.id === counter?.staffId)?.name ?? 'Aina Sofea',
        remarks: remark,
        lines: state.stockItems
          .filter((item) => item.isActive)
          .toSorted((a, b) => a.sortOrder - b.sortOrder)
          .map((item) => {
            const roll = hash(`${item.name}|${date}`)
            const skipped = roll % 19 === 0
            return {
              brandId: item.brandId,
              brandName: item.brandId === BRAND_FOOD ? 'Food' : 'Drinks',
              category: item.category,
              subcategory: item.subcategory,
              name: item.name,
              unitLabel: item.unitLabel,
              trackUnopened: item.trackUnopened,
              trackOpened: item.trackOpened,
              trackBalance: item.trackBalance,
              unopenedMilli: item.trackUnopened && !skipped ? (roll % 6) * 1000 : null,
              openedMilli: item.trackOpened && !skipped ? ((roll >>> 4) % 3) * 1000 : null,
              balance: item.trackBalance && !skipped ? (LEVELS[(roll >>> 8) % LEVELS.length] ?? null) : null,
            }
          }),
      })
    })
  }

  // Run it all in time order, never later than a minute ago.
  let clock = setUp.getTime()
  for (const event of events.toSorted((a, b) => a.when - b.when || a.order - b.order)) {
    clock = Math.max(clock, Math.min(event.when, latest))
    event.run(new Date(clock))
  }

  // Now: someone on tonight's shift has clocked in, and a cover request is out.
  const time = new Date(latest)
  const running = slotsOf(weekIds[0] ?? '').find((slot) => Date.parse(slot.startsAt) <= latest && latest < Date.parse(slot.endsAt))
  const runningRow = running ? onShift(running.id)[0] : undefined
  if (runningRow) clockedIn(runningRow.id, false)
  const ahead = slotsOf(weekIds[0] ?? '')
    .filter((slot) => Date.parse(slot.startsAt) > latest + 3_600_000)
    .toSorted((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  const farhan = staffNamed('Farhan Azmi').id
  const leaving =
    ahead.flatMap((slot) => onShift(slot.id)).find((row) => row.staffId === farhan && !row.isBackup) ??
    ahead.flatMap((slot) => onShift(slot.id)).find((row) => !row.isBackup)
  if (leaving) {
    const member = state.staff.find((row) => row.id === leaving.staffId)!
    const ctx = { state, now: new Date(time.getTime() - minutes(40)) }
    const staffActor = { kind: 'STAFF' as const, label: member.name }
    leaving.status = 'WITHDRAWN'
    leaving.endedAt = ctx.now.toISOString()
    const slot = state.slots.find((row) => row.id === leaving.slotId)!
    touchWeek(ctx, slot.weekId)
    audit(ctx, staffActor, { action: 'roster.staff_withdrew', entityType: 'assignment', entityId: leaving.id, before: { slotId: slot.id, staffId: member.id } })
    openCoverage(ctx, staffActor, slot.id, leaving.id)
  }
  return state
}
