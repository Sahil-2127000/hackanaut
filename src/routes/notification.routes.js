import { Router } from 'express'
import { listNotifications, markRead } from '../controllers/notification.controller.js'
import { requireAuth } from '../middleware/auth.js'

export const notificationRouter = Router()
notificationRouter.use(requireAuth)
notificationRouter.get('/', listNotifications)
notificationRouter.post('/read', markRead)
notificationRouter.post('/:id/read', markRead)
