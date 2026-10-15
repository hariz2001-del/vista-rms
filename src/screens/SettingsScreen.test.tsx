import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { VistaStore } from '../data/store.ts'
import { SettingsScreen } from './SettingsScreen.tsx'

vi.mock('./SarangAiPanel.tsx', () => ({ SarangAiPanel: () => null }))
afterEach(cleanup)

it('toggles order pagers through the shared business settings', () => {
  const setSettings = vi.fn()
  const store = {
    settings: { businessName: 'Vista', outletName: 'Counter', settlementEnabled: false, pagerEnabled: false },
    brands: [], counterSessions: [], setSettings,
  } as unknown as VistaStore
  const { rerender } = render(<SettingsScreen store={store} />)
  const toggle = screen.getByRole('switch', { name: 'Order pagers' })
  expect(toggle).toHaveAttribute('aria-checked', 'false')
  fireEvent.click(toggle)
  expect(setSettings).toHaveBeenCalledWith({ ...store.settings, pagerEnabled: true })
  const enabled = { ...store, settings: { ...store.settings, pagerEnabled: true } }
  rerender(<SettingsScreen store={enabled} />)
  fireEvent.click(screen.getByRole('switch', { name: 'Order pagers' }))
  expect(setSettings).toHaveBeenLastCalledWith(store.settings)
})
