import { Notification } from '../models/notification.model.js'

/**
 * In-app notifications. Never throws: a failed notification must not break the workflow.
 * (SMS can be added here later through sms.service.)
 */
export async function notify(users, title, body, link) {
  const ids = [...new Set((Array.isArray(users) ? users : [users]).filter(Boolean).map(String))]
  if (!ids.length) return
  try {
    await Notification.insertMany(ids.map((user) => ({ user, title, body, link })))
  } catch (error) {
    console.error('[notify] failed:', error.message)
  }
}
