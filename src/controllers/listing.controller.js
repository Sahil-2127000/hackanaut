import mongoose from 'mongoose'
import { estimateTonnes, RATES } from '../config/rates.js'
import { HttpError } from '../middleware/errors.js'
import { ACTIVE, CANCELLABLE, Listing, listingLabel, nextListingNumber } from '../models/listing.model.js'
import { scheduleRebuild, withClusterLock } from '../services/clustering.service.js'
import { farmerListingView } from '../services/views.service.js'
import { isoWeekKey } from '../utils/isoWeek.js'

const MAX_ACTIVE = 5
const DAY = 86_400_000

async function findOwnListing(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Farm not found.')
  const listing = await Listing.findOne({ _id: req.params.id, farmer: req.user._id })
  if (!listing) throw new HttpError(404, 'Farm not found.')
  return listing
}

/**
 * Farm registration for one harvest. Everything after this (clustering, machines,
 * trucks, payment) is arranged by the platform.
 */
export async function createListing(req, res) {
  const { harvestDate, lat, lng, acres, estTonnes, ...rest } = req.body
  const now = Date.now()
  if (harvestDate.getTime() < now - 7 * DAY || harvestDate.getTime() > now + 60 * DAY) {
    throw new HttpError(400, 'Please check the highlighted fields.', {
      fields: { harvestDate: 'Choose a harvest date within the last week or the next 60 days.' },
    })
  }
  const activeCount = await Listing.countDocuments({ farmer: req.user._id, status: { $in: ACTIVE } })
  if (activeCount >= MAX_ACTIVE) {
    throw new HttpError(409, `You already have ${MAX_ACTIVE} active farms registered. Wait for one to be collected first.`)
  }

  const listing = await Listing.create({
    ...rest,
    number: await nextListingNumber(),
    farmer: req.user._id,
    location: { type: 'Point', coordinates: [lng, lat] },
    acres,
    estTonnes: estTonnes ?? estimateTonnes(acres),
    harvestDate,
    harvestWeek: isoWeekKey(harvestDate),
    statusHistory: [{ status: 'listed' }],
  })
  scheduleRebuild()
  res.status(201).json({ data: { listing: await farmerListingView(listing) } })
}

export async function getMyListings(req, res) {
  const listings = await Listing.find({ farmer: req.user._id }).sort({ createdAt: -1 }).limit(50)
  res.json({ data: { listings: await Promise.all(listings.map((l) => farmerListingView(l))) } })
}

/** Numbers for the farmer home and money screens. */
export async function getSummary(req, res) {
  const listings = await Listing.find({ farmer: req.user._id })
  const paid = listings.filter((l) => l.status === 'paid')
  const collected = listings.filter((l) => ['picked_up', 'delivered', 'paid'].includes(l.status))
  const active = listings.filter((l) => ACTIVE.includes(l.status)).sort((a, b) => a.harvestDate - b.harvestDate)
  const earned = paid.reduce((sum, l) => sum + (l.payout?.amount ?? 0), 0)
  const tonnesSaved = collected.reduce((sum, l) => sum + (l.verifiedTonnes ?? l.estTonnes), 0)
  const upcoming = active
    .filter((l) => !['listed', 'clustered'].includes(l.status))
    .reduce((sum, l) => sum + (l.verifiedTonnes ?? l.readyTonnes ?? l.estTonnes) * RATES.farmerPerTonne, 0)

  res.json({
    data: {
      farmerRate: RATES.farmerPerTonne,
      earned,
      upcoming: Math.round(upcoming),
      tonnesSaved: Math.round(tonnesSaved * 10) / 10,
      co2Avoided: Math.round(tonnesSaved * RATES.co2PerTonne * 10) / 10,
      activeCount: active.length,
      focus: active[0] ? await farmerListingView(active[0], { detail: true }) : null,
      payments: paid
        .sort((a, b) => b.payout.paidAt - a.payout.paidAt)
        .map((l) => ({ id: l._id.toString(), label: listingLabel(l), fieldName: l.fieldName ?? null, tonnes: l.verifiedTonnes, amount: l.payout.amount, reference: l.payout.reference, paidAt: l.payout.paidAt })),
    },
  })
}

export async function getListing(req, res) {
  const listing = await findOwnListing(req)
  res.json({ data: { listing: await farmerListingView(listing, { detail: true }) } })
}

export async function cancelListing(req, res) {
  const listing = await withClusterLock(async () => {
    const own = await findOwnListing(req)
    if (!CANCELLABLE.includes(own.status)) {
      throw new HttpError(409, 'An industry has already bought this straw, so it can’t be cancelled here. Call ParaliLink for help.')
    }
    own.status = 'cancelled'
    own.clusterRef = undefined
    own.cluster = undefined
    own.statusHistory.push({ status: 'cancelled' })
    await own.save()
    return own
  })
  scheduleRebuild()
  res.json({ data: { listing: await farmerListingView(listing) } })
}
