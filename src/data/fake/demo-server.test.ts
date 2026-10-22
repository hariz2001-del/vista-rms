import { describe, expect, it } from 'vitest'
import type { Attendance, PayPeriod, PayrollRow, PayslipDetail, WeekDetail, WeekSummary } from '../roster-api.ts'
import type { StockCountSummary, StockItem } from '../stock-api.ts'
import type { AuditEntry, Staff, WorkType } from '../team-api.ts'
import { demoWindow } from '../demo-session.ts'
import { createDemoServer } from './demo-server.ts'
import { seedDemoServer } from './server/seed.ts'
import type { DemoServerState } from './server/state.ts'

// A Wednesday afternoon in Kuala Lumpur: two nights of this week worked, the rest to come.
const NOW = new Date('2026-10-21T08:00:00Z')

/** The server with the browser's storage swapped for memory that, like it, belongs to one window. */
function server(clock = { now: NOW }) {
  let saved: { window: string; state: DemoServerState } | null = null
  return createDemoServer({
    now: () => clock.now,
    load: async (at) => (saved?.window === demoWindow(at) ? saved.state : null),
    save: async (state, at) => {
      saved = { window: demoWindow(at), state }
    },
  })
}

describe('demo server seed', () => {
  const state = seedDemoServer(NOW)

  it('has a small team with rates and their own PINs', () => {
    expect(state.staff).toHaveLength(8)
    expect(state.staff.filter((staff) => staff.status === 'ACTIVE')).toHaveLength(7)
    expect(new Set(state.staff.map((staff) => staff.pin)).size).toBe(8)
    expect(state.workTypes.map((type) => type.rateSenPerHour)).toEqual([800, 1000, 600])
    expect(state.staff.every((staff) => staff.defaultWorkTypeId)).toBe(true)
  })

  it('has two finished weeks, this week published and next week open for picks', () => {
    const weeks = state.weeks.toSorted((a, b) => a.weekStart.localeCompare(b.weekStart))
    expect(weeks.map((week) => [week.weekStart, week.status])).toEqual([
      ['2026-10-05', 'PUBLISHED'],
      ['2026-10-12', 'PUBLISHED'],
      ['2026-10-19', 'PUBLISHED'],
      ['2026-10-26', 'APPLICATIONS_OPEN'],
    ])
    const next = weeks[3]!
    const nextSlots = new Set(state.slots.filter((slot) => slot.weekId === next.id).map((slot) => slot.id))
    expect(state.applications.filter((row) => nextSlots.has(row.slotId)).length).toBeGreaterThan(5)
    // Mondays closed: six trading nights of two shifts.
    expect(nextSlots.size).toBe(12)
  })

  it('has hours waiting, a cover request, payslips in every state and stock counts', () => {
    const pending = state.attendance.filter((row) => row.status === 'PENDING')
    expect(pending.length).toBeGreaterThanOrEqual(3)
    expect(pending.length).toBeLessThanOrEqual(6)
    expect(state.coverage.filter((row) => row.status === 'OPEN')).toHaveLength(1)
    expect(state.offers.filter((row) => row.status === 'PENDING')).toHaveLength(1)
    const lastWeek = state.payslips.filter((row) => row.periodStart === '2026-10-12')
    expect(lastWeek.map((row) => row.status).toSorted()).toEqual(['APPROVED', 'APPROVED', 'PAID'])
    expect(state.payslips.filter((row) => row.periodStart === '2026-10-05').every((row) => row.status === 'PAID')).toBe(true)
    expect(state.adjustments.filter((row) => row.status === 'OPEN')).toHaveLength(1)
    expect(state.stockItems).toHaveLength(14)
    expect(state.stockCounts.length).toBeGreaterThanOrEqual(5)
  })

  it('is the same seed for the same moment', () => {
    expect(seedDemoServer(NOW)).toEqual(state)
  })
})

describe('demo server routes', () => {
  it('gives next week’s shifts to the applicants and publishes it', async () => {
    const api = server()
    const { weeks } = await api.request<{ weeks: WeekSummary[] }>('GET', '/rms/team/weeks')
    const next = weeks.find((week) => week.status === 'APPLICATIONS_OPEN')!
    expect(next.filled).toBe(0)

    const filled = await api.request<{ added: number; leftOver: number; detail: WeekDetail }>('POST', `/rms/team/weeks/${next.id}/fill-from-picks`)
    expect(filled.added).toBeGreaterThan(0)
    for (const slot of filled.detail.slots) {
      expect(slot.assignments.filter((row) => row.status === 'ACTIVE' && !row.isBackup).length).toBeLessThanOrEqual(slot.requiredStaff)
    }

    const published = await api.request<WeekDetail>('POST', `/rms/team/weeks/${next.id}/publish`)
    expect(published.week.status).toBe('PUBLISHED')
    const after = await api.request<{ weeks: WeekSummary[] }>('GET', '/rms/team/weeks')
    expect(after.weeks.find((week) => week.id === next.id)?.filled).toBe(filled.added)
    const { entries } = await api.request<{ entries: AuditEntry[] }>('GET', '/rms/team/audit')
    expect(entries[0]).toMatchObject({ action: 'roster.published', entityId: next.id, actorLabel: 'Management' })

    // A published week refuses a fresh suggestion, as the server does.
    await expect(api.request('POST', `/rms/team/weeks/${next.id}/generate`)).rejects.toMatchObject({ code: 'team:WEEK_PUBLISHED' })
  })

  it('pays approved hours × the rate, rounded down to the quarter hour', async () => {
    const api = server()
    const { periods } = await api.request<{ periods: PayPeriod[] }>('GET', '/rms/team/payroll/periods')
    const last = periods[1]!
    expect(last).toMatchObject({ start: '2026-10-12', end: '2026-10-18', payday: '2026-10-21' })

    const range = `start=${last.start}&end=${last.end}`
    const { attendance } = await api.request<{ attendance: Attendance[] }>('GET', `/rms/team/attendance?${range}&status=APPROVED`)
    for (const record of attendance) expect(record.payableMinutes).toBe(Math.floor(record.workedMinutes! / 15) * 15)

    const { rows } = await api.request<{ rows: PayrollRow[] }>('GET', `/rms/team/payroll?${range}`)
    const { adjustments } = await api.request<{ adjustments: Array<{ staffId: string; amountSen: number; status: string }> }>('GET', '/rms/team/adjustments')
    for (const row of rows.filter((candidate) => candidate.status === 'DRAFT')) {
      const worked = attendance
        .filter((record) => record.staffId === row.staffId && record.payslipStatus === null)
        .reduce((sum, record) => sum + Math.round((record.payableMinutes! * record.rate!.rateSenPerHour) / 60), 0)
      const owed = adjustments.filter((item) => item.staffId === row.staffId && item.status === 'OPEN').reduce((sum, item) => sum + item.amountSen, 0)
      expect(row.totalSen).toBe(worked + owed)
    }

    // By hand: 19:00–23:40 on Regular (RM 8.00/h) pays 4.5 hours = RM 36.00.
    const { staff } = await api.request<{ staff: Staff[] }>('GET', '/rms/team/staff')
    const { workTypes } = await api.request<{ workTypes: WorkType[] }>('GET', '/rms/team/work-types')
    const regular = workTypes.find((type) => type.name === 'Regular')!
    const mei = staff.find((member) => member.name === 'Mei Ling Tan')!
    expect(mei.defaultWorkTypeId).toBe(regular.id)
    const custom = 'start=2026-09-01&end=2026-09-01'
    await api.request('POST', '/rms/team/attendance', { staffId: mei.id, startAt: '2026-09-01T19:00:00+08:00', endAt: '2026-09-01T23:40:00+08:00' })
    // Her open adjustment from a corrected, already paid shift rides on her next payslip.
    const owed = adjustments.filter((item) => item.staffId === mei.id && item.status === 'OPEN').reduce((sum, item) => sum + item.amountSen, 0)
    const draft = await api.request<PayslipDetail>('GET', `/rms/team/payroll/staff/${mei.id}?${custom}`)
    expect(draft.lines.find((line) => line.kind === 'ATTENDANCE')).toMatchObject({ minutes: 270, rateSenPerHour: 800, amountSen: 3600 })
    expect(draft.totalSen).toBe(3600 + owed)

    const approved = await api.request<{ payslipId: string; totalSen: number }>('POST', '/rms/team/payroll/approve', { staffId: mei.id, start: '2026-09-01', end: '2026-09-01' })
    expect(approved.totalSen).toBe(3600 + owed)
    await api.request('POST', `/rms/team/payslips/${approved.payslipId}/pay`)
    const paid = await api.request<PayslipDetail>('GET', `/rms/team/payroll/staff/${mei.id}?${custom}`)
    expect(paid).toMatchObject({ status: 'PAID', totalSen: 3600 + owed })
    await expect(api.request('POST', `/rms/team/payslips/${approved.payslipId}/unapprove`)).rejects.toMatchObject({ code: 'team:PAYSLIP_PAID' })
  })

  it('confirms finished shifts from the roster and covers a vacancy', async () => {
    const api = server()
    const { shifts } = await api.request<{ shifts: Array<{ assignmentId: string }> }>('GET', '/rms/team/attendance/unconfirmed?start=2026-10-19&end=2026-10-25')
    expect(shifts.length).toBeGreaterThan(0)
    const { confirmed } = await api.request<{ confirmed: number }>('POST', '/rms/team/attendance/from-roster', { assignmentIds: shifts.map((shift) => shift.assignmentId) })
    expect(confirmed).toBe(shifts.length)
    const again = await api.request<{ shifts: unknown[] }>('GET', '/rms/team/attendance/unconfirmed?start=2026-10-19&end=2026-10-25')
    expect(again.shifts).toHaveLength(0)

    const { coverage } = await api.request<{ coverage: Array<{ id: string; status: string; queue: Array<{ staffId: string }> }> }>('GET', '/rms/team/coverage')
    const open = coverage.find((item) => item.status === 'OPEN')!
    await api.request('POST', `/rms/team/coverage/${open.id}/confirm`, { staffId: open.queue[0]!.staffId })
    const after = await api.request<{ coverage: Array<{ id: string; status: string }> }>('GET', '/rms/team/coverage')
    expect(after.coverage.find((item) => item.id === open.id)?.status).toBe('FILLED')
  })

  it('keeps the stock list in the owner’s order and reads past counts', async () => {
    const api = server()
    const { items } = await api.request<{ items: StockItem[] }>('GET', '/rms/stock/items')
    const reversed = items.map((item) => item.id).toReversed()
    await api.request('PUT', '/rms/stock/items/order', { ids: reversed })
    const reordered = await api.request<{ items: StockItem[] }>('GET', '/rms/stock/items')
    // Still by brand first, then as arranged.
    expect(reordered.items[0]?.brandId).toBe(items[0]?.brandId)
    await expect(api.request('PUT', '/rms/stock/items/order', { ids: reversed.slice(1) })).rejects.toMatchObject({ code: 'stock:ORDER_MISMATCH' })

    const { counts } = await api.request<{ counts: StockCountSummary[] }>('GET', '/rms/stock/counts?from=2026-10-01&to=2026-10-21')
    expect(counts[0]!.businessDate >= counts.at(-1)!.businessDate).toBe(true)
    const { count } = await api.request<{ count: { lines: unknown[] } }>('GET', `/rms/stock/counts/${counts[0]!.id}`)
    expect(count.lines).toHaveLength(counts[0]!.itemCount)
    await expect(api.file(`/rms/stock/counts/${counts[0]!.id}/pdf`)).rejects.toMatchObject({ code: 'demo:NOT_AVAILABLE' })
  })

  it('starts again at the next 3-hour block', async () => {
    const clock = { now: NOW }
    const api = server(clock)
    const created = await api.request<{ staff: Staff; pin: string }>('POST', '/rms/team/staff', { name: 'Visitor Test' })
    expect(created.pin).toMatch(/^\d{4}$/)
    expect(created.staff.staffCode).toBe('S009')

    clock.now = new Date(NOW.getTime() + 30 * 60_000)
    expect((await api.request<{ staff: Staff[] }>('GET', '/rms/team/staff')).staff).toHaveLength(9)

    // 16:00 → 19:00 in Kuala Lumpur: a new block, a fresh team.
    clock.now = new Date(NOW.getTime() + 3 * 3_600_000)
    expect((await api.request<{ staff: Staff[] }>('GET', '/rms/team/staff')).staff).toHaveLength(8)
  })
})
