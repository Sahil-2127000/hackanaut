/**
 * Demo data for presentations and local testing. Safe to run again: it only
 * removes and recreates demo records (demo phone numbers, their listings,
 * orders and clusters), then rebuilds clusters with the real engine.
 *
 *   npm run seed --workspace server
 *
 * Demo farmer: Gurpreet Singh · +91 98765 43210
 * Demo buyer:  Malwa Pellet Works · +91 98140 00001
 * Demo baler:  Harjit Singh (PB-13) · +91 98150 00013 (one job in progress, one new offer)
 * (sign in with the dev code shown on the sign-in screen)
 */

import mongoose from 'mongoose'
import crypto from 'node:crypto'
import { env } from '../src/config/env.js'
import { estimateTonnes, RATES, rateSnapshot } from '../src/config/rates.js'
import { BalerBooking } from '../src/models/balerBooking.model.js'
import { Cluster } from '../src/models/cluster.model.js'
import { Demand } from '../src/models/demand.model.js'
import { Job } from '../src/models/job.model.js'
import { Listing, nextListingNumber } from '../src/models/listing.model.js'
import { Order } from '../src/models/order.model.js'
import { User } from '../src/models/user.model.js'
import { rebuildClusters } from '../src/services/clustering.service.js'
import { balerPay, priceCluster } from '../src/services/pricing.service.js'
import { loadRates } from '../src/services/settings.service.js'
import { nextSequence } from '../src/utils/counters.js'
import { centroid, orderStops, roadKm, toLatLng } from '../src/utils/geo.js'
import { isoWeekKey } from '../src/utils/isoWeek.js'

const DAY = 86_400_000
const now = Date.now()
const at = (days, hour = 10) => {
  const d = new Date(now + days * DAY)
  d.setHours(hour, 0, 0, 0)
  return d
}
// Days from today back to this week's Monday (ISO weeks start on Monday).
const MONDAY = -((new Date(now).getDay() + 6) % 7)
// Deterministic "random" so every seed run looks the same.
let state = 42
const rand = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296)

const DEMO_FARMER_PREFIX = '+9190000' // +91 90000 xxxxx
const GURPREET = '+919876543210'
const BUYER_PHONE = '+919814000001'
const ADMIN_PHONE = '+919888000000'

const VILLAGES = [
  { village: 'Bhawanigarh', district: 'Sangrur', lat: 30.2655, lng: 76.0393, week: 1, farms: 6 },
  { village: 'Sunam', district: 'Sangrur', lat: 30.1286, lng: 75.7997, week: 0, farms: 7 },
  { village: 'Dhuri', district: 'Sangrur', lat: 30.3707, lng: 75.8669, week: 0, farms: 4 },
  { village: 'Longowal', district: 'Sangrur', lat: 30.21, lng: 75.69, week: 1, farms: 5 },
  { village: 'Lehragaga', district: 'Sangrur', lat: 29.942, lng: 75.769, week: 2, farms: 2 },
  { village: 'Nabha', district: 'Patiala', lat: 30.3747, lng: 76.1525, week: 2, farms: 5 },
  { village: 'Samana', district: 'Patiala', lat: 30.15, lng: 76.19, week: 1, farms: 5 },
  { village: 'Patran', district: 'Patiala', lat: 29.96, lng: 76.15, week: 3, farms: 1 },
  { village: 'Malerkotla', district: 'Malerkotla', lat: 30.5309, lng: 75.8792, week: 1, farms: 4 },
  { village: 'Barnala', district: 'Barnala', lat: 30.378, lng: 75.548, week: 3, farms: 6 },
]
const NAMES = ['Harjinder Singh', 'Baljit Kaur', 'Sukhwinder Singh', 'Kulwant Singh', 'Manpreet Kaur', 'Jaswinder Singh', 'Amandeep Singh', 'Paramjit Kaur', 'Gurdeep Singh', 'Rajwinder Singh', 'Navdeep Kaur', 'Satnam Singh']

await mongoose.connect(env.mongodbUri)
// Use any rate card saved from the admin console, so demo prices match the app.
await loadRates()

// ── Reset demo records only ──────────────────────────────────────────────
const demoFarmers = await User.find({ phone: { $regex: `^\\${DEMO_FARMER_PREFIX}` } }).select('_id')
const gurpreet = await User.findOneAndUpdate(
  { phone: GURPREET },
  { name: 'Gurpreet Singh', role: 'farmer', language: 'pa', onboarded: true },
  { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
)
// Ops admin for the admin console (admins can't sign themselves up).
await User.findOneAndUpdate(
  { phone: ADMIN_PHONE },
  { name: 'ParaliLink Ops', role: 'admin', language: 'en', onboarded: true },
  { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
)
const buyer = await User.findOneAndUpdate(
  { phone: BUYER_PHONE },
  {
    name: 'Harleen Kaur',
    role: 'buyer',
    language: 'en',
    onboarded: true,
    buyer: { company: 'Malwa Pellet Works', plantType: 'pellet', district: 'Sangrur', plantLocation: { type: 'Point', coordinates: [75.8421, 30.2458] } },
  },
  { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
)
// Four balers parked around the region.
const BALERS = [
  // ratePerAcre: what each baler charges farmers (paid to the baler directly). Placeholders.
  { phone: '+919815000013', name: 'Harjit Singh', vehicle: 'PB-13', district: 'Sangrur', lat: 30.255, lng: 76.02, capacity: 60, rate: 1500 },
  { phone: '+919815000002', name: 'Amarjit Singh', vehicle: 'PB-02', district: 'Sangrur', lat: 30.2458, lng: 75.87, capacity: 50, rate: 1400 },
  { phone: '+919815000021', name: 'Sukhdev Singh', vehicle: 'PB-21', district: 'Patiala', lat: 30.37, lng: 76.15, capacity: 50, rate: 1600 },
  { phone: '+919815000007', name: 'Manjit Kaur', vehicle: 'PB-07', district: 'Barnala', lat: 30.38, lng: 75.55, capacity: 45, rate: 1450 },
]
const balers = []
for (const b of BALERS) {
  balers.push(
    await User.findOneAndUpdate(
      { phone: b.phone },
      {
        name: b.name,
        role: 'baler',
        language: 'pa',
        onboarded: true,
        baler: { vehicle: b.vehicle, machine: 'square', capacityTonnesPerDay: b.capacity, district: b.district, base: { type: 'Point', coordinates: [b.lng, b.lat] }, available: true, ratePerAcre: b.rate },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    ),
  )
}
const harjit = balers[0]
await Job.deleteMany({ baler: { $in: balers.map((b) => b._id) } })

const farmerIds = [gurpreet._id, ...demoFarmers.map((f) => f._id)]
const demoOrders = await Order.find({ buyer: buyer._id }).select('cluster')
await Cluster.deleteMany({ $or: [{ status: { $in: ['forming', 'ready'] } }, { _id: { $in: demoOrders.map((o) => o.cluster) } }] })
await Order.deleteMany({ buyer: buyer._id })
await Demand.deleteMany({ buyer: buyer._id })
await BalerBooking.deleteMany({ $or: [{ farmer: { $in: farmerIds } }, { baler: { $in: balers.map((b) => b._id) } }] })
await Listing.deleteMany({ farmer: { $in: farmerIds } })
await User.deleteMany({ phone: { $regex: `^\\${DEMO_FARMER_PREFIX}` } })

let farmerSeq = 0
async function demoFarmer() {
  farmerSeq += 1
  return User.create({
    phone: `${DEMO_FARMER_PREFIX}${String(farmerSeq).padStart(5, '0')}`,
    name: NAMES[farmerSeq % NAMES.length],
    role: 'farmer',
    language: 'pa',
    onboarded: true,
  })
}

async function makeListing(farmer, { village, district, lat, lng, acres, harvest, status = 'listed', history, extra = {}, fieldName }) {
  return Listing.create({
    number: await nextListingNumber(),
    farmer: farmer._id,
    fieldName,
    location: { type: 'Point', coordinates: [lng, lat] },
    village,
    district,
    acres,
    estTonnes: estimateTonnes(acres),
    // Small square bales weigh roughly 25 kg, so about 96 bales per acre.
    bales: Math.round(acres * 96),
    baling: { by: 'own' },
    harvestDate: harvest,
    harvestWeek: isoWeekKey(harvest),
    status,
    statusHistory: history ?? [{ status: 'listed', at: at(-3) }],
    ...extra,
  })
}
const hist = (pairs) => pairs.map(([s, d]) => ({ status: s, at: at(d) }))

// ── Gurpreet: two paid fields ─────────────────────────────────────────────
for (const f of [
  { fieldName: 'Canal field', lat: 30.2601, lng: 76.0302, acres: 1.7, days: -24, tonnes: 4.0, baler: ['Amarjit Singh', 'PB-02'], cluster: 'C-091 · Bhawanigarh' },
  { fieldName: 'Back field', lat: 30.2689, lng: 76.0441, acres: 3.3, days: -18, tonnes: 8.0, baler: ['Harjit Singh', 'PB-13'], cluster: 'C-094 · Bhawanigarh' },
]) {
  await makeListing(gurpreet, {
    fieldName: f.fieldName,
    village: 'Bhawanigarh',
    district: 'Sangrur',
    lat: f.lat,
    lng: f.lng,
    acres: f.acres,
    harvest: at(f.days),
    status: 'paid',
    history: hist([['listed', f.days - 6], ['clustered', f.days - 3], ['sold', f.days - 2], ['pickup_scheduled', f.days - 1], ['picked_up', f.days + 3], ['paid', f.days + 3]]),
    extra: {
      cluster: { name: f.cluster, farmCount: 4 },
      buyerName: 'Malwa Pellet Works',
      pickup: { date: at(f.days + 3, 9), window: '9–11 am', code: '000000', balerName: f.baler[0], balerVehicle: f.baler[1] },
      verifiedTonnes: f.tonnes,
      payout: { amount: f.tonnes * RATES.farmerPerTonne, upiRef: `UPI-DEMO-${f.fieldName.slice(0, 4).toUpperCase()}`, paidAt: at(f.days + 3, 15) },
    },
  })
}

// ── Current order: Gurpreet's Home field + 3 neighbours, in progress ───────
const orderCode = `C-${100 + (await nextSequence('cluster'))}`
const orderFarms = [
  { who: gurpreet, fieldName: 'Home field', lat: 30.2655, lng: 76.0393, acres: 6.5, verified: null },
  { who: await demoFarmer(), lat: 30.2712, lng: 76.0468, acres: 7.5, verified: 18.7 },
  { who: await demoFarmer(), lat: 30.2603, lng: 76.0505, acres: 5.0, verified: 12.3 },
  { who: await demoFarmer(), lat: 30.2741, lng: 76.0331, acres: 7.0, verified: 15.2 },
]
const orderListings = []
for (const f of orderFarms) {
  const picked = f.verified != null
  orderListings.push(
    await makeListing(f.who, {
      fieldName: f.fieldName,
      village: 'Bhawanigarh',
      district: 'Sangrur',
      lat: f.lat,
      lng: f.lng,
      acres: f.acres,
      harvest: at(-1),
      // Verified farms are paid at once (that's the flow), Gurpreet's is still to do.
      status: picked ? 'paid' : 'pickup_scheduled',
      history: hist([['listed', -9], ['clustered', -6], ['sold', -4], ['pickup_scheduled', -3], ...(picked ? [['picked_up', 0], ['paid', 0]] : [])]),
      extra: {
        cluster: { name: `${orderCode} · Bhawanigarh`, farmCount: 4 },
        buyerName: 'Malwa Pellet Works',
        pickup: {
          date: picked ? at(0, 9) : at(1, 9),
          window: '9–11 am',
          code: crypto.randomInt(0, 1_000_000).toString().padStart(6, '0'),
          balerName: harjit.name,
          balerVehicle: harjit.baler.vehicle,
          balerPhone: harjit.phone,
          ...(picked ? { bales: Math.round(f.verified * 40) } : {}),
        },
        ...(picked
          ? { verifiedTonnes: f.verified, payout: { amount: Math.round(f.verified * RATES.farmerPerTonne), upiRef: 'TEST-UPI-DEMO', paidAt: at(0, 12) } }
          : {}),
      },
    }),
  )
}
const pts = orderListings.map((l) => toLatLng(l.location))
const center = centroid(pts)
const plant = { lat: 30.2458, lng: 75.8421 }
const tonnes = Math.round(orderListings.reduce((s, l) => s + l.estTonnes, 0) * 10) / 10
const routeKm = Math.round(orderStops(pts, plant).km * 10) / 10
const price = priceCluster({ tonnes, farmCount: 4, routeKm, center }, plant)
const cluster = await Cluster.create({
  code: orderCode,
  place: 'Bhawanigarh',
  district: 'Sangrur',
  harvestWeek: isoWeekKey(at(-1)),
  center: { type: 'Point', coordinates: [center.lng, center.lat] },
  listings: orderListings.map((l) => l._id),
  farmCount: 4,
  totalAcres: 26,
  totalTonnes: tonnes,
  routeKm,
  status: 'ordered',
})
const ord = await Order.create({
  code: `PL-${String(new Date().getFullYear()).slice(2)}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(await nextSequence('order')).padStart(4, '0')}`,
  buyer: buyer._id,
  buyerCompany: 'Malwa Pellet Works',
  cluster: cluster._id,
  clusterCode: orderCode,
  place: 'Bhawanigarh',
  district: 'Sangrur',
  harvestWeek: cluster.harvestWeek,
  listings: cluster.listings,
  estTonnes: tonnes,
  farmCount: 4,
  price,
  rates: rateSnapshot(),
  payment: { status: 'paid', method: 'UPI', amount: price.total, reference: 'TEST-DEMO', paidAt: at(-4), test: true },
  status: 'in_progress',
  statusHistory: hist([['placed', -4], ['baler_assigned', -3], ['in_progress', 0]]),
})
cluster.order = ord._id
await cluster.save()
await Listing.updateMany({ _id: { $in: cluster.listings } }, { order: ord._id, clusterRef: cluster._id })

/** A job for Harjit with pay worked out from his real base, like the dispatcher does. */
function harjitJob(order, clusterDoc, stopsInOrder, routeKmValue, status, extra = {}) {
  const c = toLatLng(clusterDoc.center)
  const approachKm = Math.round(roadKm({ lat: harjit.baler.base.coordinates[1], lng: harjit.baler.base.coordinates[0] }, c) * 10) / 10
  const kmToPlant = Math.round(roadKm(c, plant) * 10) / 10
  const pay = balerPay({ tonnes: order.estTonnes, farmCount: order.farmCount, routeKm: routeKmValue, kmToPlant, approachKm })
  return {
    order: order._id,
    baler: harjit._id,
    status,
    clusterCode: order.clusterCode,
    place: order.place,
    district: order.district,
    harvestWeek: order.harvestWeek,
    farmCount: order.farmCount,
    estTonnes: order.estTonnes,
    approachKm,
    routeKm: routeKmValue,
    kmToPlant,
    plantName: 'Malwa Pellet Works',
    plant,
    stops: stopsInOrder,
    pay: { total: pay.total, parts: pay.parts, advancePct: RATES.baler.fuelAdvancePct, estCost: Math.round(order.estTonnes * 190 + (approachKm * 2 + routeKmValue + kmToPlant) * 9) },
    ...extra,
  }
}

// Harjit's job on this order: accepted 3 days ago, three farms done, Gurpreet's next.
const seq = orderStops(pts, plant).order.map((i) => orderListings[i])
const inProgress = harjitJob(ord, cluster, seq.map((l) => l._id), routeKm, 'in_progress', { offeredAt: at(-4), respondedAt: at(-3) })
inProgress.payouts = [
  { kind: 'advance', label: `Fuel advance · ${RATES.baler.fuelAdvancePct}%`, amount: Math.round((inProgress.pay.total * RATES.baler.fuelAdvancePct) / 100), reference: 'TEST-ADV-DEMO', at: at(-3) },
  ...orderListings
    .filter((l) => l.verifiedTonnes != null)
    .map((l) => ({
      kind: 'stop',
      label: `Farm stop · ${l.verifiedTonnes} t`,
      amount: Math.round(l.verifiedTonnes * RATES.baler.balingPerTonne + RATES.baler.perFarm),
      listing: l._id,
      reference: 'TEST-STOP-DEMO',
      at: at(0, 12),
    })),
]
await Job.create(inProgress)

// ── Open supply around the region ─────────────────────────────────────────
let open = 0
for (const v of VILLAGES) {
  for (let i = 0; i < v.farms; i++) {
    const jitterKm = 2.6
    await makeListing(await demoFarmer(), {
      village: v.village,
      district: v.district,
      lat: v.lat + ((rand() - 0.5) * 2 * jitterKm) / 111,
      lng: v.lng + ((rand() - 0.5) * 2 * jitterKm) / 96,
      acres: Math.round((3 + rand() * 6.5) * 2) / 2,
      // Tue–Fri of the village's harvest week, so a village never straddles two ISO weeks.
      harvest: at(MONDAY + v.week * 7 + 1 + Math.floor(rand() * 4)),
    })
    open += 1
  }
}

const result = await rebuildClusters()

// A second order (Samana, next week) offered to Harjit, so the offer card has something to show.
const samana = await Cluster.findOne({ place: 'Samana', status: 'ready' })
if (samana) {
  const samanaListings = await Listing.find({ _id: { $in: samana.listings } })
  const sPts = samanaListings.map((l) => toLatLng(l.location))
  const sRoute = orderStops(sPts, plant)
  const sPrice = priceCluster({ tonnes: samana.totalTonnes, farmCount: samana.farmCount, routeKm: samana.routeKm, center: toLatLng(samana.center) }, plant)
  const sOrder = await Order.create({
    code: `PL-${String(new Date().getFullYear()).slice(2)}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(await nextSequence('order')).padStart(4, '0')}`,
    buyer: buyer._id,
    buyerCompany: 'Malwa Pellet Works',
    cluster: samana._id,
    clusterCode: samana.code,
    place: samana.place,
    district: samana.district,
    harvestWeek: samana.harvestWeek,
    listings: samana.listings,
    estTonnes: samana.totalTonnes,
    farmCount: samana.farmCount,
    price: sPrice,
    rates: rateSnapshot(),
    payment: { status: 'paid', method: 'UPI', amount: sPrice.total, reference: 'TEST-DEMO-2', paidAt: new Date(), test: true },
    status: 'placed',
    statusHistory: [{ status: 'placed', at: new Date() }],
  })
  samana.status = 'ordered'
  samana.order = sOrder._id
  await samana.save()
  await Listing.updateMany(
    { _id: { $in: samana.listings } },
    { $set: { status: 'sold', buyerName: 'Malwa Pellet Works', order: sOrder._id }, $push: { statusHistory: { status: 'sold', at: new Date() } } },
  )
  await Job.create(harjitJob(sOrder, samana, sRoute.order.map((i) => samanaListings[i]._id), Math.round(sRoute.km * 10) / 10, 'offered', {
    // Sent 7 hours ago, so the admin console's "needs attention" queue has an unanswered offer to show.
    offeredAt: new Date(Date.now() - 7 * 3_600_000),
  }))
}

// Baler bookings: Gurpreet has Harjit booked for his North field; another farmer is waiting on Harjit.
const dayAt = (d) => {
  const x = at(d)
  x.setHours(0, 0, 0, 0)
  return x
}
const harjitBase = { lat: 30.255, lng: 76.02 }
await BalerBooking.create({
  farmer: gurpreet._id,
  baler: harjit._id,
  location: { type: 'Point', coordinates: [76.0471, 30.2712] },
  village: 'Bhawanigarh',
  district: 'Sangrur',
  acres: 4.5,
  date: dayAt(1),
  note: 'North field, next to the canal bridge',
  distanceKm: Math.round(roadKm(harjitBase, { lat: 30.2712, lng: 76.0471 }) * 10) / 10,
  ratePerAcre: 1500,
  status: 'accepted',
  statusHistory: [{ status: 'requested', at: at(-1) }, { status: 'accepted', at: at(-1) }],
  respondedAt: at(-1),
})
// Two fields Harjit baled earlier in the season (his earnings page).
for (const [days, acres, village, lat, lng] of [
  [-19, 3.3, 'Bhawanigarh', 30.2689, 76.0441],
  [-12, 6, 'Kakra', 30.2795, 76.0703],
]) {
  await BalerBooking.create({
    farmer: gurpreet._id,
    baler: harjit._id,
    location: { type: 'Point', coordinates: [lng, lat] },
    village,
    district: 'Sangrur',
    acres,
    date: dayAt(days),
    distanceKm: Math.round(roadKm(harjitBase, { lat, lng }) * 10) / 10,
    ratePerAcre: 1500,
    status: 'done',
    statusHistory: [{ status: 'requested', at: at(days - 3) }, { status: 'accepted', at: at(days - 3) }, { status: 'done', at: at(days) }],
    respondedAt: at(days - 3),
  })
}
const waiting = await User.findOne({ phone: { $regex: `^\\${DEMO_FARMER_PREFIX}` } })
if (waiting) {
  await BalerBooking.create({
    farmer: waiting._id,
    baler: harjit._id,
    location: { type: 'Point', coordinates: [76.031, 30.2408] },
    village: 'Bhawanigarh',
    district: 'Sangrur',
    acres: 7,
    date: dayAt(3),
    distanceKm: Math.round(roadKm(harjitBase, { lat: 30.2408, lng: 76.031 }) * 10) / 10,
    ratePerAcre: 1500,
    statusHistory: [{ status: 'requested', at: at(0) }],
  })
}

console.info(`[seed] Gurpreet: 3 listings · buyer: Malwa Pellet Works (2 orders) · balers: ${BALERS.length} · ${open} open listings`)
console.info(`[seed] admin: ParaliLink Ops · ${ADMIN_PHONE}`)
console.info(`[seed] clustering: ${result.clusters} clusters (${result.ready} ready, ${result.forming} forming)`)
await mongoose.disconnect()
