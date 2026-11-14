import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { cn } from '../../../lib/cn'
import { formatNumber, formatRupees } from '../../../lib/format'
import { useAsync } from '../../../lib/useAsync'
import { ErrorBlock, LoadingBlock } from '../../farmer/components/LoadState'
import { shortDate } from '../../farmer/copy'
import { adminApi, formatPhone } from '../adminApi'
import { AdminPage, Chip } from '../components/ui'

const ROLES = [
  { id: 'all', label: 'Everyone' },
  { id: 'farmer', label: 'Farmers' },
  { id: 'buyer', label: 'Buyers' },
  { id: 'baler', label: 'Balers' },
  { id: 'admin', label: 'Admins' },
]
const ROLE_TONE = { farmer: 'forest', buyer: 'straw', baler: 'outline', admin: 'muted' }
const LANG = { pa: 'ਪੰਜਾਬੀ', en: 'English' }

/** One line of numbers that matter for each role. */
function stats(u) {
  const s = u.stats
  if (!s) return []
  if (u.role === 'farmer') return [`${s.listings} listing${s.listings === 1 ? '' : 's'}`, `${formatNumber(s.acres, 1)} ac`, `${formatRupees(s.earned)} earned`]
  if (u.role === 'buyer') return [`${s.orders} order${s.orders === 1 ? '' : 's'}`, `${formatNumber(s.tonnes, 1)} t`, `${formatRupees(s.spent)} paid`]
  if (u.role === 'baler') return [`${s.completed} done · ${s.active} active`, s.declined ? `${s.declined} declined` : null, `${formatRupees(s.earned)} earned`].filter(Boolean)
  return []
}

export default function AdminUsersPage() {
  const [params, setParams] = useSearchParams()
  const role = ROLES.some((r) => r.id === params.get('role')) ? params.get('role') : 'all'
  const [text, setText] = useState(params.get('q') ?? '')
  const [q, setQ] = useState(text)

  // Search after a short pause in typing.
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300)
    return () => clearTimeout(id)
  }, [text])

  const { data, error, loading, reload } = useAsync((signal) => adminApi.users({ role, q }, signal), [role, q])
  const users = data?.users ?? []

  function pickRole(id) {
    const next = new URLSearchParams(params)
    if (id === 'all') next.delete('role')
    else next.set('role', id)
    setParams(next, { replace: true })
  }

  return (
    <AdminPage title="Users" aside={data && <span className="label text-stone">{users.length} shown</span>}>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filter by role" className="flex flex-wrap gap-1.5">
          {ROLES.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={role === r.id}
              onClick={() => pickRole(r.id)}
              className={cn('label min-h-10 px-3.5 text-[12.5px] transition-colors', role === r.id ? 'bg-forest text-paper' : 'border border-soil/25 hover:bg-husk')}
            >
              {r.label}
            </button>
          ))}
        </div>
        <label className="flex w-full items-center border-b-2 border-soil bg-paper-light focus-within:border-forest sm:w-[320px]">
          <span className="sr-only">Search by name, phone, company or vehicle</span>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-3 text-stone">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Name, phone, company, vehicle" className="h-11 min-w-0 flex-1 bg-transparent px-3 outline-none" />
        </label>
      </div>

      {loading && !data && <LoadingBlock />}
      {error && <ErrorBlock error={error} onRetry={reload} />}
      {data && users.length === 0 && <p className="mt-5 border border-dashed border-soil/30 p-6 text-center text-stone-dark">Nobody matches.</p>}

      {users.length > 0 && (
        <div className={cn('mt-5 border-t-2 border-forest transition-opacity', loading && 'opacity-60')}>
          <div className="label hidden grid-cols-[1.4fr_0.6fr_0.9fr_1.8fr_0.7fr] gap-4 border-b border-soil/15 px-2 py-2 text-xs text-stone lg:grid">
            <span>Name · phone</span>
            <span>Role</span>
            <span>District</span>
            <span>Activity</span>
            <span className="text-right">Joined</span>
          </div>
          <ul>
            {users.map((u) => (
              <li key={u.id} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 border-b border-soil/12 px-2 py-3 lg:grid-cols-[1.4fr_0.6fr_0.9fr_1.8fr_0.7fr] lg:items-center">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {u.name ?? '—'}
                    {u.company && <span className="font-normal text-stone-dark"> · {u.company}</span>}
                    {u.vehicle && <span className="font-normal text-stone-dark"> · {u.vehicle}</span>}
                  </span>
                  <a href={`tel:${u.phone}`} className="label text-xs text-stone hover:text-forest hover:underline">
                    {formatPhone(u.phone)}
                  </a>
                  {u.language && <span className="ml-2 text-[11px] text-stone">{LANG[u.language]}</span>}
                </span>
                <span className="flex items-center gap-1.5 justify-self-end lg:justify-self-start">
                  <Chip tone={ROLE_TONE[u.role]}>{u.role}</Chip>
                  {u.role === 'baler' && !u.available && <Chip tone="danger">Off</Chip>}
                </span>
                <span className="hidden text-sm text-stone-dark lg:block">{u.district ?? '—'}</span>
                <span className="col-span-2 text-sm tabular-nums lg:col-span-1">
                  <span className="text-stone-dark lg:hidden">
                    {u.district ?? '—'} · joined {shortDate(u.createdAt)}
                    <br />
                  </span>
                  {stats(u).map((s, i) => (
                    <span key={i}>
                      {i > 0 && <span className="text-stone"> · </span>}
                      {s}
                    </span>
                  ))}
                  {u.role === 'baler' && u.capacity && <span className="text-stone"> · {u.capacity} t/day</span>}
                </span>
                <span className="label hidden text-xs text-stone lg:block lg:text-right">{shortDate(u.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </AdminPage>
  )
}
