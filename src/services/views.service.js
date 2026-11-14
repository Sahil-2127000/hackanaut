import { RATES } from '../config/rates.js'
import { CANCELLABLE, Listing, listingLabel } from '../models/listing.model.js'
import { MachineJob } from '../models/machineJob.model.js'
import { Trip } from '../models/trip.model.js'
import { User } from '../models/user.model.js'
import { toLatLng } from '../utils/geo.js'

/** JSON shapes sent to the app. One place, so every dashboard shows the same facts. */

const round1 = (n) => Math.round(n * 10) / 10
const id = (x) => (x ? String(x._id ?? x) : null)

export function jobView(j, { withFarmer = true } = {}) {
  return {
    id: id(j),
    code: j.code,
    op: j.op,
    status: j.status,
    machineId: id(j.machine),
    machineName: j.machineName,
    orderId: id(j.order),
    listingId: id(j.listing),
    clusterCode: j.clusterCode,
    farmLabel: j.farmLabel,
    village: j.village,
    farmerName: withFarmer ? j.farmerName : undefined,
    farmerPhone: withFarmer ? j.farmerPhone : undefined,
    location: j.location,
    directionsUrl: j.location ? `https://www.google.com/maps/dir/?api=1&destination=${j.location.lat},${j.location.lng}` : null,
    acres: j.acres,
    estTonnes: j.estTonnes,
    distanceKm: j.distanceKm,
    days: j.days,
    start: j.start,
    end: j.end,
    hours: j.hours,
    ratePerAcre: j.ratePerAcre,
    cost: j.cost,
    sequence: j.sequence ?? null,
    bales: j.bales ?? null,
    readyTonnes: j.readyTonnes ?? null,
    exceptionReason: j.exceptionReason ?? null,
    statusHistory: j.statusHistory,
    completedAt: j.completedAt ?? null,
  }
}

export function tripView(t, { forFarmerListing } = {}) {
  const collected = round1(t.stops.reduce((s, x) => s + (x.collectedTonnes ?? 0), 0))
  const view = {
    id: id(t),
    code: t.code,
    status: t.status,
    orderId: id(t.order),
    clusterCode: t.clusterCode,
    regNo: t.regNo,
    vehicleType: t.vehicleType,
    ownerKind: t.ownerKind,
    capacityTonnes: t.capacityTonnes,
    date: t.date,
    start: t.start,
    plant: t.plant,
    plantName: t.plantName,
    stops: t.stops.map((s) => ({
      id: id(s),
      listingId: id(s.listing),
      label: s.label,
      farmerName: s.farmerName,
      farmerPhone: s.farmerPhone,
      village: s.village,
      location: s.location,
      directionsUrl: s.location ? `https://www.google.com/maps/dir/?api=1&destination=${s.location.lat},${s.location.lng}` : null,
      plannedTonnes: s.plannedTonnes,
      collectedTonnes: s.collectedTonnes ?? null,
      bales: s.bales ?? null,
      status: s.status,
      eta: s.eta,
      at: s.at ?? null,
    })),
    approachKm: t.approachKm,
    routeKm: t.routeKm,
    toPlantKm: t.toPlantKm,
    totalKm: t.totalKm,
    durationMin: t.durationMin,
    eta: t.eta,
    geometry: t.geometry,
    routeSource: t.routeSource,
    plannedTonnes: t.plannedTonnes,
    collectedTonnes: collected,
    verifiedTonnes: t.verifiedTonnes ?? null,
    cost: t.cost,
    statusHistory: t.statusHistory,
    deliveredAt: t.deliveredAt ?? null,
    verifiedAt: t.verifiedAt ?? null,
  }
  if (forFarmerListing) {
    const stop = t.stops.find((s) => String(s.listing) === String(forFarmerListing))
    return {
      tripId: view.id,
      code: t.code,
      regNo: t.regNo,
      vehicleType: t.vehicleType,
      tripStatus: t.status,
      stopStatus: stop?.status,
      plannedTonnes: stop?.plannedTonnes,
      collectedTonnes: stop?.collectedTonnes ?? null,
      eta: stop?.eta,
      date: t.date,
    }
  }
  return view
}

/** A farm as its farmer sees it, with machines, trucks and money. */
export async function farmerListingView(l, { detail = false } = {}) {
  const rate = RATES.farmerPerTonne
  const base = {
    id: id(l),
    number: l.number,
    label: listingLabel(l),
    fieldName: l.fieldName ?? null,
    location: toLatLng(l.location),
    village: l.village,
    district: l.district,
    acres: l.acres,
    estTonnes: l.estTonnes,
    readyTonnes: l.readyTonnes ?? null,
    verifiedTonnes: l.verifiedTonnes ?? null,
    bales: l.bales ?? null,
    quality: l.quality,
    moisture: l.moisture,
    access: l.access,
    harvestDate: l.harvestDate,
    status: l.status,
    statusHistory: l.statusHistory,
    cancellable: CANCELLABLE.includes(l.status),
    cluster: l.cluster?.name ? { name: l.cluster.name, code: l.cluster.name.split(' · ')[0], farmCount: l.cluster.farmCount } : null,
    buyerName: l.buyerName ?? null,
    farmerRate: rate,
    estEarning: Math.round((l.verifiedTonnes ?? l.readyTonnes ?? l.estTonnes) * rate),
    payout: l.payout?.amount ? l.payout : null,
    createdAt: l.createdAt,
  }
  if (!detail && !['scheduled', 'cutting', 'ready', 'pickup_scheduled', 'picked_up'].includes(l.status)) return base

  const [jobs, trips] = await Promise.all([
    MachineJob.find({ listing: l._id, status: { $ne: 'cancelled' } }).sort({ start: 1 }).lean(),
    Trip.find({ 'stops.listing': l._id, status: { $ne: 'cancelled' } }).sort({ date: 1 }).lean(),
  ])
  const owners = new Map((await User.find({ _id: { $in: jobs.map((j) => j.owner) } }).select('name phone')).map((u) => [String(u._id), u]))
  const pendingPickup = trips.some((t) => t.stops.some((s) => String(s.listing) === String(l._id) && s.status === 'pending'))
  return {
    ...base,
    machines: jobs.map((j) => ({
      id: id(j),
      code: j.code,
      op: j.op,
      machineName: j.machineName,
      ownerName: owners.get(String(j.owner))?.name ?? null,
      ownerPhone: ['requested', 'assigned', 'dispatched', 'arrived', 'in_progress'].includes(j.status) ? owners.get(String(j.owner))?.phone ?? null : null,
      start: j.start,
      end: j.end,
      hours: j.hours,
      status: j.status,
    })),
    trucks: trips.map((t) => tripView(t, { forFarmerListing: l._id })),
    pickupCode: pendingPickup ? l.pickup?.code ?? null : null,
  }
}

/** Full tracking of one order (industry and admin). */
export async function orderDetail(order) {
  const [listings, jobs, trips] = await Promise.all([
    Listing.find({ _id: { $in: order.listings } }).populate('farmer', 'name phone').lean(),
    MachineJob.find({ order: order._id }).sort({ start: 1 }).lean(),
    Trip.find({ order: order._id, status: { $ne: 'cancelled' } }).sort({ createdAt: 1 }).lean(),
  ])
  const jobsOf = (lid) => jobs.filter((j) => String(j.listing) === String(lid) && j.status !== 'cancelled')
  const farms = listings
    .sort((a, b) => a.harvestDate - b.harvestDate)
    .map((l) => ({
      id: id(l),
      label: listingLabel(l),
      village: l.village,
      farmerName: l.farmer?.name ?? null,
      location: toLatLng(l.location),
      acres: l.acres,
      estTonnes: l.estTonnes,
      readyTonnes: l.readyTonnes ?? null,
      collectedTonnes: l.verifiedTonnes ?? null,
      quality: l.quality,
      moisture: l.moisture,
      harvestDate: l.harvestDate,
      status: l.status,
      machines: jobsOf(l._id).map((j) => ({ id: id(j), code: j.code, op: j.op, machineName: j.machineName, start: j.start, end: j.end, status: j.status })),
    }))

  const sum = (arr, f) => round1(arr.reduce((s, x) => s + (f(x) ?? 0), 0))
  const liveJobs = jobs.filter((j) => j.status !== 'cancelled')
  return {
    id: id(order),
    code: order.code,
    clusterCode: order.clusterCode,
    buyerCompany: order.buyerCompany,
    place: order.place,
    district: order.district,
    status: order.status,
    statusHistory: order.statusHistory,
    createdAt: order.createdAt,
    deliveryBy: order.deliveryBy ?? null,
    plant: order.plant,
    farmCount: order.farmCount,
    totalAcres: order.totalAcres,
    price: order.price,
    payment: order.payment,
    settlement: order.settlement?.at ? order.settlement : null,
    alerts: (order.alerts ?? []).map((a) => ({ id: id(a), kind: a.kind, message: a.message, at: a.at, resolvedAt: a.resolvedAt ?? null, listingId: id(a.listing) })),
    progress: {
      orderedTonnes: order.estTonnes,
      jobsTotal: liveJobs.length,
      jobsDone: liveJobs.filter((j) => j.status === 'completed').length,
      farmsReady: listings.filter((l) => l.readyTonnes != null).length,
      readyTonnes: sum(listings, (l) => l.readyTonnes),
      collectedTonnes: sum(listings, (l) => l.verifiedTonnes),
      deliveredTonnes: sum(trips.filter((t) => ['delivered', 'verified'].includes(t.status)), (t) => t.stops.reduce((s, x) => s + (x.collectedTonnes ?? 0), 0)),
      verifiedTonnes: sum(trips, (t) => t.verifiedTonnes),
      vehicles: trips.length,
      nextEta: trips.filter((t) => !['delivered', 'verified'].includes(t.status)).map((t) => t.eta).sort()[0] ?? null,
    },
    farms,
    jobs: jobs.map((j) => jobView(j)),
    trips: trips.map((t) => tripView(t)),
    co2Avoided: round1(sum(listings, (l) => l.verifiedTonnes) * RATES.co2PerTonne),
  }
}
