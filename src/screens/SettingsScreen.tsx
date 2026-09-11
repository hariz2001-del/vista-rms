import { Panel, SectionHeading } from '../components/primitives.tsx'
import type { VistaStore } from '../data/store.ts'

/** Two values that must always total 100. Moving one moves the other. */
function RatioSlider({
  label,
  hint,
  leftName,
  leftColour,
  rightName,
  rightColour,
  value,
  onChange,
}: {
  label: string
  hint: string
  leftName: string
  leftColour: string
  rightName: string
  rightColour: string
  value: number
  onChange: (next: number) => void
}) {
  return (
    <div className="py-4">
      <p className="text-sm font-black text-ink">{label}</p>
      <p className="mt-0.5 text-xs font-semibold text-muted">{hint}</p>

      <div className="mt-3 flex items-center justify-between text-sm font-black">
        <span style={{ color: leftColour }}>
          {leftName} {value}%
        </span>
        <span style={{ color: rightColour }}>
          {rightName} {100 - value}%
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
        className="mt-2 w-full"
      />

      <div className="mt-1 flex gap-2">
        {[70, 60, 50, 40, 30].map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            className={`border px-2 py-1 text-xs font-bold ${
              value === preset ? 'border-rail bg-rail text-white' : 'border-line text-slate-600'
            }`}
          >
            {preset}/{100 - preset}
          </button>
        ))}
      </div>
    </div>
  )
}

export function SettingsScreen({ store }: { store: VistaStore }) {
  const food = store.brands[0]
  const drinks = store.brands[1]
  if (!food || !drinks) return null

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="border-b border-line pb-5">
        <p className="page-kicker">Business rules / effective now</p>
        <h1 className="mt-1 text-3xl sm:text-[2.65rem]">Settings</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Changing a ratio applies from now on. Expenses already logged keep the split they were
          recorded with, so a past month can never be quietly rewritten.
        </p>
      </div>

      <Panel>
        <SectionHeading title="Business" />
        <dl className="divide-y divide-slate-100 text-sm">
          <div className="flex justify-between py-2">
            <dt className="font-semibold text-muted">Business name</dt>
            <dd className="font-black">{store.settings.businessName}</dd>
          </div>
          <div className="flex justify-between py-2">
            <dt className="font-semibold text-muted">Outlet</dt>
            <dd className="font-black">{store.settings.outletName}</dd>
          </div>
          <div className="flex justify-between py-2">
            <dt className="font-semibold text-muted">Trading day rolls over</dt>
            <dd className="font-black">5:00 am</dd>
          </div>
          <div className="flex justify-between py-2">
            <dt className="font-semibold text-muted">Payment</dt>
            <dd className="font-black">DuitNow QR only</dd>
          </div>
        </dl>
      </Panel>

      <Panel>
        <SectionHeading title="Brands" hint="Brand decides how sales and costs are attributed." />
        <ul className="divide-y divide-slate-100">
          {store.brands.map((brand) => (
            <li key={brand.id} className="flex items-center gap-3 py-3">
              <span
                aria-hidden="true"
                className="size-8 shrink-0"
                style={{ backgroundColor: brand.colour }}
              />
              <span className="flex-1 text-sm font-black">{brand.name}</span>
              <span className="font-mono text-xs text-muted">{brand.colour}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <SectionHeading title="How money is split" />

        <RatioSlider
          label="Shared overheads"
          hint="Rent, utilities, packaging — anything neither brand owns outright."
          leftName={food.name}
          leftColour={food.chartColour}
          rightName={drinks.name}
          rightColour={drinks.chartColour}
          value={store.settings.sharedOverheadFoodPct}
          onChange={(next) =>
            store.setSettings({ ...store.settings, sharedOverheadFoodPct: next })
          }
        />

        <RatioSlider
          label="Shared equipment"
          hint="Chillers, freezers, fryers. A capital responsibility, separate from the overhead split."
          leftName={food.name}
          leftColour={food.chartColour}
          rightName={drinks.name}
          rightColour={drinks.chartColour}
          value={store.settings.capitalAssetFoodPct}
          onChange={(next) => store.setSettings({ ...store.settings, capitalAssetFoodPct: next })}
        />

        <div className="border-t border-slate-100 py-4">
          <p className="text-sm font-black text-ink">Host commission</p>
          <p className="mt-0.5 text-xs font-semibold text-muted">
            The host&apos;s share of the {food.name} operating result. Never charged on a loss; an
            unrecovered loss carries forward instead.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={50}
              step={5}
              value={store.settings.hostCommissionPct}
              onChange={(event) =>
                store.setSettings({
                  ...store.settings,
                  hostCommissionPct: Number(event.target.value),
                })
              }
              aria-label="Host commission percentage"
              className="flex-1"
            />
            <span className="w-14 text-right text-lg font-black tabular">
              {store.settings.hostCommissionPct}%
            </span>
          </div>
        </div>
      </Panel>

      <Panel>
        <SectionHeading title="Partners" />
        <ul className="divide-y divide-slate-100">
          {store.partners.map((partner) => (
            <li key={partner.id} className="flex items-center gap-3 py-3">
              <div className="flex-1">
                <p className="text-sm font-black">{partner.name}</p>
                <p className="text-xs font-semibold text-muted">
                  {partner.role === 'FOOD_OWNER' ? 'Food brand owner' : 'Stall host'}
                </p>
              </div>
              <span
                className="px-2 py-1 text-xs font-bold text-white"
                style={{
                  backgroundColor: store.brands.find((b) => b.id === partner.brandId)?.colour,
                }}
              >
                {store.brands.find((b) => b.id === partner.brandId)?.name}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}
