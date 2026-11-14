import { RATES } from '../config/rates.js'
import { haversineKm } from '../utils/geo.js'

/**
 * Route planning for one vehicle: start → farms → industry (no depot).
 *
 * 1. Sequence: nearest-neighbour from the vehicle's start (`sequenceStops`). Kept as its own
 *    function so it can later be swapped for a capacity-aware vehicle-routing solver.
 * 2. Road distance, time and the drawn line come from OSRM (public OpenStreetMap router).
 *    If OSRM is slow or unreachable we fall back to straight-line × road factor and say so
 *    (`source: 'estimate'`).
 */

const OSRM_URL = process.env.OSRM_URL ?? 'https://router.project-osrm.org'
const OSRM_TIMEOUT_MS = 4000
const round1 = (n) => Math.round(n * 10) / 10
const cache = new Map()

/** Nearest-neighbour order of `stops` starting from `start`. Returns indices into `stops`. */
export function sequenceStops(start, stops) {
  const left = stops.map((s, i) => ({ ...s, i }))
  const order = []
  let here = start
  while (left.length) {
    left.sort((a, b) => haversineKm(here, a) - haversineKm(here, b))
    const next = left.shift()
    order.push(next.i)
    here = next
  }
  return order
}

async function osrm(points) {
  const key = points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';')
  if (cache.has(key)) return cache.get(key)
  const url = `${OSRM_URL}/route/v1/driving/${key}?overview=simplified&geometries=geojson`
  const res = await fetch(url, { signal: AbortSignal.timeout(OSRM_TIMEOUT_MS), headers: { 'User-Agent': 'ParaliLink/0.1 (hackathon demo)' } })
  if (!res.ok) throw new Error(`OSRM ${res.status}`)
  const body = await res.json()
  const route = body.routes?.[0]
  if (body.code !== 'Ok' || !route) throw new Error(`OSRM ${body.code}`)
  const result = {
    legsKm: route.legs.map((l) => l.distance / 1000),
    durationMin: route.duration / 60,
    geometry: route.geometry.coordinates.map(([lng, lat]) => [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]),
  }
  if (cache.size > 500) cache.clear()
  cache.set(key, result)
  return result
}

function estimate(points) {
  const legsKm = points.slice(1).map((p, i) => haversineKm(points[i], p) * RATES.roadFactor)
  const km = legsKm.reduce((s, x) => s + x, 0)
  return { legsKm, durationMin: (km / RATES.trucks.avgSpeedKmh) * 60, geometry: points.map((p) => [p.lat, p.lng]) }
}

/** Road legs for an already ordered list of points. */
export async function roadLegs(points) {
  if (points.length < 2) return { legsKm: [], durationMin: 0, geometry: points.map((p) => [p.lat, p.lng]), source: 'estimate' }
  try {
    return { ...(await osrm(points)), source: 'osrm' }
  } catch {
    return { ...estimate(points), source: 'estimate' }
  }
}

/**
 * Plans one pickup run. `stops` are { lat, lng, ... }.
 * Returns the stop order plus distances (km), driving + loading time and the line to draw.
 */
export async function planRoute(start, stops, plant) {
  const sequence = sequenceStops(start, stops)
  const ordered = sequence.map((i) => stops[i])
  const points = [start, ...ordered, plant]
  const { legsKm, durationMin, geometry, source } = await roadLegs(points)
  const approachKm = legsKm[0] ?? 0
  const toPlantKm = legsKm[legsKm.length - 1] ?? 0
  const routeKm = legsKm.slice(1, -1).reduce((s, x) => s + x, 0)
  const workMin = ordered.length * RATES.trucks.loadMinutesPerStop + RATES.trucks.unloadMinutes
  // Minutes from departure to reach each stop (driving + loading at earlier stops).
  let t = 0
  const arriveMin = ordered.map((_, n) => {
    t += (legsKm[n] / Math.max(legsKm.reduce((s, x) => s + x, 0), 0.001)) * durationMin + (n > 0 ? RATES.trucks.loadMinutesPerStop : 0)
    return Math.round(t)
  })
  return {
    sequence,
    approachKm: round1(approachKm),
    routeKm: round1(routeKm),
    toPlantKm: round1(toPlantKm),
    totalKm: round1(approachKm + routeKm + toPlantKm),
    durationMin: Math.round(durationMin + workMin),
    arriveMin,
    geometry,
    source,
  }
}
