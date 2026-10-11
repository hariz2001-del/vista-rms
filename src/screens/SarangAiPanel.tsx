import { Bot, Copy, KeyRound, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Panel, SectionHeading } from '../components/primitives.tsx'
import { dateTimeText } from '../data/roster-api.ts'
import { errorText, useLoad } from '../data/team-api.ts'
import { apiRequest } from '../lib/http.ts'

/**
 * Sarang AI: the bookkeeping assistant on Telegram (a Hermes agent). Here the
 * owner makes the key it signs in with and lists who may talk to it. The API
 * enforces both on every call; the assistant cannot widen them itself.
 */

type AgentRole = 'OWNER' | 'BOOKKEEPER' | 'VIEWER'
type AgentKey = { id: string; label: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }
type AgentUser = { id: string; telegramUserId: string; name: string; role: AgentRole; isActive: boolean }
type AgentSetup = { keys: AgentKey[]; users: AgentUser[]; openReceipts: number }

const ROLES: Array<{ value: AgentRole; label: string; hint: string }> = [
  { value: 'BOOKKEEPER', label: 'Bookkeeper', hint: 'Send and sort receipts, post them to the books, ask anything' },
  { value: 'VIEWER', label: 'Viewer', hint: 'Ask questions and get reports; cannot change anything' },
  { value: 'OWNER', label: 'Owner', hint: 'Everything a bookkeeper can' },
]

const agentApi = {
  load: () => apiRequest<AgentSetup>('GET', '/rms/agent'),
  createKey: (label: string) => apiRequest<{ id: string; key: string }>('POST', '/rms/agent/keys', { label }),
  revokeKey: (id: string) => apiRequest('POST', `/rms/agent/keys/${id}/revoke`),
  addUser: (body: { telegramUserId: string; name: string; role: AgentRole }) => apiRequest('POST', '/rms/agent/users', body),
  updateUser: (id: string, body: Partial<Pick<AgentUser, 'name' | 'role' | 'isActive'>>) => apiRequest('PATCH', `/rms/agent/users/${id}`, body),
}

export function SarangAiPanel() {
  const { data, error, reload } = useLoad(agentApi.load)
  const [fresh, setFresh] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [telegramUserId, setTelegramUserId] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<AgentRole>('BOOKKEEPER')

  async function run(action: () => Promise<unknown>) {
    setProblem(null)
    try {
      await action()
      reload()
      return true
    } catch (caught) {
      setProblem(errorText(caught))
      return false
    }
  }

  async function makeKey() {
    if (data?.keys.some((key) => !key.revokedAt) && !window.confirm('Make another key? The current one keeps working until you revoke it.')) return
    setProblem(null)
    try {
      const made = await agentApi.createKey('Sarang Hermes')
      setFresh(made.key)
      setCopied(false)
      reload()
    } catch (caught) {
      setProblem(errorText(caught))
    }
  }

  async function addUser(event: FormEvent) {
    event.preventDefault()
    if (await run(() => agentApi.addUser({ telegramUserId: telegramUserId.trim(), name: name.trim(), role }))) {
      setTelegramUserId('')
      setName('')
    }
  }

  return (
    <Panel>
      <SectionHeading
        title="Sarang AI"
        hint="The bookkeeping assistant on Telegram. It signs in with the key below, and only answers the Telegram accounts listed here — each limited to its role."
      />
      {error && !data ? <p className="text-sm font-bold text-serious">{error}</p> : null}
      {problem ? (
        <p role="alert" className="mb-3 text-sm font-bold text-serious">
          {problem}
        </p>
      ) : null}

      {data ? (
        <div className="space-y-6">
          {data.openReceipts > 0 ? (
            <p className="flex items-center gap-2 bg-canvas p-3 text-sm font-bold">
              <Bot aria-hidden="true" className="size-4" /> {data.openReceipts} receipt{data.openReceipts === 1 ? '' : 's'} waiting to be sorted.
            </p>
          ) : null}

          <section className="space-y-2">
            <h3 className="text-sm font-black uppercase tracking-wider text-muted">Key</h3>
            {fresh ? (
              <div className="space-y-2 border-2 border-rail bg-surface p-3">
                <p className="text-sm font-bold">Copy this key now — it is shown only once. Put it in the Sarang Hermes .env as VISTA_AGENT_KEY.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 break-all bg-canvas px-2 py-1 font-mono text-xs">{fresh}</code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(fresh).then(() => setCopied(true))
                    }}
                    className="vista-button-secondary flex min-h-10 items-center gap-2"
                  >
                    <Copy aria-hidden="true" className="size-4" /> {copied ? 'Copied' : 'Copy'}
                  </button>
                  <button type="button" onClick={() => setFresh(null)} className="min-h-10 px-2 text-sm font-bold text-muted underline">
                    Done
                  </button>
                </div>
              </div>
            ) : null}
            <ul className="divide-y divide-slate-100">
              {data.keys.map((key) => (
                <li key={key.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <KeyRound aria-hidden="true" className="size-4 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="font-bold">{key.label}</span>
                    <span className="block text-xs text-muted">
                      Made {dateTimeText(key.createdAt)}
                      {key.lastUsedAt ? ` · last used ${dateTimeText(key.lastUsedAt)}` : ' · not used yet'}
                    </span>
                  </span>
                  {key.revokedAt ? (
                    <span className="text-xs font-bold text-muted">Revoked</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('Revoke this key? Sarang AI stops working until it has a new one.')) void run(() => agentApi.revokeKey(key.id))
                      }}
                      className="min-h-9 border border-critical/40 px-3 text-xs font-bold text-critical"
                    >
                      Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => void makeKey()} className="vista-button-secondary flex min-h-11 items-center gap-2">
              <Plus aria-hidden="true" className="size-4" /> {data.keys.length === 0 ? 'Make the key' : 'Make a new key'}
            </button>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-black uppercase tracking-wider text-muted">Who may use it</h3>
            {data.users.length === 0 ? (
              <p className="text-sm text-muted">Nobody yet. Add your own Telegram account first (message @userinfobot on Telegram for your number).</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.users.map((user) => (
                  <li key={user.id} className={`flex flex-wrap items-center gap-3 py-2 text-sm ${user.isActive ? '' : 'opacity-60'}`}>
                    <span className="min-w-0 flex-1">
                      <span className="font-bold">{user.name}</span>
                      <span className="block font-mono text-xs text-muted">Telegram {user.telegramUserId}</span>
                    </span>
                    <select
                      value={user.role}
                      aria-label={`${user.name}'s role`}
                      onChange={(event) => void run(() => agentApi.updateUser(user.id, { role: event.target.value as AgentRole }))}
                      className="vista-control min-h-9 px-2 text-sm"
                    >
                      {ROLES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void run(() => agentApi.updateUser(user.id, { isActive: !user.isActive }))}
                      className="min-h-9 border border-line px-3 text-xs font-bold"
                    >
                      {user.isActive ? 'Turn off' : 'Turn on'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={(event) => void addUser(event)} className="grid gap-2 border border-line bg-canvas p-3 sm:grid-cols-[10rem_minmax(0,1fr)_10rem_auto] sm:items-end">
              <label className="block">
                <span className="vista-field-label">Telegram user id</span>
                <input
                  value={telegramUserId}
                  onChange={(event) => setTelegramUserId(event.target.value.replace(/\D/g, ''))}
                  inputMode="numeric"
                  placeholder="304348232"
                  className="vista-control mt-1 w-full px-2 font-mono"
                />
              </label>
              <label className="block">
                <span className="vista-field-label">Name</span>
                <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="Kirko" className="vista-control mt-1 w-full px-2" />
              </label>
              <label className="block">
                <span className="vista-field-label">Role</span>
                <select value={role} onChange={(event) => setRole(event.target.value as AgentRole)} className="vista-control mt-1 w-full px-2" title={ROLES.find((r) => r.value === role)?.hint}>
                  {ROLES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={!telegramUserId || !name.trim()} className="vista-button-primary min-h-11 px-4 disabled:opacity-50">
                Add
              </button>
            </form>
            <p className="text-xs text-muted">{ROLES.map((option) => `${option.label}: ${option.hint}.`).join(' ')}</p>
          </section>
        </div>
      ) : null}
    </Panel>
  )
}
