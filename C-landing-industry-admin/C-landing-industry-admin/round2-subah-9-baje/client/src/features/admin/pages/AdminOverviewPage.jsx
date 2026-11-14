import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../../../lib/cn'
import { formatNumber, formatRupees } from '../../../lib/format'
import { useAsync } from '../../../lib/useAsync'
import { weekRange, weekShort } from '../../buyer/buyerApi'
import { ErrorBlock, LoadingBlock } from '../../farmer/components/LoadState'
import { shortDate } from '../../farmer/copy'
import { adminApi, ago, formatPhone } from '../adminApi'
import { AdminPage, Chip, Notice } from '../components/ui'

const REFRESH_MS = 60_000

function Kpis({ k }) {
  const tiles = [
    ['Acres listed', formatNumber(k.acresListed), `${k.farmsListed} farms · ≈ ${formatNumber(k.tonnesListed)} t`],
    ['Clusters ready', k.clustersReady, `${k.clustersForming} still forming`],
    ['Orders open', k.ordersOpen, `${k.ordersTotal} this season`],
    ['Verified straw', `${formatNumber(k.verifiedTonnes, 1)} t`, 'weighed at the farm'],
    ['Paid to farmers', formatRupees(k.paidToFarmers), `${formatRupees(k.paidToFarmersToday)} today`],
    ['CO₂ avoided', `${formatNumber(k.co2Avoided, 1)} t`, 'vs burning the same straw'],
  ]
  return (
    <dl className="mt-6 grid grid-cols-2 border-t border-l border-soil/15 sm:grid-cols-3 xl:grid-cols-6">
      {tiles.map(([label, value, sub], i) => (
        <div key={label} className={cn('flex flex-col-reverse border-r border-b border-soil/15 px-4 py-4', i === 4 && 'bg-forest text-paper')}>
          <span className={cn('mt-1 text-[12px]', i === 4 ? 'text-sage-light' : 'text-stone')}>{sub}</span>
          <dt className={cn('label mt-2 text-xs', i === 4 ? 'text-sage' : 'text-stone')}>{label}</dt>
          <dd className={cn('display text-[clamp(30px,3.2vw,42px)]', i === 4 && 'text-straw-light')}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function WeeklyChart({ weekly, thisWeek }) {
  const max = Math.max(1, ...weekly.map((w) => w.listed))
  return (
    <section aria-labelledby="weekly-title" className="border border-soil/15 bg-paper-light p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="weekly-title" className="label text-soil">
          Listed vs collected · tonnes per harvest week
        </h2>
        <p className="label flex gap-4 text-xs text-stone">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 bg-sage" /> Listed
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 bg-forest" /> Collected
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 bg-straw" /> This week
          </span>
        </p>
      </div>
      {weekly.length === 0 ? (
        <p className="mt-6 text-sm text-stone">No listings yet.</p>
      ) : (
        <>
          <div aria-hidden="true" className="mt-5 flex h-[190px] items-end gap-[clamp(6px,1.4vw,18px)] border-b border-soil/30">
            {weekly.map((w, i) => (
              <div key={w.week} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                <span className="label mb-1 block truncate text-center text-[12.5px] text-stone">{w.listed ? formatNumber(w.listed) : ''}</span>
                <div className="flex flex-1 items-end gap-[3px]">
                  <span className={cn('animate-grow flex-1 origin-bottom', w.week === thisWeek ? 'bg-straw' : 'bg-sage')} style={{ height: `${(w.listed / max) * 100}%`, animationDelay: `${i * 50}ms` }} />
                  <span className="animate-grow flex-1 origin-bottom bg-forest" style={{ height: `${(w.collected / max) * 100}%`, animationDelay: `${i * 50 + 120}ms` }} />
                </div>
              </div>
            ))}
          </div>
          <div aria-hidden="true" className="mt-2 flex gap-[clamp(6px,1.4vw,18px)]">
            {weekly.map((w) => (
              <span key={w.week} className={cn('label min-w-0 flex-1 truncate text-center text-[12.5px]', w.week === thisWeek ? 'text-straw-dark' : 'text-stone')}>
                {weekShort(w.week)}
              </span>
            ))}
          </div>
          <table className="sr-only">
            <caption>Tonnes listed and collected per harvest week</caption>
            <thead>
              <tr>
                <th>Week</th>
                <th>Listed</th>
                <th>Collected</th>
              </tr>
            </thead>
            <tbody>
              {weekly.map((w) => (
                <tr key={w.week}>
                  <td>
                    {weekShort(w.week)} ({weekRange(w.week)})
                  </td>
                  <td>{w.listed} t</td>
                  <td>{w.collected} t</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}

const STATE = {
  late: { label: 'Late', tone: 'danger' },
  on_route: { label: 'On route', tone: 'forest' },
  booked: { label: 'Booked', tone: 'outline' },
  unloading: { label: 'To plant', tone: 'straw' },
}

function LivePickups({ live }) {
  return (
    <section aria-labelledby="live-title">
      <div className="flex items-baseline justify-between">
        <h2 id="live-title" className="display text-3xl">
          Live pickups
        </h2>
        <span className="label flex items-center gap-2 text-stone">
          {live.length > 0 && <span aria-hidden="true" className="animate-blink size-2 rounded-full bg-straw" />}
          {live.length} baler{live.length === 1 ? '' : 's'} out
        </span>
      </div>
      {live.length === 0 ? (
        <p className="mt-3 border border-dashed border-soil/30 p-5 text-center text-sm text-stone-dark">No balers on a job right now.</p>
      ) : (
        <div className="mt-3 border-t-2 border-forest">
          <div className="label hidden grid-cols-[1.3fr_1fr_0.7fr_0.8fr_0.7fr] gap-3 border-b border-soil/15 px-2 py-2 text-xs text-stone md:grid">
            <span>Baler</span>
            <span>Cluster · next farm</span>
            <span>Stops</span>
            <span>Verified</span>
            <span>Status</span>
          </div>
          <ul>
            {live.map((r) => {
              const s = STATE[r.state] ?? STATE.on_route
              return (
                <li key={r.id}>
                  <Link
                    to={`/admin/orders/${r.order}`}
                    className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-b border-soil/12 px-2 py-3 transition-colors hover:bg-husk md:grid-cols-[1.3fr_1fr_0.7fr_0.8fr_0.7fr] md:items-center"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold">{r.baler?.name ?? '—'}</span>
                      <span className="label text-xs text-stone">
                        {r.baler?.vehicle} · {formatPhone(r.baler?.phone)}
                      </span>
                    </span>
                    <span className="justify-self-end md:order-last md:justify-self-start">
                      <Chip tone={s.tone}>{s.label}</Chip>
                    </span>
                    <span className="min-w-0 text-sm">
                      <span className="block">
                        {r.clusterCode} · {r.place}
                      </span>
                      <span className="label text-xs text-stone">
                        {r.next ? `Next: ${r.next.farmer ?? r.next.village} · ${r.next.date ? shortDate(r.next.date) : ''} ${r.next.window ?? ''}` : 'All farms done'}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 text-sm md:block">
                      <span className="tabular-nums">
                        {r.stopsDone}/{r.stopsTotal}
                      </span>
                      <span aria-hidden="true" className="block h-1 w-16 bg-soil/10 md:mt-1 md:w-full">
                        <span className="block h-full bg-forest" style={{ width: `${(r.stopsDone / Math.max(1, r.stopsTotal)) * 100}%` }} />
                      </span>
                    </span>
                    <span className="display text-2xl">
                      {formatNumber(r.verifiedTonnes, 1)} <span className="text-base text-stone">/ {formatNumber(r.estTonnes, 0)} t</span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}

const SEVERITY = { high: 'border-danger', medium: 'border-straw', low: 'border-sage' }

function Queue({ queue, onAction, busyKey }) {
  return (
    <section aria-labelledby="queue-title">
      <div className="flex items-baseline justify-between">
        <h2 id="queue-title" className="display text-3xl">
          Needs attention
        </h2>
        <span className={cn('label grid min-w-7 place-items-center px-1.5 py-0.5 text-[12.5px]', queue.length ? 'bg-straw text-forest-deep' : 'bg-sage-light text-forest')}>{queue.length}</span>
      </div>
      {queue.length === 0 ? (
        <p className="mt-3 border border-dashed border-soil/30 p-5 text-center text-sm text-stone-dark">All clear. Nothing is waiting on the ops team.</p>
      ) : (
        <ul className="mt-3 grid gap-2.5">
          {queue.map((q) => (
            <li key={q.key} className={cn('border-l-[3px] bg-paper-light px-4 py-3.5', SEVERITY[q.severity])}>
              <p className="font-semibold">{q.title}</p>
              <p className="mt-1 text-[13px] leading-normal text-stone-dark">{q.detail}</p>
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                <span className="label text-xs text-stone">{q.at ? ago(q.at) : ''}</span>
                <span className="flex gap-2">
                  {q.phone && q.action.type !== 'call' && (
                    <a href={`tel:${q.phone}`} className="label inline-flex min-h-10 items-center border border-soil/25 px-3 text-[12.5px] hover:bg-husk">
                      Call
                    </a>
                  )}
                  {q.action.type === 'call' ? (
                    <a href={`tel:${q.phone}`} className="label inline-flex min-h-10 items-center border border-forest px-3 text-[12.5px] text-forest transition-colors hover:bg-forest hover:text-paper">
                      {q.action.label} · {formatPhone(q.phone)}
                    </a>
                  ) : (
                    <button
                      type="button"
                      disabled={busyKey === q.key}
                      onClick={() => onAction(q)}
                      className="label inline-flex min-h-10 items-center border border-forest px-3 text-[12.5px] text-forest transition-colors hover:bg-forest hover:text-paper disabled:opacity-50"
                    >
                      {busyKey === q.key ? 'Working…' : q.action.label}
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function MoneyFlow({ k }) {
  return (
    <section aria-labelledby="money-title" className="bg-forest-deep p-5 text-paper">
      <h2 id="money-title" className="label text-sage">
        Money this season · test mode
      </h2>
      <dl className="mt-3">
        {[
          ['Paid by buyers', k.buyerPayments],
          ['To farmers (UPI)', k.paidToFarmers],
          ['To balers (UPI)', k.paidToBalers],
        ].map(([label, v]) => (
          <div key={label} className="flex items-baseline justify-between border-t border-paper/12 py-2.5">
            <dt className="text-sm text-sage-light">{label}</dt>
            <dd className="display text-2xl text-straw-light">{formatRupees(v)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[12px] leading-normal text-sage">
        Buyer money not yet paid out is held for pickups still to happen. No ParaliLink fee in the pilot. No real money moves until the UPI gateway is connected.
      </p>
    </section>
  )
}

export default function AdminOverviewPage() {
  const { data, error, loading, reload } = useAsync((signal) => adminApi.overview(signal))
  const [busyKey, setBusyKey] = useState(null)
  const [notice, setNotice] = useState(null)

  // Quiet refresh every minute while the tab is visible.
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === 'visible' && reload(), REFRESH_MS)
    return () => clearInterval(id)
  }, [reload])

  async function onAction(q) {
    setBusyKey(q.key)
    setNotice(null)
    try {
      const a = q.action
      if (a.type === 'reoffer') {
        const r = await adminApi.reoffer(a.id)
        setNotice({ text: `Offered to ${r.offeredTo}.` })
      } else if (a.type === 'pass') {
        const r = await adminApi.passOffer(a.id)
        setNotice({ text: r.offeredTo ? `Offer passed to ${r.offeredTo}.` : 'Offer withdrawn. No other baler is free, so the order is back in the queue.' })
      } else if (a.type === 'settle') {
        const r = await adminApi.settle(a.id)
        setNotice({ text: r.reference ? `Order settled · ${r.reference}.` : 'Order closed.' })
      } else if (a.type === 'rebuild') {
        const r = await adminApi.rebuildClusters()
        setNotice({ text: `Clustering re-run: ${r.ready} ready, ${r.forming} forming.` })
      }
    } catch (err) {
      setNotice({ text: err.message, error: true })
    } finally {
      setBusyKey(null)
      reload()
    }
  }

  return (
    <AdminPage
      title="Today in the fields"
      aside={
        <p className="label flex items-center gap-3 text-stone">
          {data && <span>Updated {new Date(data.generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>}
          <button type="button" onClick={reload} className="inline-flex min-h-10 items-center border border-soil/25 px-3 text-[11px] hover:bg-husk">
            {loading && data ? 'Refreshing…' : 'Refresh'}
          </button>
        </p>
      }
    >
      <Notice notice={notice} onClose={() => setNotice(null)} />
      {loading && !data && <LoadingBlock />}
      {error && <ErrorBlock error={error} onRetry={reload} />}
      {data && (
        <>
          <Kpis k={data.kpis} />
          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)] lg:gap-10">
            <div className="grid min-w-0 content-start gap-8">
              <WeeklyChart weekly={data.weekly} thisWeek={data.thisWeek} />
              <LivePickups live={data.live} />
            </div>
            <div className="grid min-w-0 content-start gap-8">
              <Queue queue={data.queue} onAction={onAction} busyKey={busyKey} />
              <MoneyFlow k={data.kpis} />
            </div>
          </div>
        </>
      )}
    </AdminPage>
  )
}
