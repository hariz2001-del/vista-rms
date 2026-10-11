import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Expense } from '../domain/types.ts'
import { apiRequest } from '../lib/http.ts'
import { ExpenseReceipt } from './ExpenseReceipt.tsx'

vi.mock('../lib/http.ts', () => ({ apiRequest: vi.fn() }))
const expense: Expense = { id: 'expense-1', businessDate: '2026-10-06', amountSen: 7610, category: 'RAW_MATERIALS', paidBy: 'STALL_FUNDS', brandId: null, foodSplitPct: 100, foodAmountSen: 7610, drinksAmountSen: 0, description: 'Bakery purchase', vendor: 'BFEE', receiptUrl: null, receiptDocumentId: 'receipt-1', isSettled: true, isLocked: false }
beforeEach(() => {
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:test-receipt'); static revokeObjectURL = vi.fn() })
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals() })

it('loads privately on click, offers original/scan, and releases image data on close', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ imageBase64: 'dGVzdA==', mimeType: 'image/jpeg', hasScan: true, driveUrl: 'https://drive.google.com/file/d/example/view' })
  render(<ExpenseReceipt expense={expense} />)
  expect(apiRequest).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'View receipt for Bakery purchase' }))
  await screen.findByRole('img', { name: 'Receipt from BFEE' })
  expect(apiRequest).toHaveBeenCalledWith('GET', '/rms/expenses/expense-1/receipt')
  fireEvent.click(screen.getByRole('button', { name: 'Show original photo' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('GET', '/rms/expenses/expense-1/receipt?original=true'))
  await screen.findByRole('img', { name: 'Original photo from BFEE' })
  fireEvent.click(screen.getByRole('button', { name: 'Close receipt' }))
  expect(URL.revokeObjectURL).toHaveBeenCalled()
  expect(screen.queryByRole('img')).toBeNull()
})

it('shows a failed Drive read without losing the expense screen', async () => {
  vi.mocked(apiRequest).mockRejectedValue(new Error('Google connection needs renewal.'))
  render(<ExpenseReceipt expense={expense} />)
  fireEvent.click(screen.getByRole('button', { name: 'View receipt for Bakery purchase' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Google connection needs renewal.')
  expect(screen.getByRole('button', { name: 'Close receipt' })).toBeTruthy()
})
