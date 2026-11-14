import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { formatNumber, formatRupees } from '../../../lib/format'
import { useAsync } from '../../../lib/useAsync'
import { shortDate } from '../../farmer/copy'
import { ErrorBlock, LoadingBlock } from '../../farmer/components/LoadState'
import { buyerApi, weekRange, weekShort } from '../buyerApi'
import { RouteMap } from '../components/RouteMap'

const th = 'label border-b border-soil/15 px-2 py-3 text-left font-normal text-stone'
const td = 'border-b border-soil/10 px-2 py-3.5'

export default function ClusterPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data, error, loading, reload } = useAsync((signal) => buyerApi.cluster(id, signal), [id])
  const [agree, setAgree] = useState(true)
  const [phase, setPhase] = useState('idle') // idle | paying | paid
  const [order, setOrder] = useState(null)
  const [payError, setPayError] = useState('')

  const cluster = data?.cluster

  async function pay() {
    setPhase('paying')
    setPayError('')
    try {
      const res = await buyerApi.placeOrder(id)
      setOrder(res.order)
      setPhase('paid')
    } catch (err) {
      setPayError(err.message)
      setPhase('idle')
      if (err.details?.orderId) navigate(`/buyer/orders/${err.details.orderId}`)
    }
  }

  if (loading) return <LoadingBlock />
  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorBlock error={error} onRetry={reload} />
        <Link to="/buyer" className="label mx-5.5 mt-4 inline-flex min-h-11 items-center text-forest underline underline-offset-4">
          ← Back to the supply map
        </Link>
      </div>
    )
  }

  return (
    <>
      <section aria-labelledby="cl-title" className="relative isolate h-[280px] overflow-hidden bg-forest-deep text-paper">
        <img src="/images/harvest-edge.webp" alt="" className="absolute inset-0 -z-20 size-full animate-kenburns object-cover motion-reduce:animate-none" />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgb(18_36_26/0.9)_0%,rgb(18_36_26/0.45)_60%,rgb(18_36_26/0.2)_100%)]" />
        <div className="mx-auto flex h-full max-w-[1520px] flex-col justify-between px-[clamp(16px,3vw,40px)] py-5">
          <nav aria-label="Breadcrumb" className="label text-paper/80">
            <Link to="/buyer" className="text-straw-light hover:underline">
              Supply map
            </Link>{' '}
            / {cluster.code}
          </nav>
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <h1 id="cl-title" className="display text-[clamp(3rem,6vw,5.5rem)]">
                {cluster.place} <span className="accent text-[0.6em] text-straw-light">{cluster.district}</span>
              </h1>
              <p className="mt-2 text-sage-light">
                Cluster {cluster.code}, {cluster.status === 'ready' ? 'ready to order' : 'still forming'}
              </p>
            </div>
            <dl className="flex flex-wrap">
              {[
                ['Est. straw', `${formatNumber(cluster.totalTonnes, 1)} t`],
                ['Farms', cluster.farmCount],
                ['Harvest', weekShort(cluster.harvestWeek)],
                ['Delivered', `${formatRupees(cluster.price.perTonne)}/t`],
              ].map(([k, v]) => (
                <div key={k} className="border-l border-paper/30 px-5">
                  <dt className="label text-sage">{k}</dt>
                  <dd className="display mt-1.5 text-4xl">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <div className="mx-auto flex max-w-[1520px] flex-wrap items-start gap-8 px-[clamp(16px,3vw,40px)] pt-8 pb-12">
        <div className="flex min-w-0 flex-[999_1_600px] flex-col gap-10">
          <section aria-labelledby="farms-title">
            <div className="flex flex-wrap justify-between gap-2 border-t-2 border-forest pt-3">
              <h2 id="farms-title" className="label">
                (01) Farms in this cluster
              </h2>
              <span className="label text-stone">Names and phone numbers are shared with the baler after payment</span>
            </div>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full min-w-[560px] border-collapse text-[15px]">
                <thead>
                  <tr>
                    <th scope="col" className={th}>Farm</th>
                    <th scope="col" className={`${th} text-right`}>Acres</th>
                    <th scope="col" className={`${th} text-right`}>Est. straw</th>
                    <th scope="col" className={th}>Harvest</th>
                    <th scope="col" className={th}>From centre</th>
                  </tr>
                </thead>
                <tbody>
                  {cluster.farms.map((f, i) => (
                    <tr key={f.label} className="transition-colors hover:bg-husk">
                      <td className={`${td} font-semibold`}>
                        <span className="label mr-2.5 inline-grid size-[22px] place-items-center bg-forest text-xs text-paper">{i + 1}</span>
                        {f.label}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>{formatNumber(f.acres, 1)}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatNumber(f.estTonnes, 1)} t</td>
                      <td className={td}>{shortDate(f.harvestDate)}</td>
                      <td className={`${td} text-stone`}>{formatNumber(f.kmFromCenter, 1)} km</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" className="px-2 py-3.5 text-left font-semibold">
                      Total
                    </th>
                    <td className="px-2 py-3.5 text-right font-semibold">{formatNumber(cluster.totalAcres, 1)}</td>
                    <td className="px-2 py-3.5 text-right font-semibold">{formatNumber(cluster.totalTonnes, 1)} t</td>
                    <td colSpan={2} className="px-2 py-3.5 text-[13px] text-stone">
                      ≈ 2.4 t per acre, verified by weight at pickup
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section aria-labelledby="plan-title" className="grid gap-6 md:grid-cols-[1fr_1.3fr]">
            <div>
              <div className="border-t-2 border-forest pt-3">
                <h2 id="plan-title" className="label">
                  (02) Pickup plan
                </h2>
              </div>
              <ol className="mt-4.5 grid gap-3.5">
                {[
                  'The nearest free baler is booked as soon as you pay.',
                  `${cluster.farmCount} stops on one route (≈ ${formatNumber(cluster.routeKm, 1)} km between farms) in the week of ${weekRange(cluster.harvestWeek)}.`,
                  'Each farm confirms pickup and weight with a one-time code.',
                  `Delivered to your plant, ${formatNumber(cluster.price.kmToPlant, 1)} km away.`,
                ].map((t, i) => (
                  <li key={t} className="grid grid-cols-[28px_1fr] gap-2.5">
                    <span className="label text-straw-dark">0{i + 1}</span>
                    <span className="text-[15px] leading-relaxed">{t}</span>
                  </li>
                ))}
              </ol>
            </div>
            <RouteMap
              plant={data.plant}
              stops={cluster.farms.map((f) => ({ position: f.position, label: f.label }))}
              caption={`Route ≈ ${formatNumber(cluster.routeKm + cluster.price.kmToPlant, 0)} km · ${cluster.farmCount} stops → your plant · farm positions approximate`}
            />
          </section>

          <section aria-labelledby="record-title">
            <div className="border-t-2 border-forest pt-3">
              <h2 id="record-title" className="label">
                (03) What you get on record
              </h2>
            </div>
            <div className="mt-4 grid border-l border-soil/15 sm:grid-cols-3">
              {[
                [cluster.farmCount, 'OTP-verified weight slips, one per farm'],
                [`≈ ${formatNumber(cluster.totalTonnes * 1.46, 0)} t`, 'CO₂ avoided, on your impact report (1.46 t per t)'],
                ['Invoice', 'Generated on the final verified weight'],
              ].map(([v, t]) => (
                <div key={t} className="border-r border-soil/15 px-5 py-1">
                  <p className="display text-4xl text-forest">{v}</p>
                  <p className="mt-1.5 text-sm leading-normal text-stone-dark">{t}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside aria-labelledby="sum-title" className="min-w-0 flex-[1_1_340px] border border-soil/15 bg-paper-light lg:sticky lg:top-6">
          {phase !== 'paid' ? (
            <div className="p-5.5">
              <h2 id="sum-title" className="label text-stone">
                Order summary
              </h2>
              <dl className="mt-3.5 text-[15px]">
                {[
                  [`Straw to ${cluster.farmCount} farmers · ${formatNumber(cluster.totalTonnes, 1)} t × ₹1,200`, cluster.price.farmers],
                  ['Baling & transport', cluster.price.baler],
                  ['ParaliLink fee (pilot)', 0],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 border-b border-soil/10 py-2.5">
                    <dt className="text-stone-dark">{k}</dt>
                    <dd className="font-semibold tabular-nums">{formatRupees(v)}</dd>
                  </div>
                ))}
              </dl>
              <details className="mt-2.5 text-[13px]">
                <summary className="label min-h-9 cursor-pointer py-2 text-forest">How the baler’s {formatRupees(cluster.price.baler)} is worked out</summary>
                <dl className="mt-1 bg-husk px-3 py-2">
                  {cluster.price.balerParts.map((p) => (
                    <div key={p.key} className="flex justify-between gap-2 py-1">
                      <dt className="text-stone-dark">{p.label}</dt>
                      <dd className="font-semibold tabular-nums">{formatRupees(p.amount)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
              <div className="mt-4 flex items-baseline justify-between">
                <span className="font-semibold">Estimated total</span>
                <span className="display text-5xl text-forest">{formatRupees(cluster.price.total)}</span>
              </div>
              <p className="label mt-1 text-right text-stone">Delivered price {formatRupees(cluster.price.perTonne)} / t</p>
              <p className="mt-3 text-[13px] leading-normal text-stone">
                You pay the estimate now and it is held safely. Farmers are paid at each verified pickup, the baler as work is done. After
                the last farm, the total is adjusted to the verified weight.
              </p>
              <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm leading-normal">
                <input type="checkbox" checked={agree} onChange={() => setAgree((v) => !v)} className="mt-0.5 size-5 shrink-0 accent-forest" />
                Deliver to my plant. I accept the purchase terms.
              </label>
              {payError && (
                <p role="alert" className="mt-3 border-l-[3px] border-danger bg-[#f4dfd6] px-3 py-2 text-sm text-[#6e1f12]">
                  {payError}
                </p>
              )}
              {cluster.status === 'ready' ? (
                <button
                  type="button"
                  onClick={pay}
                  disabled={!agree || phase === 'paying'}
                  className="group label mt-4 flex h-14 w-full items-center justify-between bg-straw px-5 text-forest-deep transition-colors hover:bg-straw-light disabled:cursor-not-allowed disabled:bg-husk disabled:text-stone"
                >
                  {phase === 'paying' ? 'Waiting for UPI approval…' : 'Pay estimate by UPI'}
                  {phase === 'paying' ? (
                    <span aria-hidden="true" className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <span aria-hidden="true" className="transition-transform group-hover:translate-x-1.5">
                      →
                    </span>
                  )}
                </button>
              ) : (
                <p className="mt-4 border-l-[3px] border-straw bg-husk px-3 py-2.5 text-sm">This cluster is still forming and can’t be ordered yet.</p>
              )}
              <p className="label mt-2.5 text-center text-xs text-stone">Test mode · no real money moves yet</p>
            </div>
          ) : (
            <div role="status" className="bg-forest p-6 text-paper">
              <span className="grid size-16 place-items-center bg-straw">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#12241A" strokeWidth="2.6" strokeLinecap="square" aria-hidden="true">
                  <path d="M4 12.5 9.5 18 20 6" />
                </svg>
              </span>
              <p className="label mt-5.5 text-sage">Order {order.code}</p>
              <p className="display mt-2 text-5xl text-straw-light">Order placed</p>
              <p className="mt-3 leading-relaxed text-sage-light">
                Farmers can see their straw is sold. A baler will be booked next, and you’ll see each stop as it’s verified.
              </p>
              <Link to={`/buyer/orders/${order.id}`} className="label mt-5.5 flex h-14 items-center justify-between bg-paper px-5 text-forest-deep">
                Track this order <span aria-hidden="true">→</span>
              </Link>
            </div>
          )}
        </aside>
      </div>
    </>
  )
}
