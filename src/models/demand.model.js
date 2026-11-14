import mongoose from 'mongoose'

/** Buyer interest in future supply, from the harvest calendar. */
const demandSchema = new mongoose.Schema(
  {
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    district: { type: String, required: true },
    harvestWeek: { type: String, required: true },
  },
  { timestamps: true },
)
demandSchema.index({ buyer: 1, district: 1, harvestWeek: 1 }, { unique: true })

export const Demand = mongoose.model('Demand', demandSchema)
