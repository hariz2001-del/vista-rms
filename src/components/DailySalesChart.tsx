import { useId, useState } from 'react'
import { formatRinggit, formatRinggitShort } from '../domain/money.ts'
import type { Brand } from '../domain/types.ts'

export type DailyPoint = {
  date: string
  /** Keyed by brand id, in the same fixed order as `brands`. */
  byBrand: Record<string, number>
  totalSen: number
}

type Props = {
  points: DailyPoint[]
  brands: Brand[]
}

const WIDTH = 900
const HEIGHT = 240
const PAD = { top: 12, right: 8, bottom: 26, left: 52 }
/** A 2px gap between stacked segments so the two brands never fuse into one bar. */
const SEGMENT_GAP = 2

function niceCeiling(value: number): number {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return Math.ceil(value / magnitude) * magnitude
}

/** Only the data end — the top of the stack — is rounded; the baseline stays square. */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.max(0, Math.min(r, h, w / 2))
  return [
    `M${x},${y + h}`,
    `L${x},${y + radius}`,
    `Q${x},${y} ${x + radius},${y}`,
    `L${x + w - radius},${y}`,
    `Q${x + w},${y} ${x + w},${y + radius}`,
    `L${x + w},${y + h}`,
    'Z',
  ].join(' ')
}

function dayLabel(date: string): string {
  return new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  )
}

/**
 * Daily net sales, stacked by brand.
 *
 * Stacked rather than grouped because the question the owner asks first is "how
 * much did we take", and the brand split is the follow-up. One y-axis only —
 * both series are the same measure in the same unit.
 */
export function DailySalesChart({ points, brands }: Props) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  const titleId = useId()

  if (points.length === 0) {
    return <p className="p-6 text-center text-sm font-semibold text-muted">No trading yet.</p>
  }

  const plotWidth = WIDTH - PAD.left - PAD.right
  const plotHeight = HEIGHT - PAD.top - PAD.bottom
  const maxSen = niceCeiling(Math.max(...points.map((point) => point.totalSen)))
  const step = plotWidth / points.length
  const barWidth = Math.max(2, Math.min(26, step * 0.68))
  const yFor = (sen: number) => PAD.top + plotHeight - (sen / maxSen) * plotHeight
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(maxSen * fraction))
  // Label density follows the data: every bar for a short month, thinned out
  // for a long one, so the axis never ends up with a single lonely tick.
  const labelEvery = points.length <= 10 ? 1 : Math.ceil(points.length / 8)

  const active = hovered === null ? null : points[hovered]

  return (
    <figure className="m-0">
      <figcaption className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h3 id={titleId} className="font-display text-lg font-bold tracking-[-0.02em] text-ink">
          Net sales by day
        </h3>
        {/* Two series, so a legend is always present — identity is never colour alone. */}
        <ul className="flex flex-wrap items-center gap-3">
          {brands.map((brand) => (
            <li key={brand.id} className="flex items-center gap-1.5 text-xs font-bold text-muted">
              <span
                aria-hidden="true"
                className="size-3 rounded-sm"
                style={{ backgroundColor: brand.chartColour }}
              />
              {brand.name}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setShowTable((current) => !current)}
          className="ml-auto border-b border-dotted border-muted px-0 py-1 text-xs font-bold text-muted hover:text-ink"
        >
          {showTable ? 'Show chart' : 'Show as table'}
        </button>
      </figcaption>

      {showTable ? (
        <div className="scrollbar-subtle max-h-72 overflow-y-auto border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="p-2 text-left font-bold">Date</th>
                {brands.map((brand) => (
                  <th key={brand.id} className="p-2 text-right font-bold">
                    {brand.name}
                  </th>
                ))}
                <th className="p-2 text-right font-bold">Total</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.date} className="border-t border-slate-100">
                  <td className="p-2 font-semibold">{dayLabel(point.date)}</td>
                  {brands.map((brand) => (
                    <td key={brand.id} className="p-2 text-right tabular">
                      {formatRinggit(point.byBrand[brand.id] ?? 0)}
                    </td>
                  ))}
                  <td className="p-2 text-right font-black tabular">
                    {formatRinggit(point.totalSen)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="w-full"
            role="img"
            aria-labelledby={titleId}
            onMouseLeave={() => setHovered(null)}
          >
            {/* Recessive grid: thin, light, behind everything. */}
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={PAD.left}
                  x2={WIDTH - PAD.right}
                  y1={yFor(tick)}
                  y2={yFor(tick)}
                  stroke="var(--color-chart-grid)"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={yFor(tick) + 4}
                  textAnchor="end"
                  className="fill-slate-400 text-[11px] font-semibold"
                >
                  {formatRinggitShort(tick)}
                </text>
              </g>
            ))}

            {points.map((point, index) => {
              const x = PAD.left + index * step + (step - barWidth) / 2
              let cursorY = PAD.top + plotHeight
              const isHovered = hovered === index

              return (
                <g
                  key={point.date}
                  onMouseEnter={() => setHovered(index)}
                  onFocus={() => setHovered(index)}
                  tabIndex={-1}
                >
                  {/* Hit target wider than the mark itself. */}
                  <rect
                    x={PAD.left + index * step}
                    y={PAD.top}
                    width={step}
                    height={plotHeight}
                    fill={isHovered ? 'rgba(15,23,42,0.04)' : 'transparent'}
                  />
                  {brands.map((brand, brandIndex) => {
                    const value = point.byBrand[brand.id] ?? 0
                    if (value <= 0) return null
                    const rawHeight = (value / maxSen) * plotHeight
                    const gap = brandIndex === 0 ? 0 : SEGMENT_GAP
                    const height = Math.max(1, rawHeight - gap)
                    const y = cursorY - height
                    cursorY -= rawHeight
                    const isTop = brandIndex === brands.length - 1
                    return isTop ? (
                      <path
                        key={brand.id}
                        d={roundedTop(x, y, barWidth, height, 4)}
                        fill={brand.chartColour}
                        opacity={hovered === null || isHovered ? 1 : 0.45}
                      />
                    ) : (
                      <rect
                        key={brand.id}
                        x={x}
                        y={y}
                        width={barWidth}
                        height={height}
                        fill={brand.chartColour}
                        opacity={hovered === null || isHovered ? 1 : 0.45}
                      />
                    )
                  })}
                </g>
              )
            })}

            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={PAD.top + plotHeight}
              y2={PAD.top + plotHeight}
              stroke="#cbd5e1"
              strokeWidth={1}
            />

            {/* Selective labels only — never a number on every bar. */}
            {points.map((point, index) =>
              index % labelEvery === 0 ? (
                <text
                  key={point.date}
                  x={PAD.left + index * step + step / 2}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                  className="fill-slate-400 text-[11px] font-semibold"
                >
                  {dayLabel(point.date)}
                </text>
              ) : null,
            )}
          </svg>

          {active ? (
            <div
              className="pointer-events-none absolute top-2 border border-white/20 bg-rail px-3 py-2 text-xs font-semibold text-white shadow-lg"
              style={{
                left: `${Math.min(78, ((hovered ?? 0) / points.length) * 100 + 2)}%`,
              }}
              role="status"
            >
              <p className="font-black">{dayLabel(active.date)}</p>
              {brands.map((brand) => (
                <p key={brand.id} className="mt-0.5 flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-sm"
                    style={{ backgroundColor: brand.chartColour }}
                  />
                  {brand.name}
                  <span className="ml-auto tabular">{formatRinggit(active.byBrand[brand.id] ?? 0)}</span>
                </p>
              ))}
              <p className="mt-1 border-t border-white/20 pt-1 tabular font-black">
                {formatRinggit(active.totalSen)}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </figure>
  )
}
