import { HttpError } from './errors.js'
import { plantOf } from '../utils/location.js'

export function requirePlant(req, res, next) {
  const plant = plantOf(req.user)
  if (!plant) return next(new HttpError(409, 'Set up your plant first so we can work out distances and prices.', { reason: 'no_plant' }))
  req.plant = plant
  next()
}
