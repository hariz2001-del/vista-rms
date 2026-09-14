import { LoaderCircle, LogIn } from 'lucide-react'
import { useState, type FormEvent } from 'react'

type Props = {
  /** Resolves to an error message to show, or null once signed in. */
  onSignIn: (email: string, password: string) => Promise<string | null>
  /** Pre-fill and show the demo partner credentials. Local development only. */
  showDemoHint: boolean
}

/** The owner dashboard's front door. Partner accounts only. */
export function SignInScreen({ onSignIn, showDemoHint }: Props) {
  const [email, setEmail] = useState(showDemoHint ? 'food@vistahub.my' : '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (isBusy) return
    setError(null)
    setIsBusy(true)

    const failure = await onSignIn(email.trim(), password)
    // On success this screen unmounts, so only a failure needs to reset it.
    if (failure) {
      setError(failure)
      setIsBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-canvas p-5">
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="w-full max-w-md border border-line bg-surface p-7 shadow-sm"
      >
        <p className="page-kicker">Vista RMS / owner ledger</p>
        <h1 className="mt-1 text-3xl">Sign in</h1>
        <p className="mt-2 text-sm text-muted">
          Partner accounts only. The counter account cannot open the books.
        </p>

        <label className="mt-6 block">
          <span className="vista-field-label">Email</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="vista-control mt-1 w-full px-3"
          />
        </label>

        <label className="mt-4 block">
          <span className="vista-field-label">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="vista-control mt-1 w-full px-3"
          />
        </label>

        <p className="mt-3 min-h-6 text-sm font-bold text-critical" role="alert">
          {error ?? ''}
        </p>

        <button
          type="submit"
          disabled={isBusy}
          className="vista-button-primary flex min-h-12 w-full items-center justify-center gap-2 disabled:opacity-60"
        >
          {isBusy ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <LogIn aria-hidden="true" className="size-4" />
          )}
          Sign in
        </button>

        {showDemoHint ? (
          <p className="mt-5 border border-line bg-canvas p-3 text-xs text-muted">
            Demo partners — <span className="font-mono">food@vistahub.my</span> (Hariz) or{' '}
            <span className="font-mono">drinks@vistahub.my</span> (Iman), password{' '}
            <span className="font-mono">vista</span>
          </p>
        ) : null}
      </form>
    </div>
  )
}
