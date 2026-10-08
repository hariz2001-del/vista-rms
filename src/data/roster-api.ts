import { apiRequest } from '../lib/http.ts'
import type { SoloSuitability, TrainingStatus } from './team-api.ts'

/**
 * Team: timetable, roster weeks, cover, attendance and payroll
 * (api-vista src/routes/team-roster.ts and team-payroll.ts). Management only.
 */

export type OperatingDay = { weekday: number; isClosed: boolean; opensAt: string; closesAt: string }
export type ClosedPeriod = { id: string; startDate: string; endDate: string; reason: string | null }
export type SlotTemplate = {
  id?: string
  weekday: number
  startTime: string
  endTime: string
  requiredStaff: number
  canRunSolo: boolean
  roleTags: string[]
  workTypeId: string | null
  label: string | null
}

export type WeekStatus = 'DRAFT' | 'APPLICATIONS_OPEN' | 'APPLICATIONS_CLOSED' | 'GENERATED' | 'IN_REVIEW' | 'PUBLISHED'

export type RosterWeek = {
  id: string
  weekStart: string
  weekEnd: string
  label: string
  status: WeekStatus
  phase: WeekStatus | 'ACTIVE' | 'COMPLETED'
  applicationsOpenAt: string | null
  applicationsCloseAt: string | null
  reviewDeadline: string | null
  publishDeadline: string | null
  applicationLimit: number
  assignmentTargetShifts: number
  assignmentMaxShifts: number
  assignmentMaxMinutes: number
  withdrawalDeadlineHours: number
  generatedAt: string | null
  reviewedAt: string | null
  publishedAt: string | null
  updatedAt: string
  version: number
}

export type WeekSummary = RosterWeek & { shiftCount: number; seats: number; filled: number; applicantCount: number }

export type RosterAssignment = {
  id: string
  staffId: string
  staffName: string
  status: 'ACTIVE' | 'WITHDRAWN' | 'REMOVED'
  source: 'AUTO' | 'MANUAL' | 'REPLACEMENT'
  isLocked: boolean
  workTypeId: string | null
  rateOverrideSen: number | null
  rateOverrideReason: string | null
  explanation: string | null
  /** Extra to the shift's places, with their own times or just hours. */
  isBackup: boolean
  hoursOnly: boolean
  /** This person's own times on the shift (a backup's may differ from the slot's). */
  startTime: string
  endTime: string
  minutes: number
}

/** A backup's time: their own start and end, or just hours from the shift's start. */
export type BackupTime = { startTime: string; endTime: string } | { minutes: number }

export type RosterSlot = {
  id: string
  date: string
  startTime: string
  endTime: string
  startsAt: string
  endsAt: string
  minutes: number
  requiredStaff: number
  canRunSolo: boolean
  roleTags: string[]
  workTypeId: string | null
  label: string | null
  allowsBackup: boolean
  applicants: Array<{ staffId: string; appliedAt: string }>
  assignments: RosterAssignment[]
  openCoverage: { id: string; isUrgent: boolean; vacatedBy: string | null; askingName: string | null } | null
}

export type RosterWarning = { kind: string; slotId: string | null; staffId: string | null; message: string }

export type Fairness = {
  staffId: string
  appliedShifts: number
  appliedMinutes: number
  assignedShifts: number
  assignedMinutes: number
  fairShareMinutes: number
  fillRate: number | null
}

export type WeekStaff = {
  id: string
  name: string
  staffCode: string
  status: string
  roleTags: string[]
  defaultWorkTypeId: string | null
  soloSuitability: SoloSuitability
  trainingStatus: TrainingStatus
  trailingMinutes: number
}

export type WeekDetail = {
  week: RosterWeek
  slots: RosterSlot[]
  staff: WeekStaff[]
  fairness: Fairness[]
  warnings: RosterWarning[]
}

export type RosterExport = {
  businessName: string
  weekStart: string
  weekEnd: string
  label: string
  isPublished: boolean
  updatedAt: string
  days: Array<{ date: string; label: string; shifts: Array<{ startTime: string; endTime: string; label: string | null; staff: string[] }> }>
}

export type Coverage = {
  id: string
  status: 'OPEN' | 'FILLED' | 'CANCELLED'
  isUrgent: boolean
  createdAt: string
  resolvedAt: string | null
  slot: { id: string; weekId: string; date: string; startTime: string; endTime: string; startsAt: string; label: string | null }
  vacatedBy: string | null
  vacatedHow: string | null
  offers: Array<{ id: string; staffId: string; staffName: string; rank: number; status: string; respondedAt: string | null }>
  queue: Array<{ staffId: string; staffName: string; appliedForSlot: boolean; reason: string }>
}

export type Attendance = {
  id: string
  staffId: string
  staffName: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  source: 'TEAM_APP' | 'MANUAL'
  date: string
  clockInAt: string
  clockOutAt: string | null
  approvedStartAt: string | null
  approvedEndAt: string | null
  shift: { startTime: string; endTime: string; label: string | null } | null
  assignmentId: string | null
  workTypeId: string | null
  note: string | null
  payableMinutes: number | null
  workedMinutes: number | null
  rate: { workTypeName: string; rateSenPerHour: number } | null
  payslipStatus: 'APPROVED' | 'PAID' | null
  flags: string[]
}

export type UnconfirmedShift = {
  assignmentId: string
  staffId: string
  staffName: string
  date: string
  startTime: string
  endTime: string
  minutes: number
  label: string | null
}

export type PayPeriod = { start: string; end: string; label: string; payday: string }

export type PayrollRow = {
  staffId: string
  name: string
  staffCode: string
  status: 'DRAFT' | 'APPROVED' | 'PAID'
  payslipId: string | null
  minutesByType: Record<string, number>
  totalMinutes: number
  totalSen: number
  paidAt: string | null
  unpaidAfterPayslipSen: number
  pendingCount: number
  openAdjustments: number
  problems: string[]
}

export type PayslipLine = {
  kind: 'ATTENDANCE' | 'ADJUSTMENT'
  attendanceId: string | null
  adjustmentId: string | null
  workDate: string
  clockInAt: string | null
  clockOutAt: string | null
  approvedStartAt?: string | null
  approvedEndAt?: string | null
  minutes: number
  workTypeName: string
  rateSenPerHour: number
  amountSen: number
  description: string | null
}

export type PayslipDetail = {
  staff: { id: string; name: string; staffCode: string }
  start: string
  end: string
  status: 'DRAFT' | 'APPROVED' | 'PAID'
  payslipId: string | null
  lines: PayslipLine[]
  totalMinutes: number
  totalSen: number
  approvedAt: string | null
  paidAt: string | null
  paidOn: string | null
  problems: string[]
  pendingCount: number
}

export type Adjustment = {
  id: string
  staffId: string
  staffName: string
  amountSen: number
  minutesDelta: number
  reason: string
  status: 'OPEN' | 'INCLUDED' | 'DISMISSED'
  resolvedNote: string | null
  createdAt: string
}

type SlotFields = Omit<SlotTemplate, 'weekday' | 'id'> & { date: string; allowsBackup?: boolean }

export const rosterApi = {
  scheduleSetup: () =>
    apiRequest<{ operatingHours: OperatingDay[]; closedPeriods: ClosedPeriod[]; templates: SlotTemplate[] }>('GET', '/rms/team/schedule-setup'),
  saveHours: (days: OperatingDay[]) => apiRequest('PUT', '/rms/team/operating-hours', { days }),
  addClosed: (body: { startDate: string; endDate: string; reason?: string | null }) => apiRequest('POST', '/rms/team/closed-periods', body),
  removeClosed: (id: string) => apiRequest('DELETE', `/rms/team/closed-periods/${id}`),
  saveTemplates: (templates: SlotTemplate[]) => apiRequest('PUT', '/rms/team/slot-templates', { templates }),

  weeks: () => apiRequest<{ weeks: WeekSummary[] }>('GET', '/rms/team/weeks'),
  createWeek: (weekStart: string, options: { copyFromWeekId?: string | null; fromTemplate?: boolean } = {}) =>
    apiRequest<WeekDetail>('POST', '/rms/team/weeks', {
      weekStart,
      fromTemplate: options.fromTemplate ?? false,
      copyFromWeekId: options.copyFromWeekId ?? null,
    }),
  copyDay: (weekId: string, date: string, fromDate: string) =>
    apiRequest<WeekDetail>('POST', `/rms/team/weeks/${weekId}/days/${date}/copy-from`, { fromDate }),
  week: (id: string) => apiRequest<WeekDetail>('GET', `/rms/team/weeks/${id}`),
  updateWeek: (id: string, body: Partial<RosterWeek>) => apiRequest<WeekDetail>('PATCH', `/rms/team/weeks/${id}`, body),
  setStatus: (id: string, status: 'DRAFT' | 'APPLICATIONS_OPEN' | 'APPLICATIONS_CLOSED' | 'IN_REVIEW') =>
    apiRequest<WeekDetail>('POST', `/rms/team/weeks/${id}/status`, { status }),
  generate: (id: string) => apiRequest<WeekDetail>('POST', `/rms/team/weeks/${id}/generate`),
  publish: (id: string) => apiRequest<WeekDetail>('POST', `/rms/team/weeks/${id}/publish`),
  fillFromPicks: (id: string) =>
    apiRequest<{ added: number; leftOver: number; detail: WeekDetail }>('POST', `/rms/team/weeks/${id}/fill-from-picks`),
  deleteWeek: (id: string) => apiRequest('DELETE', `/rms/team/weeks/${id}`),
  exportWeek: (id: string) => apiRequest<RosterExport>('GET', `/rms/team/weeks/${id}/export`),

  addSlot: (weekId: string, body: SlotFields) => apiRequest<WeekDetail>('POST', `/rms/team/weeks/${weekId}/slots`, body),
  updateSlot: (id: string, body: Partial<SlotFields>) => apiRequest<WeekDetail>('PATCH', `/rms/team/slots/${id}`, body),
  removeSlot: (id: string) => apiRequest<WeekDetail>('DELETE', `/rms/team/slots/${id}`),

  assign: (slotId: string, staffId: string, isLocked = false) =>
    apiRequest<{ assignmentId: string; warnings: RosterWarning[]; detail: WeekDetail }>('POST', `/rms/team/slots/${slotId}/assignments`, {
      staffId,
      isLocked,
    }),
  updateAssignment: (
    id: string,
    body: Partial<{ isLocked: boolean; workTypeId: string | null; rateOverrideSen: number | null; rateOverrideReason: string | null }>,
  ) => apiRequest<WeekDetail>('PATCH', `/rms/team/assignments/${id}`, body),
  addBackup: (slotId: string, body: { staffId: string } & BackupTime) =>
    apiRequest<WeekDetail>('POST', `/rms/team/slots/${slotId}/backups`, body),
  setBackupTime: (assignmentId: string, body: BackupTime) =>
    apiRequest<WeekDetail>('PATCH', `/rms/team/assignments/${assignmentId}/time`, body),
  unassign: (id: string, vacancy = true) => apiRequest<WeekDetail>('DELETE', `/rms/team/assignments/${id}?vacancy=${vacancy}`),

  coverage: () => apiRequest<{ coverage: Coverage[] }>('GET', '/rms/team/coverage'),
  confirmCover: (id: string, staffId: string) => apiRequest('POST', `/rms/team/coverage/${id}/confirm`, { staffId }),
  skipCover: (id: string) => apiRequest('POST', `/rms/team/coverage/${id}/skip`),
  offerNext: (id: string) => apiRequest('POST', `/rms/team/coverage/${id}/offer-next`),
  cancelCover: (id: string) => apiRequest('POST', `/rms/team/coverage/${id}/cancel`),
}

export const payrollApi = {
  attendance: (start: string, end: string, status?: string) =>
    apiRequest<{ attendance: Attendance[] }>('GET', `/rms/team/attendance?start=${start}&end=${end}${status ? `&status=${status}` : ''}`),
  unconfirmed: (start: string, end: string) =>
    apiRequest<{ shifts: UnconfirmedShift[] }>('GET', `/rms/team/attendance/unconfirmed?start=${start}&end=${end}`),
  confirmWorked: (assignmentIds: string[]) =>
    apiRequest<{ confirmed: number }>('POST', '/rms/team/attendance/from-roster', { assignmentIds }),
  addAttendance: (body: { staffId: string; startAt: string; endAt: string; workTypeId?: string | null; note?: string | null }) =>
    apiRequest('POST', '/rms/team/attendance', body),
  editAttendance: (
    id: string,
    body: Partial<{ approvedStartAt: string; approvedEndAt: string; clockOutAt: string; workTypeId: string | null; note: string | null }>,
  ) => apiRequest('PATCH', `/rms/team/attendance/${id}`, body),
  approveAttendance: (id: string, body: { approvedStartAt?: string; approvedEndAt?: string } = {}) =>
    apiRequest('POST', `/rms/team/attendance/${id}/approve`, body),
  rejectAttendance: (id: string, note?: string) => apiRequest('POST', `/rms/team/attendance/${id}/reject`, { note }),

  periods: () => apiRequest<{ frequency: string; today: string; periods: PayPeriod[] }>('GET', '/rms/team/payroll/periods'),
  summary: (start: string, end: string) => apiRequest<{ label: string; rows: PayrollRow[] }>('GET', `/rms/team/payroll?start=${start}&end=${end}`),
  payslip: (staffId: string, start: string, end: string) =>
    apiRequest<PayslipDetail>('GET', `/rms/team/payroll/staff/${staffId}?start=${start}&end=${end}`),
  approve: (staffId: string, start: string, end: string) =>
    apiRequest<{ payslipId: string; totalSen: number }>('POST', '/rms/team/payroll/approve', { staffId, start, end }),
  unapprove: (payslipId: string) => apiRequest('POST', `/rms/team/payslips/${payslipId}/unapprove`),
  pay: (payslipId: string, paidOn?: string) =>
    apiRequest<{ replayed: boolean }>('POST', `/rms/team/payslips/${payslipId}/pay`, paidOn ? { paidOn } : {}),
  adjustments: () => apiRequest<{ adjustments: Adjustment[] }>('GET', '/rms/team/adjustments'),
  dismissAdjustment: (id: string, note: string) => apiRequest('POST', `/rms/team/adjustments/${id}/dismiss`, { note }),
}

// ---------------------------------------------------------------------------
// Time, in Malaysia
// ---------------------------------------------------------------------------

const KL = 'Asia/Kuala_Lumpur'

/** "4.5h", "5h". */
export function hoursText(minutes: number): string {
  return `${Math.round((minutes / 60) * 100) / 100}h`
}

export function dayName(date: string, style: 'short' | 'long' = 'short'): string {
  return new Intl.DateTimeFormat('en-MY', { weekday: style, day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  )
}

export function clockText(iso: string): string {
  return new Intl.DateTimeFormat('en-MY', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: KL }).format(new Date(iso))
}

export function dateTimeText(iso: string): string {
  return new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: KL,
  }).format(new Date(iso))
}

/** "17:30" → "17:30", "9:5" → "09:05": 24-hour, everywhere in Vista. */
export function timeText(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return `${String(h ?? 0).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`
}

/** `YYYY-MM-DD` + `HH:MM` in Malaysia → ISO with offset, as the API takes it. */
export function mytIso(date: string, time: string): string {
  return `${date}T${time}:00+08:00`
}

/** The Malaysia date and time of an instant, for form fields. */
export function mytParts(iso: string): { date: string; time: string } {
  const shifted = new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString()
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) }
}

export function addDaysTo(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10)
}

export function mondayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const weekday = (new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay() + 6) % 7
  return addDaysTo(date, -weekday)
}

export function todayInKl(): string {
  return mytParts(new Date().toISOString()).date
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
