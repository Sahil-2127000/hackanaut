import { RATES } from '../config/rates.js'
import { Listing, listingLabel } from '../models/listing.model.js'
import { Machine } from '../models/machine.model.js'
import { LIVE_JOB, MachineJob } from '../models/machineJob.model.js'
import { Order } from '../models/order.model.js'
import { User } from '../models/user.model.js'
import { nextSequence } from '../utils/counters.js'
import { addDays, dayKey, startOfDay } from '../utils/dates.js'
import { haversineKm, toLatLng } from '../utils/geo.js'
import { withLock } from '../utils/lock.js'
import { notify } from './notification.service.js'

/**
 * Automatic machinery scheduling.
 *
 * Every farm needs cutting and baling. Either one combined machine does both, or a cutter
 * cuts and a baler follows after `dryingDays`. For each farm the scheduler:
 *  1. finds active machines of the right type whose service radius covers the farm,
 *  2. books acres day by day from the harvest date, never above the machine's daily
 *     capacity (summed over all its live jobs) and only inside its available dates,
 *  3. keeps the plan that finishes baling first (then the cheaper, then the nearer one).
 *
 * All booking runs under one lock, so no machine-day can be booked twice.
 * Farms with no machine get an alert on the order for the admin.
 */

const round1 = (n) => Math.round(n * 10) / 10

export function withLogisticsLock(task) {
  return withLock('logistics', task)
}

/**
 * Acres already booked per machine per day: Map(machineId → Map(dayKey → acres)).
 * Live jobs hold all their days; a completed job only holds the days up to when it finished
 * (finishing early frees the machine).
 */
async function bookedAcres(machineIds) {
  const jobs = await MachineJob.find({ machine: { $in: machineIds }, status: { $in: [...LIVE_JOB, 'completed'] } }).select('machine days status completedAt').lean()
  const map = new Map()
  for (const j of jobs) {
    const m = map.get(String(j.machine)) ?? new Map()
    const until = j.status === 'completed' && j.completedAt ? startOfDay(j.completedAt).getTime() : Infinity
    for (const d of j.days) if (new Date(d.date).getTime() <= until) m.set(dayKey(d.date), (m.get(dayKey(d.date)) ?? 0) + d.acres)
    map.set(String(j.machine), m)
  }
  return map
}

/** Books `acres` on a machine from `from`, using spare capacity each day. Returns { days, start, end } or null. */
function fitDays(machine, acres, from, booked) {
  const used = booked.get(String(machine._id)) ?? new Map()
  const cap = machine.capacityAcresPerDay
  const days = []
  let left = acres
  let day = startOfDay(from)
  if (machine.availableFrom && day < startOfDay(machine.availableFrom)) day = startOfDay(machine.availableFrom)
  const horizon = addDays(from, RATES.machines.horizonDays)
  while (left > 0.01) {
    if (day > horizon) return null
    if (machine.availableTo && day > startOfDay(machine.availableTo)) return null
    const spare = cap - (used.get(dayKey(day)) ?? 0)
    if (spare >= Math.min(0.5, left)) {
      const take = Math.min(spare, left)
      days.push({ date: day, acres: round1(take) })
      left -= take
    }
    day = addDays(day, 1)
  }
  return { days, start: days[0].date, end: days[days.length - 1].date }
}

function candidatesFor(machines, type, farm, exclude) {
  return machines
    .filter((m) => m.type === type && !exclude.has(String(m._id)))
    .map((m) => ({ m, km: haversineKm(toLatLng(m.base), farm) * RATES.roadFactor }))
    .filter((c) => c.km <= c.m.serviceRadiusKm)
}

function bestFit(cands, acres, from, booked) {
  let best = null
  for (const { m, km } of cands) {
    const fit = fitDays(m, acres, from, booked)
    if (!fit) continue
    const cost = Math.round(acres * m.ratePerAcre)
    const score = [fit.end.getTime(), cost, km]
    if (!best || compare(score, best.score) < 0) best = { m, km, fit, cost, score }
  }
  return best
}

const compare = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

/** Adds the plan's days to the in-memory bookings so later farms in the same run see them. */
function reserve(booked, plan) {
  const used = booked.get(String(plan.m._id)) ?? new Map()
  for (const d of plan.fit.days) used.set(dayKey(d.date), (used.get(dayKey(d.date)) ?? 0) + d.acres)
  booked.set(String(plan.m._id), used)
}

/** Picks combined vs cutter + baler for one farm. Returns [{ op, plan }] or null. */
function planFarm(listing, machines, booked, exclude) {
  const farm = toLatLng(listing.location)
  const from = new Date(Math.max(startOfDay(listing.harvestDate).getTime(), addDays(new Date(), 1).getTime()))
  const options = []

  const combined = bestFit(candidatesFor(machines, 'combined', farm, exclude), listing.acres, from, booked)
  if (combined) options.push({ end: combined.fit.end, cost: combined.cost, steps: [{ op: 'cut_bale', plan: combined }] })

  const cut = bestFit(candidatesFor(machines, 'cutter', farm, exclude), listing.acres, from, booked)
  if (cut) {
    // The baler must not start before cutting ends + drying.
    const baleFrom = addDays(cut.fit.end, RATES.machines.dryingDays)
    const bale = bestFit(candidatesFor(machines, 'baler', farm, exclude), listing.acres, baleFrom, booked)
    if (bale) options.push({ end: bale.fit.end, cost: cut.cost + bale.cost, steps: [{ op: 'cut', plan: cut }, { op: 'bale', plan: bale }] })
  }

  if (!options.length) return null
  options.sort((a, b) => a.end - b.end || a.cost - b.cost)
  return options[0].steps
}

async function createJob({ op, plan }, listing, order, farmer) {
  const { m, km, fit, cost } = plan
  const workHours = (() => {
    const [sh, sm] = m.workStart.split(':').map(Number)
    const [eh, em] = m.workEnd.split(':').map(Number)
    return (eh * 60 + em - sh * 60 - sm) / 60
  })()
  return MachineJob.create({
    code: `MJ-${String(await nextSequence('machineJob')).padStart(4, '0')}`,
    machine: m._id,
    owner: m.owner,
    order: order._id,
    listing: listing._id,
    clusterCode: order.clusterCode,
    op,
    machineName: m.name,
    farmLabel: listingLabel(listing),
    farmerName: farmer?.name,
    farmerPhone: farmer?.phone,
    village: listing.village,
    location: toLatLng(listing.location),
    acres: listing.acres,
    estTonnes: listing.estTonnes,
    distanceKm: round1(km),
    days: fit.days,
    start: fit.start,
    end: fit.end,
    hours: round1((listing.acres / m.capacityAcresPerDay) * workHours),
    ratePerAcre: m.ratePerAcre,
    cost,
    status: 'requested',
    statusHistory: [{ status: 'requested', at: new Date(), note: 'Booked automatically' }],
  })
}

const OP_LABEL = { cut: 'Cutting', bale: 'Baling', cut_bale: 'Cutting + baling' }
const fmtDay = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/** Schedules machines for the given farms of an order. Caller holds the logistics lock. */
async function scheduleListings(order, listings, exclude = new Set()) {
  const machines = await Machine.find({ active: true })
  const booked = await bookedAcres(machines.map((m) => m._id))
  const farmers = new Map((await User.find({ _id: { $in: listings.map((l) => l.farmer) } }).select('name phone')).map((u) => [String(u._id), u]))
  const created = []

  // Earliest harvest first, so early farms get the first free machine-days.
  for (const listing of [...listings].sort((a, b) => a.harvestDate - b.harvestDate)) {
    const farm = toLatLng(listing.location)
    const near = machines.filter((m) => haversineKm(toLatLng(m.base), farm) <= RATES.machines.searchRadiusKm)
    const steps = planFarm(listing, near, booked, exclude)
    if (!steps) {
      order.addAlert('no_machine', `No free machine within reach of ${listingLabel(listing)} (${listing.village}). Add a machine or reschedule.`, listing._id)
      continue
    }
    order.resolveAlerts(['no_machine', 'machine_exception'], 'system', listing._id)
    for (const step of steps) {
      reserve(booked, step.plan)
      created.push(await createJob(step, listing, order, farmers.get(String(listing.farmer))))
    }
    if (['sold', 'clustered'].includes(listing.status)) {
      listing.status = 'scheduled'
      listing.statusHistory.push({ status: 'scheduled', at: new Date() })
      await listing.save()
    }
    const first = steps[0].plan
    const last = steps[steps.length - 1].plan
    await notify(
      listing.farmer,
      'Machines booked for your field',
      `${OP_LABEL[steps[0].op]} by ${first.m.name} from ${fmtDay(first.fit.start)}${steps.length > 1 ? `, baling by ${last.m.name} from ${fmtDay(last.fit.start)}` : ''}.`,
      `/farmer/listings/${listing._id}`,
    )
  }

  // Number each owner's jobs by date for a simple work sequence.
  const owners = [...new Set(created.map((j) => String(j.owner)))]
  for (const owner of owners) {
    const jobs = await MachineJob.find({ owner, status: { $in: LIVE_JOB } }).sort({ start: 1, distanceKm: 1 })
    for (const [i, j] of jobs.entries()) if (j.sequence !== i + 1) await MachineJob.updateOne({ _id: j._id }, { $set: { sequence: i + 1 } })
    const mine = created.filter((j) => String(j.owner) === owner)
    await notify(owner, `${mine.length} new job${mine.length > 1 ? 's' : ''} for your machines`, `${order.clusterCode}: first on ${fmtDay(mine[0].start)}. Please confirm.`, '/baler')
  }
  return created
}

/** After an industry buys a cluster: book machines for every farm. */
export async function scheduleOrder(orderId) {
  return withLogisticsLock(async () => {
    const order = await Order.findById(orderId)
    if (!order) return []
    const listings = await Listing.find({ _id: { $in: order.listings }, status: { $in: ['sold', 'clustered'] } })
    const jobs = await scheduleListings(order, listings)
    if (jobs.length && order.status === 'placed') order.setStatus('machines_scheduled')
    await order.save()
    return jobs
  })
}

/** Re-plans one farm (after an exception or from the admin). Cancels its unfinished jobs first. */
export async function rescheduleListing(orderId, listingId, excludeMachineIds = []) {
  return withLogisticsLock(async () => {
    const order = await Order.findById(orderId)
    const listing = await Listing.findById(listingId)
    if (!order || !listing || ['ready', 'pickup_scheduled', 'picked_up', 'delivered', 'paid', 'cancelled'].includes(listing.status)) return []
    // Keep a completed cutting job: only the baling then needs a new machine.
    const done = await MachineJob.find({ listing: listing._id, status: 'completed' })
    await MachineJob.updateMany({ listing: listing._id, status: { $in: LIVE_JOB } }, { $set: { status: 'cancelled' }, $push: { statusHistory: { status: 'cancelled', at: new Date(), note: 'Re-planned' } } })
    const exclude = new Set(excludeMachineIds.map(String))
    let jobs
    if (done.some((j) => j.op === 'cut')) {
      jobs = await scheduleBalingOnly(order, listing, exclude)
    } else {
      jobs = await scheduleListings(order, [listing], exclude)
    }
    await order.save()
    return jobs
  })
}

async function scheduleBalingOnly(order, listing, exclude) {
  const farm = toLatLng(listing.location)
  const machines = (await Machine.find({ active: true, type: 'baler' })).filter((m) => haversineKm(toLatLng(m.base), farm) <= RATES.machines.searchRadiusKm)
  const booked = await bookedAcres(machines.map((m) => m._id))
  const plan = bestFit(candidatesFor(machines, 'baler', farm, exclude), listing.acres, addDays(new Date(), 1), booked)
  if (!plan) {
    order.addAlert('no_machine', `No free baler for ${listingLabel(listing)} (${listing.village}).`, listing._id)
    return []
  }
  order.resolveAlerts(['no_machine', 'machine_exception'], 'system', listing._id)
  const farmer = await User.findById(listing.farmer).select('name phone')
  const job = await createJob({ op: 'bale', plan }, listing, order, farmer)
  await notify(plan.m.owner, 'New baling job', `${listingLabel(listing)}, ${listing.village} from ${fmtDay(plan.fit.start)}. Please confirm.`, '/baler')
  return [job]
}
