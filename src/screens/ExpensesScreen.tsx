import { HandCoins, Pencil, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { DateRangePicker } from '../components/DateRangePicker.tsx'
import { CATEGORIES, ExpenseForm, PAYMENT_METHODS } from '../components/ExpenseForm.tsx'
import { Badge, Money, Panel, SectionHeading } from '../components/primitives.tsx'
import type { VistaStore } from '../data/store.ts'
import { formatQuantity } from '../domain/expense-items.ts'
import { formatRinggit } from '../domain/money.ts'
import { formatDate, inRange, monthOf, type DateRange } from '../domain/selectors.ts'
import type { Expense, ExpenseCategory, PaymentMethod } from '../domain/types.ts'

// Wages are not in the form's list: they are written by paying a payslip.
const CATEGORY_LABEL = {
  ...Object.fromEntries(CATEGORIES.map((category) => [category.value, category.label])),
  WAGES: 'Staff wages',
} as Record<ExpenseCategory, string>

const METHOD_LABEL = Object.fromEntries(
  PAYMENT_METHODS.map((method) => [method.value, method.label]),
) as Record<PaymentMethod, string>

/** Wages belong to their payslip, and a settled period is frozen. */
function canChange(expense: Expense): boolean {
  return !expense.isLocked && expense.category !== 'WAGES'
}

/** A partner already paid back for it: the payment happened, so it stays. */
function isReimbursedAdvance(expense: Expense): boolean {
  return expense.paidBy !== 'STALL_FUNDS' && expense.isSettled
}

export function ExpensesScreen({ store }: { store: VistaStore }) {
  const foodBrand = store.brands[0]
  const drinksBrand = store.brands[1]
  // Without partner settlement there is nobody to owe and nothing to split:
  // every cost is paid from the business's own funds, whole.
  const withSettlement = store.settings.settlementEnabled && drinksBrand !== undefined

  const [range, setRange] = useState<DateRange>(() => ({
    startDate: `${monthOf(store.today)}-01`,
    endDate: store.today,
  }))

  const visible = useMemo(
    () =>
      inRange(store.expenses, range.startDate, range.endDate).toSorted((a, b) =>
        b.businessDate.localeCompare(a.businessDate),
      ),
    [store.expenses, range],
  )

  const total = visible.reduce((sum, expense) => sum + expense.amountSen, 0)

  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = store.expenses.find((expense) => expense.id === editingId)
  const formTop = useRef<HTMLDivElement>(null)

  function startEditing(expense: Expense) {
    setEditingId(expense.id)
    formTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function remove(expense: Expense) {
    const what = `${expense.vendor ? `${expense.vendor} · ` : ''}${expense.description}`
    const cash =
      expense.paidBy === 'STALL_FUNDS' ? ' Its money goes back into the cashflow balance.' : ''
    if (window.confirm(`Delete "${what}" (${formatRinggit(expense.amountSen)})?${cash}`)) {
      if (editingId === expense.id) setEditingId(null)
      store.deleteExpense(expense.id)
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="border-b border-line pb-5">
        <p className="page-kicker">Spending / new entry</p>
        <h1 className="mt-1 text-3xl sm:text-[2.65rem]">Expenses</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          {withSettlement
            ? 'Log what the stall spends, receipt by receipt. Only stall funds move the cashflow balance — a partner paying out of pocket creates a debt instead.'
            : 'Log what the business spends, receipt by receipt. Every cost comes out of the cashflow balance.'}
        </p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Panel className="scroll-mt-4 p-4 sm:p-5">
          <div ref={formTop} />
          {editing ? (
            <SectionHeading
              title="Edit expense"
              hint={
                isReimbursedAdvance(editing)
                  ? 'The partner has been paid back for this, so who paid and the amount stay as they are.'
                  : 'Saving replaces the entry. Any change to the money is corrected in the cashflow book.'
              }
            />
          ) : (
            <SectionHeading
              title="Log a receipt"
              hint="Amount and what it was are all that is required. The rest makes the books easy to check later."
            />
          )}
          <ExpenseForm
            key={editing?.id ?? 'new'}
            today={store.today}
            brands={store.brands}
            withSettlement={withSettlement}
            sharedFoodPct={store.settings.sharedOverheadFoodPct}
            equipmentFoodPct={store.settings.capitalAssetFoodPct}
            onLog={(input) =>
              editing ? store.updateExpense(editing.id, input) : store.addExpense(input)
            }
            editing={editing}
            onCancel={() => setEditingId(null)}
          />
        </Panel>

        <Panel>
          <div className="mb-3 space-y-3">
            <SectionHeading title="Logged" />
            <DateRangePicker value={range} onChange={setRange} today={store.today} showSummary />
          </div>

          <p className="mb-3 text-sm font-bold text-muted">
            {visible.length} entries · <span className="tabular">{formatRinggit(total)}</span>
          </p>

          <ul className="divide-y divide-slate-100">
            {visible.map((expense) => {
              const items = expense.items ?? []
              const hasDetail = items.length > 0 || Boolean(expense.notes)
              return (
                <li
                  key={expense.id}
                  className={`py-3 ${expense.id === editingId ? '-mx-2 bg-canvas px-2' : ''}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-black text-ink">
                        {expense.vendor ? `${expense.vendor} · ` : ''}
                        {expense.description}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-2 text-xs font-semibold text-muted">
                        <span>
                          {formatDate(expense.businessDate)}
                          {expense.receiptTime ? `, ${expense.receiptTime}` : ''}
                        </span>
                        <span>·</span>
                        <span>{CATEGORY_LABEL[expense.category] ?? expense.category}</span>
                        {withSettlement ? (
                          <>
                            <span>·</span>
                            <span>
                              {expense.brandId === null
                                ? `Shared ${expense.foodSplitPct}/${100 - expense.foodSplitPct}`
                                : (store.brands.find((b) => b.id === expense.brandId)?.name ?? '—')}
                            </span>
                          </>
                        ) : null}
                        {expense.paymentMethod ? (
                          <>
                            <span>·</span>
                            <span>{METHOD_LABEL[expense.paymentMethod]}</span>
                          </>
                        ) : null}
                        {expense.receiptNo ? (
                          <>
                            <span>·</span>
                            <span>No. {expense.receiptNo}</span>
                          </>
                        ) : null}
                      </p>
                    </div>

                    {expense.category === 'CAPITAL_ASSET' ? <Badge tone="info">Equipment</Badge> : null}

                    {expense.paidBy !== 'STALL_FUNDS' && !expense.isSettled ? (
                      <Badge tone="warning" icon={<HandCoins aria-hidden="true" className="size-3.5" />}>
                        Owed to{' '}
                        {expense.paidBy === 'PARTNER_FOOD' ? foodBrand?.name : drinksBrand?.name}
                      </Badge>
                    ) : null}

                    <Money sen={expense.amountSen} className="text-sm font-black" />

                    {canChange(expense) ? (
                      <div className="flex">
                        <button
                          type="button"
                          onClick={() => startEditing(expense)}
                          aria-label={`Edit ${expense.description}`}
                          title="Edit"
                          className="grid size-9 place-items-center text-muted hover:bg-canvas hover:text-ink"
                        >
                          <Pencil aria-hidden="true" className="size-4" />
                        </button>
                        {isReimbursedAdvance(expense) ? null : (
                          <button
                            type="button"
                            onClick={() => remove(expense)}
                            aria-label={`Delete ${expense.description}`}
                            title="Delete"
                            className="grid size-9 place-items-center text-muted hover:bg-canvas hover:text-serious"
                          >
                            <Trash2 aria-hidden="true" className="size-4" />
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>

                  {hasDetail ? (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer font-bold text-muted">
                        {items.length > 0
                          ? `${items.length} line${items.length === 1 ? '' : 's'}`
                          : 'Remarks'}
                      </summary>
                      {items.length > 0 ? (
                        <table className="mt-2 w-full">
                          <tbody>
                            {items.map((item, index) => (
                              <tr key={`${expense.id}-${index}`} className="border-t border-slate-100">
                                <td className="py-1 pr-2 text-ink">{item.name}</td>
                                <td className="py-1 pr-2 text-right tabular text-muted">
                                  {formatQuantity(item.quantityMilli)}
                                  {item.unit ? ` ${item.unit}` : ''} ×{' '}
                                  {item.unitPriceSen < 0 ? '−' : ''}
                                  {formatRinggit(Math.abs(item.unitPriceSen))}
                                </td>
                                <td className="py-1 text-right font-bold tabular text-ink">
                                  {item.totalSen < 0 ? '−' : ''}
                                  {formatRinggit(Math.abs(item.totalSen))}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : null}
                      {expense.notes ? (
                        <p className="mt-2 border-l-2 border-line pl-2 text-muted">{expense.notes}</p>
                      ) : null}
                    </details>
                  ) : null}
                </li>
              )
            })}
          </ul>

          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm font-semibold text-muted">
              No expenses logged in this range.
            </p>
          ) : null}
        </Panel>
      </div>
    </div>
  )
}
