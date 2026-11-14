/**
 * Platform rate card and logistics rules. These are the defaults; the admin
 * console can override any field in RATE_FIELDS (saved in the `settings`
 * collection and applied at startup and on save).
 *
 * Money model (simulated, no real payments):
 *   industry pays = straw (farm-gate rate × tonnes) + baling (machine owners)
 *                 + transport (vehicle owners) + ParaliLink commission.
 *
 * Every order stores a snapshot of the money rates it was priced with.
 */
export const RATES = {
  // Farm-gate price the farmer receives per tonne of baled straw.
  farmerPerTonne: 1800,
  // ParaliLink commission on straw + baling + transport.
  commissionPct: 5,
  tonnesPerAcre: 2.4,
  co2PerTonne: 1.46,

  // Used for the estimate before real machines and trucks are booked.
  estimates: {
    balingPerAcre: 1600, // cutting + raking + baling
    transportPerKm: 45,
  },

  clustering: {
    radiusKm: 5, // farms within this distance of the seed farm can join
    dateWindowDays: 3, // expected harvest dates within ± this many days of the seed farm
    minTonnes: 30, // below this a cluster is still "forming" and can't be bought
    maxTonnes: 120,
  },

  machines: {
    dryingDays: 1, // days between cutting and baling when separate machines do them
    searchRadiusKm: 60,
    horizonDays: 21, // how far ahead the scheduler looks for free days
  },

  trucks: {
    m3PerTonne: 7, // loose-packed square bales: about 7 m³ per tonne
    dispatchAtTonnes: 20, // send trucks once this much ready straw is waiting (or every farm is ready)
    preferIndustryFleet: 1, // 1 = use the industry's own vehicles first
    searchRadiusKm: 80,
    avgSpeedKmh: 28,
    loadMinutesPerStop: 40,
    unloadMinutes: 60,
  },

  // Straight-line distance × this ≈ road distance in rural Punjab (used when OSRM is unreachable).
  roadFactor: 1.3,
}

export const DEFAULT_RATES = structuredClone(RATES)

/** Fields the admin console may edit, with safe ranges. `path` is the key path inside RATES. */
export const RATE_FIELDS = [
  { path: 'farmerPerTonne', group: 'money', label: 'Farm-gate rate (baled)', unit: '₹ / t', min: 300, max: 6000, step: 50 },
  { path: 'commissionPct', group: 'money', label: 'ParaliLink commission', unit: '%', min: 0, max: 20, step: 0.5 },
  { path: 'estimates.balingPerAcre', group: 'money', label: 'Baling estimate', unit: '₹ / acre', min: 200, max: 6000, step: 50 },
  { path: 'estimates.transportPerKm', group: 'money', label: 'Transport estimate', unit: '₹ / km', min: 5, max: 200, step: 1 },
  { path: 'clustering.radiusKm', group: 'clustering', label: 'Cluster radius', unit: 'km', min: 1, max: 15, step: 0.5 },
  { path: 'clustering.dateWindowDays', group: 'clustering', label: 'Harvest date window', unit: '± days', min: 0, max: 10, step: 1 },
  { path: 'clustering.minTonnes', group: 'clustering', label: 'Ready at', unit: 't', min: 5, max: 200, step: 5 },
  { path: 'clustering.maxTonnes', group: 'clustering', label: 'Cluster cap', unit: 't', min: 20, max: 400, step: 5 },
  { path: 'machines.dryingDays', group: 'machines', label: 'Drying gap (cut → bale)', unit: 'days', min: 0, max: 5, step: 1 },
  { path: 'machines.searchRadiusKm', group: 'machines', label: 'Machine search radius', unit: 'km', min: 5, max: 200, step: 5 },
  { path: 'trucks.m3PerTonne', group: 'trucks', label: 'Bale volume', unit: 'm³ / t', min: 3, max: 15, step: 0.5 },
  { path: 'trucks.dispatchAtTonnes', group: 'trucks', label: 'Dispatch when ready', unit: 't', min: 1, max: 200, step: 1 },
  { path: 'trucks.preferIndustryFleet', group: 'trucks', label: 'Industry vehicles first', unit: '1 = yes, 0 = no', min: 0, max: 1, step: 1 },
  { path: 'trucks.searchRadiusKm', group: 'trucks', label: 'Vehicle search radius', unit: 'km', min: 5, max: 300, step: 5 },
  { path: 'co2PerTonne', group: 'impact', label: 'CO₂ avoided', unit: 't CO₂ / t straw', min: 0.5, max: 3, step: 0.01 },
]

const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj)
const setPath = (obj, path, value) => {
  const keys = path.split('.')
  const last = keys.pop()
  keys.reduce((o, k) => o[k], obj)[last] = value
}

/** Current values of the editable fields, as a flat { path: value } map. */
export function editableRates(source = RATES) {
  return Object.fromEntries(RATE_FIELDS.map((f) => [f.path, getPath(source, f.path)]))
}

/** Applies a flat { path: value } map onto RATES. Unknown keys are ignored. */
export function applyRateOverrides(values = {}) {
  for (const f of RATE_FIELDS) {
    const v = values[f.path]
    if (typeof v === 'number' && Number.isFinite(v)) setPath(RATES, f.path, v)
  }
}

/** Money rates copied onto an order, so later rate changes don't touch it. */
export function rateSnapshot() {
  return { farmerPerTonne: RATES.farmerPerTonne, commissionPct: RATES.commissionPct, estimates: { ...RATES.estimates } }
}

/** Estimated straw for a field, rounded to 0.1 t. */
export function estimateTonnes(acres) {
  return Math.round(acres * RATES.tonnesPerAcre * 10) / 10
}
