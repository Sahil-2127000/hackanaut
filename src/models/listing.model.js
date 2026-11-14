import mongoose from 'mongoose'
import { nextSequence } from '../utils/counters.js'

/**
 * A farm registration for one harvest (called a "listing" in code).
 *
 * listed → clustered → sold (an industry bought its cluster) → scheduled (machines booked)
 * → cutting → ready (baled; actual tonnes known) → pickup_scheduled (truck assigned)
 * → picked_up → delivered → paid. `cancelled` only before the sale.
 *
 * Planned and actual quantities are kept apart:
 *   estTonnes (farmer's estimate) → readyTonnes (after baling) → verifiedTonnes (collected by the truck).
 */
export const LISTING_STATUSES = ['listed', 'clustered', 'sold', 'scheduled', 'cutting', 'ready', 'pickup_scheduled', 'picked_up', 'delivered', 'paid', 'cancelled']
export const CANCELLABLE = ['listed', 'clustered']
export const ACTIVE = ['listed', 'clustered', 'sold', 'scheduled', 'cutting', 'ready', 'pickup_scheduled', 'picked_up', 'delivered']
export const QUALITIES = ['good', 'average', 'poor']
export const MOISTURES = ['dry', 'normal', 'wet']
// Largest vehicle that can reach the field.
export const ACCESS = ['tractor', 'truck', 'any']

const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }, // [lng, lat]
  },
  { _id: false },
)

const listingSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true, unique: true },
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    fieldName: { type: String, trim: true, maxlength: 60 },
    location: { type: pointSchema, required: true },
    village: { type: String, required: true, trim: true, maxlength: 80 },
    district: { type: String, required: true, trim: true, maxlength: 40 },
    acres: { type: Number, required: true, min: 0.5, max: 200 },
    estTonnes: { type: Number, required: true },
    quality: { type: String, enum: QUALITIES, default: 'good' },
    moisture: { type: String, enum: MOISTURES, default: 'normal' },
    access: { type: String, enum: ACCESS, default: 'any' },
    // Expected harvest date. Clustering groups farms whose dates are close.
    harvestDate: { type: Date, required: true },
    harvestWeek: { type: String, required: true, index: true },
    crop: { type: String, default: 'paddy' },

    status: { type: String, enum: LISTING_STATUSES, default: 'listed', index: true },
    statusHistory: [{ status: { type: String, enum: LISTING_STATUSES }, at: { type: Date, default: Date.now }, _id: false }],

    cluster: { name: String, farmCount: Number },
    clusterRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Cluster', index: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', index: true },
    buyerName: String,

    // Actual quantity after baling (entered by the machine owner).
    readyTonnes: Number,
    bales: Number,
    readyAt: Date,

    // Truck pickup. A big farm can be split across trucks; the code is the same for all of them.
    pickup: {
      code: String, // 6 digits, shown only to the farmer; the driver enters it at the field
      attempts: Number,
    },
    verifiedTonnes: Number, // collected at the farm (sum over trucks)
    payout: { amount: Number, reference: String, paidAt: Date },
  },
  { timestamps: true },
)

listingSchema.index({ location: '2dsphere' })
listingSchema.index({ status: 1, harvestDate: 1 })

export const Listing = mongoose.model('Listing', listingSchema)

export async function nextListingNumber() {
  return 400 + (await nextSequence('listing'))
}

/** Short label shown everywhere, e.g. "Farm 0412". */
export const listingLabel = (l) => `Farm ${String(l.number).padStart(4, '0')}`
