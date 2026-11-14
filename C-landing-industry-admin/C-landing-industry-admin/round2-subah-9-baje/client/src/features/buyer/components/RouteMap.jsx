import { useEffect, useRef, useState } from 'react'

/** Leaflet route map (farm stops → plant), loaded on demand. */
export function RouteMap({ plant, stops, base, plantLabel, baseLabel, height = 300, caption }) {
  const holder = useRef(null)
  const [ready, setReady] = useState(false)
  const key = JSON.stringify(stops.map((s) => [s.position, s.state]))

  useEffect(() => {
    let map
    let cancelled = false
    import('../routeMapSetup').then(({ createRouteMap }) => {
      if (cancelled || !holder.current) return
      map = createRouteMap(holder.current, { plant, stops, base, plantLabel, baseLabel })
      setReady(true)
    })
    return () => {
      cancelled = true
      map?.destroy()
    }
    // Rebuild only when the stops actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, plant.lat, plant.lng])

  return (
    <figure className="m-0">
      <div className="relative overflow-hidden border border-soil/20 bg-survey" style={{ height }}>
        <div ref={holder} className="absolute inset-0" role="img" aria-label={caption ?? 'Pickup route from farm to farm, then to your plant'} />
        {!ready && <span className="label absolute inset-0 grid place-items-center text-stone">Loading map…</span>}
      </div>
      {caption && <figcaption className="label mt-2 text-xs text-stone">{caption}</figcaption>}
    </figure>
  )
}
