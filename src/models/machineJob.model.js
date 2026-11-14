import mongoose from 'mongoose'

/**
 * One machine booked for one farm.
 * op: cut | bale | cut_bale (a combined machine does both).
 *
 * requested (system booked it, owner to confirm) → assigned (confirmed) → dispatched
 * → arrived → in_progress → completed. `exception` = the owner reported a problem
 * (the scheduler re-assigns the farm); `cancelled` = no longer needed.
 *
 * `days` holds the acres booked on each date; the scheduler sums them per machine
 * and date so a machine is never booked beyond its daily capacity.
 */
export const JOB_STATUSES = ['requested', 'assigned', 'dispatched', 'arrived', 'in_progress', 'completed', 'exception', 'cancelled']
export const LIVE_JOB = ['requested', 'assigned', 'dispatched', 'arrived', 'in_progress']
export const NEXT_JOB_STATUS = { requested: 'assigned', assigned: 'dispatched', dispatched: 'arrived', arrived: 'in_progress', in_progress: 'completed' }

const machineJobSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true }, // e.g. "MJ-0031"
    machine: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine', required: true, index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true, index: true },
    clusterCode: String,
    op: { type: String, enum: ['cut', 'bale', 'cut_bale'], required: true },
    // Snapshot for the owner's list.
    machineName: String,
    farmLabel: String,
    farmerName: String,
    farmerPhone: String,
    village: String,
    location: { lat: Number, lng: Number },
    acres: Number,
    estTonnes: Number,
    distanceKm: Number,
    days: [{ date: Date, acres: Number, _id: false }],
    start: Date,
    end: Date,
    hours: Number, // working hours needed
    ratePerAcre: Number,
    cost: Number,
    sequence: Number, // order in the owner's day plan

    status: { type: String, enum: JOB_STATUSES, default: 'requested', index: true },
    statusHistory: [{ status: String, at: { type: Date, default: Date.now }, note: String, _id: false }],
    exceptionReason: String,
    // Filled when a baling job completes.
    bales: Number,
    readyTonnes: Number,
    completedAt: Date,
  },
  { timestamps: true },
)

machineJobSchema.index({ machine: 1, status: 1, start: 1 })

export const MachineJob = mongoose.model('MachineJob', machineJobSchema)
