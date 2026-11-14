import { z } from 'zod'
import { PUNJAB_BOUNDS, PUNJAB_DISTRICTS } from '../config/punjab.js'
import { QUALITIES } from '../models/listing.model.js'
import { PLANT_TYPES } from '../models/user.model.js'

export const profileSchema = z.object({
  company: z.string().trim().min(2, 'Enter the company or plant name.').max(100),
  plantType: z.enum(PLANT_TYPES, { error: 'Choose the plant type.' }),
  district: z.enum(PUNJAB_DISTRICTS, { error: 'Choose a district.' }),
  lat: z.number().min(PUNJAB_BOUNDS.minLat, 'The plant must be in or near Punjab.').max(PUNJAB_BOUNDS.maxLat, 'The plant must be in or near Punjab.'),
  lng: z.number().min(PUNJAB_BOUNDS.minLng, 'The plant must be in or near Punjab.').max(PUNJAB_BOUNDS.maxLng, 'The plant must be in or near Punjab.'),
  requiredTonnes: z.number().min(0).max(100000).optional(),
  deliveryBy: z.coerce.date().optional(),
  acceptQuality: z.array(z.enum(QUALITIES)).min(1, 'Accept at least one quality.').optional(),
  unloadPerDay: z.number().min(0).max(10000).optional(),
  preferOwnFleet: z.boolean().optional(),
})

export const demandSchema = z.object({
  district: z.enum(PUNJAB_DISTRICTS),
  week: z.string().regex(/^\d{4}-W\d{2}$/),
})

export const orderSchema = z.object({ clusterId: z.string() })
export const verifySchema = z.object({ tonnes: z.number({ error: 'Enter the weighed tonnes.' }).min(0.1, 'Enter the weighed tonnes.').max(100) })
