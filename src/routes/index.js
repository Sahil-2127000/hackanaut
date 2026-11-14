import { Router } from 'express'
import mongoose from 'mongoose'
import { adminRouter } from './admin.routes.js'
import { authRouter } from './auth.routes.js'
import { buyerRouter } from './buyer.routes.js'
import { listingsRouter } from './listing.routes.js'
import { machineryRouter } from './machinery.routes.js'
import { notificationRouter } from './notification.routes.js'
import { transportRouter } from './transport.routes.js'

/**
 * Root API router, mounted at /api/v1.
 * listings = farmer farm registration · buyer = industry · machinery = machine owners
 * transport = vehicles and pickup runs · admin = operations console.
 */
export const apiRouter = Router()

apiRouter.get('/health', (req, res) => {
  const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting']
  res.json({
    data: {
      status: 'ok',
      db: dbStates[mongoose.connection.readyState] ?? 'unknown',
      time: new Date().toISOString(),
    },
  })
})

apiRouter.use('/auth', authRouter)
apiRouter.use('/listings', listingsRouter)
apiRouter.use('/buyer', buyerRouter)
apiRouter.use('/machinery', machineryRouter)
apiRouter.use('/transport', transportRouter)
apiRouter.use('/notifications', notificationRouter)
apiRouter.use('/admin', adminRouter)
