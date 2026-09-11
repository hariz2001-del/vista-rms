import { useMemo, useState } from 'react'
import { AppShell, type ScreenKey } from './components/AppShell.tsx'
import { StatusBanner } from './components/StatusBanner.tsx'
import { useVistaStore } from './data/store.ts'
import { attentionItems } from './domain/selectors.ts'
import { CashflowScreen } from './screens/CashflowScreen.tsx'
import { ExpensesScreen } from './screens/ExpensesScreen.tsx'
import { MenuScreen } from './screens/MenuScreen.tsx'
import { OverviewScreen } from './screens/OverviewScreen.tsx'
import { SettingsScreen } from './screens/SettingsScreen.tsx'
import { SettlementScreen } from './screens/SettlementScreen.tsx'

export default function App() {
  const store = useVistaStore()
  const [screen, setScreen] = useState<ScreenKey>('overview')

  const attentionCount = useMemo(
    () => attentionItems(store.shifts, store.orders, store.expenses).length,
    [store.shifts, store.orders, store.expenses],
  )

  return (
    <AppShell
      current={screen}
      onNavigate={setScreen}
      businessName={store.settings.businessName}
      outletName={store.settings.outletName}
      attentionCount={attentionCount}
      banner={<StatusBanner store={store} />}
    >
      {screen === 'overview' ? <OverviewScreen store={store} onNavigate={setScreen} /> : null}
      {screen === 'cashflow' ? <CashflowScreen store={store} /> : null}
      {screen === 'expenses' ? <ExpensesScreen store={store} /> : null}
      {screen === 'settlement' ? <SettlementScreen store={store} /> : null}
      {screen === 'menu' ? <MenuScreen store={store} /> : null}
      {screen === 'settings' ? <SettingsScreen store={store} /> : null}
    </AppShell>
  )
}
