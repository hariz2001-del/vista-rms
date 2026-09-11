import type { CSSProperties, ReactNode } from 'react'
import { formatRinggit } from '../domain/money.ts'

/**
 * Money always renders through here, with tabular figures so a column of
 * amounts lines up, and a semantic tone rather than a raw colour.
 */
export function Money({
  sen,
  tone = 'default',
  className = '',
}: {
  sen: number
  tone?: 'default' | 'in' | 'out' | 'muted'
  className?: string
}) {
  const toneClass =
    tone === 'in'
      ? 'text-good'
      : tone === 'out'
        ? 'text-serious'
        : tone === 'muted'
          ? 'text-muted'
          : 'text-ink'
  return <span className={`tabular ${toneClass} ${className}`}>{formatRinggit(sen)}</span>
}

export function StatTile({
  label,
  value,
  sub,
  tone = 'default',
  hero = false,
  className = '',
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'default' | 'good' | 'warning' | 'critical'
  hero?: boolean
  className?: string
}) {
  const edge =
    tone === 'good'
      ? 'border-good/45'
      : tone === 'warning'
        ? 'border-warning/45'
        : tone === 'critical'
          ? 'border-critical/45'
          : 'border-line'

  return (
    <div className={`relative border-t bg-surface px-4 py-4 ${edge} ${className}`}>
      <p className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className={`mt-2 font-mono font-bold tabular tracking-[-0.04em] ${hero ? 'text-3xl sm:text-[2.55rem]' : 'text-[1.45rem]'}`}>
        {value}
      </p>
      {sub ? <p className="mt-1 max-w-[48ch] text-xs leading-relaxed text-muted">{sub}</p> : null}
    </div>
  )
}

/** Status is never colour alone — every badge carries its own words. */
export function Badge({
  children,
  tone = 'neutral',
  icon,
}: {
  children: ReactNode
  tone?: 'neutral' | 'good' | 'warning' | 'critical' | 'info'
  icon?: ReactNode
}) {
  const styles = {
    neutral: 'bg-slate-100 text-slate-700',
    good: 'bg-green-100 text-good',
    warning: 'bg-amber-100 text-warning',
    critical: 'bg-red-100 text-critical',
    info: 'bg-sky-100 text-sky-800',
  }[tone]

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-1 font-mono text-[0.65rem] font-bold ${styles}`}
    >
      {icon}
      {children}
    </span>
  )
}

export function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 className="font-display text-xl font-bold tracking-[-0.025em] text-ink">{title}</h2>
      {hint ? <p className="mt-1 max-w-[70ch] text-sm leading-relaxed text-muted">{hint}</p> : null}
    </div>
  )
}

export function Panel({
  children,
  className = '',
  style,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <div
      style={style}
      className={`border border-line bg-surface p-4 shadow-[0_1px_0_rgba(24,33,29,0.04)] ${className}`}
    >
      {children}
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="grid place-items-center border border-dashed border-line bg-surface p-10 text-center">
      <div>
        <p className="font-black text-ink">{title}</p>
        {hint ? <p className="mt-1 text-sm font-semibold text-muted">{hint}</p> : null}
      </div>
    </div>
  )
}

/** A brand identity dot. Uses the brand's identity colour, not its chart colour. */
export function BrandDot({ colour, name }: { colour: string; name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: colour }}
      />
      {name}
    </span>
  )
}
