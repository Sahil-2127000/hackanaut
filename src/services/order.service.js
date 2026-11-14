import mongoose from 'mongoose'
import { RATES, rateSnapshot } from '../config/rates.js'
import { HttpError } from '../middleware/errors.js'
import { Cluster } from '../models/cluster.model.js'
import { Listing } from '../models/listing.model.js'
import { Order } from '../models/order.model.js'
import { nextSequence } from '../utils/counters.js'
import { toLatLng } from '../utils/geo.js'
import { withClusterLock } from './clustering.service.js'
import { scheduleOrder } from './machineScheduler.service.js'
import { notify } from './notification.service.js'
import { priceCluster } from './pricing.service.js'
import { provisionalPlan } from './vehicleAssignment.service.js'

/**
 * An industry buys a whole cluster:
 *  1. every farm is reserved atomically (only farms still "clustered" can be sold, so the
 *     same straw can never be in two orders),
 *  2. price snapshot with a provisional vehicle plan (nothing booked yet),
 *  3. simulated payment, farmers notified,
 *  4. trigger: automatic machine scheduling.
 */
export async function purchaseCluster(user, plant, clusterId) {
  if (!mongoose.isValidObjectId(clusterId)) throw new HttpError(404, 'Cluster not found.')

  const order = await withClusterLock(async () => {
    const cluster = await Cluster.findOne({ _id: clusterId })
    if (!cluster) throw new HttpError(404, 'This cluster was regrouped a moment ago. Please pick it again on the map.')
    if (cluster.status === 'ordered') {
      const existing = await Order.findById(cluster.order).select('buyer code')
      if (existing?.buyer?.equals(user._id)) {
        throw new HttpError(409, `You’ve already bought this cluster (${existing.code}).`, { orderId: existing._id.toString() })
      }
      throw new HttpError(409, 'Another industry has just bought this cluster.')
    }
    if (cluster.status !== 'ready') throw new HttpError(409, `This cluster is still forming (under ${RATES.clustering.minTonnes} t) and can’t be bought yet.`)

    // Reserve every farm atomically: only farms still "clustered" can be sold. No double allocation.
    const reserved = await Listing.updateMany({ _id: { $in: cluster.listings }, status: 'clustered' }, { $set: { status: 'sold' } })
    if (reserved.modifiedCount !== cluster.listings.length) {
      await Listing.updateMany({ _id: { $in: cluster.listings }, status: 'sold', order: { $exists: false } }, { $set: { status: 'clustered' } })
      throw new HttpError(409, 'A farm in this cluster just changed. Please refresh the map and try again.')
    }

    const center = toLatLng(cluster.center)
    const plan = await provisionalPlan({ tonnes: cluster.totalTonnes, center, plant: plant, day: cluster.harvestTo ?? new Date(), access: cluster.access, buyer: user, routeKm: cluster.routeKm })
    const rates = rateSnapshot()
    const price = priceCluster(
      { tonnes: cluster.totalTonnes, acres: cluster.totalAcres, routeKm: cluster.routeKm, center },
      plant,
      rates,
      plan.vehicles.length && !plan.shortTonnes ? plan.transportCost : undefined,
    )
    const now = new Date()
    const code = `ORD-${String(await nextSequence('order')).padStart(4, '0')}`
    const created = await Order.create({
      code,
      buyer: user._id,
      buyerCompany: user.buyer?.company,
      cluster: cluster._id,
      clusterCode: cluster.code,
      place: cluster.place,
      district: cluster.district,
      harvestWeek: cluster.harvestWeek,
      listings: cluster.listings,
      estTonnes: cluster.totalTonnes,
      totalAcres: cluster.totalAcres,
      farmCount: cluster.farmCount,
      plant: plant,
      deliveryBy: user.buyer?.deliveryBy,
      price: { ...price, trucksPlanned: plan.summary },
      rates,
      payment: { status: 'simulated', amount: price.total, reference: `SIM-${code}`, paidAt: now },
      statusHistory: [{ status: 'placed', at: now }],
    })

    cluster.status = 'ordered'
    cluster.order = created._id
    await cluster.save()
    await Listing.updateMany(
      { _id: { $in: cluster.listings } },
      { $set: { buyerName: user.buyer?.company, order: created._id }, $push: { statusHistory: { status: 'sold', at: now } } },
    )
    return created
  })

  const farmers = await Listing.find({ _id: { $in: order.listings } }).distinct('farmer')
  await notify(farmers, 'Your straw is sold', `${order.buyerCompany} bought cluster ${order.clusterCode}. Machines are being booked for your field.`, '/farmer/listings')
  // Trigger: purchase → automatic machine scheduling. The order stands even if this fails.
  const jobs = await scheduleOrder(order._id).catch((error) => {
    console.error('[scheduler] failed:', error)
    return []
  })
  return { order, jobs }
}

