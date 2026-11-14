import mongoose from 'mongoose'

/**
 * A vehicle registered by an independent transporter or by an industry (its own fleet).
 * Straw is bulky: what a vehicle can really carry is min(payload, volume ÷ m³ per tonne).
 */
export const VEHICLE_TYPES = ['tractor_trolley', 'truck', 'twelve_wheeler', 'trailer']
// Typical specs, used as form defaults (the owner enters the real figures).
export const VEHICLE_DEFAULTS = {
  tractor_trolley: { payloadTonnes: 4, volumeM3: 30, ratePerKm: 25, minCharge: 800 },
  truck: { payloadTonnes: 10, volumeM3: 55, ratePerKm: 45, minCharge: 2500 },
  twelve_wheeler: { payloadTonnes: 16, volumeM3: 72, ratePerKm: 60, minCharge: 4000 },
  trailer: { payloadTonnes: 25, volumeM3: 95, ratePerKm: 80, minCharge: 6000 },
}

const vehicleSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ownerKind: { type: String, enum: ['independent', 'industry'], required: true },
    regNo: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 20 },
    type: { type: String, enum: VEHICLE_TYPES, required: true },
    payloadTonnes: { type: Number, required: true, min: 1, max: 60 },
    volumeM3: { type: Number, min: 5, max: 200 },
    base: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true },
    },
    district: String,
    serviceRadiusKm: { type: Number, default: 60, min: 5, max: 300 },
    availableFrom: Date,
    availableTo: Date,
    ratePerKm: { type: Number, required: true, min: 0, max: 1000 },
    minCharge: { type: Number, default: 0, min: 0, max: 100000 },
    driverName: { type: String, trim: true, maxlength: 60 },
    driverPhone: { type: String, trim: true, maxlength: 20 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
)

vehicleSchema.index({ base: '2dsphere' })

vehicleSchema.methods.toView = function toView(m3PerTonne) {
  const byVolume = this.volumeM3 ? this.volumeM3 / m3PerTonne : Infinity
  return {
    id: this._id.toString(),
    regNo: this.regNo,
    type: this.type,
    ownerKind: this.ownerKind,
    payloadTonnes: this.payloadTonnes,
    volumeM3: this.volumeM3 ?? null,
    strawTonnes: Math.round(Math.min(this.payloadTonnes, byVolume) * 10) / 10,
    base: { lat: this.base.coordinates[1], lng: this.base.coordinates[0] },
    district: this.district ?? null,
    serviceRadiusKm: this.serviceRadiusKm,
    availableFrom: this.availableFrom ?? null,
    availableTo: this.availableTo ?? null,
    ratePerKm: this.ratePerKm,
    minCharge: this.minCharge,
    driverName: this.driverName ?? null,
    driverPhone: this.driverPhone ?? null,
    active: this.active,
  }
}

export const Vehicle = mongoose.model('Vehicle', vehicleSchema)
