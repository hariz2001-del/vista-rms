import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { formatRinggit, formatRinggitShort } from '../domain/money.ts'
import {
  TIME_FRAMES,
  axisTicks,
  salesSeries,
  seriesTotals,
  type SalesSeries,
  type SeriesDef,
  type SeriesMode,
  type TimeFrame,
} from '../domain/sales-series.ts'
import type { DateRange } from '../domain/selectors.ts'
import type { Brand, Category, Order, SaleCorrection } from '../domain/types.ts'

type Props = {
  range: DateRange
  orders: Order[]
  corrections: SaleCorrection[]
  brands: Brand[]
  categories: Category[]
  /** The owner's "day starts at" hour; a single day shows its 24 hours from here. */
  dayRolloverHour: number
}

const HEIGHT = 260
const PAD = { top: 14, bottom: 30, side: 14 }
const Y_AXIS_WIDTH = 58
/** Below this spacing a range of days scrolls instead of squeezing. */
const MIN_DAY_SPACING = 26
const SURFACE = '#fffdf8'

const MODES: Array<{ key: SeriesMode; label: string }> = [
  { key: 'OVERALL', label: 'Overall' },
  { key: 'BRAND', label: 'By brand' },
  { key: 'CATEGORY', label: 'By category' },
]

const dayFormat = new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const longDayFormat = new Intl.DateTimeFormat('en-MY', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
const timeFormat = new Intl.DateTimeFormat('en-MY', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Kuala_Lumpur',
})

/** "21:00", "21:30" — 24-hour, everywhere in Vista. */
function clock(date: Date): string {
  return timeFormat.format(date)
}

/** A day ("28 Sept"), or a time frame: "21:00" on the axis, "21:30 – 22:00" in full. */
function pointLabel(series: SalesSeries, at: string, long = false, frameMinutes = 60): string {
  if (series.kind === 'TIME') {
    const start = new Date(at)
    return long
      ? `${clock(start)} – ${clock(new Date(start.getTime() + frameMinutes * 60_000))}`
      : clock(start)
  }
  return (long ? longDayFormat : dayFormat).format(new Date(`${at}T12:00:00Z`))
}

/**
 * Net sales as lines — per day across a range, or per time frame (H4, H1, M30)
 * through a single day. Overall, by brand, or one brand's categories, each line switchable.
 *
 * One y-axis, recessive grid, 2px lines, a crosshair with every visible line's
 * value on hover or arrow keys, and a table of the same figures. A long range
 * scrolls sideways with the axis pinned, opening at the latest day.
 */
export function SalesLineChart({
  range,
  orders,
  corrections,
  brands,
  categories,
  dayRolloverHour,
}: Props) {
  const titleId = useId()
  const [mode, setMode] = useState<SeriesMode>('OVERALL')
  const [categoryBrandId, setCategoryBrandId] = useState<string | null>(brands[0]?.id ?? null)
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [showTable, setShowTable] = useState(false)
  const [frame, setFrame] = useState<TimeFrame>(60)
  const [active, setActive] = useState<number | null>(null)
  const [viewport, setViewport] = useState(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const brandForCategories = categoryBrandId ?? brands[0]?.id ?? null
  const series = useMemo(
    () =>
      salesSeries(
        orders,
        corrections,
        range,
        mode,
        brands,
        categories,
        brandForCategories,
        dayRolloverHour,
        new Date(),
        frame,
      ),
    [orders, corrections, range, mode, brands, categories, brandForCategories, dayRolloverHour, frame],
  )
  const totals = useMemo(() => seriesTotals(series), [series])
  const visible = series.defs.filter((def) => !hidden.has(def.key))
  // Today's hours that have not started keep their place on the axis, but the
  // line stops at the current hour rather than claiming RM 0 for the future.
  const drawn = series.points.filter((point) => !point.isFuture)
  const lastDrawn = drawn.length - 1

  // Measure the scrolling area so the plot fills it, or overflows it on purpose.
  // Keyed on the element itself: the plot unmounts on a day with no sales (and
  // in table view) and mounts again after, and it must be measured each time.
  // A zero reading is the old element leaving the page, never a real width —
  // taking it would draw every later day's chart zero pixels wide.
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    scrollRef.current = scrollElement
    if (!scrollElement) return
    if (scrollElement.clientWidth > 0) setViewport(scrollElement.clientWidth)
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0
      if (width > 0) setViewport(width)
    })
    observer.observe(scrollElement)
    return () => observer.disconnect()
  }, [scrollElement])

  const count = series.points.length
  const plotWidth = Math.max(
    viewport,
    series.kind === 'DAY' ? count * MIN_DAY_SPACING + PAD.side * 2 : 0,
  )
  const innerWidth = Math.max(1, plotWidth - PAD.side * 2)
  const plotHeight = HEIGHT - PAD.top - PAD.bottom

  // Open a long range at its latest day.
  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollLeft = element.scrollWidth
  }, [series, plotWidth])

  useEffect(() => setActive(null), [series])

  // Days and hours are both evenly spaced, so both sit on an even grid.
  const xAt = (index: number): number =>
    PAD.side + (count <= 1 ? innerWidth / 2 : (index / (count - 1)) * innerWidth)

  const values = visible.flatMap((def) => drawn.map((point) => point.values[def.key] ?? 0))
  // Round gridlines on one whole-sen step, either side of zero.
  const { floor, ceiling: maxValue, ticks } = axisTicks(values)
  const yAt = (sen: number) => PAD.top + plotHeight - ((sen - floor) / (maxValue - floor)) * plotHeight
  const tickLabel = (sen: number) => (sen < 0 ? `−${formatRinggitShort(-sen)}` : formatRinggitShort(sen))

  const pathFor = (def: SeriesDef) =>
    drawn
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${xAt(index).toFixed(1)},${yAt(point.values[def.key] ?? 0).toFixed(1)}`)
      .join(' ')

  // Axis labels only ever on the hour, whatever the time frame — the frame
  // changes the points and the line, not the clock. Thinned to ~56px apart,
  // always keeping the latest.
  const onTheHour = series.points
    .map((point, index) => ({ index, x: xAt(index), label: pointLabel(series, point.at), at: point.at }))
    .filter((item) => series.kind === 'DAY' || new Date(item.at).getUTCMinutes() === 0)
  const labelGap = onTheHour.length > 1 ? (onTheHour[1]?.x ?? 0) - (onTheHour[0]?.x ?? 0) : innerWidth
  const labelEvery = Math.max(1, Math.ceil(56 / Math.max(1, labelGap)))
  const xLabels = onTheHour.filter((_, position) => (onTheHour.length - 1 - position) % labelEvery === 0)

  function nearestIndex(x: number): number {
    let best = 0
    let bestDistance = Infinity
    for (let index = 0; index < count; index += 1) {
      const distance = Math.abs(xAt(index) - x)
      if (distance < bestDistance) {
        best = index
        bestDistance = distance
      }
    }
    return best
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (count === 0) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const step = event.key === 'ArrowRight' ? 1 : -1
      setActive((current) => Math.min(count - 1, Math.max(0, (current ?? (step > 0 ? -1 : count)) + step)))
    } else if (event.key === 'Escape') {
      setActive(null)
    }
  }

  function toggle(key: string) {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const activePoint = active === null ? null : series.points[active]
  const frameWords = { 240: 'each 4 hours', 60: 'each hour', 30: 'each half hour' }[frame]
  const title = series.kind === 'DAY' ? 'Net sales by day' : 'Net sales by time frame'
  const note = [
    series.kind === 'TIME'
      ? `Net sales in ${frameWords}. Shows order spikes and quiet periods throughout the shift.`
      : null,
    mode === 'CATEGORY'
      ? 'Sale lines only: cancelled sales are left out and exchanges count as first rung up.'
      : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <figure className="m-0">
      <figcaption className="mb-3 space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h3 id={titleId} className="font-display text-lg font-bold tracking-[-0.02em] text-ink">
            {title}
          </h3>
          <div role="group" aria-label="Lines" className="flex border border-line text-xs font-bold">
            {MODES.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={mode === option.key}
                onClick={() => setMode(option.key)}
                className={`min-h-9 px-3 ${
                  mode === option.key ? 'bg-rail text-white' : 'text-muted hover:bg-canvas'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {series.kind === 'TIME' ? (
            <div role="group" aria-label="Time frame" className="flex border border-line font-mono text-xs font-bold">
              {TIME_FRAMES.map((option) => (
                <button
                  key={option.minutes}
                  type="button"
                  aria-pressed={frame === option.minutes}
                  onClick={() => setFrame(option.minutes)}
                  title={{ 240: '4 hours', 60: '1 hour', 30: '30 minutes' }[option.minutes]}
                  className={`min-h-9 px-2.5 ${
                    frame === option.minutes ? 'bg-ink text-white' : 'text-muted hover:bg-canvas'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          {mode === 'CATEGORY' ? (
            <div role="group" aria-label="Brand" className="flex gap-1 text-xs font-bold">
              {brands.map((brand) => (
                <button
                  key={brand.id}
                  type="button"
                  aria-pressed={brandForCategories === brand.id}
                  onClick={() => setCategoryBrandId(brand.id)}
                  className={`min-h-9 border px-3 ${
                    brandForCategories === brand.id
                      ? 'border-ink bg-ink text-white'
                      : 'border-line text-muted hover:bg-canvas'
                  }`}
                >
                  {brand.name}
                </button>
              ))}
            </div>
          ) : null}
          <span className="ml-auto text-xs font-bold text-muted">
            <button
              type="button"
              onClick={() => setShowTable((current) => !current)}
              className="border-b border-dotted border-muted py-1 hover:text-ink"
            >
              {showTable ? 'Show chart' : 'Show as table'}
            </button>
          </span>
        </div>

        {/* Two or more lines: a legend, each one switchable, with its period figure. */}
        {series.defs.length > 1 ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Show or hide lines">
            {series.defs.map((def) => (
              <li key={def.key}>
                <label className="flex min-h-8 cursor-pointer items-center gap-2 text-xs font-bold text-ink">
                  <input
                    type="checkbox"
                    checked={!hidden.has(def.key)}
                    onChange={() => toggle(def.key)}
                    className="size-4 accent-[#173a33]"
                  />
                  <span aria-hidden="true" className="h-0.5 w-4 rounded-full" style={{ backgroundColor: def.colour }} />
                  {def.label}
                  <span className="font-semibold text-muted tabular">{formatRinggit(totals[def.key] ?? 0)}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs font-bold text-muted">
            Total{' '}
            <span className="text-ink tabular">{formatRinggit(totals[series.defs[0]?.key ?? ''] ?? 0)}</span>
          </p>
        )}
        {note ? <p className="text-xs text-muted">{note}</p> : null}
      </figcaption>

      {count === 0 ? (
        <p className="border border-dashed border-line p-8 text-center text-sm font-semibold text-muted">
          No sales {series.kind === 'TIME' ? 'on this day' : 'in this period'}.
        </p>
      ) : showTable ? (
        <div className="scrollbar-subtle max-h-80 overflow-auto border border-line">
          <table className="w-full min-w-max text-sm">
            <thead className="sticky top-0 bg-canvas text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="sticky left-0 bg-canvas p-2 text-left font-bold">
                  {series.kind === 'DAY' ? 'Date' : 'Time'}
                </th>
                {visible.map((def) => (
                  <th key={def.key} className="p-2 text-right font-bold">
                    {def.label}
                  </th>
                ))}
                {visible.length > 1 ? <th className="p-2 text-right font-bold">Total</th> : null}
              </tr>
            </thead>
            <tbody>
              {drawn.map((point, index) => (
                <tr key={`${point.at}-${index}`} className="border-t border-slate-100">
                  <td className="sticky left-0 bg-surface p-2 font-semibold whitespace-nowrap">
                    {pointLabel(series, point.at, true, frame)}
                  </td>
                  {visible.map((def) => (
                    <td key={def.key} className="p-2 text-right tabular whitespace-nowrap">
                      {formatRinggit(point.values[def.key] ?? 0)}
                    </td>
                  ))}
                  {visible.length > 1 ? (
                    <td className="p-2 text-right font-black tabular whitespace-nowrap">
                      {formatRinggit(visible.reduce((sum, def) => sum + (point.values[def.key] ?? 0), 0))}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex">
          {/* The y-axis stays put while a long range scrolls. */}
          <svg width={Y_AXIS_WIDTH} height={HEIGHT} aria-hidden="true" className="shrink-0">
            {ticks.map((tick) => (
              <text
                key={tick}
                x={Y_AXIS_WIDTH - 6}
                y={yAt(tick) + 4}
                textAnchor="end"
                className="fill-slate-400 text-[11px] font-semibold"
              >
                {tickLabel(tick)}
              </text>
            ))}
          </svg>

          <div ref={setScrollElement} className="scrollbar-subtle relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
            <div className="relative" style={{ width: plotWidth, height: HEIGHT }}>
              <svg
                width={plotWidth}
                height={HEIGHT}
                role="img"
                aria-labelledby={titleId}
                tabIndex={0}
                className="block outline-none focus-visible:outline-2 focus-visible:outline-[#e35f27]"
                onPointerMove={(event) => {
                  const box = event.currentTarget.getBoundingClientRect()
                  setActive(nearestIndex(event.clientX - box.left))
                }}
                onPointerLeave={() => setActive(null)}
                onKeyDown={onKeyDown}
                onBlur={() => setActive(null)}
              >
                {/* Recessive grid. */}
                {ticks.map((tick) => (
                  <line
                    key={tick}
                    x1={0}
                    x2={plotWidth}
                    y1={yAt(tick)}
                    y2={yAt(tick)}
                    stroke={tick === 0 ? '#c3c2b7' : 'var(--color-chart-grid)'}
                    strokeWidth={1}
                  />
                ))}

                {/* A lone line gets a faint fill beneath it, stock-chart style. */}
                {visible.length === 1 && visible[0] && lastDrawn >= 0 ? (
                  <path
                    d={`${pathFor(visible[0])} L${xAt(lastDrawn).toFixed(1)},${yAt(Math.max(0, floor)).toFixed(1)} L${xAt(0).toFixed(1)},${yAt(Math.max(0, floor)).toFixed(1)} Z`}
                    fill={visible[0].colour}
                    opacity={0.1}
                  />
                ) : null}

                {visible.map((def) => (
                  <path
                    key={def.key}
                    d={pathFor(def)}
                    fill="none"
                    stroke={def.colour}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}

                {series.kind === 'TIME'
                  ? visible.map((def) =>
                      drawn.map((point, index) => (
                        <circle
                          key={`${def.key}-${point.at}`}
                          cx={xAt(index)}
                          cy={yAt(point.values[def.key] ?? 0)}
                          r={3}
                          fill={def.colour}
                          stroke={SURFACE}
                          strokeWidth={1.5}
                        />
                      )),
                    )
                  : null}

                {xLabels.map((item) => (
                  <text
                    key={`${item.label}-${item.x}`}
                    x={item.x}
                    y={HEIGHT - 9}
                    // Pinned to the edge near either end, so a label is never cut off.
                    textAnchor={item.x > plotWidth - 30 ? 'end' : item.x < 30 ? 'start' : 'middle'}
                    className="fill-slate-400 text-[11px] font-semibold"
                  >
                    {item.label}
                  </text>
                ))}

                {activePoint && active !== null ? (
                  <g aria-hidden="true">
                    <line
                      x1={xAt(active)}
                      x2={xAt(active)}
                      y1={PAD.top}
                      y2={PAD.top + plotHeight}
                      stroke="#18211d"
                      strokeOpacity={0.35}
                      strokeDasharray="3 3"
                    />
                    {(activePoint.isFuture ? [] : visible).map((def) => (
                      <circle
                        key={def.key}
                        cx={xAt(active)}
                        cy={yAt(activePoint.values[def.key] ?? 0)}
                        r={4.5}
                        fill={def.colour}
                        stroke={SURFACE}
                        strokeWidth={2}
                      />
                    ))}
                  </g>
                ) : null}
              </svg>

              {activePoint && active !== null && visible.length > 0 ? (
                <div
                  role="status"
                  className="pointer-events-none absolute top-2 z-10 min-w-40 border border-white/20 bg-rail px-3 py-2 text-xs font-semibold text-white shadow-lg"
                  style={
                    xAt(active) > plotWidth - 190
                      ? { right: plotWidth - xAt(active) + 12 }
                      : { left: xAt(active) + 12 }
                  }
                >
                  <p className="font-black">{pointLabel(series, activePoint.at, true, frame)}</p>
                  {activePoint.isFuture ? <p className="mt-0.5 text-white/70">Still to come</p> : null}
                  {activePoint.isFuture ? null : visible.map((def) => (
                    <p key={def.key} className="mt-0.5 flex items-center gap-2">
                      <span aria-hidden="true" className="h-0.5 w-3 rounded-full" style={{ backgroundColor: def.colour }} />
                      {def.label}
                      <span className="ml-auto pl-3 tabular">{formatRinggit(activePoint.values[def.key] ?? 0)}</span>
                    </p>
                  ))}
                  {visible.length > 1 && !activePoint.isFuture ? (
                    <p className="mt-1 flex border-t border-white/20 pt-1 font-black">
                      Total
                      <span className="ml-auto pl-3 tabular">
                        {formatRinggit(visible.reduce((sum, def) => sum + (activePoint.values[def.key] ?? 0), 0))}
                      </span>
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
      {!showTable && series.kind === 'DAY' && plotWidth > viewport + 1 ? (
        <p className="mt-1 text-right text-[0.7rem] text-muted">Scroll sideways for earlier days.</p>
      ) : null}
    </figure>
  )
}
