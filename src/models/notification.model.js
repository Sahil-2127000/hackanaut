import mongoose from 'mongoose'

/** In-app notification. Old ones expire after 30 days. */
const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    body: String,
    link: String, // app path, e.g. "/farmer/listings/…"
    read: { type: Boolean, default: false },
  },
  { timestamps: true },
)

notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 86_400 })

export const Notification = mongoose.model('Notification', notificationSchema)
