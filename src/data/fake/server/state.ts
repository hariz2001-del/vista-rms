import { ApiError } from '../../../lib/http.ts'
import type { StockCountLine, StockItem } from '../../stock-api.ts'
import type { AuditEntry, StaffAttributes, TeamSettings, WorkType } from '../../team-api.ts'
import type { ClosedPeriod, OperatingDay, SlotTemplate, WeekStatus } from '../../roster-api.ts'

/**
 * The demo's Team and Stock records, laid out like api-vista's tables so the
 * fake routes can follow the real ones line for line. Instants are ISO
 * strings, dates `YYYY-MM-DD`. Array order is creation order.
 */

export type StaffRow = {
  id: string
  name: string
  staffCode: string
  status: 'ACTIVE' | 'INACTIVE'
  defaultWorkTypeId: string | null
  roleTags: string[]
  /** Kept in the clear: there is nothing to protect in a demo. */
  pin: string | null
  pinSetAt: string | null
  createdAt: string
  attributes: StaffAttributes | null
}

export type WeekRow = {
  id: string
  weekStart: string
  status: WeekStatus
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

export type SlotRow = {
  id: string
  weekId: string
  startsAt: string
  endsAt: string
  requiredStaff: number
  canRunSolo: boolean
  roleTags: string[]
  workTypeId: string | null
  label: string | null
  allowsBackup: boolean
}

export type ApplicationRow = { slotId: string; staffId: string; createdAt: string }

export type AssignmentRow = {
  id: string
  slotId: string
  staffId: string
  status: 'ACTIVE' | 'WITHDRAWN' | 'REMOVED'
  source: 'AUTO' | 'MANUAL' | 'REPLACEMENT'
  isLocked: boolean
  workTypeId: string | null
  rateOverrideSen: number | null
  rateOverrideReason: string | null
  explanation: string | null
  isBackup: boolean
  hoursOnly: boolean
  /** A backup's own times; null means the slot's. */
  startsAt: string | null
  endsAt: string | null
  createdAt: string
  endedAt: string | null
}

export type CoverageRow = {
  id: string
  slotId: string
  vacatedAssignmentId: string | null
  isUrgent: boolean
  status: 'OPEN' | 'FILLED' | 'CANCELLED'
  createdAt: string
  resolvedAt: string | null
}

export type OfferRow = {
  id: string
  coverageId: string
  staffId: string
  rank: number
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'MANAGER_SKIPPED' | 'MANAGER_CONFIRMED' | 'SUPERSEDED'
  respondedAt: string | null
}

export type AttendanceRow = {
  id: string
  staffId: string
  assignmentId: string | null
  clockInAt: string
  clockOutAt: string | null
  approvedStartAt: string | null
  approvedEndAt: string | null
  workTypeId: string | null
  note: string | null
  source: 'TEAM_APP' | 'MANUAL'
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  approvedAt: string | null
  version: number
}

export type StoredLine = {
  kind: 'ATTENDANCE' | 'ADJUSTMENT'
  attendanceId: string | null
  adjustmentId: string | null
  workDate: string
  clockInAt: string | null
  clockOutAt: string | null
  minutes: number
  workTypeName: string
  rateSenPerHour: number
  amountSen: number
  description: string | null
}

export type PayslipRow = {
  id: string
  staffId: string
  periodStart: string
  periodEnd: string
  status: 'APPROVED' | 'PAID'
  totalMinutes: number
  totalSen: number
  approvedAt: string
  paidAt: string | null
  paidOn: string | null
  lines: StoredLine[]
}

export type AdjustmentRow = {
  id: string
  staffId: string
  attendanceId: string | null
  causePayslipId: string | null
  includedInPayslipId: string | null
  amountSen: number
  minutesDelta: number
  reason: string
  status: 'OPEN' | 'INCLUDED' | 'DISMISSED'
  resolvedNote: string | null
  resolvedAt: string | null
  createdAt: string
}

export type StockItemRow = StockItem & { createdAt: string }

export type StockCountRow = {
  id: string
  businessDate: string
  submittedAt: string
  branchName: string
  staffName: string
  remarks: string | null
  lines: StockCountLine[]
}

export type DemoServerState = {
  /** Bumped for every new id, so ids are stable for the same demo. */
  seq: number
  settings: TeamSettings
  workTypes: WorkType[]
  staff: StaffRow[]
  hours: OperatingDay[]
  closed: ClosedPeriod[]
  templates: Array<SlotTemplate & { id: string }>
  weeks: WeekRow[]
  slots: SlotRow[]
  applications: ApplicationRow[]
  assignments: AssignmentRow[]
  coverage: CoverageRow[]
  offers: OfferRow[]
  attendance: AttendanceRow[]
  payslips: PayslipRow[]
  adjustments: AdjustmentRow[]
  audit: AuditEntry[]
  stockItems: StockItemRow[]
  stockCounts: StockCountRow[]
}

/** What every fake route gets: the records, the clock, and the request. */
export type Ctx = {
  state: DemoServerState
  now: Date
  params: Record<string, string>
  query: URLSearchParams
  body: Record<string, unknown>
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
/** `[method, '/rms/team/staff/:id', handler]` */
export type Route = [Method, string, (ctx: Ctx) => unknown]

/** A UUID-shaped id, counted up, so the same demo always has the same ids. */
export function newId(state: DemoServerState): string {
  state.seq += 1
  return `00000000-0000-4000-8000-${state.seq.toString(16).padStart(12, '0')}`
}

// The server's own wording (api-vista src/errors.ts) for the codes these routes use.
const MESSAGES: Record<string, string> = {
  'menu:BRAND_NOT_FOUND': 'That brand no longer exists.',
  'rms:PERIOD_LOCKED': 'That date falls in a period that has already been settled.',
  'stock:ITEM_NOT_FOUND': 'That stock item no longer exists.',
  'stock:COUNT_NOT_FOUND': 'That stock count no longer exists.',
  'stock:ORDER_MISMATCH': 'The stock list changed while you were arranging it. It has been reloaded — try again.',
  'team:PIN_TAKEN': 'Another staff member already has that PIN. Pick a different one, or leave it blank for a random one.',
  'team:STAFF_NOT_FOUND': 'That staff member no longer exists.',
  'team:STAFF_HAS_HISTORY':
    'They have hours or pay on record, so they cannot be deleted. Deactivate them instead — their history stays and they can no longer sign in.',
  'team:STAFF_CODE_TAKEN': 'Another staff member already has that Staff ID.',
  'team:WORK_TYPE_NOT_FOUND': 'That work type no longer exists.',
  'team:WORK_TYPE_NAME_TAKEN': 'A work type with that name already exists.',
  'team:TARGET_ABOVE_MAX': 'The usual number of shifts cannot be more than the maximum.',
  'team:NOT_FOUND': 'That no longer exists.',
  'team:RANGE_BACKWARDS': 'The end date must be on or after the start date.',
  'team:TIMES_BACKWARDS': 'The end time must be after the start time.',
  'team:WEEK_NOT_FOUND': 'That roster week no longer exists.',
  'team:WEEK_NOT_MONDAY': 'A roster week starts on a Monday.',
  'team:WEEK_EXISTS': 'There is already a roster for that week.',
  'team:WEEK_PUBLISHED': 'This roster is published. Change it shift by shift, or move it back to review first.',
  'team:DATE_OUTSIDE_WEEK': 'That date is not in this roster week.',
  'team:HAS_ATTENDANCE': 'Someone has already clocked in against this, so it cannot be deleted.',
  'team:SHIFT_NOT_FOUND': 'That shift no longer exists.',
  'team:ASSIGNMENT_NOT_FOUND': 'That shift assignment no longer exists.',
  'team:ALREADY_ASSIGNED': 'They are already on this shift.',
  'team:STAFF_INACTIVE': 'That staff member is deactivated.',
  'team:COVERAGE_NOT_FOUND': 'That cover request no longer exists.',
  'team:COVERAGE_CLOSED': 'That shift has already been covered or the request was cancelled.',
  'team:BACKUP_NOT_ALLOWED': 'This shift does not take backup staff. Edit the shift and tick Allow backup staff.',
  'team:BACKUP_TOO_LONG': 'A backup can be on a shift for 16 hours at most.',
  'team:NOT_A_BACKUP': 'Only a backup has their own times on a shift.',
  'team:ATTENDANCE_NOT_FOUND': 'That attendance record no longer exists.',
  'team:NO_CLOCK_OUT': 'Set an end time before approving.',
  'team:NO_RATE': 'Some approved time has no work type or rate. Give the person a usual work type, or set one on the record.',
  'team:NOTHING_TO_PAY': 'There is no approved time to pay for in this period.',
  'team:PAYSLIP_EXISTS': 'This period already has a payslip for them.',
  'team:PAYSLIP_NOT_FOUND': 'That payslip no longer exists.',
  'team:PAYSLIP_PAID': 'That payslip is paid and cannot change. Use an adjustment instead.',
  'team:ADJUSTMENT_CLOSED': 'That adjustment has already been settled.',
  'team:ORG_CODE_TAKEN': 'Another workplace already uses that code. Pick a different one.',
  'demo:INVALID': 'Something in that form is not right. Check it and try again.',
  'demo:NOT_FOUND': 'The demo does not have that.',
}

/** A refusal, as the real server would send it. */
export function fail(code: string, status: number): never {
  throw new ApiError(code, MESSAGES[code] ?? 'The server could not complete that.', status)
}

export const badRequest = (code: string): never => fail(code, 400)
export const notFound = (code: string): never => fail(code, 404)
export const conflict = (code: string): never => fail(code, 409)

/** Things only a live business account can do, said plainly. */
export function demoOnly(message: string): never {
  throw new ApiError('demo:NOT_AVAILABLE', message, 409)
}

export type Actor = { kind: 'OWNER' | 'MANAGER' | 'STAFF' | 'SYSTEM'; label: string }
export const MANAGEMENT: Actor = { kind: 'OWNER', label: 'Management' }
export const SYSTEM: Actor = { kind: 'SYSTEM', label: 'System' }

/** One line on the Team audit trail, newest id highest. */
export function audit(
  ctx: Pick<Ctx, 'state' | 'now'>,
  actor: Actor,
  input: { action: string; entityType: string; entityId?: string | null; before?: unknown; after?: unknown },
): void {
  const snapshot = (value: unknown) => (value === undefined || value === null ? null : (JSON.parse(JSON.stringify(value)) as unknown))
  const last = ctx.state.audit.at(-1)?.id ?? 0
  ctx.state.audit.push({
    id: last + 1,
    actorKind: actor.kind,
    actorLabel: actor.label,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    before: snapshot(input.before),
    after: snapshot(input.after),
    createdAt: ctx.now.toISOString(),
  })
}

// Small readers for request bodies. The screens send well-formed bodies; these
// only stop a bad one turning into a half-made record.

export function str(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || value.trim() === '') return badRequest('demo:INVALID')
  return value.trim()
}

export function optStr(body: Record<string, unknown>, key: string): string | null | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') return badRequest('demo:INVALID')
  return value.trim() === '' ? null : value.trim()
}

export function num(body: Record<string, unknown>, key: string): number {
  const value = body[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) return badRequest('demo:INVALID')
  return value
}

export function has(body: Record<string, unknown>, key: string): boolean {
  return body[key] !== undefined
}

export const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
