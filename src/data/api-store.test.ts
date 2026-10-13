import { act, renderHook, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '../lib/http.ts'
import { useApiStore } from './api-store.ts'

vi.mock('../lib/http.ts', () => ({ apiRequest: vi.fn(),
  ApiError: class extends Error {}, SessionExpiredError: class extends Error {} }))
const request = vi.mocked(apiRequest)
const snapshot = { businessDate: '2026-10-13', settings: {}, brands: [], categories: [],
  products: [], partners: [], shifts: [], orders: [], corrections: [], ledger: [],
  expenses: [], closures: [], terminal: {}, counterSessions: [], promotions: [] }
let version = 'v1'
let visibility = 'visible'
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const calls = (path: string) => request.mock.calls.filter(c => c[1] === path).length

beforeEach(() => {
  vi.useFakeTimers(); request.mockReset(); version = 'v1'; visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility as DocumentVisibilityState)
  request.mockImplementation(async (_method, path) => path === '/rms/state'
    ? { revision: version, businessDate: snapshot.businessDate, terminal: {}, counterSessions: [] }
    : snapshot)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('low-egress RMS refresh', () => {
  it('loads history once and does not download unchanged books again', async () => {
    renderHook(() => useApiStore(true)); await flush()
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })
    expect(calls('/rms/state')).toBe(21)
    expect(calls('/rms/snapshot')).toBe(1)
  })
  it('reloads books when the server revision changes', async () => {
    renderHook(() => useApiStore(true)); await flush(); version = 'v2'
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(calls('/rms/snapshot')).toBe(2)
  })
  it('stops hidden polling and checks immediately on return', async () => {
    renderHook(() => useApiStore(true)); await flush(); visibility = 'hidden'
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })
    expect(calls('/rms/state')).toBe(1)
    visibility = 'visible'; version = 'v2'
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(calls('/rms/snapshot')).toBe(2)
  })
  it('does not poll after sign-out', async () => {
    const { rerender } = renderHook(({ enabled }) => useApiStore(enabled), { initialProps: { enabled: true } })
    await flush(); rerender({ enabled: false })
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(calls('/rms/state')).toBe(1)
  })
  it('forces a fresh snapshot after an owner action even with the same revision', async () => {
    const { result } = renderHook(() => useApiStore(true)); await flush()
    await act(async () => { result.current.addExpense({} as never) })
    await flush()
    expect(calls('/rms/expenses')).toBe(1)
    expect(calls('/rms/snapshot')).toBe(2)
  })
  it('never overlaps polls when the network is slow', async () => {
    let release!: (value: unknown) => void
    request.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    renderHook(() => useApiStore(true)); await flush()
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(calls('/rms/state')).toBe(1)
    await act(async () => { release({ revision: version, businessDate: snapshot.businessDate, terminal: {}, counterSessions: [] }) })
    expect(calls('/rms/snapshot')).toBe(1)
  })
})
