import { LEVELS, levelOf, type StockBalance, type StockNote } from '../domain/stock.ts'

/**
 * How full the open one is, as a bar of five steps — 0%, 25%, 50%, 75%,
 * 100%. Tapping a step fills the bar to it in that level's colour (red when
 * finished, through to green); tapping the chosen step again clears it.
 */
export function StockLevelBar({
  label,
  value,
  note,
  onChange,
}: {
  label: string
  value: StockBalance | null
  /** Finished or low, worked out with the unopened count (stockNote). */
  note: StockNote | null
  onChange: (value: StockBalance | null) => void
}) {
  const level = levelOf(value)
  return (
    <div>
      <div
        role="radiogroup"
        aria-label={label}
        className="relative h-14 overflow-hidden rounded-xl border-2 border-slate-200 bg-slate-100"
        // Finished: the whole bar goes pale red, as there is nothing to fill.
        style={level?.pct === 0 ? { backgroundColor: '#fee2e2', borderColor: level.colour } : undefined}
      >
        {level && level.pct > 0 ? (
          <div
            aria-hidden="true"
            className="absolute inset-y-0 left-0 transition-[width,background-color] duration-200"
            style={{ width: `${level.pct}%`, backgroundColor: level.colour }}
          />
        ) : null}
        <div className="relative grid h-full grid-cols-5">
          {LEVELS.map((step) => {
            const on = value === step.value
            return (
              <button
                key={step.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange(on ? null : step.value)}
                className={`m-1 rounded-lg text-sm font-black tabular-nums transition ${
                  on ? 'bg-white text-slate-900 shadow-md ring-2 ring-slate-900' : 'text-slate-800 hover:bg-white/50'
                }`}
              >
                {step.label}
              </button>
            )
          })}
        </div>
      </div>
      {note ? (
        <p className="mt-1 text-right text-xs font-black uppercase tracking-wider" style={{ color: note.colour }}>
          {note.text}
        </p>
      ) : null}
    </div>
  )
}

/** The level as a report shows it: the bar alone, filled and coloured, and its note. */
export function StockLevelReading({ balance, note }: { balance: StockBalance | null; note: StockNote | null }) {
  const level = levelOf(balance)
  if (!level) return <span className="text-muted">—</span>
  return (
    <span className="inline-flex flex-col items-end gap-0.5" title={level.label}>
      <span
        role="img"
        aria-label={`${level.label}${note ? `, ${note.text}` : ''}`}
        className="relative block h-3.5 w-32 overflow-hidden rounded-full border"
        style={{ backgroundColor: level.pct === 0 ? '#fee2e2' : '#e5e7eb', borderColor: level.pct === 0 ? level.colour : '#d1d5db' }}
      >
        <span className="absolute inset-y-0 left-0" style={{ width: `${level.pct}%`, backgroundColor: level.colour }} />
        {/* Quarter marks, so 25 and 50 read apart at a glance. */}
        {[25, 50, 75].map((mark) => (
          <span key={mark} aria-hidden="true" className="absolute inset-y-0 w-px bg-white/70" style={{ left: `${mark}%` }} />
        ))}
      </span>
      {note ? (
        <span className="text-[0.65rem] font-black uppercase tracking-wider" style={{ color: note.colour }}>
          {note.text}
        </span>
      ) : null}
    </span>
  )
}
