import { api } from '../../lib/api'

export const buyerApi = {
  saveProfile: (body) => api('/buyer/profile', { method: 'PUT', body }),
  clusters: (maxKm, signal) => api(`/buyer/clusters?maxKm=${maxKm}`, { signal }),
  cluster: (id, signal) => api(`/buyer/clusters/${id}`, { signal }),
  calendar: (signal) => api('/buyer/calendar', { signal }),
  toggleDemand: (district, week) => api('/buyer/demand', { method: 'POST', body: { district, week } }),
  placeOrder: (clusterId) => api('/buyer/orders', { method: 'POST', body: { clusterId } }),
  orders: (signal) => api('/buyer/orders', { signal }),
  order: (id, signal) => api(`/buyer/orders/${id}`, { signal }),
}

export const PLANT_TYPES = [
  { id: 'pellet', label: 'Pellet plant' },
  { id: 'boiler', label: 'Industrial boiler' },
  { id: 'biogas', label: 'Biogas / CBG plant' },
  { id: 'paper', label: 'Paper mill' },
  { id: 'other', label: 'Other' },
]

/** "2026-W47" → "W47". */
export const weekShort = (key) => key?.split('-')[1] ?? ''

/** "2026-W47" → "16–22 Nov" (Monday–Sunday). */
export function weekRange(key) {
  const [y, w] = key.split('-W').map(Number)
  const jan4 = new Date(Date.UTC(y, 0, 4))
  const monday = new Date(jan4)
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (w - 1) * 7)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  const fmt = (d, month) => d.toLocaleDateString('en-IN', { day: 'numeric', ...(month ? { month: 'short' } : {}), timeZone: 'UTC' })
  return monday.getUTCMonth() === sunday.getUTCMonth() ? `${fmt(monday)}–${fmt(sunday, true)}` : `${fmt(monday, true)} – ${fmt(sunday, true)}`
}

export const ORDER_STATUS = {
  placed: { label: 'Placed · finding a baler', tone: 'straw' },
  baler_assigned: { label: 'Baler booked', tone: 'straw' },
  in_progress: { label: 'Picking up', tone: 'straw' },
  delivered: { label: 'Delivered', tone: 'forest' },
  settled: { label: 'Settled', tone: 'outline' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
}
