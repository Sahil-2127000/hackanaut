import crypto from 'node:crypto'
import { RATES } from '../config/rates.js'
import { Listing, listingLabel } from '../models/listing.model.js'
import { Order } from '../models/order.model.js'
import { LIVE_TRIP, Trip } from '../models/trip.model.js'
import { User } from '../models/user.model.js'
import { Vehicle } from '../models/vehicle.model.js'
import { nextSequence } from '../utils/counters.js'
import { atTime, dayKey, startOfDay } from '../utils/dates.js'
import { centroid, haversineKm, toLatLng } from '../utils/geo.js'
import { withLogisticsLock } from './machineScheduler.service.js'
import { notify } from './notification.service.js'
import { planRoute } from './route.service.js'

/**
 * Automatic truck assignment (best-fit vehicle combination).
 *
 * Runs only for straw that is actually baled and ready. For the ready tonnes it:
 *  1. lists vehicles that are active, free that day (one run per vehicle per day), available
 *     on that date, whose service area covers the cluster and that can reach every field
 *     (a "tractor only" field can't take a 12-wheeler);
 *  2. works out what each can really carry: min(payload, loading volume ÷ m³ per tonne),
 *     because bulky straw fills a truck by volume before weight;
 *  3. picks the cheapest combination that covers the ready tonnes (exact search over the
 *     nearest candidates; ties → fewer vehicles, then less empty space). The industry's own
 *     vehicles are used first when it prefers that; third-party transporters fill the rest;
 *  4. splits the farms over the chosen vehicles (a farm can be split), orders each run with
 *     nearest-neighbour and gets road distance / time / line from OSRM.
 * Short of capacity → books what exists and raises an alert for the admin.
 */

const round1 = (n) => Math.round(n * 10) / 10
const ACCESS_RANK = { tractor: 0, truck: 1, any: 2 }
const VEHICLE_NEEDS = { tractor_trolley: 0, truck: 1, twelve_wheeler: 2, trailer: 2 }
const TYPE_LABEL = { tractor_trolley: 'tractor-trolley', truck: 'truck', twelve_wheeler: '12-wheeler', trailer: 'trailer' }
const MAX_CANDIDATES = 16

export const strawCapacity = (v) => round1(Math.min(v.payloadTonnes, v.volumeM3 ? v.volumeM3 / RATES.trucks.m3PerTonne : Infinity))
const canReach = (v, access) => VEHICLE_NEEDS[v.type] <= ACCESS_RANK[access ?? 'any']
const vehicleLabel = (v) => `${TYPE_LABEL[v.type]} ${v.payloadTonnes} t`

function availableOn(v, day) {
  if (v.availableFrom && day < startOfDay(v.availableFrom)) return false
  if (v.availableTo && day > startOfDay(v.availableTo)) return false
  return true
}

const WORK_START = '08:00'
const WORK_END = '18:00'
const MAX_RUNS_PER_DAY = 3

/**
 * Run slots that could carry this pickup, with capacity and an estimated cost.
 * A vehicle can make several runs a day: after unloading at the plant it drives back to the
 * farms, as long as the run still ends inside the working day (turnaround time counts).
 * Runs already booked that day are taken off the vehicle's time.
 * `center` = farms' centre, `plant` = industry, `access` = most restrictive field access.
 */
export async function vehicleCandidates({ center, plant, day, access, buyerId, routeKm = 0, notBefore }) {
  const all = await Vehicle.find({ active: true }).lean()
  const booked = await Trip.find({ status: { $ne: 'cancelled' }, date: startOfDay(day) }).select('vehicle eta').lean()
  const freeAt = new Map()
  for (const t of booked) if (!freeAt.has(String(t.vehicle)) || t.eta > freeAt.get(String(t.vehicle))) freeAt.set(String(t.vehicle), t.eta)

  const toPlant = haversineKm(center, plant) * RATES.roadFactor
  const plantToFarms = toPlant
  const { avgSpeedKmh, loadMinutesPerStop, unloadMinutes } = RATES.trucks
  const dayStart = atTime(day, WORK_START)
  const dayEnd = atTime(day, WORK_END)
  const runMin = (approach) => ((approach + routeKm + toPlant) / avgSpeedKmh) * 60 + 2 * loadMinutesPerStop + unloadMinutes

  const slots = []
  for (const v of all) {
    if (!(v.ownerKind === 'independent' || String(v.owner) === String(buyerId))) continue
    if (!availableOn(v, day) || !canReach(v, access)) continue
    const capacity = strawCapacity(v)
    const fromBase = haversineKm(toLatLng(v.base), center) * RATES.roadFactor
    if (!(capacity > 0) || fromBase > Math.min(v.serviceRadiusKm, RATES.trucks.searchRadiusKm)) continue
    const busy = freeAt.get(String(v._id))
    let t = new Date(Math.max(dayStart.getTime(), notBefore?.getTime() ?? 0, busy?.getTime() ?? 0))
    for (let k = 0; k < MAX_RUNS_PER_DAY; k++) {
      // First run of the day starts from the base; later runs (or after an earlier booking) from the plant.
      const fromPlant = k > 0 || Boolean(busy)
      const approach = fromPlant ? plantToFarms : fromBase
      const minutes = runMin(approach)
      if (t.getTime() + minutes * 60_000 > dayEnd.getTime()) break
      const km = approach + routeKm + toPlant
      slots.push({
        v,
        run: k,
        key: `${v._id}#${k}`,
        start: fromPlant ? plant : toLatLng(v.base),
        departAt: t,
        approach,
        capacity,
        cost: Math.round(Math.max(v.minCharge ?? 0, km * v.ratePerKm)),
        own: v.ownerKind === 'industry',
      })
      t = new Date(t.getTime() + minutes * 60_000)
    }
  }
  return slots.sort((a, b) => a.run - b.run || a.approach - b.approach).slice(0, MAX_CANDIDATES * 3)
}

/** Cheapest subset of `cands` with total capacity ≥ need. null if impossible. */
export function minCostCover(cands, need) {
  if (need <= 0) return []
  const list = [...cands].sort((a, b) => a.cost / a.capacity - b.cost / b.capacity).slice(0, MAX_CANDIDATES)
  if (list.reduce((s, c) => s + c.capacity, 0) < need - 0.01) return null
  const suffixCap = list.map((_, i) => list.slice(i).reduce((s, c) => s + c.capacity, 0))
  let best = null
  const better = (cost, n, spare) =>
    !best || cost < best.cost || (cost === best.cost && (n < best.pick.length || (n === best.pick.length && spare < best.spare)))
  const pick = []
  function dfs(i, cap, cost) {
    if (best && cost > best.cost) return
    if (cap >= need - 0.01) {
      if (better(cost, pick.length, cap - need)) best = { cost, spare: cap - need, pick: [...pick] }
      return
    }
    if (i >= list.length || cap + suffixCap[i] < need - 0.01) return
    pick.push(list[i])
    dfs(i + 1, cap + list[i].capacity, cost + list[i].cost)
    pick.pop()
    dfs(i + 1, cap, cost)
  }
  dfs(0, 0, 0)
  return best?.pick ?? null
}

/** Chooses vehicles for `need` tonnes. Returns { picked, shortTonnes }. */
export function chooseVehicles(cands, need, preferOwn) {
  const own = cands.filter((c) => c.own)
  const third = cands.filter((c) => !c.own)
  if (preferOwn && own.length) {
    const ownOnly = minCostCover(own, need)
    if (ownOnly) return { picked: ownOnly, shortTonnes: 0 }
    const ownCap = own.reduce((s, c) => s + c.capacity, 0)
    const rest = minCostCover(third, need - ownCap)
    if (rest) return { picked: [...own, ...rest], shortTonnes: 0 }
    const capAll = ownCap + third.reduce((s, c) => s + c.capacity, 0)
    return { picked: [...own, ...third], shortTonnes: round1(need - capAll) }
  }
  const cover = minCostCover(cands, need)
  if (cover) return { picked: cover, shortTonnes: 0 }
  return { picked: cands, shortTonnes: round1(need - cands.reduce((s, c) => s + c.capacity, 0)) }
}

const summarise = (picked) => {
  const vehicles = new Map()
  for (const c of picked) vehicles.set(String(c.v._id), { v: c.v, runs: (vehicles.get(String(c.v._id))?.runs ?? 0) + 1 })
  const byType = new Map()
  for (const { v, runs } of vehicles.values()) {
    const x = byType.get(vehicleLabel(v)) ?? { n: 0, runs: 0 }
    byType.set(vehicleLabel(v), { n: x.n + 1, runs: x.runs + runs })
  }
  return [...byType].map(([label, x]) => `${x.n} × ${label}${x.runs > x.n ? ` (${x.runs} runs)` : ''}`).join(' + ')
}

/**
 * Provisional plan (nothing is booked) for a cluster before / right after purchase:
 * which vehicle combination would carry it on the harvest day, and roughly what it costs.
 */
export async function provisionalPlan({ tonnes, center, plant, day, access, buyer, routeKm }) {
  const cands = await vehicleCandidates({ center, plant, day: startOfDay(day), access, buyerId: buyer?._id, routeKm })
  const preferOwn = Boolean(RATES.trucks.preferIndustryFleet) && (buyer?.buyer?.preferOwnFleet ?? true)
  const { picked, shortTonnes } = chooseVehicles(cands, tonnes, preferOwn)
  const cost = picked.reduce((s, c) => s + (c.own ? 0 : c.cost), 0)
  return {
    vehicles: picked.map((c) => ({ regNo: c.v.regNo, type: c.v.type, capacity: c.capacity, own: c.own, cost: c.own ? 0 : c.cost })),
    summary: picked.length ? summarise(picked) : 'No vehicle free yet',
    capacity: round1(picked.reduce((s, c) => s + c.capacity, 0)),
    transportCost: cost,
    shortTonnes: Math.max(0, shortTonnes),
  }
}

/** Tonnes of each farm's ready straw not yet on a live truck run. */
async function unplannedReady(order) {
  const listings = await Listing.find({ _id: { $in: order.listings }, status: { $in: ['ready', 'pickup_scheduled'] } })
  const trips = await Trip.find({ order: order._id, status: { $ne: 'cancelled' } }).lean()
  const planned = new Map()
  for (const t of trips) for (const s of t.stops) if (s.status !== 'skipped') planned.set(String(s.listing), (planned.get(String(s.listing)) ?? 0) + (s.collectedTonnes ?? s.plannedTonnes))
  return listings
    .map((l) => ({ l, left: round1((l.readyTonnes ?? l.estTonnes) - (planned.get(String(l._id)) ?? 0)) }))
    .filter((x) => x.left > 0.05)
}

/** Splits farms over vehicles: each vehicle fills up from its nearest farms (farms may be split). */
function splitLoads(picked, farms) {
  const left = new Map(farms.map((f) => [String(f.l._id), f.left]))
  const runs = []
  for (const c of [...picked].sort((a, b) => a.run - b.run || b.capacity - a.capacity)) {
    let cap = c.capacity
    let here = c.start
    const stops = []
    while (cap > 0.05) {
      const options = farms.filter((f) => left.get(String(f.l._id)) > 0.05 && canReach(c.v, f.l.access) && !stops.some((s) => s.f === f))
      if (!options.length) break
      options.sort((a, b) => haversineKm(here, toLatLng(a.l.location)) - haversineKm(here, toLatLng(b.l.location)))
      const f = options[0]
      const take = round1(Math.min(cap, left.get(String(f.l._id))))
      stops.push({ f, take })
      left.set(String(f.l._id), round1(left.get(String(f.l._id)) - take))
      cap = round1(cap - take)
      here = toLatLng(f.l.location)
    }
    if (stops.length) runs.push({ c, stops })
  }
  return runs
}

async function nextTripCode() {
  return `TR-${String(await nextSequence('trip')).padStart(4, '0')}`
}

/**
 * Assigns vehicles to the order's ready, unplanned straw. Caller holds the logistics lock.
 * `force` ignores the "enough straw waiting" threshold (admin "retry").
 */
async function assignReady(order, { force = false } = {}) {
  const farms = await unplannedReady(order)
  if (!farms.length) {
    order.resolveAlerts(['no_vehicle', 'short_capacity'])
    await order.save()
    return []
  }
  const readyLeft = round1(farms.reduce((s, f) => s + f.left, 0))
  const notReady = await Listing.countDocuments({ _id: { $in: order.listings }, status: { $in: ['sold', 'scheduled', 'cutting'] } })
  if (!force && readyLeft < RATES.trucks.dispatchAtTonnes && notReady > 0) return [] // wait for more straw

  const buyer = await User.findById(order.buyer)
  const plant = order.plant
  const center = centroid(farms.map((f) => toLatLng(f.l.location)))
  const preferOwn = Boolean(RATES.trucks.preferIndustryFleet) && (buyer.buyer?.preferOwnFleet ?? true)
  // Today if vehicles still have time; otherwise the next day(s). Take the first day that can
  // carry everything, else the day that can carry the most.
  const now = new Date()
  let best = null
  for (let offset = 0; offset < 3; offset++) {
    const day = startOfDay(new Date(now.getTime() + offset * 86_400_000))
    const cands = await vehicleCandidates({ center, plant, day, access: 'any', buyerId: buyer._id, notBefore: offset === 0 ? new Date(now.getTime() + 30 * 60_000) : undefined })
    const reachable = cands.filter((c) => farms.some((f) => canReach(c.v, f.l.access)))
    const choice = chooseVehicles(reachable, readyLeft, preferOwn)
    const cap = choice.picked.reduce((s, c) => s + c.capacity, 0)
    if (!best || cap > best.cap) best = { day, cap, ...choice }
    if (choice.picked.length && choice.shortTonnes <= 0) break
  }
  const { day, picked, shortTonnes } = best

  if (!picked.length) {
    order.addAlert('no_vehicle', `${readyLeft} t is ready but no vehicle is free in the next 3 days near ${order.place}. Find a vehicle or reschedule.`)
    await order.save()
    return []
  }

  const runs = splitLoads(picked, farms)
  const leftover = round1(readyLeft - runs.reduce((s, r) => s + r.stops.reduce((x, st) => x + st.take, 0), 0))
  if (shortTonnes > 0.05 || leftover > 0.05) {
    order.addAlert('short_capacity', `Short of vehicle capacity by ${Math.max(shortTonnes, leftover)} t for ${order.clusterCode}. The rest waits for another vehicle.`)
  } else {
    order.resolveAlerts(['no_vehicle', 'short_capacity'])
  }

  const farmers = new Map((await User.find({ _id: { $in: farms.map((f) => f.l.farmer) } }).select('name phone')).map((u) => [String(u._id), u]))
  const trips = []
  const lastEta = new Map() // vehicle → when its previous run in this plan reaches the plant

  for (const { c, stops } of runs) {
    const start = c.start
    const departure = new Date(Math.max(c.departAt.getTime(), lastEta.get(String(c.v._id))?.getTime() ?? 0))
    const points = stops.map((s) => toLatLng(s.f.l.location))
    const route = await planRoute(start, points, plant)
    const ordered = route.sequence.map((i) => stops[i])
    const cost = c.own ? 0 : Math.round(Math.max(c.v.minCharge ?? 0, route.totalKm * c.v.ratePerKm))
    const eta = new Date(departure.getTime() + route.durationMin * 60_000)
    lastEta.set(String(c.v._id), eta)

    const trip = await Trip.create({
      code: await nextTripCode(),
      vehicle: c.v._id,
      owner: c.v.owner,
      ownerKind: c.v.ownerKind,
      order: order._id,
      buyer: order.buyer,
      clusterCode: order.clusterCode,
      regNo: c.v.regNo,
      vehicleType: c.v.type,
      capacityTonnes: c.capacity,
      date: day,
      start,
      plant,
      plantName: order.buyerCompany,
      stops: ordered.map((s, n) => {
        const farmer = farmers.get(String(s.f.l.farmer))
        return {
          listing: s.f.l._id,
          label: listingLabel(s.f.l),
          farmerName: farmer?.name,
          farmerPhone: farmer?.phone,
          village: s.f.l.village,
          location: toLatLng(s.f.l.location),
          plannedTonnes: s.take,
          eta: new Date(departure.getTime() + route.arriveMin[n] * 60_000),
        }
      }),
      approachKm: route.approachKm,
      routeKm: route.routeKm,
      toPlantKm: route.toPlantKm,
      totalKm: route.totalKm,
      durationMin: route.durationMin,
      eta,
      geometry: route.geometry,
      routeSource: route.source,
      plannedTonnes: round1(stops.reduce((s, x) => s + x.take, 0)),
      cost,
      statusHistory: [{ status: 'assigned', at: now }],
    })
    trips.push(trip)

    for (const s of trip.stops) {
      const l = farms.find((f) => String(f.l._id) === String(s.listing)).l
      if (!l.pickup?.code) l.pickup = { code: crypto.randomInt(0, 1_000_000).toString().padStart(6, '0'), attempts: 0 }
      await l.save()
      await notify(
        l.farmer,
        'Truck assigned for pickup',
        `${trip.regNo} (${TYPE_LABEL[trip.vehicleType]}) collects about ${s.plannedTonnes} t around ${s.eta.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}. Show your pickup code to the driver.`,
        `/farmer/listings/${l._id}`,
      )
    }
    await notify(trip.owner, `New pickup run ${trip.code}`, `${trip.stops.length} farm${trip.stops.length > 1 ? 's' : ''}, ${trip.plannedTonnes} t to ${order.buyerCompany}. ${route.totalKm} km.`, c.own ? `/buyer/trips/${trip._id}` : `/transporter/trips/${trip._id}`)
  }

  // Farms fully planned move to pickup_scheduled.
  const stillLeft = new Map((await unplannedReady(order)).map((x) => [String(x.l._id), x.left]))
  for (const f of farms) {
    if (!stillLeft.has(String(f.l._id)) && f.l.status === 'ready') {
      f.l.status = 'pickup_scheduled'
      f.l.statusHistory.push({ status: 'pickup_scheduled', at: now })
      await f.l.save()
    }
  }

  // Deadline and unloading checks (warnings for the admin and industry).
  const latest = trips.reduce((m, t) => (t.eta > m ? t.eta : m), new Date(0))
  if (order.deliveryBy && latest > new Date(startOfDay(order.deliveryBy).getTime() + 86_400_000)) {
    order.addAlert('late', `Delivery expected ${latest.toLocaleDateString('en-IN')} is after the industry's deadline.`)
  }
  if (buyer.buyer?.unloadPerDay) {
    const sameDay = await Trip.find({ buyer: buyer._id, date: day, status: { $ne: 'cancelled' } }).lean()
    const tonnesToday = sameDay.reduce((s, t) => s + t.plannedTonnes, 0)
    if (tonnesToday > buyer.buyer.unloadPerDay) {
      order.addAlert('unload', `${round1(tonnesToday)} t arriving on ${dayKey(day)} is above the plant's unloading limit of ${buyer.buyer.unloadPerDay} t/day.`)
    }
  }

  await notify(order.buyer, `${trips.length} truck run${trips.length > 1 ? 's' : ''} assigned for ${order.clusterCode}`, `${round1(trips.reduce((s, t) => s + t.plannedTonnes, 0))} t, ${day.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.`, `/buyer/orders/${order._id}`)
  await order.save()
  return trips
}

/** Called whenever a farm becomes ready. Assigns trucks once enough straw is waiting. */
export function maybeDispatch(orderId, opts) {
  return withLogisticsLock(async () => {
    const order = await Order.findById(orderId)
    if (!order || ['delivered', 'settled', 'cancelled'].includes(order.status)) return []
    return assignReady(order, opts)
  })
}

export { LIVE_TRIP }
