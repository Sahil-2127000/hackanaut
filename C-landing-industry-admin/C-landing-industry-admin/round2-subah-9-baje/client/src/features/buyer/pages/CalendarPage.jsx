import { m, useReducedMotion } from 'motion/react'
import { useMemo, useState } from 'react'
import { cn } from '../../../lib/cn'
import { formatNumber } from '../../../lib/format'
import { EASE } from '../../../lib/motion'
import { useAsync } from '../../../lib/useAsync'
import { ErrorBlock, LoadingBlock } from '../../farmer/components/LoadState'
import { buyerApi, weekRange, weekShort } from '../buyerApi'

const SHADES = ['#F3EEE2', '#E4E9DA', '#C6D3B9', '#93AA86', '#4F6E57', '#1C3324']

export default function CalendarPage() {
  const reduce = useReducedMotion()
  const { data, error, loading, reload } = useAsync((signal) => buyerApi.calendar(signal))
  const [sel, setSel] = useState(null) // { district, week }
  const [demands, setDemands] = useState(null)
  const [busy, setBusy] = useState(false)

  const view = useMemo(() => {
    if (!data) return null
    const cell = (district, week) => data.cells.find((c) => c.district === district && c.week === week)
    const byDistrict = {}
    data.cells.forEach((c) => (byDistrict[c.district] = (byDistrict[c.district] ?? 0) + c.listedTonnes))
    const districts = Object.keys(byDistrict).sort((a, b) => byDistrict[b] - byDistrict[a])
    const totals = data.weeks.map((w) => data.cells.filter((c) => c.week === w).reduce((s, c) => s + c.listedTonnes, 0))
    const maxCell = Math.max(1, ...data.cells.map((c) => c.listedTonnes))
    const shade = (v) => (!v ? SHADES[0] : SHADES[Math.min(5, 1 + Math.floor((v / maxCell) * 4.999))])
    return { cell, districts, totals, maxTotal: Math.max(1, ...totals), shade, maxCell }
  }, [data])

  if (loading) return <LoadingBlock />
  if (error) return <ErrorBlock error={error} onRetry={reload} />

  const activeDemands = demands ?? data.demands
  const selected = sel ?? (view.districts[0] ? { district: view.districts[0], week: data.weeks.find((w) => view.cell(view.districts[0], w)) ?? data.weeks[1] } : null)
  const selCell = selected ? view.cell(selected.district, selected.week) : null
  const isDemanded = selected && activeDemands.some((d) => d.district === selected.district && d.week === selected.week)
  const nowIndex = data.weeks.indexOf(data.currentWeek)

  async function toggleDemand() {
    setBusy(true)
    try {
      const res = await buyerApi.toggleDemand(selected.district, selected.week)
      const others = activeDemands.filter((d) => !(d.district === selected.district && d.week === selected.week))
      setDemands(res.active ? [...others, selected] : others)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1520px] px-[clamp(16px,3vw,40px)] pt-6 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[clamp(2.4rem,4.6vw,4rem)]">
            What’s coming <span className="accent text-forest">off the fields</span>
          </h1>
        </div>
        <p className="max-w-[420px] text-sm leading-normal text-stone-dark">
          Listed acres × 2.4 t per acre. It grows every day as farmers list, so plan early and register interest.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-start gap-6">
        <div className="min-w-0 flex-[999_1_640px]">
          <figure className="m-0 border-t-2 border-forest pt-4">
            <figcaption className="flex justify-between">
              <span className="label">All districts · tonnes per harvest week</span>
              <span className="label text-stone">Peak {weekShort(data.weeks[view.totals.indexOf(Math.max(...view.totals))])}</span>
            </figcaption>
            <div className="mt-3.5 grid h-[150px] grid-cols-[120px_repeat(8,minmax(0,1fr))] items-end gap-1.5">
              <span />
              {view.totals.map((t, i) => (
                <div key={data.weeks[i]} className="flex h-full flex-col justify-end gap-1">
                  <span className={cn('label text-center text-xs', data.weeks[i] === selected?.week ? 'text-straw-dark' : 'text-stone')}>{t ? formatNumber(t, 0) : ''}</span>
                  <m.span
                    className={cn('block origin-bottom', data.weeks[i] === selected?.week ? 'bg-straw' : i === nowIndex ? 'bg-forest' : 'bg-sage')}
                    style={{ height: `${(t / view.maxTotal) * 110}px` }}
                    initial={reduce ? false : { scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ duration: 1, delay: i * 0.06, ease: EASE }}
                  />
                </div>
              ))}
            </div>
          </figure>

          {view.districts.length === 0 ? (
            <p className="mt-6 border border-dashed border-soil/30 p-6 text-center text-stone">No straw listed for the coming weeks yet.</p>
          ) : (
            <div className="mt-5 overflow-x-auto">
              <table className="-mx-1.5 w-full min-w-[640px] border-separate border-spacing-1.5">
                <caption className="px-1.5 pb-1.5 text-left">
                  <span className="label text-stone">Tonnes by district and week · select a cell</span>
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-[120px]" />
                    {data.weeks.map((w, i) => (
                      <th key={w} scope="col" className={cn('label py-1 font-normal', i === nowIndex ? 'text-straw-dark' : 'text-stone')}>
                        {weekShort(w)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {view.districts.map((d) => (
                    <tr key={d}>
                      <th scope="row" className="pr-2 text-left text-sm font-semibold whitespace-nowrap">
                        {d}
                      </th>
                      {data.weeks.map((w, i) => {
                        const c = view.cell(d, w)
                        const v = c?.listedTonnes ?? 0
                        const on = selected?.district === d && selected?.week === w
                        return (
                          <td key={w} className="p-0">
                            <button
                              type="button"
                              onClick={() => setSel({ district: d, week: w })}
                              aria-pressed={on}
                              aria-label={`${d}, ${weekShort(w)}, ${formatNumber(v, 0)} tonnes`}
                              className="label h-13 w-full text-xs transition-shadow hover:shadow-[inset_0_0_0_2px_#D8A532]"
                              style={{
                                background: view.shade(v),
                                color: v / view.maxCell > 0.6 ? '#F3EEE2' : '#1A1C17',
                                border: on ? '3px solid #D8A532' : i === nowIndex ? '1px solid #D8A532' : '1px solid rgb(26 28 23 / 0.08)',
                              }}
                            >
                              {v ? formatNumber(v, 0) : '–'}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3.5 flex flex-wrap items-center gap-3 text-xs" aria-hidden="true">
            <span className="label text-stone">Tonnes</span>
            <span>low</span>
            {SHADES.map((s) => (
              <span key={s} className="h-3.5 w-5 border border-soil/10" style={{ background: s }} />
            ))}
            <span>high</span>
            <span className="ml-3 flex items-center gap-1.5">
              <span className="h-4 w-0.5 bg-straw" /> This week
            </span>
          </div>
        </div>

        {selected && (
          <aside aria-labelledby="det-title" className="min-w-0 flex-[1_1_320px] border border-soil/15 bg-paper-light p-5.5">
            <h2 id="det-title" className="text-2xl font-semibold tracking-[-0.015em]">
              {selected.district} district
            </h2>
            <p className="mt-1 text-sm text-stone-dark">
              Week {weekShort(selected.week).replace('W', '')}, {weekRange(selected.week)}
            </p>
            <p className="display mt-3.5 text-7xl text-forest">
              {formatNumber(selCell?.listedTonnes ?? 0, 0)}
              <span className="text-2xl text-stone"> t</span>
            </p>
            {selCell ? (
              <>
                <div className="mt-4.5 flex h-2.5 bg-soil/[0.08]" role="img" aria-label={`${selCell.clusteredTonnes} t ready in clusters, ${selCell.availableTonnes - selCell.clusteredTonnes} t listed but not clustered`}>
                  <span className="bg-forest" style={{ width: `${(selCell.clusteredTonnes / selCell.listedTonnes) * 100}%` }} />
                  <span className="bg-straw" style={{ width: `${((selCell.availableTonnes - selCell.clusteredTonnes) / selCell.listedTonnes) * 100}%` }} />
                </div>
                <div className="mt-2 grid gap-1 text-[13px]">
                  <span>
                    <span className="mr-1.5 inline-block size-2.5 bg-forest" />
                    In ready clusters {formatNumber(selCell.clusteredTonnes, 1)} t
                  </span>
                  <span>
                    <span className="mr-1.5 inline-block size-2.5 bg-straw" />
                    Listed, still forming {formatNumber(selCell.availableTonnes - selCell.clusteredTonnes, 1)} t
                  </span>
                  <span>
                    <span className="mr-1.5 inline-block size-2.5 bg-soil/10" />
                    Already sold {formatNumber(selCell.listedTonnes - selCell.availableTonnes, 1)} t
                  </span>
                </div>
                <p className="mt-3 text-sm text-stone-dark">{selCell.farms} farms listed for this week.</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-stone-dark">Nothing listed yet for this district and week.</p>
            )}
            <button
              type="button"
              onClick={toggleDemand}
              disabled={busy}
              aria-pressed={isDemanded}
              className={cn(
                'group label mt-5 flex h-14 w-full items-center justify-between px-5 transition-colors disabled:opacity-60',
                isDemanded ? 'bg-forest text-paper' : 'bg-straw text-forest-deep hover:bg-straw-light',
              )}
            >
              {isDemanded ? 'Interest registered ✓' : 'Register interest in this supply'}
              <span aria-hidden="true">→</span>
            </button>
            <p className="mt-2.5 text-xs leading-normal text-stone">
              We use this to tell farmers where demand is. You only pay when you order a ready cluster.
            </p>
          </aside>
        )}
      </div>
    </div>
  )
}
