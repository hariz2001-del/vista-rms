import { Check, ClipboardCopy, ClipboardPaste, HandCoins, Plus, X } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { DateRangePicker } from '../components/DateRangePicker.tsx'
import { Badge, Money, Panel, SectionHeading } from '../components/primitives.tsx'
import type { VistaStore } from '../data/store.ts'
import { splitShared } from '../domain/finance.ts'
import { formatRinggit, parseRinggitToSen } from '../domain/money.ts'
import { formatDate, inRange, monthOf, type DateRange } from '../domain/selectors.ts'
import type { ExpenseCategory, PaymentSource } from '../domain/types.ts'
import { parsePastedExpenses, receiptPrompt, type PastedExpense } from '../domain/receipt-paste.ts'

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

const PASTE_PLACEHOLDER = '=== VISTA EXPENSE ===\nDATE: 2026-09-27\nAMOUNT: 45.80\n…'

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
  // Without partner settlement there is nobody to owe and nothing to split:
  // every cost is paid from the business's own funds, whole.
  const withSettlement = store.settings.settlementEnabled && drinksBrand !== undefined

  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<ExpenseCategory>('RAW_MATERIALS')
  const [paidBy, setPaidBy] = useState<PaymentSource>('STALL_FUNDS')
  const [target, setTarget] = useState<'FOOD' | 'DRINKS' | 'SHARED'>('SHARED')
  const [foodPct, setFoodPct] = useState(store.settings.sharedOverheadFoodPct)
  const [saved, setSaved] = useState(false)
  const [businessDate, setBusinessDate] = useState(store.today)

  // Receipts read by Gemini, pasted back. The first fills the form; the rest
  // wait their turn and load one by one as each is logged.
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasted, setPasted] = useState('')
  const [queue, setQueue] = useState<PastedExpense[]>([])
  const [queueTotal, setQueueTotal] = useState(0)
  const [filledFrom, setFilledFrom] = useState<PastedExpense | null>(null)
  const [copied, setCopied] = useState(false)
  const prompt = receiptPrompt({
    foodName: foodBrand?.name ?? 'Food',
    drinksName: drinksBrand?.name ?? 'Drinks',
    withBrands: withSettlement,
  })

  function fillFrom(entry: PastedExpense) {
    setAmount(entry.amountSen === undefined ? '' : (entry.amountSen / 100).toFixed(2))
    setDescription(entry.description ?? '')
    // A future date is a misread; the API would take it, so the form refuses it.
    setBusinessDate(
      entry.businessDate && entry.businessDate <= store.today ? entry.businessDate : store.today,
    )
    if (entry.category) setCategory(entry.category)
    if (entry.chargeTo) setTarget(entry.chargeTo)
    if (entry.foodSplitPct !== undefined) setFoodPct(entry.foodSplitPct)
    setFilledFrom(entry)
  }

  function readPasted(text: string) {
    setPasted(text)
    const entries = parsePastedExpenses(text, {
      food: foodBrand?.name ?? 'Food',
      drinks: drinksBrand?.name ?? 'Drinks',
    })
    const [first, ...rest] = entries
    setQueueTotal(entries.length)
    setQueue(rest)
    if (first) fillFrom(first)
    else setFilledFrom(null)
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked: "See the prompt" shows it for copying by hand.
      setCopied(false)
    }
  }

  const [range, setRange] = useState<DateRange>(() => ({
    startDate: `${monthOf(store.today)}-01`,
    endDate: store.today,
  }))

  const amountSen = parseRinggitToSen(amount)
  const canSave = amountSen !== null && amountSen > 0 && description.trim().length > 0
  const preview = amountSen && target === 'SHARED' ? splitShared(amountSen, foodPct) : null

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSave || amountSen === null) return

    if (!withSettlement || !foodBrand || !drinksBrand) {
      store.addExpense({
        businessDate,
        amountSen,
        category,
        paidBy: 'STALL_FUNDS',
        brandId: null,
        foodSplitPct: 100,
        description: description.trim(),
      })
    } else {
      store.addExpense({
        businessDate,
        amountSen,
        category,
        paidBy,
        brandId: target === 'SHARED' ? null : target === 'FOOD' ? foodBrand.id : drinksBrand.id,
        foodSplitPct: foodPct,
        description: description.trim(),
      })
    }

    setAmount('')
    setDescription('')
    const [next, ...rest] = queue
    if (next) {
      fillFrom(next)
      setQueue(rest)
    } else {
      setFilledFrom(null)
      setBusinessDate(store.today)
      if (queueTotal > 0) {
        setPasted('')
        setQueueTotal(0)
      }
    }
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
          {withSettlement
            ? 'Log what the stall spends. Only stall funds move the cashflow balance — a partner paying out of pocket creates a debt instead.'
            : 'Log what the business spends. Every cost comes out of the cashflow balance.'}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Panel>
          <SectionHeading title="Log an expense" hint="Amount and what it was. Everything else has a sensible default." />
          <form onSubmit={handleSubmit} className="space-y-4">
            {pasteOpen ? (
              <div className="space-y-3 border border-rail/40 bg-canvas p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-black text-ink">Fill from a receipt</p>
                  <button
                    type="button"
                    onClick={() => setPasteOpen(false)}
                    aria-label="Close receipt paste"
                    className="grid size-8 place-items-center text-muted hover:bg-surface"
                  >
                    <X aria-hidden="true" className="size-4" />
                  </button>
                </div>
                <ol className="list-decimal space-y-1 pl-4 text-xs text-muted">
                  <li>Copy the prompt and paste it into Gemini.</li>
                  <li>Attach the receipt photo — several at once is fine — and send.</li>
                  <li>Copy Gemini&rsquo;s whole reply and paste it below. The form fills itself.</li>
                </ol>
                <button
                  type="button"
                  onClick={() => void copyPrompt()}
                  className="flex min-h-10 w-full items-center justify-center gap-2 border border-line bg-surface text-sm font-bold text-ink hover:bg-white"
                >
                  {copied ? (
                    <>
                      <Check aria-hidden="true" className="size-4" /> Prompt copied
                    </>
                  ) : (
                    <>
                      <ClipboardCopy aria-hidden="true" className="size-4" /> Copy the prompt
                    </>
                  )}
                </button>
                <details className="text-xs text-muted">
                  <summary className="cursor-pointer font-bold">See the prompt</summary>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap border border-line bg-surface p-2 text-[0.7rem] leading-relaxed">
                    {prompt}
                  </pre>
                </details>
                <label className="block">
                  <span className="vista-field-label">Gemini&rsquo;s reply</span>
                  <textarea
                    value={pasted}
                    onChange={(event) => readPasted(event.target.value)}
                    rows={5}
                    placeholder={PASTE_PLACEHOLDER}
                    className="mt-1 w-full border-2 border-line bg-surface p-2 font-mono text-xs outline-none focus:border-rail"
                  />
                </label>
                {pasted.trim() !== '' && queueTotal === 0 ? (
                  <p role="alert" className="text-xs font-bold text-serious">
                    No receipt found in that text. Paste Gemini&rsquo;s whole reply, including the
                    === VISTA EXPENSE === lines.
                  </p>
                ) : null}
                {filledFrom ? (
                  <div role="status" className="space-y-1 text-xs">
                    <p className="font-bold text-good">
                      {queueTotal > 1
                        ? `Receipt ${queueTotal - queue.length} of ${queueTotal} filled in. Check it and log it; the next one loads after.`
                        : 'Filled in. Check the form below, then log it.'}
                    </p>
                    {filledFrom.amountSen === undefined ? (
                      <p className="font-bold text-serious">No amount was read — type it in.</p>
                    ) : null}
                    {filledFrom.problems.map((problem) => (
                      <p key={problem} className="text-serious">
                        {problem}.
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPasteOpen(true)}
                className="flex min-h-12 w-full items-center justify-center gap-2 border border-dashed border-slate-400 text-sm font-bold text-ink hover:bg-canvas"
              >
                <ClipboardPaste aria-hidden="true" className="size-4" /> Fill from a receipt (Gemini)
              </button>
            )}

            <div>
              <label className="vista-field-label" htmlFor="expense-date">
                Date
              </label>
              <input
                id="expense-date"
                type="date"
                value={businessDate}
                max={store.today}
                onChange={(event) => setBusinessDate(event.target.value || store.today)}
                className="mt-1 min-h-12 w-full border-2 border-line bg-surface px-3 font-semibold outline-none focus:border-rail"
              />
            </div>

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

            {withSettlement ? (
              <>
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
              </>
            ) : null}

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
