import { z } from 'zod'
import { PUNJAB_BOUNDS, PUNJAB_DISTRICTS } from '../config/punjab.js'
import { ACCESS, MOISTURES, QUALITIES } from '../models/listing.model.js'

export const createSchema = z.object({
  fieldName: z.string().trim().max(60).optional(),
  lat: z.number().min(PUNJAB_BOUNDS.minLat, 'The field must be in Punjab.').max(PUNJAB_BOUNDS.maxLat, 'The field must be in Punjab.'),
  lng: z.number().min(PUNJAB_BOUNDS.minLng, 'The field must be in Punjab.').max(PUNJAB_BOUNDS.maxLng, 'The field must be in Punjab.'),
  village: z.string().trim().min(2, 'Enter the village name.').max(80),
  district: z.enum(PUNJAB_DISTRICTS, { error: 'Choose a district.' }),
  acres: z.number().min(0.5, 'At least half an acre.').max(200, 'Up to 200 acres per farm.'),
  // Expected harvest date.
  harvestDate: z.coerce.date({ error: 'Choose the expected harvest date.' }),
  // Farmer's own estimate; defaults to acres × tonnes per acre.
  estTonnes: z.number().min(0.5, 'At least 0.5 t.').max(800).optional(),
  quality: z.enum(QUALITIES, { error: 'Choose the straw quality.' }).default('good'),
  moisture: z.enum(MOISTURES, { error: 'Choose the moisture.' }).default('normal'),
  access: z.enum(ACCESS).default('any'),
})
