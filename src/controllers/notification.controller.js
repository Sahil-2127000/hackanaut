import mongoose from 'mongoose'
import { Notification } from '../models/notification.model.js'

export async function listNotifications(req, res) {
  const items = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(40).lean()
  res.json({
    data: {
      unread: items.filter((n) => !n.read).length,
      notifications: items.map((n) => ({ id: String(n._id), title: n.title, body: n.body ?? null, link: n.link ?? null, read: n.read, at: n.createdAt })),
    },
  })
}

export async function markRead(req, res) {
  const filter = { user: req.user._id, read: false }
  if (req.params.id) {
    if (!mongoose.isValidObjectId(req.params.id)) return res.json({ data: { ok: true } })
    filter._id = req.params.id
  }
  await Notification.updateMany(filter, { $set: { read: true } })
  res.json({ data: { ok: true } })
}
