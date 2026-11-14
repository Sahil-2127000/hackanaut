import mongoose from 'mongoose'

/**
 * A pickup cluster: nearby farms with close harvest dates and the same straw quality.
 * forming → ready (≥ min tonnes) → ordered (an industry bought it).
 * Forming/ready clusters are rebuilt whenever farms change; ordered ones are frozen.
 */
export const CLUSTER_STATUSES = ['forming', 'ready', 'ordered']

const clusterSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true }, // e.g. "PL-001"
    place: { type: String, required: true },
    district: { type: String, required: true },
    harvestWeek: { type: String, required: true, index: true },
    harvestFrom: Date,
    harvestTo: Date,
    quality: String,
    moisture: String, // worst moisture in the cluster
    access: String, // most restrictive road access in the cluster
    center: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true },
    },
    listings: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Listing' }],
    farmCount: { type: Number, required: true },
    totalAcres: { type: Number, required: true },
    totalTonnes: { type: Number, required: true },
    routeKm: { type: Number, default: 0 },
    status: { type: String, enum: CLUSTER_STATUSES, default: 'forming', index: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  },
  { timestamps: true },
)

clusterSchema.index({ center: '2dsphere' })

export const Cluster = mongoose.model('Cluster', clusterSchema)
