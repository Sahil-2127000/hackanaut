import mongoose from 'mongoose'

/**
 * A cutting / baling machine registered by a machinery owner (role "baler").
 * cutter: cuts and rakes · baler: bales cut straw · combined: does both in one pass.
 */
export const MACHINE_TYPES = ['cutter', 'baler', 'combined']

const machineSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 }, // e.g. "Square baler PB-13"
    type: { type: String, enum: MACHINE_TYPES, required: true },
    regNo: { type: String, trim: true, maxlength: 20 },
    capacityAcresPerDay: { type: Number, required: true, min: 1, max: 200 },
    workStart: { type: String, default: '08:00' },
    workEnd: { type: String, default: '18:00' },
    base: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true },
    },
    district: String,
    serviceRadiusKm: { type: Number, default: 25, min: 1, max: 200 },
    availableFrom: Date,
    availableTo: Date,
    ratePerAcre: { type: Number, required: true, min: 0, max: 20000 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
)

machineSchema.index({ base: '2dsphere' })

machineSchema.methods.toView = function toView() {
  return {
    id: this._id.toString(),
    name: this.name,
    type: this.type,
    regNo: this.regNo ?? null,
    capacityAcresPerDay: this.capacityAcresPerDay,
    workStart: this.workStart,
    workEnd: this.workEnd,
    base: { lat: this.base.coordinates[1], lng: this.base.coordinates[0] },
    district: this.district ?? null,
    serviceRadiusKm: this.serviceRadiusKm,
    availableFrom: this.availableFrom ?? null,
    availableTo: this.availableTo ?? null,
    ratePerAcre: this.ratePerAcre,
    active: this.active,
  }
}

export const Machine = mongoose.model('Machine', machineSchema)
