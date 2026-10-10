import { ClipboardList, FileDown, MessageSquareText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { DateRangePicker } from '../../components/DateRangePicker.tsx'
import { EmptyState, Panel } from '../../components/primitives.tsx'
import { clockText } from '../../data/roster-api.ts'
import { stockApi, type StockCount, type StockCountSummary } from '../../data/stock-api.ts'
import { errorText } from '../../data/team-api.ts'
import { StockLevelReading } from '../../components/StockLevelBar.tsx'
import { formatCount, groupStock, stockNote } from '../../domain/stock.ts'
import { formatDate, type DateRange } from '../../domain/selectors.ts'
import { downloadStockChecklist } from '../../lib/stock-pdf.ts'

const ALL = ''

function daysBefore(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() - days)
  return at.toISOString().slice(0, 10)
}

function quantity(milli: number | null, unit: string | null) {
  if (milli === null) return <span className="text-muted">—</span>
  return (
    <span className="font-black tabular text-ink">
      {formatCount(milli)}
      {unit ? <span className="font-semibold text-muted"> {unit}</span> : null}
    </span>
  )
}

function Report({ count }: { count: StockCount }) {
  const [problem, setProblem] = useState<string | null>(null)
  async function pdf() {
    setProblem(null)
    try {
      await downloadStockChecklist(
        count.lines.map((line) => ({ ...line, brand: line.brandName })),
        {
          businessName: count.branchName,
          filled: { date: formatDate(count.businessDate), countedBy: count.staffName, sentAt: clockText(count.submittedAt), remarks: count.remarks },
        },
        `closing-stock-${count.businessDate}.pdf`,
      )
    } catch (caught) {
      setProblem(errorText(caught, 'The PDF could not be made. Try again.'))
    }
  }
  const groups = useMemo(
    () => groupStock(count.lines.map((line) => ({ ...line, brandKey: line.brandName }))),
    [count],
  )
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3 border-b border-line pb-3">
        <div>
          <p className="page-kicker">{count.branchName}</p>
          <h3 className="mt-1 text-2xl font-black">Closing stock · {formatDate(count.businessDate)}</h3>
          <p className="text-sm font-semibold text-muted">
            Counted by {count.staffName} · sent {clockText(count.submittedAt)}
          </p>
        </div>
        <button type="button" onClick={() => void pdf()} className="vista-button-secondary ml-auto flex min-h-11 items-center gap-2">
          <FileDown aria-hidden="true" className="size-4" /> Download PDF
        </button>
        {problem ? <p role="alert" className="w-full text-sm font-bold text-serious">{problem}</p> : null}
      </div>

      {count.remarks ? (
        <div className="flex gap-2 border-l-4 border-warning bg-canvas p-3 text-sm">
          <MessageSquareText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
          <p className="whitespace-pre-wrap text-ink">{count.remarks}</p>
        </div>
      ) : null}

      {groups.map((brand) => (
        <section key={brand.brandKey} className="space-y-2">
          <h4 className="text-base font-black">{brand.brandKey}</h4>
          {brand.categories.map((category) => (
            <div key={category.category} className="border border-line">
              <p className="bg-canvas px-3 py-1.5 text-xs font-black uppercase tracking-[0.08em] text-ink">
                {category.category}
              </p>
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col />
                  <col className="w-28" />
                  <col className="w-44" />
                </colgroup>
                <thead>
                  <tr className="text-left text-[0.7rem] uppercase tracking-[0.06em] text-muted">
                    <th className="px-3 py-1 font-bold">Item</th>
                    <th className="px-2 py-1 text-right font-bold">Unopened</th>
                    <th className="px-3 py-1 text-right font-bold">Opened balance</th>
                  </tr>
                </thead>
                {category.subcategories.map((group) => (
                  <tbody key={group.subcategory ?? '—'}>
                    {group.subcategory ? (
                      <tr>
                        <td colSpan={3} className="px-3 pt-2 text-xs font-bold text-muted">
                          {group.subcategory}
                        </td>
                      </tr>
                    ) : null}
                    {group.items.map((line, index) => (
                      <tr key={`${line.name}-${index}`} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 font-semibold text-ink">{line.name}</td>
                        <td className="px-2 py-1.5 text-right">
                          {line.trackUnopened ? quantity(line.unopenedMilli, line.unitLabel) : null}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {line.trackBalance ? (
                            <StockLevelReading balance={line.balance} note={stockNote(line)} />
                          ) : stockNote(line) ? (
                            <span className="text-[0.65rem] font-black uppercase tracking-wider" style={{ color: stockNote(line)!.colour }}>
                              {stockNote(line)!.text}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

/** Past closing counts: pick a day, a branch or a person, and read one back. */
export function StockCountsTab({ today }: { today: string }) {
  const [range, setRange] = useState<DateRange>(() => ({ startDate: daysBefore(today, 29), endDate: today }))
  const [counts, setCounts] = useState<StockCountSummary[] | null>(null)
  const [staff, setStaff] = useState(ALL)
  const [branch, setBranch] = useState(ALL)
  const [selected, setSelected] = useState<StockCount | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    stockApi
      .listCounts({ from: range.startDate, to: range.endDate })
      .then((result) => {
        if (cancelled) return
        setCounts(result.counts)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(errorText(caught, 'Could not load the counts.'))
      })
    return () => {
      cancelled = true
    }
  }, [range])

  const staffNames = useMemo(() => [...new Set((counts ?? []).map((count) => count.staffName))].toSorted(), [counts])
  const branches = useMemo(() => [...new Set((counts ?? []).map((count) => count.branchName))].toSorted(), [counts])
  const visible = (counts ?? []).filter(
    (count) => (staff === ALL || count.staffName === staff) && (branch === ALL || count.branchName === branch),
  )

  async function open(id: string) {
    try {
      setSelected((await stockApi.getCount(id)).count)
      setError(null)
    } catch (caught) {
      setError(errorText(caught, 'Could not open that count.'))
    }
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <Panel className="space-y-3">
        <DateRangePicker value={range} onChange={setRange} today={today} showSummary />
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="vista-field-label">Counted by</span>
            <select
              value={staff}
              onChange={(event) => setStaff(event.target.value)}
              className="mt-1 min-h-11 w-full border-2 border-line bg-surface px-2 font-semibold"
            >
              <option value={ALL}>Everyone</option>
              {staffNames.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="vista-field-label">Branch</span>
            <select
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              className="mt-1 min-h-11 w-full border-2 border-line bg-surface px-2 font-semibold"
            >
              <option value={ALL}>All branches</option>
              {branches.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
        </div>

        {error ? (
          <p role="alert" className="text-sm font-bold text-serious">
            {error}
          </p>
        ) : null}

        <ul className="divide-y divide-slate-100">
          {visible.map((count) => (
            <li key={count.id}>
              <button
                type="button"
                onClick={() => void open(count.id)}
                aria-pressed={selected?.id === count.id}
                className={`flex w-full items-center gap-3 px-2 py-2.5 text-left hover:bg-canvas ${
                  selected?.id === count.id ? 'bg-canvas' : ''
                }`}
              >
                <ClipboardList aria-hidden="true" className="size-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-black text-ink">
                    {formatDate(count.businessDate)} · {clockText(count.submittedAt)}
                  </span>
                  <span className="block truncate text-xs font-semibold text-muted">
                    {count.staffName} · {count.branchName}
                    {count.remarks ? ` · “${count.remarks}”` : ''}
                  </span>
                </span>
                <span className="text-xs font-bold tabular text-muted">
                  {count.filledCount}/{count.itemCount}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {counts && visible.length === 0 ? (
          <p className="py-6 text-center text-sm font-semibold text-muted">No counts in this range.</p>
        ) : null}
      </Panel>

      {selected ? (
        <Panel className="p-4 sm:p-5">
          <Report count={selected} />
        </Panel>
      ) : (
        <EmptyState
          title="Pick a count to read it"
          hint="The counter sends one from the POS at closing: tap the clipboard in its top bar."
        />
      )}
    </div>
  )
}
