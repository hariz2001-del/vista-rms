import { useEffect, useMemo, useState } from 'react'
import { AppShell, type ScreenKey } from './components/AppShell.tsx'
import { BannerPreviewControls, StatusBanner } from './components/StatusBanner.tsx'
import { useApiStore } from './data/api-store.ts'
import { useDemoStore } from './data/store.ts'
import { attentionItems } from './domain/selectors.ts'
import { ApiError, onSessionExpired } from './lib/http.ts'
import { IS_DEMO } from './lib/mode.ts'
import { hasSession, signIn, signOut } from './lib/session.ts'
import { CashflowScreen } from './screens/CashflowScreen.tsx'
import { ExpensesScreen } from './screens/ExpensesScreen.tsx'
import { MenuScreen } from './screens/MenuScreen.tsx'
import { OverviewScreen } from './screens/OverviewScreen.tsx'
import { SettingsScreen } from './screens/SettingsScreen.tsx'
import { SettlementScreen } from './screens/SettlementScreen.tsx'
import { SignInScreen } from './screens/SignInScreen.tsx'

/**
 * Chosen once per build, never per render, so the hook order is stable: the
 * generated demo history, or the real books from api-vista.
 */
const useStore = IS_DEMO ? useDemoStore : useApiStore

export default function App() {
  const [signedIn, setSignedIn] = useState(() => IS_DEMO || hasSession())
  const store = useStore(signedIn)
  const [screen, setScreen] = useState<ScreenKey>('overview')

  // A rejected token anywhere sends the owner back to the sign-in screen.
  useEffect(() => onSessionExpired(() => setSignedIn(false)), [])

  const attentionCount = useMemo(
    () => attentionItems(store.expenses, store.corrections).length,
    [store.expenses, store.corrections],
  )

  async function handleSignIn(email: string, password: string): Promise<string | null> {
    try {
      await signIn(email, password)
      setSignedIn(true)
      return null
    } catch (error) {
      if (error instanceof ApiError) return error.message
      return 'Cannot reach the server. Check the connection and try again.'
    }
  }

  function handleSignOut() {
    signOut()
    setSignedIn(false)
  }

  if (!signedIn) {
    return <SignInScreen onSignIn={handleSignIn} showDemoHint={import.meta.env.DEV} />
  }

  if (store.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas p-5 text-center">
        <div>
          <p className="page-kicker">Vista RMS</p>
          <p className="mt-2 text-lg font-bold">Opening the books…</p>
          {store.error ? (
            <p className="mt-2 max-w-sm text-sm text-critical" role="alert">
              {store.error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-5 min-h-11 px-3 text-sm font-bold text-muted underline"
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return (
    <AppShell
      current={screen}
      onNavigate={setScreen}
      businessName={store.settings.businessName}
      outletName={store.settings.outletName}
      attentionCount={attentionCount}
      isDemo={IS_DEMO}
      onSignOut={IS_DEMO ? undefined : handleSignOut}
      banner={
        <>
          {store.error ? (
            <div
              role="alert"
              className="flex min-h-11 shrink-0 flex-wrap items-center gap-3 bg-critical px-4 py-2 text-sm font-bold text-white sm:px-6"
            >
              {store.error}
              <button
                type="button"
                onClick={store.dismissError}
                className="ml-auto min-h-9 px-2 text-xs underline"
              >
                Dismiss
              </button>
            </div>
          ) : null}
          <StatusBanner store={store} />
          <BannerPreviewControls store={store} />
        </>
      }
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
