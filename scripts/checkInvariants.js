/**
 * Consistency checks for the logistics data (read-only). Run after the seed or a demo:
 *
 *   npm run check --workspace server
 *
 * 1. No farm is in more than one open cluster or live order.
 * 2. No machine is booked above its daily capacity on any day.
 * 3. No vehicle has overlapping runs or is overloaded (planned ≤ straw capacity).
 * 4. Collected tonnes per farm match the sum of its collected truck stops.
 * 5. Settlements add up (lines = straw + baling + transport + commission = total).
 * 6. No truck run exists for a farm that wasn't baled (ready) first.
 */
import mongoose from 'mongoose'
import { env } from '../src/config/env.js'
import { Cluster } from '../src/models/cluster.model.js'
import { Listing } from '../src/models/listing.model.js'
import { Machine } from '../src/models/machine.model.js'
import { LIVE_JOB, MachineJob } from '../src/models/machineJob.model.js'
import { Order } from '../src/models/order.model.js'
import { Trip } from '../src/models/trip.model.js'
import { dayKey, startOfDay } from '../src/utils/dates.js'

await mongoose.connect(env.mongodbUri)
const problems = []
const fail = (msg) => problems.push(msg)
const round1 = (n) => Math.round(n * 10) / 10

// 1
const clusters = await Cluster.find().lean()
const seenInCluster = new Map()
for (const c of clusters) for (const l of c.listings) {
  if (seenInCluster.has(String(l))) fail(`Farm ${l} is in clusters ${seenInCluster.get(String(l))} and ${c.code}`)
  seenInCluster.set(String(l), c.code)
}
const orders = await Order.find({ status: { $ne: 'cancelled' } }).lean()
const seenInOrder = new Map()
for (const o of orders) for (const l of o.listings) {
  if (seenInOrder.has(String(l))) fail(`Farm ${l} is in orders ${seenInOrder.get(String(l))} and ${o.code}`)
  seenInOrder.set(String(l), o.code)
}

// 2
const machines = new Map((await Machine.find().lean()).map((m) => [String(m._id), m]))
const perMachineDay = new Map()
for (const j of await MachineJob.find({ status: { $in: [...LIVE_JOB, 'completed'] } }).lean()) {
  // A job finished early only held its days up to completion.
  const until = j.status === 'completed' && j.completedAt ? startOfDay(j.completedAt).getTime() : Infinity
  for (const d of j.days) {
    if (new Date(d.date).getTime() > until) continue
    const k = `${j.machine}|${dayKey(d.date)}`
    perMachineDay.set(k, (perMachineDay.get(k) ?? 0) + d.acres)
  }
}
for (const [k, acres] of perMachineDay) {
  const m = machines.get(k.split('|')[0])
  if (m && acres > m.capacityAcresPerDay + 0.05) fail(`${m.name} booked ${round1(acres)} acres on ${k.split('|')[1]} (capacity ${m.capacityAcresPerDay})`)
}

// 3
const trips = await Trip.find({ status: { $ne: 'cancelled' } }).lean()
const byVehicleDay = new Map()
for (const t of trips) {
  if (t.plannedTonnes > t.capacityTonnes + 0.05) fail(`${t.code} plans ${t.plannedTonnes} t on a ${t.capacityTonnes} t vehicle`)
  const k = `${t.vehicle}|${dayKey(t.date)}`
  byVehicleDay.set(k, [...(byVehicleDay.get(k) ?? []), t])
}
for (const runs of byVehicleDay.values()) {
  const spans = runs.map((t) => ({ code: t.code, from: new Date(t.eta).getTime() - t.durationMin * 60_000, to: new Date(t.eta).getTime() })).sort((a, b) => a.from - b.from)
  for (let i = 1; i < spans.length; i++) if (spans[i].from < spans[i - 1].to - 60_000) fail(`${runs[0].regNo}: runs ${spans[i - 1].code} and ${spans[i].code} overlap`)
}

// 4 + 6
const listings = await Listing.find({ order: { $exists: true } }).lean()
for (const l of listings) {
  const stops = trips.flatMap((t) => t.stops.filter((s) => String(s.listing) === String(l._id)))
  const collected = round1(stops.reduce((s, x) => s + (x.collectedTonnes ?? 0), 0))
  if (Math.abs(collected - (l.verifiedTonnes ?? 0)) > 0.11) fail(`Farm ${l.number}: collected ${l.verifiedTonnes ?? 0} t but stops add up to ${collected} t`)
  if (stops.length && l.readyTonnes == null) fail(`Farm ${l.number} has a truck run but was never marked ready`)
}

// 5
for (const o of orders.filter((x) => x.settlement?.at)) {
  const s = o.settlement
  const sum = s.lines.reduce((a, x) => a + x.amount, 0)
  if (sum !== s.total || s.straw + s.baling + s.transport + s.commission !== s.total) fail(`${o.code}: settlement doesn't add up`)
}

console.info(
  JSON.stringify(
    { clusters: clusters.length, orders: orders.length, machineDays: perMachineDay.size, trips: trips.length, problems: problems.length ? problems : 'none' },
    null,
    1,
  ),
)
await mongoose.disconnect()
process.exit(problems.length ? 1 : 0)
