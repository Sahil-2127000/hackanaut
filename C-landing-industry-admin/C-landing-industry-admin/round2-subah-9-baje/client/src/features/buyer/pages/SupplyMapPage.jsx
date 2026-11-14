import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../../../lib/cn'
import { formatNumber, formatRupees } from '../../../lib/format'
import { useAsync } from '../../../lib/useAsync'
import { ErrorBlock } from '../../farmer/components/LoadState'
import { buyerApi, weekRange, weekShort } from '../buyerApi'

function SupplyMap({ plant, clusters, selectedId, isVisible, onSelect }) {
  const holder = useRef(null)
  const map = useRef(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    import('../supplyMapSetup').then(({ createSupplyMap }) => {
      if (cancelled || !holder.current) return
      map.current = createSupplyMap(holder.current, { plant, onSelect: (id) => onSelectRef.current(id) })
      setReady(true)
    })
    return () => {
      cancelled = true
      map.current?.destroy()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plant.lat, plant.lng])

  useEffect(() => {
    if (ready) map.current?.setClusters(clusters, selectedId, isVisible)
  }, [ready, clusters, selectedId, isVisible])

  return (
    <div className="relative h-[clamp(420px,62vh,680px)] overflow-hidden border border-soil/20 bg-survey">
      <div ref={holder} className="absolute inset-0" role="application" aria-label="Map of supply clusters around your plant. Use the list to choose a cluster with the keyboard." />
      {!ready && <span className="label absolute inset-0 grid place-items-center text-stone">Loading map…</span>}
      <div className="pointer-events-none absolute right-3 bottom-7 z-[500] grid gap-1.5 bg-paper/95 px-3 py-2.5 text-xs" aria-hidden="true">
        <span className="flex items-center gap-2">
          <span className="size-3 bg-forest" /> Ready to order
        </span>
        <span className="flex items-center gap-2">
          <span className="size-3 border-2 border-dashed border-straw-dark bg-straw-light" /> Forming
        </span>
        <span className="label text-xs text-stone">Number = tonnes · label = delivered ₹ per tonne</span>
      </div>
    </div>
  )
}

function SelectedPanel({ cluster, minTonnes }) {
  if (!cluster) {
    return (
      <div className="grid h-full place-items-center p-8 text-center text-stone">
        <p>Select a cluster on the map or in the list to see its farms and delivered price.</p>
      </div>
    )
  }
  const ready = cluster.status === 'ready'
  const max = Math.max(...cluster.price.balerParts.map((p) => p.amount))
  return (
    <div className="flex h-full flex-col">
      <div className="p-5 pb-0">
        <div className="flex items-center justify-between gap-3">
          <span className="label text-stone">
            {cluster.code} · {cluster.district}
          </span>
          <span className={cn('label px-2 py-1 text-xs', ready ? 'bg-forest text-paper' : 'bg-straw-light text-[#4f3b07]')}>{ready ? 'Ready to order' : 'Forming'}</span>
        </div>
        <h2 className="mt-3 text-[22px] font-semibold tracking-[-0.015em]">{cluster.place}</h2>
        <p className="display mt-3.5 text-7xl text-forest">
          {formatNumber(cluster.totalTonnes, 1)}
          <span className="text-2xl text-stone"> t est.</span>
        </p>
      </div>
      <dl className="mx-5 mt-4 border-t border-soil/15 text-sm">
        {[
          ['Farms', `${cluster.farmCount} farms · ${formatNumber(cluster.totalAcres, 1)} acres`],
          ['Harvest week', `${weekShort(cluster.harvestWeek)} · ${weekRange(cluster.harvestWeek)}`],
          ['Distance to plant', `${formatNumber(cluster.price.kmToPlant, 1)} km by road`],
          ['Farmers · ₹1,200/t', formatRupees(cluster.price.farmers)],
          ['Baling & transport', formatRupees(cluster.price.baler)],
          ['Delivered price', `${formatRupees(cluster.price.perTonne)} / t`],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-soil/10 py-2.5">
            <dt className="text-stone">{k}</dt>
            <dd className="text-right font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mx-5 mt-4">
        <p className="label text-stone">Where the baler share goes</p>
        <div className="mt-2 grid gap-1.5">
          {cluster.price.balerParts.map((p) => (
            <div key={p.key} className="grid grid-cols-[1fr_72px] items-center gap-2 text-xs">
              <span className="relative h-5 bg-soil/[0.06]">
                <span className="absolute inset-y-0 left-0 bg-sage/60" style={{ width: `${(p.amount / max) * 100}%` }} />
                <span className="relative px-1.5 leading-5 text-soil">{p.label}</span>
              </span>
              <span className="text-right tabular-nums">{formatRupees(p.amount)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-auto p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="font-semibold">Estimated total</span>
          <span className="display text-4xl text-forest">{formatRupees(cluster.price.total)}</span>
        </div>
        {ready ? (
          <Link to={`/buyer/clusters/${cluster.id}`} className="group label flex h-14 items-center justify-between bg-straw px-5 text-forest-deep transition-colors hover:bg-straw-light">
            Review &amp; order <span aria-hidden="true" className="transition-transform group-hover:translate-x-1.5">→</span>
          </Link>
        ) : (
          <p className="border-l-[3px] border-straw bg-husk px-4 py-3 text-sm text-stone-dark">
            Still forming: it can be ordered once nearby farms add up to {minTonnes} t. Check the harvest calendar.
          </p>
        )}
        <p className="mt-2.5 text-xs leading-normal text-stone">Final amount uses the weight verified at each farm.</p>
      </div>
    </div>
  )
}

export default function SupplyMapPage() {
  const [maxKm, setMaxKm] = useState(60)
  const [debouncedKm, setDebouncedKm] = useState(60)
  const { data, error, loading, reload } = useAsync((signal) => buyerApi.clusters(debouncedKm, signal), [debouncedKm])
  const [week, setWeek] = useState('all')
  const [readyOnly, setReadyOnly] = useState(false)
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedKm(maxKm), 350)
    return () => clearTimeout(t)
  }, [maxKm])

  const clusters = useMemo(() => data?.clusters ?? [], [data])
  const weeks = useMemo(() => [...new Set(clusters.map((c) => c.harvestWeek))].sort(), [clusters])
  const isVisible = useMemo(() => (c) => (week === 'all' || c.harvestWeek === week) && (!readyOnly || c.status === 'ready'), [week, readyOnly])
  const visible = clusters.filter(isVisible)
  const selected = clusters.find((c) => c.id === selectedId) ?? null

  // Default selection: the cheapest ready cluster.
  useEffect(() => {
    if (!selectedId && clusters.length) setSelectedId((clusters.filter((c) => c.status === 'ready').sort((a, b) => a.price.perTonne - b.price.perTonne)[0] ?? clusters[0]).id)
  }, [clusters, selectedId])

  return (
    <div className="mx-auto max-w-[1520px] px-[clamp(16px,3vw,40px)] pt-6 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[clamp(2.4rem,4.6vw,4rem)]">Straw near your plant</h1>
        </div>
        {data && (
          <dl className="flex flex-wrap border-l border-soil/15">
            {[
              ['Ready now', data.totals.readyCount, ' clusters'],
              ['Ready tonnes', formatNumber(data.totals.readyTonnes, 0), ' t'],
              ['Forming', formatNumber(data.totals.formingTonnes, 0), ' t'],
            ].map(([k, v, u]) => (
              <div key={k} className="border-r border-soil/15 px-5">
                <dt className="label text-stone">{k}</dt>
                <dd className="display mt-1.5 text-4xl text-forest">
                  {v}
                  <span className="text-base text-stone">{u}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {error && <ErrorBlock error={error} onRetry={reload} />}

      <div className="mt-5 flex flex-wrap items-stretch gap-4">
        <aside aria-label="Filters" className="flex min-w-0 flex-[1_1_220px] flex-col gap-6">
          <fieldset>
            <legend className="label text-stone">Harvest week</legend>
            <div className="mt-2.5 grid grid-cols-3 gap-1">
              {['all', ...weeks].map((w) => (
                <button
                  key={w}
                  type="button"
                  aria-pressed={week === w}
                  onClick={() => setWeek(w)}
                  className={cn('label h-11 border border-soil/30 transition-colors', week === w ? 'bg-soil text-paper' : 'hover:bg-husk')}
                >
                  {w === 'all' ? 'All' : weekShort(w)}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px]">
            <input type="checkbox" checked={readyOnly} onChange={() => setReadyOnly((v) => !v)} className="size-5 accent-forest" />
            Only clusters ready to order
          </label>
          <div>
            <label htmlFor="dist" className="label text-stone">
              Max distance · {maxKm} km
            </label>
            <input id="dist" type="range" min="10" max="120" step="5" value={maxKm} onChange={(e) => setMaxKm(Number(e.target.value))} className="mt-3 w-full accent-forest" />
          </div>
          <div className="min-h-0 flex-1">
            <p className="label text-stone">Clusters ({visible.length})</p>
            <ul className="mt-2 max-h-[300px] overflow-y-auto border-t border-soil/15">
              {visible.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    aria-pressed={c.id === selectedId}
                    className={cn('flex w-full items-center justify-between gap-2 border-b border-soil/10 px-2 py-2.5 text-left text-sm transition-colors', c.id === selectedId ? 'bg-husk' : 'hover:bg-husk/60')}
                  >
                    <span>
                      <span className="font-semibold">{c.place}</span>{' '}
                      <span className="label text-xs text-stone">
                        {weekShort(c.harvestWeek)} · {c.status}
                      </span>
                    </span>
                    <span className="tabular-nums">{formatRupees(c.price.perTonne)}/t</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="border-l-[3px] border-straw bg-husk p-4">
            <p className="text-sm font-semibold">Plan ahead</p>
            <p className="mt-1 text-[13px] leading-normal text-stone-dark">See supply week by week before it’s cut.</p>
            <Link to="/buyer/calendar" className="label mt-2 inline-flex min-h-8 items-center text-forest">
              Harvest calendar →
            </Link>
          </div>
        </aside>

        <figure className="m-0 min-w-0 flex-[999_1_560px]">
          {data ? (
            <SupplyMap plant={data.plant} clusters={clusters} selectedId={selectedId} isVisible={isVisible} onSelect={setSelectedId} />
          ) : (
            <div className="h-[clamp(420px,62vh,680px)] animate-pulse bg-husk" role="status" aria-label={loading ? 'Loading map' : undefined} />
          )}
          <figcaption className="mt-2 text-xs text-stone">Farm positions are shown to about 1 km until you order.</figcaption>
        </figure>

        <section aria-label="Selected cluster" className="min-w-0 flex-[1_1_320px] border border-soil/15 bg-paper-light">
          <SelectedPanel cluster={selected} minTonnes={data?.rules.minTonnes ?? 30} />
        </section>
      </div>
    </div>
  )
}
