import { Router } from 'express'
import { collect, createVehicle, deliver, getEarnings, getTrip, listTrips, listVehicles, startTrip, updateVehicle } from '../controllers/transport.controller.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import { collectSchema, transporterProfileSchema, vehicleSchema, vehicleUpdateSchema } from '../validators/logistics.validators.js'

/** Vehicles and pickup runs: independent transporters, and industries for their own fleet. */
export const transportRouter = Router()
transportRouter.use(requireAuth, requireRole('transporter', 'buyer'))

transportRouter.put('/profile', requireRole('transporter'), validateBody(transporterProfileSchema), async (req, res) => {
  for (const [k, v] of Object.entries(req.body)) if (v !== undefined) req.user.set(`transporter.${k}`, v)
  await req.user.save()
  res.json({ data: { user: req.user.toPublic() } })
})
transportRouter.get('/vehicles', listVehicles)
transportRouter.post('/vehicles', validateBody(vehicleSchema), createVehicle)
transportRouter.put('/vehicles/:id', validateBody(vehicleUpdateSchema), updateVehicle)
transportRouter.get('/trips', listTrips)
transportRouter.get('/trips/:id', getTrip)
transportRouter.post('/trips/:id/start', startTrip)
transportRouter.post('/trips/:id/stops/:stopId/collect', validateBody(collectSchema), collect)
transportRouter.post('/trips/:id/deliver', deliver)
transportRouter.get('/earnings', getEarnings)
