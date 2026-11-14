import { api } from '../../lib/api'

export const adminApi = {
  overview: (signal) => api('/admin/overview', { signal }),
  reoffer: (orderId) => api(`/admin/orders/${orderId}/reoffer`, { method: 'POST' }),
  passOffer: (jobId) => api(`/admin/jobs/${jobId}/pass`, { method: 'POST' }),
  settle: (orderId) => api(`/admin/orders/${orderId}/settle`, { method: 'POST' }),
  rebuildClusters: () => api('/admin/clusters/rebuild', { method: 'POST' }),
  orders: (status, signal) => api(`/admin/orders?status=${encodeURIComponent(status)}`, { signal }),
  order: (id, signal) => api(`/admin/orders/${id}`, { signal }),
  users: ({ role, q }, signal) => api(`/admin/users?role=${encodeURIComponent(role)}&q=${encodeURIComponent(q)}`, { signal }),
  settings: (signal) => api('/admin/settings', { signal }),
  preview: (values, signal) => api('/admin/settings/preview', { method: 'POST', body: values, signal }),
  saveSettings: (values) => api('/admin/settings', { method: 'PUT', body: values }),
  audit: (signal) => api('/admin/audit', { signal }),
}

export const ADMIN_TABS = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/orders', label: 'Orders' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/settings', label: 'Rate card' },
]

/** "+919876543210" → "+91 98765 43210". */
export function formatPhone(phone) {
  const m = /^\+91(\d{5})(\d{5})$/.exec(phone ?? '')
  return m ? `+91 ${m[1]} ${m[2]}` : (phone ?? '')
}

/** "14 Nov, 09:17" in Indian time. */
export function dateTime(value) {
  if (!value) return ''
  return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
}

/** "3 h ago", "2 d ago". */
export function ago(value) {
  if (!value) return ''
  const mins = Math.round((Date.now() - new Date(value).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}
