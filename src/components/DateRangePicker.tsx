import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo } from 'react'
import {
  formatRange,
  rangeLength,
  rangePresets,
  shiftRange,
  type DateRange,
} from '../domain/selectors.ts'

type Props = {
  value: DateRange
  onChange: (range: DateRange) => void
  today: string
  /** Shown under the heading, e.g. "Sat, 1 Aug — Mon, 31 Aug". */
  showSummary?: boolean
  /** A "Today" preset and ‹ › buttons that step the window back and forward. */
  stepper?: boolean
}

/**
 * A native date field only opens its calendar from the small icon at its right
 * edge — clicking the text just focuses a segment. That reads as "the picker is
 * broken", so the whole field opens it.
 */
function openCalendar(event: { currentTarget: HTMLInputElement }) {
  const input = event.currentTarget
  if (typeof input.showPicker === 'function') {
    try {
      input.showPicker()
    } catch {
      // Some browsers refuse outside a user gesture. The icon still works.
    }
  }
}

export function DateRangePicker({
  value,
  onChange,
  today,
  showSummary = false,
  stepper = false,
}: Props) {
  const presets = useMemo(
    () => [
      ...(stepper ? [{ label: 'Today', range: { startDate: today, endDate: today } }] : []),
      ...rangePresets(today),
    ],
    [today, stepper],
  )
  const unit = rangeLength(value) === 1 ? 'day' : `${rangeLength(value)} days`
  const atToday = value.endDate >= today

  return (
    <div className="flex flex-col items-start gap-2">
      {showSummary ? <p className="text-sm text-muted">{formatRange(value)}</p> : null}

      <div className="flex flex-wrap items-end gap-2">
        {stepper ? (
          <div className="flex items-stretch border border-line bg-surface" role="group" aria-label="Step through dates">
            <button
              type="button"
              onClick={() => onChange(shiftRange(value, -1, today))}
              aria-label={`Previous ${unit}`}
              title={`Previous ${unit}`}
              className="grid min-h-11 w-11 place-items-center text-ink hover:bg-canvas"
            >
              <ChevronLeft aria-hidden="true" className="size-5" />
            </button>
            <span className="flex min-w-32 items-center justify-center border-x border-line px-3 text-sm font-bold text-ink tabular">
              {value.startDate === today && value.endDate === today ? 'Today' : formatRange(value)}
            </span>
            <button
              type="button"
              onClick={() => onChange(shiftRange(value, 1, today))}
              disabled={atToday}
              aria-label={`Next ${unit}`}
              title={atToday ? 'Nothing after today' : `Next ${unit}`}
              className="grid min-h-11 w-11 place-items-center text-ink hover:bg-canvas disabled:text-slate-300 disabled:hover:bg-transparent"
            >
              <ChevronRight aria-hidden="true" className="size-5" />
            </button>
          </div>
        ) : null}

        {presets.map((preset) => {
          const isActive =
            preset.range.startDate === value.startDate && preset.range.endDate === value.endDate
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => onChange(preset.range)}
              aria-pressed={isActive}
              className={`min-h-11 border px-3 text-sm font-bold ${
                isActive
                  ? 'border-rail bg-rail text-white'
                  : 'border-line bg-surface text-slate-700 hover:bg-canvas'
              }`}
            >
              {preset.label}
            </button>
          )
        })}

        <label className="flex flex-col gap-1">
          <span className="vista-field-label">From</span>
          <input
            type="date"
            value={value.startDate}
            onClick={openCalendar}
            onFocus={openCalendar}
            onChange={(event) => {
              const startDate = event.target.value
              if (!startDate) return
              // Dragging the start past the end carries the end with it rather
              // than refusing the input, which is what a min/max pair would do.
              onChange({
                startDate,
                endDate: startDate > value.endDate ? startDate : value.endDate,
              })
            }}
            className="vista-control px-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="vista-field-label">To</span>
          <input
            type="date"
            value={value.endDate}
            onClick={openCalendar}
            onFocus={openCalendar}
            onChange={(event) => {
              const endDate = event.target.value
              if (!endDate) return
              onChange({
                startDate: endDate < value.startDate ? endDate : value.startDate,
                endDate,
              })
            }}
            className="vista-control px-2"
          />
        </label>
      </div>
    </div>
  )
}
