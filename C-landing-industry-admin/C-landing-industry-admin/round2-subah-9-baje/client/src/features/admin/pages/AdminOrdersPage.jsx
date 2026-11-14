import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { cn } from '../../../lib/cn'
import { formatNumber, formatRupees } from '../../../lib/format'
import { useAsync } from '../../../lib/useAsync'
import { weekShort } from '../../buyer/buyerApi'
import { ErrorBlock, LoadingBlock } from '../../farmer/components/LoadState'
import { shortDate } from '../../farmer/copy'
import { adminApi, dateTime, formatPhone } from '../adminApi'
import { AdminPage, Chip, Notice, OrderStatusChip } from '../components/ui'

const FILTERS = [
  { id: 'open', label: 'Open' },
  { id: 'delivered', label: 'To settle' },
  { id: 'settled', label: 'Settled' },
  { id: 'all', label: 'All' },
]

const STOP = {
  pickup_scheduled: { label: 'Booked', tone: 'straw' },
  sold: { label: 'Waiting for baler', tone: 'muted' },
  picked_up: { label: 'Picked up', tone: 'forest' },
  paid: { label: 'Paid', tone: 'forest' },
}
const JOB = {
  offered: { label: 'Offered', tone: 'straw' },
  accepted: { label: 'Accepted', tone: 'forest' },
  in_progress: { label: 'On route', tone: 'forest' },
  completed: { label: 'Delivered', tone: 'outline' },
  declined: { label: 'Declined', tone: 'danger' },
  cancelled: { label: 'Withdrawn', tone: 'muted' },
}

function OrderDetail({ id, onChanged }) {
  const { data, error, loading, reload } = useAsync((signal) => adminApi.order(id, signal), [id])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  if (loading && !data) return <LoadingBlock />
  if (error) return <ErrorBlock error={error} onRetry={reload} />

  const { order: o, stops, jobs } = data
  const openOffer = jobs.find((j) => j.status === 'offered')
  const hasBaler = jobs.some((j) => ['accepted', 'in_progress', 'completed'].includes(j.status))
  const verified = stops.filter((s) => s.verifiedTonnes != null)

  async function run(action, success) {
    setBusy(true)
    setNotice(null)
    try {
      const r = await action()
      setNotice({ text: success(r) })
    } catch (err) {
      setNotice({ text: err.message, error: true })
    } finally {
      setBusy(false)
      reload()
      onChanged()
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-soil/14 px-5 py-5 sm:px-6">
        <div>
          <h2 className="display text-[44px]">
            {o.clusterCode} <span className="accent text-[0.62em] text-forest normal-case">{o.place}</span>
          </h2>
          <p className="mt-1.5 text-sm text-stone-dark">
            Order {o.code} from {o.buyer}, placed {dateTime(o.createdAt)}
          </p>
        </div>
        <OrderStatusChip status={o.status} className="px-2.5 py-1.5 text-[11px]" />
      </div>

      <div className="px-5 sm:px-6">
        <Notice notice={notice} onClose={() => setNotice(null)} />
        {(o.status === 'placed' || o.status === 'delivered') && (
          <div className="mt-4 flex flex-wrap gap-2">
            {o.status === 'placed' && openOffer && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => adminApi.passOffer(openOffer.id), (r) => (r.offeredTo ? `Passed to ${r.offeredTo}.` : 'Offer withdrawn; no other baler free.'))}
                className="label min-h-11 bg-straw px-4 text-[12.5px] text-forest-deep hover:bg-straw-light disabled:opacity-50"
              >
                Pass offer from {openOffer.baler} to next baler
              </button>
            )}
            {o.status === 'placed' && !openOffer && !hasBaler && (
              <button type="button" disabled={busy} onClick={() => run(() => adminApi.reoffer(o.id), (r) => `Offered to ${r.offeredTo}.`)} className="label min-h-11 bg-straw px-4 text-[12.5px] text-forest-deep hover:bg-straw-light disabled:opacity-50">
                Offer to balers again
              </button>
            )}
            {o.status === 'delivered' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => adminApi.settle(o.id), (r) => (r.reference ? `Settled · ${r.reference}` : 'Order closed.'))}
                className="label min-h-11 bg-forest px-4 text-[12.5px] text-paper hover:bg-forest-deep disabled:opacity-50"
              >
                {o.settlement?.difference < 0 ? `Refund ${formatRupees(-o.settlement.difference)} & close` : o.settlement?.difference > 0 ? `Charge ${formatRupees(o.settlement.difference)} & close` : 'Close order'}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-6 px-5 pt-5 pb-6 sm:px-6 xl:grid-cols-[1.3fr_1fr]">
        <section aria-labelledby="stops-title" className="min-w-0">
          <h3 id="stops-title" className="label text-stone">
            Farms · {verified.length} of {stops.length} verified
          </h3>
          <ol className="mt-2 border-t-2 border-forest">
            {stops.map((s, i) => {
              const st = STOP[s.status] ?? { label: s.status, tone: 'muted' }
              return (
                <li key={s.id} className="grid grid-cols-[26px_1fr_auto] items-start gap-3 border-b border-soil/12 py-3">
                  <span className={cn('label grid size-[24px] place-items-center text-xs', s.verifiedTonnes != null ? 'bg-forest text-paper' : 'border border-soil/30')}>{s.verifiedTonnes != null ? '✓' : i + 1}</span>
                  <span className="min-w-0">
                    <span className="block font-semibold">
                      {s.farmer} · {s.village}
                    </span>
                    <span className="label mt-0.5 block text-xs text-stone">
                      <a href={`tel:${s.phone}`} className="hover:text-forest hover:underline">
                        {formatPhone(s.phone)}
                      </a>{' '}
                      · {formatNumber(s.acres, 1)} ac
                      {s.pickupDate && s.verifiedTonnes == null && ` · ${shortDate(s.pickupDate)} ${s.window ?? ''}`}
                    </span>
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      <Chip tone={st.tone}>{st.label}</Chip>
                      {s.attempts > 0 && s.verifiedTonnes == null && <Chip tone={s.attempts >= 3 ? 'danger' : 'muted'}>{s.attempts} wrong code{s.attempts > 1 ? 's' : ''}</Chip>}
                      {s.payout && <Chip tone="muted">UPI {formatRupees(s.payout.amount)}</Chip>}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="display block text-2xl">{s.verifiedTonnes != null ? formatNumber(s.verifiedTonnes, 1) : `≈ ${formatNumber(s.estTonnes, 1)}`} t</span>
                    <span className="label text-[12.5px] text-stone">{s.verifiedTonnes != null ? 'Verified' : 'Estimate'}</span>
                  </span>
                </li>
              )
            })}
          </ol>
        </section>

        <div className="grid min-w-0 content-start gap-5">
          <section aria-labelledby="price-title" className="border-l-[3px] border-straw bg-husk px-4 py-3.5">
            <h3 id="price-title" className="label text-stone">
              Price at order time
            </h3>
            <dl className="mt-2 text-sm">
              {[
                ['Farmers', o.price.farmers],
                ['Baler', o.price.baler],
                ['ParaliLink fee', o.price.platformFee ?? 0],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-soil/10 py-1.5">
                  <dt className="text-stone-dark">{k}</dt>
                  <dd className="tabular-nums">{formatRupees(v)}</dd>
                </div>
              ))}
              <div className="flex justify-between pt-2 font-semibold">
                <dt>Estimate paid {o.payment?.test && <span className="label text-xs text-straw-dark">Test payment</span>}</dt>
                <dd className="tabular-nums">
                  {formatRupees(o.payment?.amount ?? o.price.total)} <span className="text-stone">· {formatRupees(o.price.perTonne)}/t</span>
                </dd>
              </div>
            </dl>
            {o.rates && (
              <p className="mt-2 text-[12px] text-stone-dark">
                Rates locked in: farmer {formatRupees(o.rates.farmerPerTonne)}/t · baling {formatRupees(o.rates.baler.balingPerTonne)}/t · haul ₹{o.rates.baler.haulPerTonneKm}/t·km
              </p>
            )}
            {o.settlement && (
              <p className="mt-2 border-t border-soil/15 pt-2 text-[13px]">
                Final on {formatNumber(o.settlement.verifiedTonnes, 1)} t verified: <strong>{formatRupees(o.settlement.total)}</strong>
                {o.settlement.difference !== 0 && ` (${o.settlement.difference < 0 ? 'refund' : 'top-up'} ${formatRupees(Math.abs(o.settlement.difference))})`}
                {o.settlement.reference && <span className="label block text-xs text-stone">{o.settlement.reference}</span>}
              </p>
            )}
          </section>

          <section aria-labelledby="jobs-title">
            <h3 id="jobs-title" className="label text-stone">
              Baler offers
            </h3>
            {jobs.length === 0 ? (
              <p className="mt-2 text-sm text-stone-dark">Not offered to any baler yet.</p>
            ) : (
              <ul className="mt-2 border-t border-soil/15">
                {jobs.map((j) => {
                  const st = JOB[j.status] ?? { label: j.status, tone: 'muted' }
                  return (
                    <li key={j.id} className="flex items-start justify-between gap-3 border-b border-soil/12 py-2.5 text-sm">
                      <span>
                        <span className="block font-semibold">
                          {j.baler} · {j.vehicle}
                        </span>
                        <span className="label text-xs text-stone">
                          offered {dateTime(j.offeredAt)}
                          {j.respondedAt && ` · answered ${dateTime(j.respondedAt)}`}
                        </span>
                        {j.paid > 0 && <span className="block text-[12px] text-stone-dark">Paid {formatRupees(j.paid)} of ≈ {formatRupees(j.payTotal)}</span>}
                      </span>
                      <Chip tone={st.tone}>{st.label}</Chip>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="history-title">
            <h3 id="history-title" className="label text-stone">
              History
            </h3>
            <ol className="mt-2 grid gap-1 text-[13px] text-stone-dark">
              {o.statusHistory.map((h, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>{h.status.replace('_', ' ')}</span>
                  <span className="tabular-nums">{dateTime(h.at)}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  )
}

export default function AdminOrdersPage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const filter = FILTERS.some((f) => f.id === params.get('status')) ? params.get('status') : 'open'
  const { data, error, loading, reload } = useAsync((signal) => adminApi.orders(filter, signal), [filter])
  const orders = data?.orders ?? []
  const selectedId = id ?? orders[0]?.id

  return (
    <AdminPage title="Orders">
      <div role="group" aria-label="Filter orders" className="mt-5 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setParams(f.id === 'open' ? {} : { status: f.id })}
            className={cn('label min-h-10 px-3.5 text-[12.5px] transition-colors', filter === f.id ? 'bg-forest text-paper' : 'border border-soil/25 hover:bg-husk')}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-5 grid items-start gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <section aria-label="Order list" className="min-w-0">
          {loading && !data && <LoadingBlock />}
          {error && <ErrorBlock error={error} onRetry={reload} />}
          {data && orders.length === 0 && <p className="border border-dashed border-soil/30 p-6 text-center text-stone-dark">No orders here.</p>}
          {orders.length > 0 && (
            <ul className="border-t-2 border-forest">
              {orders.map((o) => {
                const on = o.id === selectedId
                return (
                  <li key={o.id}>
                    <Link
                      to={`/admin/orders/${o.id}${filter === 'open' ? '' : `?status=${filter}`}`}
                      aria-current={on ? 'page' : undefined}
                      className={cn('grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-b border-l-4 border-soil/14 px-3.5 py-3.5 transition-colors', on ? 'border-l-straw bg-paper-light' : 'border-l-transparent hover:bg-husk')}
                    >
                      <span className="label text-stone">
                        {o.code} · {weekShort(o.harvestWeek)}
                      </span>
                      <OrderStatusChip status={o.status} />
                      <span className="min-w-0">
                        <span className="block truncate text-[16px] font-semibold">
                          {o.clusterCode} · {o.place}
                        </span>
                        <span className="block truncate text-[13px] text-stone-dark">
                          {o.buyer} · {o.baler ? `${o.baler.name} ${o.baler.vehicle ?? ''}` : 'no baler yet'}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="display block text-2xl">{formatNumber(o.estTonnes, 1)} t</span>
                        <span className="text-[12px] text-stone tabular-nums">{formatRupees(o.total)}</span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
        <section aria-label="Order detail" className="min-w-0 border border-soil/15 bg-paper-light">
          {selectedId ? <OrderDetail id={selectedId} onChanged={reload} /> : !loading && <p className="p-8 text-stone">Select an order.</p>}
        </section>
      </div>
    </AdminPage>
  )
}
