import {
  Check,
  ClipboardCopy,
  ClipboardPaste,
  ListPlus,
  Plus,
  ReceiptText,
  Trash2,
  X,
} from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { TimeInput } from './TimeInput.tsx'
import type { NewExpense } from '../data/store.ts'
import {
  formatQuantity,
  lineTotalSen,
  parseQuantityMilli,
  parseSignedPriceSen,
} from '../domain/expense-items.ts'
import { splitShared } from '../domain/finance.ts'
import { formatRinggit, parseRinggitToSen } from '../domain/money.ts'
import {
  parsePastedExpenses,
  receiptPrompt,
  type ChargeTo,
  type PastedExpense,
} from '../domain/receipt-paste.ts'
import type { Brand, ExpenseCategory, PaymentMethod, PaymentSource } from '../domain/types.ts'

export const CATEGORIES: Array<{ value: ExpenseCategory; label: string; local: string }> = [
  { value: 'RAW_MATERIALS', label: 'Stock / ingredients', local: 'Bahan mentah' },
  { value: 'PACKAGING', label: 'Packaging & disposables', local: 'Pembungkusan' },
  { value: 'ICE_GAS', label: 'Ice & gas', local: 'Ais & tong gas' },
  { value: 'RENT', label: 'Rent', local: 'Sewa' },
  { value: 'UTILITIES', label: 'Utilities', local: 'Utiliti' },
  { value: 'OPERATIONS', label: 'Cleaning & operations', local: 'Operasi & sabun' },
  { value: 'MAINTENANCE', label: 'Maintenance & repairs', local: 'Penyelenggaraan' },
  { value: 'CAPITAL_ASSET', label: 'Equipment', local: 'Peralatan modal' },
]

export const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'CASH', label: 'Cash' },
  { value: 'DUITNOW_QR', label: 'DuitNow QR' },
  { value: 'DEBIT_CARD', label: 'Debit card' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
]

const UNITS = ['kg', 'g', 'ekor', 'pcs', 'papan', 'tray', 'pack', 'botol', 'tin', 'L', 'drum', 'karung', 'ikat', 'tong']

const PASTE_PLACEHOLDER = '=== VISTA EXPENSE ===\nVENDOR: Pasar Borong Selayang\nDATE: 2026-09-27\nAMOUNT: 45.80\n…'

type Row = { key: string; name: string; quantity: string; unit: string; price: string }

let rowSeed = 0
function newRow(partial: Partial<Row> = {}): Row {
  rowSeed += 1
  return { key: `row-${rowSeed}`, name: '', quantity: '1', unit: '', price: '', ...partial }
}

function isBlank(row: Row): boolean {
  return row.name.trim() === '' && row.price.trim() === ''
}

/** A row's parsed values, or why it cannot count yet. */
function readRow(row: Row) {
  const quantityMilli = parseQuantityMilli(row.quantity)
  const unitPriceSen = parseSignedPriceSen(row.price)
  const totalSen =
    quantityMilli !== null && unitPriceSen !== null ? lineTotalSen(quantityMilli, unitPriceSen) : null
  const ok = row.name.trim() !== '' && totalSen !== null
  return { quantityMilli, unitPriceSen, totalSen, ok }
}

/** "Ayam bulat, Telur Gred A +2 more" — the one-line summary of an itemised receipt. */
function summariseItems(names: string[]): string {
  const [first, second, ...rest] = names
  if (!first) return ''
  const head = second ? `${first}, ${second}` : first
  return rest.length > 0 ? `${head} +${rest.length} more` : head
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-xs font-black uppercase tracking-[0.08em] text-ink">{title}</h3>
        {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

/** Font lives on the span: the global `button { font: inherit }` beats utilities on the button. */
function Choice({
  active,
  onClick,
  children,
  sub,
  className = '',
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  sub?: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-11 flex-col items-start justify-center border px-3 py-1.5 text-left transition-colors ${
        active
          ? 'border-ink bg-ink text-white'
          : 'border-line bg-surface text-ink hover:border-slate-400'
      } ${className}`}
    >
      <span className="text-sm font-bold leading-tight">{children}</span>
      {sub ? (
        <span className={`text-[0.7rem] leading-tight ${active ? 'text-slate-300' : 'text-muted'}`}>
          {sub}
        </span>
      ) : null}
    </button>
  )
}

const fieldClass =
  'mt-1 min-h-11 w-full border-2 border-line bg-surface px-3 font-semibold outline-none focus:border-rail'

export function ExpenseForm({
  today,
  brands,
  withSettlement,
  sharedFoodPct,
  equipmentFoodPct,
  onLog,
}: {
  today: string
  brands: Brand[]
  withSettlement: boolean
  /** The owner's standard overhead split, from Settings. */
  sharedFoodPct: number
  /** The owner's split for equipment, from Settings. */
  equipmentFoodPct: number
  onLog: (expense: NewExpense) => void
}) {
  const foodBrand = brands[0]
  const drinksBrand = brands[1]
  const foodName = foodBrand?.name ?? 'Food'
  const drinksName = drinksBrand?.name ?? 'Drinks'

  // Receipt
  const [vendor, setVendor] = useState('')
  const [receiptNo, setReceiptNo] = useState('')
  const [businessDate, setBusinessDate] = useState(today)
  const [receiptTime, setReceiptTime] = useState('')

  // Amount
  const [mode, setMode] = useState<'LUMP' | 'ITEMS'>('LUMP')
  const [amount, setAmount] = useState('')
  const [rows, setRows] = useState<Row[]>(() => [newRow()])
  const [description, setDescription] = useState('')

  // Classification and payment
  const [category, setCategory] = useState<ExpenseCategory>('RAW_MATERIALS')
  const [paidBy, setPaidBy] = useState<PaymentSource>('STALL_FUNDS')
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  const [target, setTarget] = useState<ChargeTo>('FOOD')
  const [foodPct, setFoodPct] = useState(sharedFoodPct)
  const [splitPreset, setSplitPreset] = useState<'STANDARD' | 'EQUIPMENT' | 'CUSTOM'>('STANDARD')
  const [notes, setNotes] = useState('')
  const [saved, setSaved] = useState(false)

  // Receipts read by Gemini, pasted back. The first fills the form; the rest
  // wait their turn and load one by one as each is logged.
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasted, setPasted] = useState('')
  const [queue, setQueue] = useState<PastedExpense[]>([])
  const [queueTotal, setQueueTotal] = useState(0)
  const [filledFrom, setFilledFrom] = useState<PastedExpense | null>(null)
  const [copied, setCopied] = useState(false)
  const prompt = receiptPrompt({ foodName, drinksName, withBrands: withSettlement })

  // ---- Derived -------------------------------------------------------------

  const counted = rows.filter((row) => !isBlank(row))
  const readRows = counted.map((row) => ({ row, ...readRow(row) }))
  const itemsOk = readRows.length > 0 && readRows.every((line) => line.ok)
  const itemsSen = readRows.reduce((sum, line) => sum + (line.totalSen ?? 0), 0)

  const amountSen = mode === 'ITEMS' ? (itemsOk ? itemsSen : null) : parseRinggitToSen(amount)
  const derivedDescription =
    mode === 'ITEMS' ? summariseItems(counted.map((row) => row.name.trim())) : ''
  const finalDescription = description.trim() || derivedDescription
  const canSave = amountSen !== null && amountSen > 0 && finalDescription.length > 0

  const split =
    withSettlement && amountSen !== null && amountSen > 0
      ? target === 'SHARED'
        ? splitShared(amountSen, foodPct)
        : target === 'FOOD'
          ? { foodSen: amountSen, drinksSen: 0 }
          : { foodSen: 0, drinksSen: amountSen }
      : null

  const pastedTotalMismatch =
    filledFrom !== null &&
    filledFrom.items.length > 0 &&
    filledFrom.amountSen !== undefined &&
    mode === 'ITEMS' &&
    itemsOk &&
    itemsSen !== filledFrom.amountSen

  // ---- Actions ------------------------------------------------------------

  function pickCategory(next: ExpenseCategory) {
    setCategory(next)
    // Equipment and overheads split differently; follow the category unless
    // the owner has set a split of their own.
    if (splitPreset !== 'CUSTOM') {
      const equipment = next === 'CAPITAL_ASSET'
      setSplitPreset(equipment ? 'EQUIPMENT' : 'STANDARD')
      setFoodPct(equipment ? equipmentFoodPct : sharedFoodPct)
    }
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  function removeRow(key: string) {
    setRows((current) => {
      const next = current.filter((row) => row.key !== key)
      return next.length > 0 ? next : [newRow()]
    })
  }

  function switchMode(next: 'LUMP' | 'ITEMS') {
    // Carry the figure across, so switching never loses what was typed.
    if (next === 'LUMP' && itemsOk && itemsSen > 0) setAmount((itemsSen / 100).toFixed(2))
    if (next === 'ITEMS' && counted.length === 0) {
      const sen = parseRinggitToSen(amount)
      if (sen !== null && sen > 0) {
        setRows([newRow({ name: description.trim(), price: (sen / 100).toFixed(2) })])
      }
    }
    setMode(next)
  }

  function reset(date = today) {
    setVendor('')
    setReceiptNo('')
    setBusinessDate(date)
    setReceiptTime('')
    setMode('LUMP')
    setAmount('')
    setRows([newRow()])
    setDescription('')
    setMethod(null)
    setNotes('')
  }

  function fillFrom(entry: PastedExpense) {
    reset()
    setVendor(entry.vendor ?? '')
    setReceiptNo(entry.receiptNo ?? '')
    // A future date is a misread; the API would take it, so the form refuses it.
    setBusinessDate(
      entry.businessDate && entry.businessDate <= today ? entry.businessDate : today,
    )
    setReceiptTime(entry.receiptTime ?? '')
    setDescription(entry.description ?? '')
    if (entry.items.length > 0) {
      setMode('ITEMS')
      setRows(
        entry.items.map((item) =>
          newRow({
            name: item.name,
            quantity: formatQuantity(item.quantityMilli),
            unit: item.unit ?? '',
            price: (item.unitPriceSen / 100).toFixed(2),
          }),
        ),
      )
    } else {
      setAmount(entry.amountSen === undefined ? '' : (entry.amountSen / 100).toFixed(2))
    }
    if (entry.category) pickCategory(entry.category)
    if (entry.paymentMethod) setMethod(entry.paymentMethod)
    if (entry.chargeTo) setTarget(entry.chargeTo)
    if (entry.foodSplitPct !== undefined) {
      setFoodPct(entry.foodSplitPct)
      setSplitPreset(
        entry.foodSplitPct === sharedFoodPct
          ? 'STANDARD'
          : entry.foodSplitPct === equipmentFoodPct
            ? 'EQUIPMENT'
            : 'CUSTOM',
      )
    }
    setFilledFrom(entry)
  }

  function readPasted(text: string) {
    setPasted(text)
    const entries = parsePastedExpenses(text, { food: foodName, drinks: drinksName })
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

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSave || amountSen === null) return

    const details = {
      businessDate,
      amountSen,
      category,
      description: finalDescription.slice(0, 200),
      receiptNo: receiptNo.trim() || null,
      vendor: vendor.trim() || null,
      receiptTime: receiptTime || null,
      paymentMethod: method,
      notes: notes.trim() || null,
      items:
        mode === 'ITEMS'
          ? readRows.map((line) => ({
              name: line.row.name.trim(),
              quantityMilli: line.quantityMilli ?? 1000,
              unit: line.row.unit.trim() || null,
              unitPriceSen: line.unitPriceSen ?? 0,
            }))
          : [],
    }

    onLog(
      !withSettlement || !foodBrand || !drinksBrand
        ? { ...details, paidBy: 'STALL_FUNDS', brandId: null, foodSplitPct: 100 }
        : {
            ...details,
            paidBy,
            brandId: target === 'SHARED' ? null : target === 'FOOD' ? foodBrand.id : drinksBrand.id,
            foodSplitPct: foodPct,
          },
    )

    const [next, ...rest] = queue
    if (next) {
      fillFrom(next)
      setQueue(rest)
    } else {
      reset()
      setFilledFrom(null)
      if (queueTotal > 0) {
        setPasted('')
        setQueueTotal(0)
      }
    }
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2200)
  }

  // ---- Render --------------------------------------------------------------

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Fill from Gemini */}
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
          <div className="flex flex-wrap gap-2 text-sm font-bold">
            <button
              type="button"
              onClick={() => void copyPrompt()}
              className="flex min-h-10 items-center gap-2 border border-line bg-surface px-3 text-ink hover:bg-white"
            >
              {copied ? (
                <Check aria-hidden="true" className="size-4" />
              ) : (
                <ClipboardCopy aria-hidden="true" className="size-4" />
              )}
              {copied ? 'Prompt copied' : 'Copy the prompt'}
            </button>
          </div>
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
              No receipt found in that text. Paste Gemini&rsquo;s whole reply, including the ===
              VISTA EXPENSE === lines.
            </p>
          ) : null}
          {filledFrom ? (
            <div role="status" className="space-y-1 text-xs">
              <p className="font-bold text-good">
                {queueTotal > 1
                  ? `Receipt ${queueTotal - queue.length} of ${queueTotal} filled in. Check it and log it; the next one loads after.`
                  : 'Filled in. Check the form below, then log it.'}
              </p>
              {filledFrom.amountSen === undefined && filledFrom.items.length === 0 ? (
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
          className="flex min-h-12 w-full items-center justify-center gap-2 border border-dashed border-slate-400 hover:bg-canvas"
        >
          <ClipboardPaste aria-hidden="true" className="size-4" />
          <span className="text-sm font-bold text-ink">Fill from a receipt (Gemini)</span>
        </button>
      )}

      {/* Receipt */}
      <Section title="Receipt">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="vista-field-label">Vendor / supplier</span>
            <input
              value={vendor}
              onChange={(event) => setVendor(event.target.value)}
              placeholder="Pasar Borong Selayang"
              maxLength={120}
              className={fieldClass}
            />
          </label>
          <label className="block">
            <span className="vista-field-label">Receipt / invoice no.</span>
            <input
              value={receiptNo}
              onChange={(event) => setReceiptNo(event.target.value)}
              placeholder="Optional"
              maxLength={60}
              className={fieldClass}
            />
          </label>
          <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
            <label className="block">
              <span className="vista-field-label">Date</span>
              <input
                type="date"
                value={businessDate}
                max={today}
                onChange={(event) => setBusinessDate(event.target.value || today)}
                className={`${fieldClass} px-2`}
              />
            </label>
            <label className="block">
              <span className="vista-field-label">Time</span>
              <TimeInput label="Time" optional value={receiptTime} onChange={setReceiptTime} className={`${fieldClass} px-2`} />
            </label>
          </div>
        </div>
      </Section>

      {/* Amount */}
      <Section title="Amount">
        <div role="group" aria-label="Amount entry" className="grid grid-cols-2 border border-line">
          {(
            [
              ['LUMP', 'Quick lump sum', ReceiptText],
              ['ITEMS', 'Itemised details', ListPlus],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => switchMode(value)}
              className={`flex min-h-11 items-center justify-center gap-2 ${
                mode === value ? 'bg-rail text-white' : 'bg-surface text-muted hover:bg-canvas'
              }`}
            >
              <Icon aria-hidden="true" className="size-4" />
              <span className="text-sm font-bold">{label}</span>
            </button>
          ))}
        </div>

        {mode === 'LUMP' ? (
          <div className="flex items-center border-2 border-line bg-surface px-3 focus-within:border-rail">
            <span className="font-black text-muted">RM</span>
            <input
              id="amount"
              aria-label="Amount in ringgit"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              className="min-h-14 w-full min-w-0 bg-transparent px-2 text-2xl font-black outline-none tabular"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="hidden grid-cols-[minmax(0,1fr)_4rem_5.5rem_6rem_6rem_2.25rem] gap-2 px-1 sm:grid">
              {['Item', 'Qty', 'Unit', 'Unit price', 'Line total', ''].map((label) => (
                <span key={label || 'remove'} className="vista-field-label text-right first:text-left">
                  {label}
                </span>
              ))}
            </div>
            <datalist id="expense-units">
              {UNITS.map((unit) => (
                <option key={unit} value={unit} />
              ))}
            </datalist>
            <ul className="space-y-2">
              {rows.map((row, index) => {
                const line = readRow(row)
                const blank = isBlank(row)
                const invalid = !blank && !line.ok
                return (
                  <li
                    key={row.key}
                    className={`grid grid-cols-[minmax(0,1fr)_4rem_5.5rem] gap-2 border p-2 sm:grid-cols-[minmax(0,1fr)_4rem_5.5rem_6rem_6rem_2.25rem] sm:border-0 sm:p-0 ${
                      invalid ? 'border-serious/50' : 'border-line'
                    }`}
                  >
                    <input
                      aria-label={`Item ${index + 1} name`}
                      value={row.name}
                      onChange={(event) => updateRow(row.key, { name: event.target.value })}
                      placeholder="Ayam bulat"
                      maxLength={120}
                      className="col-span-3 min-h-10 min-w-0 border-2 border-line bg-surface px-2 text-sm font-semibold outline-none focus:border-rail sm:col-span-1"
                    />
                    <input
                      aria-label={`Item ${index + 1} quantity`}
                      inputMode="decimal"
                      value={row.quantity}
                      onChange={(event) => updateRow(row.key, { quantity: event.target.value })}
                      className={`min-h-10 min-w-0 border-2 bg-surface px-2 text-right text-sm font-semibold tabular outline-none focus:border-rail ${
                        !blank && line.quantityMilli === null ? 'border-serious' : 'border-line'
                      }`}
                    />
                    <input
                      aria-label={`Item ${index + 1} unit`}
                      list="expense-units"
                      value={row.unit}
                      onChange={(event) => updateRow(row.key, { unit: event.target.value })}
                      placeholder="kg"
                      maxLength={20}
                      className="min-h-10 min-w-0 border-2 border-line bg-surface px-2 text-sm font-semibold outline-none focus:border-rail"
                    />
                    <input
                      aria-label={`Item ${index + 1} unit price in ringgit`}
                      inputMode="decimal"
                      value={row.price}
                      onChange={(event) => updateRow(row.key, { price: event.target.value })}
                      placeholder="0.00"
                      className={`col-span-2 min-h-10 min-w-0 border-2 bg-surface px-2 text-right text-sm font-semibold tabular outline-none focus:border-rail sm:col-span-1 ${
                        !blank && row.price.trim() !== '' && line.unitPriceSen === null
                          ? 'border-serious'
                          : 'border-line'
                      }`}
                    />
                    <span className="flex min-h-10 items-center justify-end text-sm font-black tabular text-ink">
                      {line.totalSen === null ? '—' : formatRinggit(Math.abs(line.totalSen))}
                      {line.totalSen !== null && line.totalSen < 0 ? ' off' : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      aria-label={`Remove item ${index + 1}`}
                      className="col-span-3 grid min-h-9 place-items-center text-muted hover:bg-canvas hover:text-serious sm:col-span-1 sm:min-h-10"
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                  </li>
                )
              })}
            </ul>
            <button
              type="button"
              onClick={() => setRows((current) => [...current, newRow()])}
              className="flex min-h-10 items-center gap-2 border border-dashed border-slate-400 px-3 hover:bg-canvas"
            >
              <Plus aria-hidden="true" className="size-4" />
              <span className="text-sm font-bold text-ink">Add a line</span>
            </button>
            <p className="text-[0.7rem] text-muted">
              A discount or rounding adjustment is a line with a minus price, like −0.02.
            </p>
            <div className="flex items-baseline justify-between border-t-2 border-ink pt-2">
              <span className="text-sm font-black uppercase tracking-[0.06em] text-ink">Total</span>
              <span className="text-2xl font-black tabular text-ink">
                {itemsOk ? formatRinggit(itemsSen) : '—'}
              </span>
            </div>
            {!itemsOk && counted.length > 0 ? (
              <p className="text-xs font-bold text-serious">
                Every line needs a name, a quantity and a price.
              </p>
            ) : null}
            {pastedTotalMismatch && filledFrom?.amountSen !== undefined ? (
              <p role="alert" className="text-xs font-bold text-serious">
                The lines add up to {formatRinggit(itemsSen)}, but the receipt total read was{' '}
                {formatRinggit(filledFrom.amountSen)}. Check the lines against the receipt.
              </p>
            ) : null}
          </div>
        )}

        <label className="block">
          <span className="vista-field-label">What for</span>
          <input
            id="what"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={derivedDescription || 'Market restock'}
            maxLength={200}
            className={fieldClass}
          />
          {mode === 'ITEMS' && description.trim() === '' && derivedDescription ? (
            <span className="mt-1 block text-[0.7rem] text-muted">
              Left blank, it is saved as &ldquo;{derivedDescription}&rdquo;.
            </span>
          ) : null}
        </label>
      </Section>

      {/* Category */}
      <Section title="Category">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {CATEGORIES.map((item) => (
            <Choice
              key={item.value}
              active={category === item.value}
              onClick={() => pickCategory(item.value)}
              sub={item.local}
            >
              {item.label}
            </Choice>
          ))}
        </div>
      </Section>

      {/* Payment */}
      <Section
        title="Payment"
        hint={
          withSettlement
            ? 'Only stall funds move the bank balance. A partner paying out of pocket is owed it back.'
            : undefined
        }
      >
        {withSettlement ? (
          <div className="grid gap-2 sm:grid-cols-3">
            <Choice
              active={paidBy === 'STALL_FUNDS'}
              onClick={() => setPaidBy('STALL_FUNDS')}
              sub="Counter bank account or till cash"
            >
              Stall funds
            </Choice>
            <Choice
              active={paidBy === 'PARTNER_FOOD'}
              onClick={() => setPaidBy('PARTNER_FOOD')}
              sub="Out of their own pocket"
            >
              {foodName} partner
            </Choice>
            <Choice
              active={paidBy === 'PARTNER_DRINKS'}
              onClick={() => setPaidBy('PARTNER_DRINKS')}
              sub="Out of their own pocket"
            >
              {drinksName} partner
            </Choice>
          </div>
        ) : null}
        <div>
          <p className="vista-field-label">Paid with (optional)</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((item) => (
              <Choice
                key={item.value}
                active={method === item.value}
                onClick={() => setMethod((current) => (current === item.value ? null : item.value))}
              >
                {item.label}
              </Choice>
            ))}
          </div>
        </div>
      </Section>

      {/* Brand allocation */}
      {withSettlement ? (
        <Section title="Charge to">
          <div role="group" aria-label="Charge to" className="grid grid-cols-3 border border-line">
            {(
              [
                ['FOOD', `${foodName}`, 'Direct, 100%'],
                ['DRINKS', `${drinksName}`, 'Direct, 100%'],
                ['SHARED', 'Shared', 'Overhead split'],
              ] as const
            ).map(([value, label, sub]) => (
              <button
                key={value}
                type="button"
                aria-pressed={target === value}
                onClick={() => setTarget(value)}
                className={`flex min-h-12 flex-col items-center justify-center ${
                  target === value ? 'bg-rail text-white' : 'bg-surface text-ink hover:bg-canvas'
                }`}
              >
                <span className="text-sm font-bold">{label}</span>
                <span className={`text-[0.7rem] ${target === value ? 'text-slate-300' : 'text-muted'}`}>
                  {sub}
                </span>
              </button>
            ))}
          </div>

          {/*
            The split appears only for a shared cost. Applying a 70/30 ratio to a
            direct expense would bleed 30% of every Food restock onto Drinks and
            quietly corrupt both brands' results.
          */}
          {target === 'SHARED' ? (
            <div className="space-y-3 border border-line bg-canvas p-3">
              <div className="flex flex-wrap gap-2">
                <Choice
                  active={splitPreset === 'STANDARD'}
                  onClick={() => {
                    setSplitPreset('STANDARD')
                    setFoodPct(sharedFoodPct)
                  }}
                  sub="Rent, utilities"
                >
                  {sharedFoodPct}/{100 - sharedFoodPct} standard
                </Choice>
                <Choice
                  active={splitPreset === 'EQUIPMENT'}
                  onClick={() => {
                    setSplitPreset('EQUIPMENT')
                    setFoodPct(equipmentFoodPct)
                  }}
                  sub="Equipment"
                >
                  {equipmentFoodPct}/{100 - equipmentFoodPct}
                </Choice>
                <Choice
                  active={splitPreset === 'CUSTOM'}
                  onClick={() => setSplitPreset('CUSTOM')}
                  sub="Set it yourself"
                >
                  Custom
                </Choice>
              </div>
              {splitPreset === 'CUSTOM' ? (
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={foodPct}
                  onChange={(event) => setFoodPct(Number(event.target.value))}
                  aria-label={`Share borne by ${foodName}`}
                  className="w-full"
                />
              ) : null}
              <div className="flex h-2 overflow-hidden bg-slate-200" aria-hidden="true">
                <span style={{ width: `${foodPct}%`, backgroundColor: foodBrand?.chartColour }} />
                <span style={{ width: `${100 - foodPct}%`, backgroundColor: drinksBrand?.chartColour }} />
              </div>
            </div>
          ) : null}

          <p className="flex flex-wrap justify-between gap-2 text-sm font-bold tabular">
            <span style={{ color: foodBrand?.chartColour }}>
              {foodName} {target === 'SHARED' ? `${foodPct}%` : target === 'FOOD' ? '100%' : '0%'}
              {split ? `: ${formatRinggit(split.foodSen)}` : ''}
            </span>
            <span style={{ color: drinksBrand?.chartColour }}>
              {drinksName}{' '}
              {target === 'SHARED' ? `${100 - foodPct}%` : target === 'DRINKS' ? '100%' : '0%'}
              {split ? `: ${formatRinggit(split.drinksSen)}` : ''}
            </span>
          </p>
        </Section>
      ) : null}

      {/* Remarks */}
      <Section title="Remarks" hint="For whoever checks the books later. Optional.">
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Bought extra for the night market crowd"
          className="w-full border-2 border-line bg-surface p-2 text-sm outline-none focus:border-rail"
        />
      </Section>

      <div className="sticky bottom-0 -mx-4 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:px-5">
        <button
          type="submit"
          disabled={!canSave}
          className="flex min-h-14 w-full items-center justify-center gap-2 bg-rail text-white transition-colors hover:bg-[#24554a] disabled:bg-slate-300"
        >
          {saved ? (
            <>
              <Check aria-hidden="true" className="size-5" />
              <span className="text-base font-bold">Saved</span>
            </>
          ) : (
            <>
              <Plus aria-hidden="true" className="size-5" />
              <span className="text-base font-bold">
                Log expense{amountSen !== null && amountSen > 0 ? ` · ${formatRinggit(amountSen)}` : ''}
              </span>
            </>
          )}
        </button>
      </div>
    </form>
  )
}
