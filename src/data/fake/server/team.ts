import type { StaffAttributes, TeamSettings } from '../../team-api.ts'
import {
  audit,
  badRequest,
  conflict,
  demoOnly,
  has,
  MANAGEMENT,
  newId,
  notFound,
  num,
  optStr,
  str,
  type Ctx,
  type DemoServerState,
  type Route,
  type StaffRow,
} from './state.ts'

/**
 * Staff, PINs, work types, settings and the audit trail — api-vista
 * src/routes/team-rms.ts. The demo session is the owner, so the confidential
 * attributes always come back.
 */

export function serialiseStaff(staff: StaffRow) {
  return {
    id: staff.id,
    name: staff.name,
    staffCode: staff.staffCode,
    status: staff.status,
    defaultWorkTypeId: staff.defaultWorkTypeId,
    roleTags: staff.roleTags,
    hasPin: staff.pin !== null,
    pinSetAt: staff.pinSetAt,
    createdAt: staff.createdAt,
    attributes: staff.attributes,
  }
}

export function requireStaff(state: DemoServerState, id: string): StaffRow {
  return state.staff.find((staff) => staff.id === id) ?? notFound('team:STAFF_NOT_FOUND')
}

function assertWorkType(state: DemoServerState, id: unknown): void {
  if (id && !state.workTypes.some((type) => type.id === id)) badRequest('team:WORK_TYPE_NOT_FOUND')
}

function nextStaffCode(state: DemoServerState): string {
  const taken = new Set(state.staff.map((staff) => staff.staffCode))
  for (let n = state.staff.length + 1; ; n += 1) {
    const code = `S${n.toString().padStart(3, '0')}`
    if (!taken.has(code)) return code
  }
}

/** A random PIN nobody else has: a PIN is the whole sign-in. */
export function uniquePin(state: DemoServerState, staffId: string | null): string {
  const taken = new Set(state.staff.filter((staff) => staff.id !== staffId).map((staff) => staff.pin))
  for (let tries = 0; tries < 200; tries += 1) {
    const pin = Math.floor(Math.random() * 10_000).toString().padStart(4, '0')
    if (!taken.has(pin)) return pin
  }
  return conflict('team:PIN_TAKEN')
}

function roleTags(value: unknown): string[] {
  if (!Array.isArray(value)) return badRequest('demo:INVALID')
  return [...new Set(value.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))]
}

function staffCode(value: unknown, state: DemoServerState, except: string | null): string {
  if (typeof value !== 'string' || !value.trim()) return badRequest('demo:INVALID')
  const code = value.trim().toUpperCase()
  if (state.staff.some((staff) => staff.id !== except && staff.staffCode === code)) conflict('team:STAFF_CODE_TAKEN')
  return code
}

const pick = (staff: StaffRow) => ({
  name: staff.name,
  staffCode: staff.staffCode,
  status: staff.status,
  defaultWorkTypeId: staff.defaultWorkTypeId,
  roleTags: staff.roleTags,
})

export function createStaff(ctx: Ctx) {
  const { state, body } = ctx
  const name = str(body, 'name')
  assertWorkType(state, body.defaultWorkTypeId)
  const staff: StaffRow = {
    id: newId(state),
    name,
    staffCode: body.staffCode ? staffCode(body.staffCode, state, null) : nextStaffCode(state),
    status: 'ACTIVE',
    defaultWorkTypeId: (body.defaultWorkTypeId as string | null | undefined) ?? null,
    roleTags: body.roleTags === undefined ? [] : roleTags(body.roleTags),
    pin: null,
    pinSetAt: null,
    createdAt: ctx.now.toISOString(),
    attributes: null,
  }
  state.staff.push(staff)
  const pin = uniquePin(state, staff.id)
  staff.pin = pin
  staff.pinSetAt = ctx.now.toISOString()
  audit(ctx, MANAGEMENT, { action: 'staff.created', entityType: 'staff', entityId: staff.id, after: { name: staff.name, staffCode: staff.staffCode } })
  return { staff: serialiseStaff(staff), pin }
}

function updateStaff(ctx: Ctx) {
  const { state, body } = ctx
  const staff = requireStaff(state, ctx.params.id ?? '')
  const before = pick(staff)
  if (has(body, 'defaultWorkTypeId')) assertWorkType(state, body.defaultWorkTypeId)
  if (has(body, 'name')) staff.name = str(body, 'name')
  if (has(body, 'staffCode')) staff.staffCode = staffCode(body.staffCode, state, staff.id)
  if (has(body, 'status')) {
    if (body.status !== 'ACTIVE' && body.status !== 'INACTIVE') badRequest('demo:INVALID')
    staff.status = body.status as StaffRow['status']
  }
  if (has(body, 'defaultWorkTypeId')) staff.defaultWorkTypeId = (body.defaultWorkTypeId as string | null) ?? null
  if (has(body, 'roleTags')) staff.roleTags = roleTags(body.roleTags)
  audit(ctx, MANAGEMENT, {
    action: has(body, 'status') && body.status !== before.status ? `staff.${staff.status.toLowerCase()}` : 'staff.updated',
    entityType: 'staff',
    entityId: staff.id,
    before,
    after: pick(staff),
  })
  return { staff: serialiseStaff(staff) }
}

/** Only for someone with no hours or pay on record; their shifts go with them. */
function deleteStaff(ctx: Ctx) {
  const { state } = ctx
  const staff = requireStaff(state, ctx.params.id ?? '')
  const id = staff.id
  const history =
    state.attendance.some((row) => row.staffId === id) ||
    state.payslips.some((row) => row.staffId === id) ||
    state.adjustments.some((row) => row.staffId === id)
  if (history) conflict('team:STAFF_HAS_HISTORY')

  const assignments = state.assignments.filter((row) => row.staffId === id)
  const assignmentIds = new Set(assignments.map((row) => row.id))
  for (const request of state.coverage) {
    if (request.vacatedAssignmentId && assignmentIds.has(request.vacatedAssignmentId)) request.vacatedAssignmentId = null
  }
  state.assignments = state.assignments.filter((row) => row.staffId !== id)
  state.offers = state.offers.filter((row) => row.staffId !== id)
  state.applications = state.applications.filter((row) => row.staffId !== id)
  state.staff = state.staff.filter((row) => row.id !== id)
  const weekIds = new Set(assignments.map((row) => state.slots.find((slot) => slot.id === row.slotId)?.weekId))
  for (const week of state.weeks) if (weekIds.has(week.id)) week.version += 1
  audit(ctx, MANAGEMENT, {
    action: 'staff.deleted',
    entityType: 'staff',
    entityId: id,
    before: { name: staff.name, staffCode: staff.staffCode, shiftsRemoved: assignments.length },
  })
  return { ok: true }
}

const DEFAULT_ATTRIBUTES: StaffAttributes = {
  reliability: null,
  capability: null,
  experience: null,
  soloSuitability: 'SUITABLE',
  trainingStatus: 'TRAINED',
  managementPriority: 0,
  notes: null,
  extra: {},
}

function saveAttributes(ctx: Ctx) {
  const staff = requireStaff(ctx.state, ctx.params.id ?? '')
  const before = staff.attributes
  const next = { ...(staff.attributes ?? DEFAULT_ATTRIBUTES) }
  for (const key of Object.keys(DEFAULT_ATTRIBUTES) as Array<keyof StaffAttributes>) {
    if (has(ctx.body, key)) (next as Record<string, unknown>)[key] = ctx.body[key]
  }
  staff.attributes = next
  audit(ctx, MANAGEMENT, { action: 'staff.attributes_changed', entityType: 'staff', entityId: staff.id, before, after: next })
  return { staff: serialiseStaff(staff) }
}

function resetPin(ctx: Ctx) {
  const { state, body } = ctx
  const staff = requireStaff(state, ctx.params.id ?? '')
  const typed = optStr(body, 'pin')
  if (typed && !/^\d{4}$/.test(typed)) badRequest('demo:INVALID')
  if (typed && state.staff.some((other) => other.id !== staff.id && other.pin === typed)) conflict('team:PIN_TAKEN')
  const pin = typed ?? uniquePin(state, staff.id)
  staff.pin = pin
  staff.pinSetAt = ctx.now.toISOString()
  audit(ctx, MANAGEMENT, { action: typed ? 'staff.pin_set' : 'staff.pin_reset', entityType: 'staff', entityId: staff.id })
  return { pin }
}

function viewPin(ctx: Ctx) {
  const staff = requireStaff(ctx.state, ctx.params.id ?? '')
  if (staff.pin) audit(ctx, MANAGEMENT, { action: 'staff.pin_viewed', entityType: 'staff', entityId: staff.id })
  return { pin: staff.pin, viewable: staff.pin !== null }
}

function createWorkType(ctx: Ctx) {
  const { state, body } = ctx
  const name = str(body, 'name')
  if (state.workTypes.some((type) => type.name === name)) conflict('team:WORK_TYPE_NAME_TAKEN')
  const workType = {
    id: newId(state),
    name,
    rateSenPerHour: Math.round(num(body, 'rateSenPerHour')),
    description: optStr(body, 'description') ?? null,
    isActive: true,
  }
  state.workTypes.push(workType)
  audit(ctx, MANAGEMENT, { action: 'work_type.created', entityType: 'work_type', entityId: workType.id, after: workType })
  return { workType }
}

/** A new rate applies to pay not yet approved; approved payslips keep theirs. */
function updateWorkType(ctx: Ctx) {
  const { state, body } = ctx
  const workType = state.workTypes.find((type) => type.id === ctx.params.id) ?? notFound('team:WORK_TYPE_NOT_FOUND')
  const before = { ...workType }
  if (has(body, 'name')) {
    const name = str(body, 'name')
    if (state.workTypes.some((type) => type.id !== workType.id && type.name === name)) conflict('team:WORK_TYPE_NAME_TAKEN')
    workType.name = name
  }
  if (has(body, 'rateSenPerHour')) workType.rateSenPerHour = Math.round(num(body, 'rateSenPerHour'))
  if (has(body, 'description')) workType.description = optStr(body, 'description') ?? null
  if (has(body, 'isActive')) workType.isActive = Boolean(body.isActive)
  audit(ctx, MANAGEMENT, { action: 'work_type.changed', entityType: 'work_type', entityId: workType.id, before, after: workType })
  return { workType }
}

const SETTING_KEYS: Array<keyof TeamSettings> = [
  'applicationLimit',
  'assignmentTargetShifts',
  'assignmentMaxShifts',
  'assignmentMaxMinutes',
  'withdrawalDeadlineHours',
  'urgentCoverageHours',
  'payRoundingMinutes',
  'payRoundingMode',
  'payFrequency',
  'payAnchorDate',
  'paydayOffsetDays',
  'engineWeights',
  'orgCode',
]

function saveSettings(ctx: Ctx) {
  const { state, body } = ctx
  const before = { ...state.settings }
  const next = { ...state.settings }
  for (const key of SETTING_KEYS) if (has(body, key)) (next as Record<string, unknown>)[key] = body[key]
  if (typeof next.orgCode === 'string') {
    next.orgCode = next.orgCode.trim().toUpperCase()
    if (!/^[A-Z0-9]{4,16}$/.test(next.orgCode)) badRequest('demo:INVALID')
  }
  if (next.assignmentMaxShifts < next.assignmentTargetShifts) badRequest('team:TARGET_ABOVE_MAX')
  state.settings = next
  audit(ctx, MANAGEMENT, { action: 'team_settings.changed', entityType: 'team_settings', before, after: next })
  return { settings: next }
}

function auditTrail(ctx: Ctx) {
  const { query } = ctx
  const before = Number(query.get('before') ?? 0)
  const limit = Math.min(200, Math.max(1, Number(query.get('limit') ?? 100)))
  const entries = ctx.state.audit
    .filter(
      (entry) =>
        (!query.get('entityType') || entry.entityType === query.get('entityType')) &&
        (!query.get('entityId') || entry.entityId === query.get('entityId')) &&
        (!before || entry.id < before),
    )
    .toSorted((a, b) => b.id - a.id)
    .slice(0, limit)
  return { entries }
}

export const teamRoutes: Route[] = [
  [
    'GET',
    '/rms/team/staff',
    ({ state }) => ({
      staff: state.staff
        .toSorted((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'ACTIVE' ? -1 : 1))
        .map(serialiseStaff),
    }),
  ],
  ['POST', '/rms/team/staff', createStaff],
  ['PATCH', '/rms/team/staff/:id', updateStaff],
  ['DELETE', '/rms/team/staff/:id', deleteStaff],
  ['PUT', '/rms/team/staff/:id/attributes', saveAttributes],
  ['POST', '/rms/team/staff/:id/pin', resetPin],
  ['GET', '/rms/team/staff/:id/pin', viewPin],
  [
    'POST',
    '/rms/team/staff/:id/view',
    () => demoOnly('The staff app preview needs a live business account. Sign up at vistahub.my to try it with your own team.'),
  ],
  [
    'GET',
    '/rms/team/work-types',
    ({ state }) => ({
      workTypes: state.workTypes.toSorted((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name)),
    }),
  ],
  ['POST', '/rms/team/work-types', createWorkType],
  ['PATCH', '/rms/team/work-types/:id', updateWorkType],
  ['GET', '/rms/team/settings', ({ state }) => ({ settings: state.settings })],
  ['PUT', '/rms/team/settings', saveSettings],
  ['GET', '/rms/team/audit', auditTrail],
]
