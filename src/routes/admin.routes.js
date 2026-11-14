import { Router } from 'express'
import {
  assignTrucks,
  forceSettle,
  getAuditLog,
  getOrder,
  getOverview,
  getSettings,
  listJobs,
  listMachines,
  listOrders,
  listTrips,
  listUsers,
  listVehicles,
  previewSettings,
  rerunClustering,
  rescheduleMachines,
  resolveAlert,
  updateSettings,
} from '../controllers/admin.controller.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

export const adminRouter = Router()

adminRouter.use(requireAuth, requireRole('admin'))
adminRouter.get('/overview', getOverview)
adminRouter.get('/machines', listMachines)
adminRouter.get('/vehicles', listVehicles)
adminRouter.get('/jobs', listJobs)
adminRouter.get('/trips', listTrips)
adminRouter.get('/orders', listOrders)
adminRouter.get('/orders/:id', getOrder)
adminRouter.post('/orders/:id/reschedule', rescheduleMachines)
adminRouter.post('/orders/:id/assign-trucks', assignTrucks)
adminRouter.post('/orders/:id/alerts/:alertId/resolve', resolveAlert)
adminRouter.post('/orders/:id/settle', forceSettle)
adminRouter.post('/clusters/rebuild', rerunClustering)
adminRouter.get('/users', listUsers)
adminRouter.get('/settings', getSettings)
adminRouter.post('/settings/preview', previewSettings)
adminRouter.put('/settings', updateSettings)
adminRouter.get('/audit', getAuditLog)
