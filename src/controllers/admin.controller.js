import mongoose from 'mongoose'
import { DEFAULT_RATES, editableRates, RATE_FIELDS, RATES } from '../config/rates.js'
import { HttpError } from '../middleware/errors.js'
import { AuditLog } from '../models/auditLog.model.js'
import { Cluster } from '../models/cluster.model.js'
import { Listing } from '../models/listing.model.js'
import { Machine } from '../models/machine.model.js'
import { LIVE_JOB, MachineJob } from '../models/machineJob.model.js'
import { Order } from '../models/order.model.js'
import { Setting } from '../models/setting.model.js'
import { LIVE_TRIP, Trip } from '../models/trip.model.js'
import { User } from '../models/user.model.js'
import { Vehicle } from '../models/vehicle.model.js'
import { audit } from '../services/audit.service.js'
import { rebuildClusters, withClusterLock } from '../services/clustering.service.js'
import { rescheduleListing, scheduleOrder } from '../services/machineScheduler.service.js'
import { priceCluster } from '../services/pricing.service.js'
import { checkRateValues, saveRates } from '../services/settings.service.js'
import { maybeDispatch, strawCapacity } from '../services/vehicleAssignment.service.js'
import { jobView, orderDetail, tripView } from '../services/views.service.js'
import { settleOrder } from '../services/workflow.service.js'
import { startOfDay } from '../utils/dates.js'
import { toLatLng } from '../utils/geo.js'

const round1 = (n) => Math.round(n * 10) / 10
const sumBy = (arr, f) => arr.reduce((s, x) => s + (f(x) ?? 0), 0)
const OPEN_ORDER = ['placed', 'machines_scheduled', 'cutting', 'in_transit', 'delivered']

async function findOrder(id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Order not found.')
  const order = await Order.findById(id)
  if (!order) throw new HttpError(404, 'Order not found.')
  return order
}

/* ------------------------------------------------------------------ overview */
export async function getOverview(req, res) {
  const today = startOfDay(new Date())
  const [listings, clusters, orders, machines, vehicles, jobs, trips, roleCounts] = await Promise.all([
    Listing.find({ status: { $ne: 'cancelled' } }).select('status estTonnes readyTonnes verifiedTonnes').lean(),
    Cluster.find().select('code place status totalTonnes farmCount harvestFrom').lean(),
    Order.find().select('code status clusterCode place buyerCompany estTonnes price settlement alerts createdAt').sort({ createdAt: -1 }).lean(),
    Machine.find().select('type active capacityAcresPerDay').lean(),
    Vehicle.find().select('type active payloadTonnes volumeM3 ownerKind').lean(),
    MachineJob.find({ status: { $in: [...LIVE_JOB, 'exception'] } }).lean(),
    Trip.find({ status: { $in: LIVE_TRIP } }).lean(),
    User.aggregate([{ $match: { role: { $ne: null } } }, { $group: { _id: '$role', n: { $sum: 1 } } }]),
  ])
  const count = (arr, key) => arr.reduce((m, x) => ({ ...m, [x[key]]: (m[x[key]] ?? 0) + 1 }), {})
  const busyVehicles = new Set(trips.filter((t) => +t.date === +today).map((t) => String(t.vehicle)))
  const alerts = orders.flatMap((o) => (o.alerts ?? []).filter((a) => !a.resolvedAt).map((a) => ({ id: String(a._id), orderId: String(o._id), orderCode: o.code, kind: a.kind, message: a.message, at: a.at })))
  const settled = orders.filter((o) => o.status === 'settled')

  res.json({
    data: {
      users: Object.fromEntries(roleCounts.map((r) => [r._id, r.n])),
      farms: { byStatus: count(listings, 'status'), total: listings.length, tonnes: round1(sumBy(listings, (l) => l.estTonnes)) },
      clusters: { byStatus: count(clusters, 'status'), list: clusters.filter((c) => c.status !== 'ordered').slice(0, 12).map((c) => ({ id: String(c._id), code: c.code, place: c.place, status: c.status, tonnes: c.totalTonnes, farms: c.farmCount, harvestFrom: c.harvestFrom })) },
      machines: { total: machines.length, active: machines.filter((m) => m.active).length, byType: count(machines, 'type'), acresPerDay: round1(sumBy(machines.filter((m) => m.active), (m) => m.capacityAcresPerDay)) },
      vehicles: {
        total: vehicles.length,
        active: vehicles.filter((v) => v.active).length,
        busyToday: busyVehicles.size,
        byType: count(vehicles, 'type'),
        strawTonnes: round1(sumBy(vehicles.filter((v) => v.active), (v) => strawCapacity(v))),
        industryOwned: vehicles.filter((v) => v.ownerKind === 'industry').length,
      },
      jobs: { byStatus: count(jobs, 'status'), pending: jobs.filter((j) => j.status === 'requested').length, exceptions: jobs.filter((j) => j.status === 'exception').length },
      trips: { byStatus: count(trips, 'status'), active: trips.length, tonnesOnRoad: round1(sumBy(trips.filter((t) => ['loading', 'in_transit'].includes(t.status)), (t) => t.stops.reduce((s, x) => s + (x.collectedTonnes ?? 0), 0))) },
      orders: {
        byStatus: count(orders, 'status'),
        open: orders.filter((o) => OPEN_ORDER.includes(o.status)).length,
        recent: orders.slice(0, 8).map((o) => ({ id: String(o._id), code: o.code, clusterCode: o.clusterCode, place: o.place, buyerCompany: o.buyerCompany, status: o.status, tonnes: o.estTonnes, openAlerts: (o.alerts ?? []).filter((a) => !a.resolvedAt).length })),
      },
      money: { settledTotal: sumBy(settled, (o) => o.settlement?.total), commission: sumBy(settled, (o) => o.settlement?.commission), pipeline: sumBy(orders.filter((o) => OPEN_ORDER.includes(o.status)), (o) => o.price?.total) },
      tonnes: {
        sold: round1(sumBy(orders.filter((o) => o.status !== 'cancelled'), (o) => o.estTonnes)),
        ready: round1(sumBy(listings, (l) => l.readyTonnes)),
        collected: round1(sumBy(listings, (l) => l.verifiedTonnes)),
        co2Avoided: round1(sumBy(listings, (l) => l.verifiedTonnes) * RATES.co2PerTonne),
      },
      alerts,
    },
  })
}

/* ------------------------------------------------------------------ logistics lists */
export async function listMachines(req, res) {
  const machines = await Machine.find().populate('owner', 'name phone').sort({ createdAt: 1 }).lean()
  const live = await MachineJob.aggregate([{ $match: { status: { $in: LIVE_JOB } } }, { $group: { _id: '$machine', jobs: { $sum: 1 }, acres: { $sum: '$acres' }, next: { $min: '$start' } } }])
  const by = new Map(live.map((x) => [String(x._id), x]))
  res.json({
    data: {
      machines: machines.map((m) => ({
        id: String(m._id),
        name: m.name,
        type: m.type,
        owner: m.owner ? { name: m.owner.name, phone: m.owner.phone } : null,
        capacityAcresPerDay: m.capacityAcresPerDay,
        serviceRadiusKm: m.serviceRadiusKm,
        ratePerAcre: m.ratePerAcre,
        district: m.district ?? null,
        base: toLatLng(m.base),
        active: m.active,
        liveJobs: by.get(String(m._id))?.jobs ?? 0,
        bookedAcres: round1(by.get(String(m._id))?.acres ?? 0),
        nextJob: by.get(String(m._id))?.next ?? null,
      })),
    },
  })
}

export async function listVehicles(req, res) {
  const today = startOfDay(new Date())
  const vehicles = await Vehicle.find().populate('owner', 'name phone buyer.company transporter.company').sort({ payloadTonnes: 1 }).lean()
  const busy = new Set((await Trip.find({ date: today, status: { $ne: 'cancelled' } }).distinct('vehicle')).map(String))
  res.json({
    data: {
      vehicles: vehicles.map((v) => ({
        id: String(v._id),
        regNo: v.regNo,
        type: v.type,
        ownerKind: v.ownerKind,
        owner: v.owner ? { name: v.owner.buyer?.company ?? v.owner.transporter?.company ?? v.owner.name, phone: v.owner.phone } : null,
        payloadTonnes: v.payloadTonnes,
        volumeM3: v.volumeM3 ?? null,
        strawTonnes: strawCapacity(v),
        ratePerKm: v.ratePerKm,
        district: v.district ?? null,
        base: toLatLng(v.base),
        active: v.active,
        busyToday: busy.has(String(v._id)),
      })),
    },
  })
}

export async function listJobs(req, res) {
  const status = typeof req.query.status === 'string' ? req.query.status.split(',') : [...LIVE_JOB, 'exception']
  const jobs = await MachineJob.find({ status: { $in: status } }).sort({ start: 1 }).limit(200).lean()
  res.json({ data: { jobs: jobs.map((j) => jobView(j)) } })
}

export async function listTrips(req, res) {
  const status = typeof req.query.status === 'string' ? req.query.status.split(',') : LIVE_TRIP
  const trips = await Trip.find({ status: { $in: status } }).sort({ date: 1 }).limit(200).lean()
  res.json({ data: { trips: trips.map((t) => ({ ...tripView(t), geometry: undefined })) } })
}

/* ------------------------------------------------------------------ orders */
export async function listOrders(req, res) {
  const filter = {}
  if (typeof req.query.status === 'string' && req.query.status) filter.status = { $in: req.query.status.split(',') }
  const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(100).lean()
  res.json({
    data: {
      orders: orders.map((o) => ({
        id: String(o._id),
        code: o.code,
        clusterCode: o.clusterCode,
        place: o.place,
        district: o.district,
        buyerCompany: o.buyerCompany,
        estTonnes: o.estTonnes,
        farmCount: o.farmCount,
        status: o.status,
        total: o.settlement?.total ?? o.price?.total,
        openAlerts: (o.alerts ?? []).filter((a) => !a.resolvedAt).length,
        createdAt: o.createdAt,
      })),
    },
  })
}

export async function getOrder(req, res) {
  const order = await findOrder(req.params.id)
  res.json({ data: { order: await orderDetail(order) } })
}

/** Re-run machine scheduling: one farm (listingId) or every unscheduled farm of the order. */
export async function rescheduleMachines(req, res) {
  const order = await findOrder(req.params.id)
  const { listingId } = req.body ?? {}
  const jobs = listingId ? await rescheduleListing(order._id, listingId) : await scheduleOrder(order._id)
  await audit(req.user, 'order.reschedule', `${order.code}: machine scheduling re-run (${jobs.length} job${jobs.length === 1 ? '' : 's'} booked)`, { target: order.code })
  res.json({ data: { booked: jobs.length, order: await orderDetail(await Order.findById(order._id)) } })
}

/** Assign vehicles now for all ready straw (ignores the "enough straw waiting" threshold). */
export async function assignTrucks(req, res) {
  const order = await findOrder(req.params.id)
  const trips = await maybeDispatch(order._id, { force: true })
  await audit(req.user, 'order.assign_trucks', `${order.code}: truck assignment re-run (${trips.length} run${trips.length === 1 ? '' : 's'})`, { target: order.code })
  res.json({ data: { trips: trips.length, order: await orderDetail(await Order.findById(order._id)) } })
}

export async function resolveAlert(req, res) {
  const order = await findOrder(req.params.id)
  const alert = order.alerts.id(req.params.alertId)
  if (!alert) throw new HttpError(404, 'Alert not found.')
  alert.resolvedAt = new Date()
  alert.resolvedBy = req.user.name
  await order.save()
  await audit(req.user, 'order.resolve_alert', `${order.code}: ${alert.message}`, { target: order.code })
  res.json({ data: { order: await orderDetail(order) } })
}

export async function forceSettle(req, res) {
  const order = await findOrder(req.params.id)
  if (order.status === 'settled') throw new HttpError(409, 'Already settled.')
  if (!(await Trip.exists({ order: order._id, status: 'verified' }))) throw new HttpError(409, 'Nothing has been delivered and verified yet.')
  await settleOrder(order._id)
  await audit(req.user, 'order.settle', `${order.code}: settled by admin (simulated)`, { target: order.code })
  res.json({ data: { order: await orderDetail(await Order.findById(order._id)) } })
}

export async function rerunClustering(req, res) {
  const result = await withClusterLock(rebuildClusters)
  await audit(req.user, 'clusters.rebuild', `Clusters rebuilt: ${result.ready} ready, ${result.forming} forming`)
  res.json({ data: result })
}

/* ------------------------------------------------------------------ users */
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export async function listUsers(req, res) {
  const filter = { role: { $ne: null } }
  if (['farmer', 'buyer', 'baler', 'transporter', 'admin'].includes(req.query.role)) filter.role = req.query.role
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 40) : ''
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i')
    filter.$or = [{ name: rx }, { phone: new RegExp(escapeRegex(q.replace(/\s/g, ''))) }, { 'buyer.company': rx }, { 'transporter.company': rx }]
  }
  const users = await User.find(filter).sort({ createdAt: -1 }).limit(200).lean()
  const ids = users.map((u) => u._id)
  const [farms, orders, machines, jobs, vehicles, trips] = await Promise.all([
    Listing.aggregate([{ $match: { farmer: { $in: ids }, status: { $ne: 'cancelled' } } }, { $group: { _id: '$farmer', n: { $sum: 1 }, acres: { $sum: '$acres' }, earned: { $sum: { $ifNull: ['$payout.amount', 0] } }, district: { $last: '$district' } } }]),
    Order.aggregate([{ $match: { buyer: { $in: ids }, status: { $ne: 'cancelled' } } }, { $group: { _id: '$buyer', n: { $sum: 1 }, tonnes: { $sum: '$estTonnes' } } }]),
    Machine.aggregate([{ $match: { owner: { $in: ids } } }, { $group: { _id: '$owner', n: { $sum: 1 } } }]),
    MachineJob.aggregate([{ $match: { owner: { $in: ids } } }, { $group: { _id: '$owner', done: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, live: { $sum: { $cond: [{ $in: ['$status', LIVE_JOB] }, 1, 0] } } } }]),
    Vehicle.aggregate([{ $match: { owner: { $in: ids } } }, { $group: { _id: '$owner', n: { $sum: 1 } } }]),
    Trip.aggregate([{ $match: { owner: { $in: ids } } }, { $group: { _id: '$owner', done: { $sum: { $cond: [{ $eq: ['$status', 'verified'] }, 1, 0] } }, live: { $sum: { $cond: [{ $in: ['$status', LIVE_TRIP] }, 1, 0] } } } }]),
  ])
  const m = (arr) => new Map(arr.map((s) => [String(s._id), s]))
  const [F, O, M, J, V, T] = [farms, orders, machines, jobs, vehicles, trips].map(m)
  res.json({
    data: {
      users: users.map((u) => {
        const id = String(u._id)
        const base = { id, name: u.name, phone: u.phone, role: u.role, language: u.language, createdAt: u.createdAt }
        if (u.role === 'farmer') return { ...base, district: F.get(id)?.district ?? null, stats: { farms: F.get(id)?.n ?? 0, acres: round1(F.get(id)?.acres ?? 0), earned: F.get(id)?.earned ?? 0 } }
        if (u.role === 'buyer') return { ...base, company: u.buyer?.company ?? null, district: u.buyer?.district ?? null, stats: { orders: O.get(id)?.n ?? 0, tonnes: round1(O.get(id)?.tonnes ?? 0), vehicles: V.get(id)?.n ?? 0 } }
        if (u.role === 'baler') return { ...base, stats: { machines: M.get(id)?.n ?? 0, jobsLive: J.get(id)?.live ?? 0, jobsDone: J.get(id)?.done ?? 0 } }
        if (u.role === 'transporter') return { ...base, company: u.transporter?.company ?? null, district: u.transporter?.district ?? null, stats: { vehicles: V.get(id)?.n ?? 0, tripsLive: T.get(id)?.live ?? 0, tripsDone: T.get(id)?.done ?? 0 } }
        return base
      }),
    },
  })
}

/* ------------------------------------------------------------------ settings */
/** Reference cluster (60 t, 25 acres, 9 km between farms) priced at three plant distances. */
function samplePrices(values) {
  const r = structuredClone(RATES)
  for (const f of RATE_FIELDS) {
    if (values[f.path] === undefined) continue
    const keys = f.path.split('.')
    const last = keys.pop()
    keys.reduce((o, k) => o[k], r)[last] = values[f.path]
  }
  const center = { lat: 30.9, lng: 75.85 }
  return [
    { key: 'near', label: 'Plant 10 km away', km: 10 },
    { key: 'mid', label: 'Plant 25 km away', km: 25 },
    { key: 'far', label: 'Plant 45 km away', km: 45 },
  ].map((s) => {
    // A plant due east of the centre, `km` road-km away.
    const plant = { lat: center.lat, lng: center.lng + s.km / RATES.roadFactor / (111.32 * Math.cos((center.lat * Math.PI) / 180)) }
    return { ...s, tonnes: 60, acres: 25, ...priceCluster({ tonnes: 60, acres: 25, routeKm: 9, center }, plant, r) }
  })
}

export async function getSettings(req, res) {
  const saved = await Setting.findById('rates').lean()
  const values = editableRates()
  res.json({
    data: {
      fields: RATE_FIELDS,
      values,
      defaults: editableRates(DEFAULT_RATES),
      updatedAt: saved?.updatedAt ?? null,
      updatedBy: saved?.updatedByName ?? null,
      samples: samplePrices(values),
    },
  })
}

export async function previewSettings(req, res) {
  const clean = checkRateValues(req.body ?? {})
  res.json({ data: { samples: samplePrices({ ...editableRates(), ...clean }) } })
}

export async function updateSettings(req, res) {
  const { changes, values } = await saveRates(req.body ?? {}, req.user)
  res.json({ data: { changes, values, samples: samplePrices(values) } })
}

export async function getAuditLog(req, res) {
  const entries = await AuditLog.find().sort({ createdAt: -1 }).limit(60).lean()
  res.json({
    data: {
      entries: entries.map((e) => ({ id: String(e._id), actor: e.actorName, action: e.action, summary: e.summary, target: e.target, changes: e.changes, at: e.createdAt })),
    },
  })
}
