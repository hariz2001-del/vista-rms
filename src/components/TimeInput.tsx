const pad = (n: number) => String(n).padStart(2, '0')
const HOURS = Array.from({ length: 24 }, (_, hour) => pad(hour))

/**
 * A 24-hour time, `HH:MM`, as two dropdowns. Not `<input type="time">`: that
 * shows AM/PM on any browser set to US English, whatever the page asks for.
 *
 * `optional` adds a blank choice, which clears the time to ''.
 */
export function TimeInput({
  value,
  onChange,
  minuteStep = 1,
  optional = false,
  className = '',
  label,
}: {
  value: string
  onChange: (value: string) => void
  minuteStep?: number
  optional?: boolean
  className?: string
  label?: string
}) {
  const [hour = '', minute = ''] = value ? value.split(':') : []
  const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, index) => pad(index * minuteStep))
  // A time saved off the step (say 16:47 with 5-minute steps) still shows as itself.
  if (minute && !minutes.includes(minute)) minutes.push(minute)
  minutes.sort()

  return (
    <span className="flex items-center gap-1">
      <select
        value={hour}
        aria-label={label ? `${label}, hour` : 'Hour'}
        onChange={(event) => onChange(event.target.value ? `${event.target.value}:${minute || '00'}` : '')}
        className={`${className} min-w-0 flex-1`}
      >
        {optional || !hour ? <option value="">--</option> : null}
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span aria-hidden="true" className="font-bold">
        :
      </span>
      <select
        value={minute}
        aria-label={label ? `${label}, minutes` : 'Minutes'}
        disabled={!hour}
        onChange={(event) => onChange(`${hour}:${event.target.value}`)}
        className={`${className} min-w-0 flex-1 disabled:opacity-50`}
      >
        {!minute ? <option value="">--</option> : null}
        {minutes.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </span>
  )
}
