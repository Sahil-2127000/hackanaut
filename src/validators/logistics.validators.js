import { z } from 'zod'
import { PUNJAB_BOUNDS, PUNJAB_DISTRICTS } from '../config/punjab.js'
import { MACHINE_TYPES } from '../models/machine.model.js'
import { VEHICLE_TYPES } from '../models/vehicle.model.js'

const lat = z.number().min(PUNJAB_BOUNDS.minLat, 'Must be in or near Punjab.').max(PUNJAB_BOUNDS.maxLat, 'Must be in or near Punjab.')
const lng = z.number().min(PUNJAB_BOUNDS.minLng, 'Must be in or near Punjab.').max(PUNJAB_BOUNDS.maxLng, 'Must be in or near Punjab.')
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, e.g. 08:00.')
const optDate = z.coerce.date().optional().nullable()

const machineFields = z.object({
  name: z.string().trim().min(2, 'Give the machine a name.').max(60),
  type: z.enum(MACHINE_TYPES, { error: 'Choose the machine type.' }),
  regNo: z.string().trim().max(20).optional(),
  capacityAcresPerDay: z.number({ error: 'Enter acres per day.' }).min(1, 'At least 1 acre a day.').max(200),
  workStart: time,
  workEnd: time,
  lat,
  lng,
  district: z.enum(PUNJAB_DISTRICTS).optional(),
  serviceRadiusKm: z.number().min(1).max(200),
  availableFrom: optDate,
  availableTo: optDate,
  ratePerAcre: z.number({ error: 'Enter your rate per acre.' }).min(0).max(20000),
  active: z.boolean().optional(),
})
export const machineSchema = machineFields.extend({
  workStart: time.default('08:00'),
  workEnd: time.default('18:00'),
  serviceRadiusKm: z.number().min(1).max(200).default(25),
})
// Updates change only the fields sent (no defaults filled in).
export const machineUpdateSchema = machineFields.partial()

export const advanceSchema = z.object({
  bales: z.number().int().min(0).max(100000).optional(),
  readyTonnes: z.number().min(0).max(1000).optional(),
})
export const exceptionSchema = z.object({ reason: z.string().trim().min(3, 'Say what went wrong.').max(160) })

const vehicleFields = z.object({
  regNo: z.string().trim().min(4, 'Enter the registration number.').max(20),
  type: z.enum(VEHICLE_TYPES, { error: 'Choose the vehicle type.' }),
  payloadTonnes: z.number({ error: 'Enter the legal payload.' }).min(1).max(60),
  volumeM3: z.number().min(5).max(200).optional(),
  lat,
  lng,
  district: z.enum(PUNJAB_DISTRICTS).optional(),
  serviceRadiusKm: z.number().min(5).max(300),
  availableFrom: optDate,
  availableTo: optDate,
  ratePerKm: z.number({ error: 'Enter the rate per km.' }).min(0).max(1000),
  minCharge: z.number().min(0).max(100000),
  driverName: z.string().trim().max(60).optional(),
  driverPhone: z.string().trim().max(20).optional(),
  active: z.boolean().optional(),
})
export const vehicleSchema = vehicleFields.extend({
  serviceRadiusKm: z.number().min(5).max(300).default(60),
  minCharge: z.number().min(0).max(100000).default(0),
})
export const vehicleUpdateSchema = vehicleFields.partial()

export const collectSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'The code has 6 digits.'),
  tonnes: z.number({ error: 'Enter the tonnes loaded.' }).min(0.1).max(60),
  bales: z.number().int().min(0).max(100000).optional(),
})

export const transporterProfileSchema = z.object({
  company: z.string().trim().max(100).optional(),
  district: z.enum(PUNJAB_DISTRICTS).optional(),
})
