import { RATES } from '../config/rates.js'
import { Cluster } from '../models/cluster.model.js'
import { Listing } from '../models/listing.model.js'
import { nextSequence } from '../utils/counters.js'
import { centroid, haversineKm, orderStops, toLatLng } from '../utils/geo.js'
import { isoWeekKey } from '../utils/isoWeek.js'
import { withLock } from '../utils/lock.js'

/**
 * Serialises cluster work (rebuilds and purchases), so a rebuild can never reshuffle
 * farms while an industry is buying them.
 */
export function withClusterLock(task) {
  return withLock('clusters', task)
}

const MOISTURE_RANK = { dry: 0, normal: 1, wet: 2 }
const ACCESS_RANK = { tractor: 0, truck: 1, any: 2 }
const DAY = 86_400_000

/**
 * Rebuilds every open cluster from scratch (rule-based greedy clustering).
 *
 * 1. Clusters already bought by an industry are frozen and left alone.
 * 2. All other clusters are dissolved; their farms go back to "listed".
 * 3. Farms are only grouped with farms of the same straw quality.
 * 4. Seed = the farm with the most compatible neighbours (densest spot first). A MongoDB
 *    $nearSphere query (2dsphere index) then pulls in unassigned farms within `radiusKm`
 *    whose expected harvest date is within ± `dateWindowDays` of the seed, nearest first,
 *    until the cluster reaches `maxTonnes`.
 * 5. Clusters with at least `minTonnes` become "ready" (can be bought); smaller ones stay "forming".
 *
 * Each farm can be in only one cluster: a farm is marked as assigned the moment it joins,
 * and the whole rebuild runs under one lock.
 */
export async function rebuildClusters() {
  const { radiusKm, minTonnes, maxTonnes, dateWindowDays } = RATES.clustering
  const windowMs = dateWindowDays * DAY

  await Cluster.deleteMany({ status: { $in: ['forming', 'ready'] } })
  await Listing.updateMany({ status: { $in: ['listed', 'clustered'] } }, { $set: { status: 'listed' }, $unset: { clusterRef: 1, cluster: 1 } })

  const pending = await Listing.find({ status: 'listed' }).sort({ harvestDate: 1, createdAt: 1 }).lean()
  const assigned = new Set()
  const created = []
  const compatible = (a, b) =>
    a.quality === b.quality && Math.abs(a.harvestDate - b.harvestDate) <= windowMs && haversineKm(toLatLng(a.location), toLatLng(b.location)) <= radiusKm

  for (;;) {
    const open = pending.filter((l) => !assigned.has(String(l._id)))
    if (!open.length) break
    const neighbours = (l) => open.filter((o) => compatible(l, o)).length
    const seed = open.reduce((best, l) => (neighbours(l) > neighbours(best) ? l : best), open[0])

    const nearby = await Listing.find({
      status: 'listed',
      quality: seed.quality,
      harvestDate: { $gte: new Date(seed.harvestDate.getTime() - windowMs), $lte: new Date(seed.harvestDate.getTime() + windowMs) },
      _id: { $nin: [...assigned] },
      location: { $nearSphere: { $geometry: seed.location, $maxDistance: radiusKm * 1000 } },
    }).lean()

    const members = []
    let tonnes = 0
    for (const listing of nearby) {
      if (members.length && tonnes + listing.estTonnes > maxTonnes) continue
      members.push(listing)
      tonnes += listing.estTonnes
      assigned.add(String(listing._id))
    }
    if (!members.length) {
      assigned.add(String(seed._id))
      continue
    }

    const memberPoints = members.map((m) => toLatLng(m.location))
    const center = centroid(memberPoints)
    const { km } = orderStops(memberPoints, center)
    const ready = tonnes >= minTonnes
    const code = `PL-${String(await nextSequence('cluster')).padStart(3, '0')}`
    const dates = members.map((m) => m.harvestDate.getTime())

    const cluster = await Cluster.create({
      code,
      place: seed.village,
      district: seed.district,
      harvestWeek: isoWeekKey(seed.harvestDate),
      harvestFrom: new Date(Math.min(...dates)),
      harvestTo: new Date(Math.max(...dates)),
      quality: seed.quality,
      moisture: members.reduce((w, m) => (MOISTURE_RANK[m.moisture] > MOISTURE_RANK[w] ? m.moisture : w), 'dry'),
      access: members.reduce((w, m) => (ACCESS_RANK[m.access] < ACCESS_RANK[w] ? m.access : w), 'any'),
      center: { type: 'Point', coordinates: [center.lng, center.lat] },
      listings: members.map((m) => m._id),
      farmCount: members.length,
      totalAcres: Math.round(members.reduce((s, m) => s + m.acres, 0) * 10) / 10,
      totalTonnes: Math.round(tonnes * 10) / 10,
      routeKm: Math.round(km * 10) / 10,
      status: ready ? 'ready' : 'forming',
    })
    created.push(cluster)

    const ids = members.map((m) => m._id)
    const clusterInfo = { name: `${code} · ${seed.village}`, farmCount: members.length }
    if (ready) {
      await Listing.updateMany({ _id: { $in: ids } }, { $set: { status: 'clustered', clusterRef: cluster._id, cluster: clusterInfo } })
      await Listing.updateMany(
        { _id: { $in: ids }, 'statusHistory.status': { $ne: 'clustered' } },
        { $push: { statusHistory: { status: 'clustered', at: new Date() } } },
      )
    } else {
      await Listing.updateMany({ _id: { $in: ids } }, { $set: { clusterRef: cluster._id, cluster: clusterInfo } })
    }
  }

  return {
    clusters: created.length,
    ready: created.filter((c) => c.status === 'ready').length,
    forming: created.filter((c) => c.status === 'forming').length,
  }
}

/**
 * Rebuild after a listing change without slowing the request. Bursts of changes
 * collapse into one extra rebuild.
 */
let queued = false
export function scheduleRebuild() {
  if (queued) return
  queued = true
  setImmediate(() => {
    queued = false
    withClusterLock(rebuildClusters).catch((error) => console.error('[clustering] rebuild failed:', error))
  })
}
