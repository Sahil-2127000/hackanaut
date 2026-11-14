import mongoose from 'mongoose'
import { RATES } from '../config/rates.js'
import { HttpError } from '../middleware/errors.js'
import { Cluster } from '../models/cluster.model.js'
import { Demand } from '../models/demand.model.js'
import { Listing, listingLabel } from '../models/listing.model.js'
import { Order } from '../models/order.model.js'
import { Trip } from '../models/trip.model.js'
import { purchaseCluster } from '../services/order.service.js'
import { priceCluster } from '../services/pricing.service.js'
import { provisionalPlan } from '../services/vehicleAssignment.service.js'
import { orderDetail } from '../services/views.service.js'
import { verifyTrip } from '../services/workflow.service.js'
import { haversineKm, orderStops, toLatLng } from '../utils/geo.js'
import { isoWeekKey } from '../utils/isoWeek.js'

/** Industry portal (role "buyer"): requirements, supply, bulk purchase, tracking, delivery check. */

const DAY = 86_400_000
const round1 = (n) => Math.round(n * 10) / 10

/** Farm positions are shown to ~1 km before purchase, to protect farmers' privacy. */
const coarse = (p) => ({ lat: Math.round(p.lat * 100) / 100, lng: Math.round(p.lng * 100) / 100 })
const accepts = (user) => (user.buyer?.acceptQuality?.length ? user.buyer.acceptQuality : ['good', 'average'])

function clusterSummary(cluster, plant) {
  const center = toLatLng(cluster.center)
  const price = priceCluster({ tonnes: cluster.totalTonnes, acres: cluster.totalAcres, routeKm: cluster.routeKm, center }, plant)
  return {
    id: cluster._id.toString(),
    code: cluster.code,
    place: cluster.place,
    district: cluster.district,
    harvestWeek: cluster.harvestWeek,
    harvestFrom: cluster.harvestFrom ?? null,
    harvestTo: cluster.harvestTo ?? null,
    quality: cluster.quality ?? 'good',
    moisture: cluster.moisture ?? 'normal',
    access: cluster.access ?? 'any',
    status: cluster.status,
    center,
    farmCount: cluster.farmCount,
    totalAcres: cluster.totalAcres,
    totalTonnes: cluster.totalTonnes,
    routeKm: cluster.routeKm,
    price,
  }
}

export async function saveProfile(req, res) {
  const { company, plantType, district, lat, lng, requiredTonnes, deliveryBy, acceptQuality, unloadPerDay, preferOwnFleet } = req.body
  const fields = { company, plantType, district, plantLocation: { type: 'Point', coordinates: [lng, lat] }, requiredTonnes, deliveryBy, acceptQuality, unloadPerDay, preferOwnFleet }
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) req.user.set(`buyer.${k}`, v)
  await req.user.save()
  res.json({ data: { user: req.user.toPublic() } })
}

export async function listClusters(req, res) {
  const maxKm = Math.min(Number(req.query.maxKm) || 80, 250)
  const quality = req.query.quality === 'all' ? null : accepts(req.user)
  const clusters = await Cluster.find({ status: { $in: ['ready', 'forming'] } }).lean()
  const items = clusters
    .map((c) => clusterSummary(c, req.plant))
    .filter((c) => c.price.kmToPlant <= maxKm && (!quality || quality.includes(c.quality)))
    .sort((a, b) => (a.harvestFrom ?? 0) - (b.harvestFrom ?? 0) || a.price.perTonne - b.price.perTonne)
  const ready = items.filter((c) => c.status === 'ready')
  res.json({
    data: {
      plant: req.plant,
      maxKm,
      acceptQuality: quality ?? ['good', 'average', 'poor'],
      requiredTonnes: req.user.buyer?.requiredTonnes ?? null,
      clusters: items,
      totals: {
        readyCount: ready.length,
        readyTonnes: round1(ready.reduce((s, c) => s + c.totalTonnes, 0)),
        formingTonnes: round1(items.filter((c) => c.status === 'forming').reduce((s, c) => s + c.totalTonnes, 0)),
      },
      rules: { ...RATES.clustering },
    },
  })
}

export async function getCluster(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'This cluster no longer exists. It may have been regrouped; go back to the map.')
  const cluster = await Cluster.findById(req.params.id).lean()
  if (!cluster || cluster.status === 'ordered') {
    throw new HttpError(404, 'This cluster is no longer available. It may have been bought or regrouped; go back to the map.')
  }
  const listings = await Listing.find({ _id: { $in: cluster.listings } }).lean()
  const center = toLatLng(cluster.center)
  const points = listings.map((l) => toLatLng(l.location))
  const { order } = orderStops(points, req.plant)
  const farms = order.map((i, n) => {
    const l = listings[i]
    return {
      label: `Farm ${String(n + 1).padStart(2, '0')}`,
      acres: l.acres,
      estTonnes: l.estTonnes,
      quality: l.quality,
      moisture: l.moisture,
      harvestDate: l.harvestDate,
      kmFromCenter: round1(haversineKm(center, points[i])),
      position: coarse(points[i]),
    }
  })
  const summary = clusterSummary(cluster, req.plant)
  const plan = await provisionalPlan({
    tonnes: cluster.totalTonnes,
    center,
    plant: req.plant,
    day: cluster.harvestTo ?? new Date(),
    access: cluster.access,
    buyer: req.user,
    routeKm: cluster.routeKm,
  })
  // Use the provisional fleet's cost when it can carry everything.
  if (plan.vehicles.length && !plan.shortTonnes) {
    summary.price = priceCluster({ tonnes: cluster.totalTonnes, acres: cluster.totalAcres, routeKm: cluster.routeKm, center }, req.plant, RATES, plan.transportCost)
  }
  res.json({ data: { cluster: { ...summary, farms, vehiclePlan: plan }, plant: req.plant, commissionPct: RATES.commissionPct } })
}

export async function getCalendar(req, res) {
  const now = new Date()
  const weeks = Array.from({ length: 8 }, (_, i) => isoWeekKey(new Date(now.getTime() + (i - 1) * 7 * DAY)))
  const rows = await Listing.aggregate([
    { $match: { harvestWeek: { $in: weeks }, status: { $ne: 'cancelled' } } },
    {
      $group: {
        _id: { district: '$district', week: '$harvestWeek' },
        listedTonnes: { $sum: '$estTonnes' },
        availableTonnes: { $sum: { $cond: [{ $in: ['$status', ['listed', 'clustered']] }, '$estTonnes', 0] } },
        clusteredTonnes: { $sum: { $cond: [{ $eq: ['$status', 'clustered'] }, '$estTonnes', 0] } },
        farms: { $sum: 1 },
      },
    },
  ])
  const demands = await Demand.find({ buyer: req.user._id }).lean()
  res.json({
    data: {
      weeks,
      currentWeek: isoWeekKey(now),
      cells: rows.map((r) => ({
        district: r._id.district,
        week: r._id.week,
        listedTonnes: round1(r.listedTonnes),
        availableTonnes: round1(r.availableTonnes),
        clusteredTonnes: round1(r.clusteredTonnes),
        farms: r.farms,
      })),
      demands: demands.map((d) => ({ district: d.district, week: d.harvestWeek })),
    },
  })
}

/** Toggle interest in a district's supply for a week. */
export async function toggleDemand(req, res) {
  const filter = { buyer: req.user._id, district: req.body.district, harvestWeek: req.body.week }
  const existing = await Demand.findOneAndDelete(filter)
  if (!existing) await Demand.create(filter)
  res.json({ data: { active: !existing } })
}

export async function placeOrder(req, res) {
  const { order, jobs } = await purchaseCluster(req.user, req.plant, req.body.clusterId)
  res.status(201).json({ data: { order: { id: order._id.toString(), code: order.code }, machineJobs: jobs.length } })
}

function orderSummary(o) {
  return {
    id: o._id.toString(),
    code: o.code,
    clusterCode: o.clusterCode,
    place: o.place,
    district: o.district,
    harvestWeek: o.harvestWeek,
    estTonnes: o.estTonnes,
    farmCount: o.farmCount,
    status: o.status,
    total: o.settlement?.total ?? o.price?.total,
    perTonne: o.price?.perTonne,
    openAlerts: (o.alerts ?? []).filter((a) => !a.resolvedAt).length,
    createdAt: o.createdAt,
  }
}

export async function listOrders(req, res) {
  const orders = await Order.find({ buyer: req.user._id }).sort({ createdAt: -1 }).limit(50).lean()
  res.json({ data: { orders: orders.map(orderSummary) } })
}

export async function getOrder(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Order not found.')
  const order = await Order.findOne({ _id: req.params.id, buyer: req.user._id })
  if (!order) throw new HttpError(404, 'Order not found.')
  res.json({ data: { order: await orderDetail(order) } })
}

/** The industry weighs a delivered load at its gate. */
export async function verifyDelivery(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Trip not found.')
  const trip = await Trip.findOne({ _id: req.params.id, buyer: req.user._id })
  if (!trip) throw new HttpError(404, 'Trip not found.')
  await verifyTrip(trip, req.body.tonnes)
  const order = await Order.findById(trip.order)
  res.json({ data: { order: await orderDetail(order) } })
}

export { orderSummary, listingLabel }
