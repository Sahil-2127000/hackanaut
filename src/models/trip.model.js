import mongoose from 'mongoose'

/**
 * One vehicle assignment: start → farms (pickup stops, in order) → industry. No storage depot.
 *
 * assigned → dispatched → loading (first farm collected) → in_transit (all farms done)
 * → delivered (at the plant) → verified (industry weighed it). Or cancelled.
 *
 * Each stop keeps the planned and the actually collected tonnes.
 */
export const TRIP_STATUSES = ['assigned', 'dispatched', 'loading', 'in_transit', 'delivered', 'verified', 'cancelled']
export const LIVE_TRIP = ['assigned', 'dispatched', 'loading', 'in_transit', 'delivered']

const stopSchema = new mongoose.Schema(
  {
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
    label: String,
    farmerName: String,
    farmerPhone: String,
    village: String,
    location: { lat: Number, lng: Number },
    plannedTonnes: Number,
    collectedTonnes: Number,
    bales: Number,
    status: { type: String, enum: ['pending', 'collected', 'skipped'], default: 'pending' },
    eta: Date,
    at: Date,
  },
  { _id: true },
)

const tripSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true }, // e.g. "TR-0012"
    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ownerKind: { type: String, enum: ['independent', 'industry'] },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    clusterCode: String,
    regNo: String,
    vehicleType: String,
    capacityTonnes: Number, // what this vehicle can carry of straw
    date: { type: Date, required: true }, // day of the pickup run
    start: { lat: Number, lng: Number },
    plant: { lat: Number, lng: Number },
    plantName: String,
    stops: [stopSchema],
    approachKm: Number,
    routeKm: Number,
    toPlantKm: Number,
    totalKm: Number,
    durationMin: Number,
    eta: Date, // at the plant
    geometry: [[Number]], // [lat, lng] pairs for the map
    routeSource: { type: String, enum: ['osrm', 'estimate'] },
    plannedTonnes: Number,
    cost: Number,
    status: { type: String, enum: TRIP_STATUSES, default: 'assigned', index: true },
    statusHistory: [{ status: String, at: { type: Date, default: Date.now }, _id: false }],
    deliveredAt: Date,
    verifiedTonnes: Number,
    verifiedAt: Date,
  },
  { timestamps: true },
)

tripSchema.index({ vehicle: 1, date: 1, status: 1 })

tripSchema.methods.setStatus = function setStatus(status) {
  if (this.status === status) return
  this.status = status
  this.statusHistory.push({ status, at: new Date() })
}

export const Trip = mongoose.model('Trip', tripSchema)
