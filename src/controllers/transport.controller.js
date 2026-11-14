import mongoose from 'mongoose'
import { RATES } from '../config/rates.js'
import { HttpError } from '../middleware/errors.js'
import { Order } from '../models/order.model.js'
import { LIVE_TRIP, Trip } from '../models/trip.model.js'
import { Vehicle, VEHICLE_DEFAULTS } from '../models/vehicle.model.js'
import { tripView } from '../services/views.service.js'
import { collectStop, deliverTrip, dispatchTrip, ownTrip } from '../services/workflow.service.js'
import { startOfDay } from '../utils/dates.js'

/**
 * Vehicles and pickup runs. Used by independent transporters and by industries for
 * their own fleet (ownerKind is set from the role).
 */

const round1 = (n) => Math.round(n * 10) / 10
const checkId = (id) => {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Not found.')
}
const ownerKindOf = (user) => (user.role === 'buyer' ? 'industry' : 'independent')

function vehicleFields(body) {
  const { lat, lng, ...rest } = body
  return { ...rest, ...(lat != null && lng != null ? { base: { type: 'Point', coordinates: [lng, lat] } } : {}) }
}

export async function listVehicles(req, res) {
  const vehicles = await Vehicle.find({ owner: req.user._id }).sort({ createdAt: 1 })
  const today = startOfDay(new Date())
  const busy = new Set((await Trip.find({ owner: req.user._id, date: today, status: { $ne: 'cancelled' } }).distinct('vehicle')).map(String))
  res.json({
    data: {
      vehicles: vehicles.map((v) => ({ ...v.toView(RATES.trucks.m3PerTonne), busyToday: busy.has(String(v._id)) })),
      defaults: VEHICLE_DEFAULTS,
      m3PerTonne: RATES.trucks.m3PerTonne,
    },
  })
}

export async function createVehicle(req, res) {
  if (await Vehicle.exists({ regNo: req.body.regNo.toUpperCase() })) {
    throw new HttpError(409, 'A vehicle with this registration number is already registered.', { fields: { regNo: 'Already registered.' } })
  }
  const vehicle = await Vehicle.create({ ...vehicleFields(req.body), owner: req.user._id, ownerKind: ownerKindOf(req.user) })
  if (req.user.role === 'buyer' && !req.user.buyer?.ownFleet) {
    req.user.buyer.ownFleet = true
    await req.user.save()
  }
  res.status(201).json({ data: { vehicle: vehicle.toView(RATES.trucks.m3PerTonne) } })
}

export async function updateVehicle(req, res) {
  checkId(req.params.id)
  const vehicle = await Vehicle.findOne({ _id: req.params.id, owner: req.user._id })
  if (!vehicle) throw new HttpError(404, 'Vehicle not found.')
  const { regNo: _ignored, ...fields } = vehicleFields(req.body)
  Object.assign(vehicle, fields)
  await vehicle.save()
  res.json({ data: { vehicle: vehicle.toView(RATES.trucks.m3PerTonne) } })
}

export async function listTrips(req, res) {
  const scope = req.query.scope === 'done' ? 'done' : 'active'
  const filter = { owner: req.user._id, status: scope === 'done' ? { $in: ['verified', 'cancelled'] } : { $in: LIVE_TRIP } }
  const trips = await Trip.find(filter).sort({ date: scope === 'done' ? -1 : 1, createdAt: 1 }).limit(100).lean()
  res.json({ data: { scope, trips: trips.map((t) => tripView(t)) } })
}

export async function getTrip(req, res) {
  checkId(req.params.id)
  const trip = await ownTrip(req.params.id, req.user)
  res.json({ data: { trip: tripView(trip) } })
}

export async function startTrip(req, res) {
  checkId(req.params.id)
  const trip = await dispatchTrip(await ownTrip(req.params.id, req.user))
  res.json({ data: { trip: tripView(trip) } })
}

export async function collect(req, res) {
  checkId(req.params.id)
  checkId(req.params.stopId)
  const trip = await collectStop(await ownTrip(req.params.id, req.user), req.params.stopId, req.body)
  res.json({ data: { trip: tripView(trip) } })
}

export async function deliver(req, res) {
  checkId(req.params.id)
  const trip = await deliverTrip(await ownTrip(req.params.id, req.user))
  res.json({ data: { trip: tripView(trip) } })
}

export async function getEarnings(req, res) {
  const trips = await Trip.find({ owner: req.user._id, status: { $ne: 'cancelled' } }).sort({ date: -1 }).lean()
  const settled = new Set((await Order.find({ _id: { $in: trips.map((t) => t.order) }, status: 'settled' }).distinct('_id')).map(String))
  const done = trips.filter((t) => t.status === 'verified')
  res.json({
    data: {
      settled: done.filter((t) => settled.has(String(t.order))).reduce((s, t) => s + t.cost, 0),
      awaitingSettlement: done.filter((t) => !settled.has(String(t.order))).reduce((s, t) => s + t.cost, 0),
      upcoming: trips.filter((t) => t.status !== 'verified').reduce((s, t) => s + t.cost, 0),
      kmDriven: round1(done.reduce((s, t) => s + t.totalKm, 0)),
      tonnesMoved: round1(done.reduce((s, t) => s + (t.verifiedTonnes ?? 0), 0)),
      trips: trips.map((t) => ({ id: String(t._id), code: t.code, date: t.date, regNo: t.regNo, clusterCode: t.clusterCode, plantName: t.plantName, totalKm: t.totalKm, tonnes: t.verifiedTonnes ?? t.plannedTonnes, cost: t.cost, status: t.status, settled: settled.has(String(t.order)) })),
    },
  })
}
