import { RATES } from '../config/rates.js'
import { haversineKm } from '../utils/geo.js'

const round1 = (n) => Math.round(n * 10) / 10

/**
 * Estimated procurement cost of a cluster for one industry (before machines and trucks
 * are booked). The real bill is settled on actual quantities and actual bookings.
 *
 *   straw      = tonnes × farm-gate rate
 *   baling     = acres × baling estimate per acre
 *   transport  = loads × (drive in + between farms + to the plant) × ₹/km
 *                (or the provisional vehicle plan's cost, when one is passed)
 *   commission = ParaliLink % of the three
 */
export function priceCluster({ tonnes, acres, routeKm, center }, plant, rates = RATES, transportOverride) {
  const kmToPlant = round1(haversineKm(center, plant) * RATES.roadFactor)
  const straw = Math.round(tonnes * rates.farmerPerTonne)
  const baling = Math.round(acres * rates.estimates.balingPerAcre)
  const loads = Math.max(1, Math.ceil(tonnes / 8))
  const transport = transportOverride ?? Math.round(loads * (15 + routeKm / loads + kmToPlant) * rates.estimates.transportPerKm)
  const commission = Math.round(((straw + baling + transport) * rates.commissionPct) / 100)
  const total = straw + baling + transport + commission
  return { kmToPlant, straw, baling, transport, commission, total, perTonne: Math.round(total / Math.max(tonnes, 0.1)) }
}
