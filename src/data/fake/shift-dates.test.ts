import { describe, expect, it } from 'vitest'
import { demoWindow, msUntilNextReset } from '../demo-session.ts'
import { daysBetween, malaysiaToday, shiftDates } from './shift-dates.ts'

describe('shiftDates', () => {
  it('moves dates and timestamps, and nothing else', () => {
    const record = {
      id: 'shift-2026-09-08',
      businessDate: '2026-09-08',
      completedAt: '2026-09-08T12:04:00.000Z',
      entryAt: '2026-09-08T12:04:00Z',
      description: 'Rent for 2026-09',
      amountSen: 120_000,
      lines: [{ businessDate: '2026-08-31' }],
      closedAt: null,
    }
    expect(shiftDates(record, 21)).toEqual({
      id: 'shift-2026-09-08',
      businessDate: '2026-09-29',
      completedAt: '2026-09-29T12:04:00.000Z',
      entryAt: '2026-09-29T12:04:00.000Z',
      description: 'Rent for 2026-09',
      amountSen: 120_000,
      lines: [{ businessDate: '2026-09-21' }],
      closedAt: null,
    })
  })

  it('crosses month and year ends', () => {
    expect(shiftDates('2026-12-30', 3)).toBe('2027-01-02')
    expect(daysBetween('2026-09-08', '2026-10-01')).toBe(23)
  })

  it('reads the date on the Malaysian clock, not UTC', () => {
    // 17:00 UTC on the 28th is 1am on the 29th in Kuala Lumpur.
    expect(malaysiaToday(new Date('2026-09-28T17:00:00Z'))).toBe('2026-09-29')
  })
})

describe('demo reset windows', () => {
  it('splits the Malaysian day into 3-hour blocks', () => {
    expect(demoWindow(new Date('2026-09-28T01:30:00Z'))).toBe('2026-09-28#3')
    expect(demoWindow(new Date('2026-09-28T16:10:00Z'))).toBe('2026-09-29#0')
  })

  it('counts down to the next boundary', () => {
    expect(msUntilNextReset(new Date('2026-09-28T01:30:00Z'))).toBe(2.5 * 3_600_000)
  })
})
