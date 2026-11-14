import { RATES } from '../config/rates.js'
import { HttpError } from '../middleware/errors.js'
import { Listing, listingLabel } from '../models/listing.model.js'
import { LIVE_JOB, MachineJob, NEXT_JOB_STATUS } from '../models/machineJob.model.js'
import { Order } from '../models/order.model.js'
import { Trip } from '../models/trip.model.js'
import { User } from '../models/user.model.js'
import { rescheduleListing } from './machineScheduler.service.js'
import { notify } from './notification.service.js'
import { maybeDispatch } from './vehicleAssignment.service.js'

/**
 * Status-based triggers that connect the modules:
 *   machine job completed (baling) → farm ready → maybeDispatch (trucks)
 *   truck collects at farm → farm picked up
 *   industry verifies delivery → farms delivered → settlement (simulated)
 */

const round1 = (n) => Math.round(n * 10) / 10
const now = () => new Date()

function pushListingStatus(l, status) {
  if (l.status === status) return
  l.status = status
  l.statusHistory.push({ status, at: now() })
}

/* ───────────────────────────── Machine jobs ───────────────────────────── */

export async function ownJob(jobId, user) {
  const job = await MachineJob.findOne({ _id: jobId, owner: user._id })
  if (!job) throw new HttpError(404, 'Job not found.')
  return job
}

/**
 * Moves a job one step: requested → assigned → dispatched → arrived → in_progress → completed.
 * Completing a baling job needs the bales and the actual tonnes.
 */
export async function advanceJob(job, { bales, readyTonnes } = {}) {
  const next = NEXT_JOB_STATUS[job.status]
  if (!next) throw new HttpError(409, 'This job can’t move forward.')
  const listing = await Listing.findById(job.listing)
  const order = await Order.findById(job.order)

  if (next === 'in_progress' && job.op === 'bale') {
    const cut = await MachineJob.findOne({ listing: job.listing, op: 'cut', status: { $ne: 'cancelled' } })
    if (cut && cut.status !== 'completed') throw new HttpError(409, 'Cutting on this field isn’t finished yet.')
  }
  const finishesBaling = next === 'completed' && job.op !== 'cut'
  if (finishesBaling) {
    if (!(readyTonnes > 0)) throw new HttpError(400, 'Enter the tonnes of straw baled.', { fields: { readyTonnes: 'Enter the tonnes baled.' } })
    if (readyTonnes > listing.estTonnes * 2.5 + 5) throw new HttpError(400, 'That is far more than this field can give. Check the number.', { fields: { readyTonnes: 'Too high for this field.' } })
  }

  job.status = next
  job.statusHistory.push({ status: next, at: now() })

  if (next === 'in_progress' && ['scheduled', 'sold'].includes(listing.status)) {
    pushListingStatus(listing, 'cutting')
    await listing.save()
    if (['placed', 'machines_scheduled'].includes(order.status)) {
      order.setStatus('cutting')
      await order.save()
    }
    await notify(listing.farmer, 'Work started on your field', `${job.machineName} has started ${job.op === 'bale' ? 'baling' : 'cutting'}.`, `/farmer/listings/${listing._id}`)
  }

  if (finishesBaling) {
    job.bales = bales ?? null
    job.readyTonnes = round1(readyTonnes)
    job.completedAt = now()
    listing.readyTonnes = round1(readyTonnes)
    listing.bales = bales ?? listing.bales
    listing.readyAt = now()
    pushListingStatus(listing, 'ready')
    await listing.save()
    await notify(listing.farmer, 'Straw baled and ready', `${round1(readyTonnes)} t ready. A truck will be assigned automatically.`, `/farmer/listings/${listing._id}`)
    await notify(order.buyer, `${listingLabel(listing)} is ready`, `${round1(readyTonnes)} t baled at ${listing.village} (${order.clusterCode}).`, `/buyer/orders/${order._id}`)
  } else if (next === 'completed') {
    job.completedAt = now()
  }
  await job.save()

  // Trigger: ready straw → truck assignment.
  if (finishesBaling) await maybeDispatch(order._id)
  return job
}

/** The owner can't do the job (breakdown, rain…). The scheduler finds another machine. */
export async function reportJobException(job, reason) {
  if (!LIVE_JOB.includes(job.status)) throw new HttpError(409, 'This job is not active.')
  job.status = 'exception'
  job.exceptionReason = reason
  job.statusHistory.push({ status: 'exception', at: now(), note: reason })
  await job.save()

  const order = await Order.findById(job.order)
  order.addAlert('machine_exception', `${job.machineName} can’t do ${job.farmLabel}: ${reason}`, job.listing)
  await order.save()
  const jobs = await rescheduleListing(job.order, job.listing, [job.machine])
  return { reassigned: jobs.length > 0 }
}

/* ───────────────────────────── Truck runs ───────────────────────────── */

export async function ownTrip(tripId, user) {
  const trip = await Trip.findOne({ _id: tripId, owner: user._id })
  if (!trip) throw new HttpError(404, 'Trip not found.')
  return trip
}

export async function dispatchTrip(trip) {
  if (trip.status !== 'assigned') throw new HttpError(409, 'This trip has already started.')
  trip.setStatus('dispatched')
  await trip.save()
  const order = await Order.findById(trip.order)
  if (['placed', 'machines_scheduled', 'cutting'].includes(order.status)) {
    order.setStatus('in_transit')
    await order.save()
  }
  const farmerIds = await Listing.find({ _id: { $in: trip.stops.map((s) => s.listing) } }).distinct('farmer')
  await notify(farmerIds, `Truck ${trip.regNo} is on the way`, 'Keep your pickup code ready.', '/farmer/listings')
  return trip
}

/** At a farm: the driver enters the farmer's code and the tonnes actually loaded. */
export async function collectStop(trip, stopId, { code, tonnes, bales }) {
  if (!['dispatched', 'loading'].includes(trip.status)) throw new HttpError(409, trip.status === 'assigned' ? 'Start the trip first.' : 'This trip is past the pickup stage.')
  const stop = trip.stops.id(stopId)
  if (!stop) throw new HttpError(404, 'This farm isn’t on your route.')
  if (stop.status !== 'pending') throw new HttpError(409, 'Already collected at this farm.')

  const listing = await Listing.findById(stop.listing)
  listing.pickup.attempts = (listing.pickup.attempts ?? 0) + 1
  if (listing.pickup.attempts > 8) {
    await listing.save()
    throw new HttpError(429, 'Too many wrong codes for this farm. Call ParaliLink support.')
  }
  if (code !== listing.pickup.code) {
    await listing.save()
    throw new HttpError(400, 'Wrong code. Ask the farmer to read it again.', { fields: { code: 'Wrong code.' } })
  }
  listing.pickup.attempts = 0

  stop.status = 'collected'
  stop.collectedTonnes = round1(tonnes)
  stop.bales = bales ?? null
  stop.at = now()
  listing.verifiedTonnes = round1((listing.verifiedTonnes ?? 0) + tonnes)

  // Farm is picked up when no live trip still has a pending stop for it.
  const others = await Trip.find({ _id: { $ne: trip._id }, 'stops.listing': listing._id, status: { $ne: 'cancelled' } }).lean()
  const pendingElsewhere = others.some((t) => t.stops.some((s) => String(s.listing) === String(listing._id) && s.status === 'pending'))
  if (!pendingElsewhere && ['ready', 'pickup_scheduled'].includes(listing.status)) pushListingStatus(listing, 'picked_up')
  await listing.save()

  trip.setStatus(trip.stops.every((s) => s.status !== 'pending') ? 'in_transit' : 'loading')
  await trip.save()
  await notify(listing.farmer, 'Straw collected', `${round1(tonnes)} t loaded on ${trip.regNo}.`, `/farmer/listings/${listing._id}`)
  return trip
}

export async function deliverTrip(trip) {
  if (trip.status !== 'in_transit') throw new HttpError(409, trip.stops.some((s) => s.status === 'pending') ? 'Collect at every farm first.' : 'This trip is not on the road.')
  trip.setStatus('delivered')
  trip.deliveredAt = now()
  await trip.save()
  await notify(trip.buyer, `${trip.regNo} arrived at the plant`, `Weigh the load and verify ${round1(trip.stops.reduce((s, x) => s + (x.collectedTonnes ?? 0), 0))} t.`, `/buyer/orders/${trip.order}`)
  return trip
}

/** Industry weighs the load at its gate. When everything is verified, the order settles. */
export async function verifyTrip(trip, verifiedTonnes) {
  if (trip.status !== 'delivered') throw new HttpError(409, 'This load hasn’t been delivered yet.')
  const collected = round1(trip.stops.reduce((s, x) => s + (x.collectedTonnes ?? 0), 0))
  trip.setStatus('verified')
  trip.verifiedTonnes = round1(verifiedTonnes)
  trip.verifiedAt = now()
  await trip.save()

  const order = await Order.findById(trip.order)
  if (collected > 0 && Math.abs(verifiedTonnes - collected) / collected > 0.03) {
    order.addAlert('weight_mismatch', `${trip.code}: ${collected} t collected at farms, ${round1(verifiedTonnes)} t weighed at the plant.`)
  }

  // Farms whose every collection has been verified are delivered.
  const tripsOfOrder = await Trip.find({ order: order._id, status: { $ne: 'cancelled' } }).lean()
  const listings = await Listing.find({ _id: { $in: order.listings } })
  for (const l of listings) {
    if (l.status !== 'picked_up') continue
    const mine = tripsOfOrder.filter((t) => t.stops.some((s) => String(s.listing) === String(l._id)))
    if (mine.length && mine.every((t) => t.status === 'verified')) {
      pushListingStatus(l, 'delivered')
      await l.save()
    }
  }
  await order.save()

  const open = listings.filter((l) => !['delivered', 'paid', 'cancelled'].includes(l.status))
  if (!open.length) await settleOrder(order._id)
  return trip
}

/* ───────────────────────────── Settlement (simulated) ───────────────────────────── */

/**
 * Final bill on actual quantities, with one simulated payout line per party:
 * farmers (collected tonnes × rate), machine owners (completed jobs), transporters
 * (trip cost; the industry's own vehicles cost nothing extra) and ParaliLink commission.
 */
export async function settleOrder(orderId) {
  const order = await Order.findById(orderId)
  if (!order || order.status === 'settled') return order
  const rates = order.rates?.farmerPerTonne ? order.rates : RATES
  const listings = await Listing.find({ _id: { $in: order.listings } })
  const jobs = await MachineJob.find({ order: order._id, status: 'completed' })
  const trips = await Trip.find({ order: order._id, status: 'verified' })
  const users = new Map(
    (await User.find({ _id: { $in: [...listings.map((l) => l.farmer), ...jobs.map((j) => j.owner), ...trips.map((t) => t.owner)] } }).select('name buyer.company transporter.company')).map((u) => [String(u._id), u]),
  )
  const at = now()
  const lines = []

  for (const l of listings) {
    if (!(l.verifiedTonnes > 0)) continue
    const amount = Math.round(l.verifiedTonnes * rates.farmerPerTonne)
    const reference = `SIM-F-${l.number}`
    lines.push({ role: 'farmer', party: l.farmer, name: users.get(String(l.farmer))?.name, label: `${listingLabel(l)} · ${l.verifiedTonnes} t × ₹${rates.farmerPerTonne}`, amount, reference })
    l.payout = { amount, reference, paidAt: at }
    pushListingStatus(l, 'paid')
    await l.save()
    await notify(l.farmer, 'Payment settled (demo)', `₹${amount.toLocaleString('en-IN')} for ${l.verifiedTonnes} t.`, `/farmer/listings/${l._id}`)
  }
  const byOwner = (items) => {
    const m = new Map()
    for (const x of items) m.set(String(x.owner), [...(m.get(String(x.owner)) ?? []), x])
    return m
  }
  for (const [owner, js] of byOwner(jobs)) {
    const amount = js.reduce((s, j) => s + (j.cost ?? 0), 0)
    lines.push({ role: 'baler', party: owner, name: users.get(owner)?.name, label: `${js.length} machine job${js.length > 1 ? 's' : ''} · ${round1(js.reduce((s, j) => s + j.acres, 0))} acres`, amount, reference: `SIM-M-${order.code}-${owner.slice(-4)}` })
  }
  for (const [owner, ts] of byOwner(trips)) {
    const amount = ts.reduce((s, t) => s + (t.cost ?? 0), 0)
    if (!amount) continue // industry's own vehicles
    const u = users.get(owner)
    lines.push({ role: 'transporter', party: owner, name: u?.transporter?.company ?? u?.name, label: `${ts.length} run${ts.length > 1 ? 's' : ''} · ${round1(ts.reduce((s, t) => s + t.totalKm, 0))} km`, amount, reference: `SIM-T-${order.code}-${owner.slice(-4)}` })
  }
  const straw = lines.filter((l) => l.role === 'farmer').reduce((s, l) => s + l.amount, 0)
  const baling = lines.filter((l) => l.role === 'baler').reduce((s, l) => s + l.amount, 0)
  const transport = lines.filter((l) => l.role === 'transporter').reduce((s, l) => s + l.amount, 0)
  const commission = Math.round(((straw + baling + transport) * (rates.commissionPct ?? RATES.commissionPct)) / 100)
  lines.push({ role: 'platform', name: 'ParaliLink', label: `Commission ${rates.commissionPct ?? RATES.commissionPct}%`, amount: commission, reference: `SIM-P-${order.code}` })

  order.settlement = {
    collectedTonnes: round1(listings.reduce((s, l) => s + (l.verifiedTonnes ?? 0), 0)),
    verifiedTonnes: round1(trips.reduce((s, t) => s + (t.verifiedTonnes ?? 0), 0)),
    straw,
    baling,
    transport,
    commission,
    total: straw + baling + transport + commission,
    lines,
    at,
  }
  order.resolveAlerts(['no_vehicle', 'short_capacity', 'no_machine', 'machine_exception', 'late', 'unload'])
  if (order.status !== 'delivered') order.setStatus('delivered')
  order.setStatus('settled')
  await order.save()

  await notify(order.buyer, `${order.code} settled (demo)`, `Final bill ₹${order.settlement.total.toLocaleString('en-IN')} on ${order.settlement.verifiedTonnes} t.`, `/buyer/orders/${order._id}`)
  await notify([...byOwner(jobs).keys(), ...byOwner(trips).keys()], `${order.code} settled (demo)`, 'Your earnings are in the settlement.', null)
  return order
}
