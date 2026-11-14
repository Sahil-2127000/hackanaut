import { Router } from 'express'
import { advance, createMachine, getEarnings, getJob, listJobs, listMachines, reportException, updateMachine } from '../controllers/machinery.controller.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import { advanceSchema, exceptionSchema, machineSchema, machineUpdateSchema } from '../validators/logistics.validators.js'

/** Machinery owners (role "baler"). */
export const machineryRouter = Router()
machineryRouter.use(requireAuth, requireRole('baler'))
machineryRouter.get('/machines', listMachines)
machineryRouter.post('/machines', validateBody(machineSchema), createMachine)
machineryRouter.put('/machines/:id', validateBody(machineUpdateSchema), updateMachine)
machineryRouter.get('/jobs', listJobs)
machineryRouter.get('/jobs/:id', getJob)
machineryRouter.post('/jobs/:id/advance', validateBody(advanceSchema), advance)
machineryRouter.post('/jobs/:id/exception', validateBody(exceptionSchema), reportException)
machineryRouter.get('/earnings', getEarnings)
