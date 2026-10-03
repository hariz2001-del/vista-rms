import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../lib/http.ts'

/**
 * The Team module's calls (api-vista src/routes/team-rms.ts). Management only:
 * the confidential attributes come back here and nowhere else.
 */

export type StaffStatus = 'ACTIVE' | 'INACTIVE'
export type SoloSuitability = 'SUITABLE' | 'CAUTION' | 'NOT_RECOMMENDED'
export type TrainingStatus = 'TRAINEE' | 'TRAINED'

export type StaffAttributes = {
  reliability: number | null
  capability: number | null
  experience: number | null
  soloSuitability: SoloSuitability
  trainingStatus: TrainingStatus
  managementPriority: number
  notes: string | null
  extra: Record<string, unknown>
}

export type Staff = {
  id: string
  name: string
  staffCode: string
  status: StaffStatus
  defaultWorkTypeId: string | null
  roleTags: string[]
  hasPin: boolean
  pinSetAt: string | null
  createdAt: string
  /** Absent entirely for a session not allowed to see it. */
  attributes?: StaffAttributes | null
}

export type WorkType = {
  id: string
  name: string
  rateSenPerHour: number
  description: string | null
  isActive: boolean
}

export type TeamSettings = {
  applicationLimit: number
  assignmentTargetShifts: number
  assignmentMaxShifts: number
  assignmentMaxMinutes: number
  withdrawalDeadlineHours: number
  urgentCoverageHours: number
  payRoundingMinutes: number
  payRoundingMode: 'FLOOR' | 'NEAREST'
  payFrequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'CUSTOM'
  payAnchorDate: string
  paydayOffsetDays: number
  engineWeights: Record<string, number>
  orgCode: string | null
}

export type AuditEntry = {
  id: number
  actorKind: string
  actorLabel: string
  action: string
  entityType: string
  entityId: string | null
  before: unknown
  after: unknown
  createdAt: string
}

export const teamApi = {
  listStaff: () => apiRequest<{ staff: Staff[] }>('GET', '/rms/team/staff'),
  createStaff: (body: {
    name: string
    staffCode?: string | null
    defaultWorkTypeId?: string | null
    roleTags?: string[]
  }) => apiRequest<{ staff: Staff; pin: string }>('POST', '/rms/team/staff', body),
  updateStaff: (id: string, body: Partial<Pick<Staff, 'name' | 'staffCode' | 'status' | 'defaultWorkTypeId' | 'roleTags'>>) =>
    apiRequest<{ staff: Staff }>('PATCH', `/rms/team/staff/${id}`, body),
  saveAttributes: (id: string, body: Partial<StaffAttributes>) =>
    apiRequest<{ staff: Staff }>('PUT', `/rms/team/staff/${id}/attributes`, body),
  viewPin: (id: string) => apiRequest<{ pin: string | null; viewable: boolean }>('GET', `/rms/team/staff/${id}/pin`),
  resetPin: (id: string, pin?: string) =>
    apiRequest<{ pin: string }>('POST', `/rms/team/staff/${id}/pin`, pin ? { pin } : {}),

  listWorkTypes: () => apiRequest<{ workTypes: WorkType[] }>('GET', '/rms/team/work-types'),
  createWorkType: (body: { name: string; rateSenPerHour: number; description?: string | null }) =>
    apiRequest<{ workType: WorkType }>('POST', '/rms/team/work-types', body),
  updateWorkType: (id: string, body: Partial<Omit<WorkType, 'id'>>) =>
    apiRequest<{ workType: WorkType }>('PATCH', `/rms/team/work-types/${id}`, body),

  getSettings: () => apiRequest<{ settings: TeamSettings }>('GET', '/rms/team/settings'),
  saveSettings: (body: Partial<TeamSettings>) =>
    apiRequest<{ settings: TeamSettings }>('PUT', '/rms/team/settings', body),

  audit: (params: { entityType?: string; entityId?: string; before?: number } = {}) => {
    const query = new URLSearchParams(
      Object.entries(params)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    ).toString()
    return apiRequest<{ entries: AuditEntry[] }>('GET', `/rms/team/audit${query ? `?${query}` : ''}`)
  },
}

/**
 * Load something once, with a way to load it again after a change. Errors
 * are kept as text for the screen to show; a failed reload keeps the last data.
 */
export function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    load()
      .then((result) => {
        if (cancelled) return
        setData(result)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load.')
      })
    return () => {
      cancelled = true
    }
    // `load` is a stable module function at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  return { data, error, reload, setData }
}

export function errorText(caught: unknown, fallback = 'That did not save. Try again.'): string {
  return caught instanceof Error ? caught.message : fallback
}
