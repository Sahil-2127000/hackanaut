import { Link, useParams } from 'react-router-dom'
import { cn } from '../../../lib/cn'
import { formatNumber, formatRupees } from '../../../lib/format'
import { useAsync } from '../../../lib/useAsync'
import { shortDate } from '../../farmer/copy'
import { ErrorBlock, LoadingBlock } from '../../farmer/components/LoadState'
import { buyerApi, ORDER_STATUS, weekShort } from '../buyerApi'
import { RouteMap } from '../components/RouteMap'

const TONE = {
  straw: 'bg-straw text-forest-deep',
  forest: 'bg-forest text-paper',
  outline: 'border border-forest text-forest',
  danger: 'border border-danger text-danger',
}

function StatusChip({ status, className }) {
  const s = ORDER_STATUS[status] ?? { label: status, tone: 'outline' }
  return <span className={cn('label px-2 py-1 text-xs whitespace-nowrap', TONE[s.tone], className)}>{s.label}</span>
}

const STOP_STATE = {
  picked_up: 'done',
  paid: 'done',
  pickup_scheduled: 'next',
}

function OrderDetail({ id }) {
  const { data, error, loading, reload } = useAsync((signal) => buyerApi.order(id, signal), [id])
  if (loading) return <LoadingBlock />
  if (error) return <ErrorBlock error={error} onRetry={reload} />

  const o = data.order
  const done = o.stops.filter((s) => s.verifiedTonnes != null).length
  const nextIndex = o.stops.findIndex((s) => s.verifiedTonnes == null)

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-soil/14 px-6 py-5.5">
        <div>
          <h2 className="display text-5xl">
            {o.clusterCode} <span className="accent text-[0.62em] text-forest">{o.place}</span>
          </h2>
          <p className="mt-1.5 text-sm text-stone-dark">
            Order {o.code}, placed {shortDate(o.createdAt)}
          </p>
        </div>
        <StatusChip status={o.status} className="px-2.5 py-1.5 text-[11px]" />
      </div>

      <div className="px-6 pt-5">
        <div className="flex justify-between text-sm">
          <span className="font-semibold">
            {done} of {o.stops.length} farms verified
          </span>
          <span className="label text-stone">Harvest {weekShort(o.harvestWeek)}</span>
        </div>
        <div className="mt-2.5 h-2 bg-soil/[0.08]">
          <span className="block h-full bg-forest transition-[width] duration-700" style={{ width: `${(done / o.stops.length) * 100}%` }} />
        </div>
      </div>

      <dl className="mx-6 mt-5 grid grid-cols-2 border-t border-l border-soil/14 sm:grid-cols-4">
        {[
          ['Estimated', `${formatNumber(o.estTonnes, 1)} t`, 'text-soil'],
          ['Verified so far', `${formatNumber(o.verifiedTonnes, 1)} t`, 'text-forest'],
          ['Still to collect', `${formatNumber(o.remainingTonnes, 1)} t`, o.remainingTonnes ? 'text-straw-dark' : 'text-stone'],
          ['CO₂ avoided', `${formatNumber(o.co2Avoided, 1)} t`, 'text-forest'],
        ].map(([k, v, c]) => (
          <div key={k} className="flex flex-col-reverse border-r border-b border-soil/14 px-4 py-3.5">
            <dt className="label mt-1.5 text-stone">{k}</dt>
            <dd className={cn('display text-3xl', c)}>{v}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap gap-6 px-6 pt-5.5 pb-6">
        <ol className="min-w-0 flex-[1.2_1_320px] border-t-2 border-forest">
          {o.stops.map((s, i) => {
            const ok = s.verifiedTonnes != null
            const now = i === nextIndex && ['baler_assigned', 'in_progress'].includes(o.status)
            return (
              <li key={s.label} className="grid grid-cols-[30px_1fr_auto] items-start gap-3 border-b border-soil/12 py-3.5">
                <span className={cn('label grid size-[26px] place-items-center text-[12.5px]', ok ? 'bg-forest text-paper' : now ? 'bg-straw text-forest-deep' : 'border-2 border-soil/30')}>
                  {ok ? '✓' : i + 1}
                </span>
                <span>
                  <span className="block font-semibold">
                    {s.label} · {formatNumber(s.acres, 1)} acres
                  </span>
                  <span className={cn('label mt-1 block text-xs', now ? 'text-straw-dark' : 'text-stone')}>
                    {ok
                      ? `Verified ${s.verifiedAt ? shortDate(s.verifiedAt) : ''} · OTP ✓`
                      : s.pickupDate
                        ? `Pickup ${shortDate(s.pickupDate)} · ${s.pickupWindow ?? ''}`
                        : 'Waiting for a baler'}
                  </span>
                </span>
                <span className="text-right">
                  <span className="display block text-2xl">{ok ? `${formatNumber(s.verifiedTonnes, 1)} t` : `≈ ${formatNumber(s.estTonnes, 1)} t`}</span>
                  <span className="label text-xs text-stone">{ok ? 'Verified' : 'Estimate'}</span>
                </span>
              </li>
            )
          })}
        </ol>
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-3.5">
          {data.plant && (
            <RouteMap
              plant={data.plant}
              height={230}
              stops={o.stops.map((s, i) => ({
                position: s.position,
                label: s.label,
                state: s.verifiedTonnes != null ? 'done' : i === nextIndex ? STOP_STATE.pickup_scheduled : 'later',
              }))}
              caption={o.balerName ? `Baler ${o.balerVehicle} · ${o.balerName}` : 'Baler not booked yet'}
            />
          )}
          {o.settlement && (
            <div className="bg-forest px-4 py-3.5 text-paper">
              <p className="text-sm font-semibold">Settled on verified weight · {formatNumber(o.settlement.verifiedTonnes, 1)} t</p>
              <p className="display mt-1 text-3xl text-straw-light">{formatRupees(o.settlement.total)}</p>
              <p className="mt-1 text-[13px] text-sage-light">
                {o.settlement.difference === 0
                  ? 'Exactly the estimate.'
                  : o.settlement.difference < 0
                    ? `${formatRupees(-o.settlement.difference)} less than the estimate · refunded (test).`
                    : `${formatRupees(o.settlement.difference)} more than the estimate · charged (test).`}
              </p>
            </div>
          )}
          <div className="border-l-[3px] border-straw bg-husk px-4 py-3.5">
            <p className="text-sm font-semibold">
              Estimate {o.payment?.status === 'paid' ? 'paid' : o.payment?.status} · {formatRupees(o.payment?.amount ?? o.total)}
              {o.payment?.test && <span className="label ml-2 text-xs text-straw-dark">Test payment</span>}
            </p>
            <p className="mt-1 text-[13px] leading-normal text-stone-dark">
              Farmers are paid at each verified pickup. When the last farm is done, the total is adjusted at {formatRupees(o.price.marginalPerTonne)} per tonne of
              difference.
            </p>
          </div>
          <button type="button" disabled className="label flex h-13 items-center justify-between border border-soil/20 px-4 text-stone">
            Weight slips & invoice after the last pickup <span aria-hidden="true">↓</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default function OrdersPage() {
  const { id } = useParams()
  const { data, error, loading, reload } = useAsync((signal) => buyerApi.orders(signal))
  const orders = data?.orders ?? []
  const selectedId = id ?? orders[0]?.id

  return (
    <div className="mx-auto flex max-w-[1520px] flex-wrap items-start gap-6 px-[clamp(16px,3vw,40px)] pt-6 pb-12">
      <section aria-labelledby="list-title" className="min-w-0 flex-[1_1_320px]">
        <div className="flex items-baseline justify-between">
          <h1 id="list-title" className="display text-5xl">
            Orders
          </h1>
          {data && <span className="label text-stone">{formatNumber(orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + o.estTonnes, 0), 1)} t this season</span>}
        </div>
        {loading && <LoadingBlock />}
        {error && <ErrorBlock error={error} onRetry={reload} />}
        {data && orders.length === 0 && (
          <div className="mt-4 border border-dashed border-soil/30 p-6 text-center text-stone-dark">
            No orders yet.{' '}
            <Link to="/buyer" className="text-forest underline underline-offset-4">
              Find supply on the map
            </Link>
          </div>
        )}
        <ul className="mt-4 border-t-2 border-forest">
          {orders.map((o) => {
            const on = o.id === selectedId
            return (
              <li key={o.id}>
                <Link
                  to={`/buyer/orders/${o.id}`}
                  aria-current={on ? 'page' : undefined}
                  className={cn('grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 border-b border-soil/14 border-l-4 px-3.5 py-4 transition-colors', on ? 'border-l-straw bg-paper-light' : 'border-l-transparent hover:bg-husk')}
                >
                  <span className="label text-stone">{o.code}</span>
                  <StatusChip status={o.status} />
                  <span className="text-[17px] font-semibold">
                    {o.clusterCode} · {o.place}
                  </span>
                  <span className="display text-right text-2xl">{formatNumber(o.estTonnes, 1)} t</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </section>

      <section aria-label="Order detail" className="min-w-0 flex-[999_1_640px] border border-soil/15 bg-paper-light">
        {selectedId ? <OrderDetail id={selectedId} /> : !loading && <p className="p-8 text-stone">Select an order to see its pickups.</p>}
      </section>
    </div>
  )
}
