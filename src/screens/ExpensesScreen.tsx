import { Camera, Check, HandCoins, Plus } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { DateRangePicker } from '../components/DateRangePicker.tsx'
import { Badge, Money, Panel, SectionHeading } from '../components/primitives.tsx'
import type { VistaStore } from '../data/store.ts'
import { splitShared } from '../domain/finance.ts'
import { formatRinggit, parseRinggitToSen } from '../domain/money.ts'
import { formatDate, inRange, monthOf, type DateRange } from '../domain/selectors.ts'
import type { ExpenseCategory, PaymentSource } from '../domain/types.ts'

const CATEGORIES: Array<{ value: ExpenseCategory; label: string }> = [
  { value: 'RAW_MATERIALS', label: 'Stock' },
  { value: 'PACKAGING', label: 'Packaging' },
  { value: 'RENT', label: 'Rent' },
  { value: 'UTILITIES', label: 'Utilities' },
  { value: 'OPERATIONS', label: 'Operations' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'CAPITAL_ASSET', label: 'Equipment' },
]

const CATEGORY_LABEL = Object.fromEntries(
  CATEGORIES.map((category) => [category.value, category.label]),
) as Record<ExpenseCategory, string>

const PAID_BY: Array<{ value: PaymentSource; label: string }> = [
  { value: 'STALL_FUNDS', label: 'Stall funds' },
  { value: 'PARTNER_FOOD', label: 'Food partner' },
  { value: 'PARTNER_DRINKS', label: 'Drinks partner' },
]

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 border px-3 text-sm font-bold transition-colors ${
        active ? 'bg-ink text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

export function ExpensesScreen({ store }: { store: VistaStore }) {
  const foodBrand = store.brands[0]
  const drinksBrand = store.brands[1]

  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<ExpenseCategory>('RAW_MATERIALS')
  const [paidBy, setPaidBy] = useState<PaymentSource>('STALL_FUNDS')
  const [target, setTarget] = useState<'FOOD' | 'DRINKS' | 'SHARED'>('SHARED')
  const [foodPct, setFoodPct] = useState(store.settings.sharedOverheadFoodPct)
  const [saved, setSaved] = useState(false)

  const [range, setRange] = useState<DateRange>(() => ({
    startDate: `${monthOf(store.today)}-01`,
    endDate: store.today,
  }))

  const amountSen = parseRinggitToSen(amount)
  const canSave = amountSen !== null && amountSen > 0 && description.trim().length > 0
  const preview = amountSen && target === 'SHARED' ? splitShared(amountSen, foodPct) : null

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSave || amountSen === null || !foodBrand || !drinksBrand) return

    store.addExpense({
      businessDate: store.today,
      amountSen,
      category,
      paidBy,
      brandId: target === 'SHARED' ? null : target === 'FOOD' ? foodBrand.id : drinksBrand.id,
      foodSplitPct: foodPct,
      description: description.trim(),
    })

    setAmount('')
    setDescription('')
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2200)
  }

  const visible = useMemo(
    () =>
      inRange(store.expenses, range.startDate, range.endDate).toSorted((a, b) =>
        b.businessDate.localeCompare(a.businessDate),
      ),
    [store.expenses, range],
  )

  const total = visible.reduce((sum, expense) => sum + expense.amountSen, 0)

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="border-b border-line pb-5">
        <p className="page-kicker">Spending / new entry</p>
        <h1 className="mt-1 text-3xl sm:text-[2.65rem]">Expenses</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Log what the stall spends. Only stall funds move the cashflow balance — a partner paying
          out of pocket creates a debt instead.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Panel>
          <SectionHeading title="Log an expense" hint="Amount and what it was. Everything else has a sensible default." />
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="vista-field-label" htmlFor="amount">
                Amount
              </label>
              <div className="mt-1 flex items-center border-2 border-line bg-surface px-3 focus-within:border-rail">
                <span className="font-black text-muted">RM</span>
                <input
                  id="amount"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                  className="min-h-14 w-full min-w-0 bg-transparent px-2 text-2xl font-black outline-none tabular"
                />
              </div>
            </div>

            <div>
              <label className="vista-field-label" htmlFor="what">
                What for
              </label>
              <input
                id="what"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Market restock"
                className="mt-1 min-h-12 w-full border-2 border-line bg-surface px-3 font-semibold outline-none focus:border-rail"
              />
            </div>

            <div>
              <p className="vista-field-label">Category</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {CATEGORIES.map((item) => (
                  <Chip
                    key={item.value}
                    active={category === item.value}
                    onClick={() => setCategory(item.value)}
                  >
                    {item.label}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <p className="vista-field-label">Who paid</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {PAID_BY.map((item) => (
                  <Chip key={item.value} active={paidBy === item.value} onClick={() => setPaidBy(item.value)}>
                    {item.label}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <p className="vista-field-label">Charge to</p>
              <div className="mt-1 flex flex-wrap gap-2">
                <Chip active={target === 'FOOD'} onClick={() => setTarget('FOOD')}>
                  {foodBrand?.name ?? 'Food'}
                </Chip>
                <Chip active={target === 'DRINKS'} onClick={() => setTarget('DRINKS')}>
                  {drinksBrand?.name ?? 'Drinks'}
                </Chip>
                <Chip active={target === 'SHARED'} onClick={() => setTarget('SHARED')}>
                  Shared
                </Chip>
              </div>
            </div>

            {/*
              The split appears only for a shared cost. Applying a 70/30 ratio to
              a direct expense would bleed 30% of every Food restock onto Drinks
              and quietly corrupt both brands' results.
            */}
            {target === 'SHARED' ? (
              <div className="border border-line bg-canvas p-3">
                <div className="flex items-center justify-between text-xs font-black">
                  <span style={{ color: foodBrand?.chartColour }}>
                    {foodBrand?.name} {foodPct}%
                  </span>
                  <span style={{ color: drinksBrand?.chartColour }}>
                    {drinksBrand?.name} {100 - foodPct}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={foodPct}
                  onChange={(event) => setFoodPct(Number(event.target.value))}
                  aria-label="Share borne by Food"
                  className="mt-2 w-full"
                />
                <div className="mt-1 flex flex-wrap gap-2">
                  {[70, 50, 30].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setFoodPct(preset)}
                      className="border border-line bg-surface px-2 py-1 text-xs font-bold text-slate-600"
                    >
                      {preset}/{100 - preset}
                    </button>
                  ))}
                </div>
                {preview ? (
                  <p className="mt-2 text-xs font-bold text-muted tabular">
                    {foodBrand?.name} {formatRinggit(preview.foodSen)} · {drinksBrand?.name}{' '}
                    {formatRinggit(preview.drinksSen)}
                  </p>
                ) : null}
              </div>
            ) : null}

            <button
              type="button"
              className="flex min-h-12 w-full items-center justify-center gap-2 border border-dashed border-slate-400 text-sm font-bold text-muted hover:bg-canvas"
              title="Receipt scanning is not built yet"
            >
              <Camera aria-hidden="true" className="size-4" /> Snap a receipt (coming later)
            </button>

            <button
              type="submit"
              disabled={!canSave}
              className="flex min-h-14 w-full items-center justify-center gap-2 bg-rail text-base font-bold text-white transition-colors hover:bg-[#24554a] disabled:bg-slate-300"
            >
              {saved ? (
                <>
                  <Check aria-hidden="true" className="size-5" /> Saved
                </>
              ) : (
                <>
                  <Plus aria-hidden="true" className="size-5" /> Log expense
                </>
              )}
            </button>
          </form>
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
            {visible.map((expense) => (
              <li key={expense.id} className="flex flex-wrap items-center gap-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-ink">{expense.description}</p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs font-semibold text-muted">
                    <span>{formatDate(expense.businessDate)}</span>
                    <span>·</span>
                    <span>{CATEGORY_LABEL[expense.category]}</span>
                    <span>·</span>
                    <span>
                      {expense.brandId === null
                        ? `Shared ${expense.foodSplitPct}/${100 - expense.foodSplitPct}`
                        : (store.brands.find((b) => b.id === expense.brandId)?.name ?? '—')}
                    </span>
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
              </li>
            ))}
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
