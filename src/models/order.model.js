import mongoose from 'mongoose'

/**
 * An industry's bulk purchase of one cluster.
 *
 * placed → machines_scheduled → cutting → in_transit → delivered → settled (or cancelled)
 *
 * `price` is the estimate at purchase (snapshot of rates). `settlement` is the
 * final bill on actual quantities, with one simulated payout line per party.
 * `alerts` hold exceptions (no machine, short of trucks, late delivery…) for the admin.
 */
export const ORDER_STATUSES = ['placed', 'machines_scheduled', 'cutting', 'in_transit', 'delivered', 'settled', 'cancelled']

const lineSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['farmer', 'baler', 'transporter', 'platform'] },
    party: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: String,
    label: String,
    amount: Number,
    reference: String,
  },
  { _id: false },
)

const alertSchema = new mongoose.Schema({
  kind: { type: String, enum: ['no_machine', 'machine_exception', 'no_vehicle', 'short_capacity', 'late', 'unload', 'weight_mismatch'] },
  message: String,
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' },
  at: { type: Date, default: Date.now },
  resolvedAt: Date,
  resolvedBy: String,
})

const orderSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true }, // e.g. "ORD-0042"
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    buyerCompany: String,
    cluster: { type: mongoose.Schema.Types.ObjectId, ref: 'Cluster', required: true },
    clusterCode: String,
    place: String,
    district: String,
    harvestWeek: String,
    listings: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Listing' }],
    estTonnes: Number,
    totalAcres: Number,
    farmCount: Number,
    plant: { lat: Number, lng: Number },
    deliveryBy: Date,
    price: {
      kmToPlant: Number,
      straw: Number,
      baling: Number,
      transport: Number,
      commission: Number,
      total: Number,
      perTonne: Number,
      trucksPlanned: String, // e.g. "2 × truck 10 t" (provisional, not booked)
    },
    rates: { type: mongoose.Schema.Types.Mixed },
    // Simulated: no money moves.
    payment: { status: { type: String, default: 'simulated' }, amount: Number, reference: String, paidAt: Date },
    settlement: {
      collectedTonnes: Number,
      verifiedTonnes: Number,
      straw: Number,
      baling: Number,
      transport: Number,
      commission: Number,
      total: Number,
      lines: [lineSchema],
      at: Date,
    },
    alerts: [alertSchema],
    status: { type: String, enum: ORDER_STATUSES, default: 'placed', index: true },
    statusHistory: [{ status: String, at: { type: Date, default: Date.now }, _id: false }],
  },
  { timestamps: true },
)

orderSchema.methods.setStatus = function setStatus(status) {
  if (this.status === status) return
  this.status = status
  this.statusHistory.push({ status, at: new Date() })
}

orderSchema.methods.addAlert = function addAlert(kind, message, listing) {
  // One open alert per kind + farm is enough.
  const open = this.alerts.find((a) => !a.resolvedAt && a.kind === kind && String(a.listing ?? '') === String(listing ?? ''))
  if (open) {
    open.message = message
    open.at = new Date()
    return
  }
  this.alerts.push({ kind, message, listing })
}

orderSchema.methods.resolveAlerts = function resolveAlerts(kinds, by = 'system', listing) {
  for (const a of this.alerts) {
    if (a.resolvedAt || !kinds.includes(a.kind)) continue
    if (listing && String(a.listing ?? '') !== String(listing)) continue
    a.resolvedAt = new Date()
    a.resolvedBy = by
  }
}

export const Order = mongoose.model('Order', orderSchema)
