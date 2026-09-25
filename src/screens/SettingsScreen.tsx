import { useState } from 'react'
import { Panel, SectionHeading } from '../components/primitives.tsx'
import type { VistaStore } from '../data/store.ts'

function clock(iso: string): string {
  return new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(iso))
}

/**
 * A name, saved when the field is left. Keyed on the saved name by its parent,
 * so a change arriving from the server replaces the draft.
 */
function NameField({
  name,
  label,
  maxLength = 60,
  onSave,
}: {
  name: string
  label: string
  maxLength?: number
  onSave: (next: string) => void
}) {
  const [draft, setDraft] = useState(name)

  function commit() {
    const next = draft.trim()
    if (next && next !== name) onSave(next)
    else setDraft(name)
  }

  return (
    <input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
      maxLength={maxLength}
      aria-label={label}
      className="vista-control w-full max-w-xs px-3 text-sm font-black"
    />
  )
}

/**
 * Partner settlement is for a stall shared by two partners, one brand each.
 * Off by default, so a solo shop never sees partners, splits or payouts.
 */
function SettlementSwitch({ store }: { store: VistaStore }) {
  const on = store.settings.settlementEnabled
  const hasTwoBrands = store.brands.length === 2

  return (
    <Panel>
      <SectionHeading
        title="Partner settlement"
        hint="For a stall shared by two partners, each owning one brand. Splits shared costs between them and works out who pays whom each period."
      />
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-black">{on ? 'On' : 'Off'}</span>
        <button
          type="button"
          disabled={!on && !hasTwoBrands}
          onClick={() => store.setSettings({ ...store.settings, settlementEnabled: !on })}
          className="vista-button-secondary min-h-11 px-4 disabled:opacity-50"
        >
          {on ? 'Turn off' : 'Turn on'}
        </button>
        {!on && !hasTwoBrands ? (
          <p className="text-xs font-semibold text-muted">
            Needs exactly two brands, one per partner. Add them in Menu first.
          </p>
        ) : null}
        {on ? (
          <p className="text-xs font-semibold text-muted">
            Turning it off hides settlement. Nothing already settled changes.
          </p>
        ) : null}
      </div>
    </Panel>
  )
}

/**
 * The counter tablet stays signed in, so the cashier only ever needs the PIN.
 * This is the one place it can be signed out — for a lost, stolen or replaced
 * tablet.
 */
function CounterPanel({ store }: { store: VistaStore }) {
  const [confirming, setConfirming] = useState(false)
  const sessions = store.counterSessions

  return (
    <Panel>
      <SectionHeading
        title="Counter tablet"
        hint="The counter stays signed in, so the cashier only needs the PIN. Sign it out here if the tablet is lost or replaced."
      />

      {sessions.length === 0 ? (
        <p className="text-sm font-semibold text-muted">
          The counter is not signed in. Sign in on the tablet with the business account.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100 text-sm">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="font-black">Signed in {clock(session.signedInAt)}</span>
                <span className="font-semibold text-muted">
                  last active {clock(session.lastUsedAt)}
                </span>
              </li>
            ))}
          </ul>

          {confirming ? (
            <div className="mt-3 border border-line bg-canvas p-3">
              <p className="text-sm font-bold">Sign the counter out?</p>
              <p className="mt-1 text-xs text-muted">
                The tablet goes back to its sign-in screen the next time it reaches the server. Sales
                it has not sent yet stay on it and send once it is signed in again. A tablet that is
                offline only finds out when it reconnects.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    store.signOutCounter()
                    setConfirming(false)
                  }}
                  className="vista-button-primary min-h-11 px-4"
                >
                  Sign out the counter
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="vista-button-secondary min-h-11 px-4"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="vista-button-secondary mt-3 min-h-11 px-4"
            >
              Sign out the counter…
            </button>
          )}
        </>
      )}
    </Panel>
  )
}

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
  const showSplit = store.settings.settlementEnabled && food !== undefined && drinks !== undefined

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="border-b border-line pb-5">
        <p className="page-kicker">Business rules / effective now</p>
        <h1 className="mt-1 text-3xl sm:text-[2.65rem]">Settings</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Changes apply from now on. Anything already recorded keeps the figures it was recorded
          with, so a past month can never be quietly rewritten.
        </p>
      </div>

      <Panel>
        <SectionHeading title="Business" />
        <dl className="divide-y divide-slate-100 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 py-2">
            <dt className="font-semibold text-muted">Business name</dt>
            <dd>
              <NameField
                key={store.settings.businessName}
                name={store.settings.businessName}
                label="Business name"
                maxLength={80}
                onSave={(businessName) => store.setSettings({ ...store.settings, businessName })}
              />
            </dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 py-2">
            <dt className="font-semibold text-muted">Outlet</dt>
            <dd>
              <NameField
                key={store.settings.outletName}
                name={store.settings.outletName}
                label="Outlet name"
                maxLength={80}
                onSave={(outletName) => store.setSettings({ ...store.settings, outletName })}
              />
            </dd>
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

      <SettlementSwitch store={store} />

      {showSplit ? <SplitPanels store={store} food={food} drinks={drinks} /> : null}

      <CounterPanel store={store} />
    </div>
  )
}

/** The split and the partners. Only for a business with settlement switched on. */
function SplitPanels({
  store,
  food,
  drinks,
}: {
  store: VistaStore
  food: VistaStore['brands'][number]
  drinks: VistaStore['brands'][number]
}) {
  return (
    <>
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
        <SectionHeading
          title="Partners"
          hint="The names settlement pays. Not logins — the business has one account."
        />
        <ul className="divide-y divide-slate-100">
          {store.partners.map((partner) => (
            <li key={partner.id} className="flex items-center gap-3 py-3">
              <div className="flex-1">
                <NameField
                  key={`${partner.id}:${partner.name}`}
                  name={partner.name}
                  label="Partner name"
                  onSave={(next) => store.renamePartner(partner.id, next)}
                />
                <p className="mt-1 text-xs font-semibold text-muted">
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
    </>
  )
}
