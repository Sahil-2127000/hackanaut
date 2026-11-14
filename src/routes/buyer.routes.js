import { Router } from 'express'
import { getCalendar, getCluster, getOrder, listClusters, listOrders, placeOrder, saveProfile, toggleDemand, verifyDelivery } from '../controllers/buyer.controller.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { requirePlant } from '../middleware/profile.js'
import { validateBody } from '../middleware/validate.js'
import { demandSchema, orderSchema, profileSchema, verifySchema } from '../validators/buyer.validators.js'

/** Industries (role "buyer"). Own vehicles and their runs live under /transport. */
export const buyerRouter = Router()
buyerRouter.use(requireAuth, requireRole('buyer'))
buyerRouter.put('/profile', validateBody(profileSchema), saveProfile)
buyerRouter.get('/clusters', requirePlant, listClusters)
buyerRouter.get('/clusters/:id', requirePlant, getCluster)
buyerRouter.get('/calendar', getCalendar)
buyerRouter.post('/demand', validateBody(demandSchema), toggleDemand)
buyerRouter.post('/orders', requirePlant, validateBody(orderSchema), placeOrder)
buyerRouter.get('/orders', listOrders)
buyerRouter.get('/orders/:id', getOrder)
buyerRouter.post('/trips/:id/verify', validateBody(verifySchema), verifyDelivery)
