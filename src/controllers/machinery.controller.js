import mongoose from 'mongoose'
import { HttpError } from '../middleware/errors.js'
import { Machine } from '../models/machine.model.js'
import { LIVE_JOB, MachineJob } from '../models/machineJob.model.js'
import { Order } from '../models/order.model.js'
import { jobView } from '../services/views.service.js'
import { advanceJob, ownJob, reportJobException } from '../services/workflow.service.js'

/** Machinery owner portal (role "baler"): machines, auto-assigned jobs, status updates, earnings. */

const round1 = (n) => Math.round(n * 10) / 10
const checkId = (id) => {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Not found.')
}

function machineFields(body) {
  const { lat, lng, ...rest } = body
  return { ...rest, ...(lat != null && lng != null ? { base: { type: 'Point', coordinates: [lng, lat] } } : {}) }
}

export async function listMachines(req, res) {
  const machines = await Machine.find({ owner: req.user._id }).sort({ createdAt: 1 })
  const live = await MachineJob.aggregate([
    { $match: { owner: req.user._id, status: { $in: LIVE_JOB } } },
    { $group: { _id: '$machine', jobs: { $sum: 1 }, acres: { $sum: '$acres' } } },
  ])
  const byMachine = new Map(live.map((x) => [String(x._id), x]))
  res.json({
    data: {
      machines: machines.map((m) => ({ ...m.toView(), liveJobs: byMachine.get(String(m._id))?.jobs ?? 0, bookedAcres: round1(byMachine.get(String(m._id))?.acres ?? 0) })),
    },
  })
}

export async function createMachine(req, res) {
  const machine = await Machine.create({ ...machineFields(req.body), owner: req.user._id })
  res.status(201).json({ data: { machine: machine.toView() } })
}

export async function updateMachine(req, res) {
  checkId(req.params.id)
  const machine = await Machine.findOne({ _id: req.params.id, owner: req.user._id })
  if (!machine) throw new HttpError(404, 'Machine not found.')
  Object.assign(machine, machineFields(req.body))
  await machine.save()
  res.json({ data: { machine: machine.toView() } })
}

export async function listJobs(req, res) {
  const scope = req.query.scope === 'done' ? 'done' : 'active'
  const filter = { owner: req.user._id, status: scope === 'done' ? { $in: ['completed', 'exception', 'cancelled'] } : { $in: LIVE_JOB } }
  const jobs = await MachineJob.find(filter).sort(scope === 'done' ? { updatedAt: -1 } : { start: 1, sequence: 1 }).limit(100).lean()
  const counts = await MachineJob.aggregate([{ $match: { owner: req.user._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }])
  res.json({ data: { scope, jobs: jobs.map((j) => jobView(j)), counts: Object.fromEntries(counts.map((c) => [c._id, c.n])) } })
}

export async function getJob(req, res) {
  checkId(req.params.id)
  const job = await ownJob(req.params.id, req.user)
  res.json({ data: { job: jobView(job) } })
}

export async function advance(req, res) {
  checkId(req.params.id)
  const job = await ownJob(req.params.id, req.user)
  const updated = await advanceJob(job, req.body ?? {})
  res.json({ data: { job: jobView(updated) } })
}

export async function reportException(req, res) {
  checkId(req.params.id)
  const job = await ownJob(req.params.id, req.user)
  const { reassigned } = await reportJobException(job, req.body.reason)
  res.json({ data: { job: jobView(await MachineJob.findById(job._id)), reassigned } })
}

export async function getEarnings(req, res) {
  const jobs = await MachineJob.find({ owner: req.user._id, status: { $in: [...LIVE_JOB, 'completed'] } }).sort({ start: -1 }).lean()
  const settledOrders = new Set((await Order.find({ _id: { $in: jobs.map((j) => j.order) }, status: 'settled' }).distinct('_id')).map(String))
  const done = jobs.filter((j) => j.status === 'completed')
  const paid = done.filter((j) => settledOrders.has(String(j.order)))
  res.json({
    data: {
      settled: paid.reduce((s, j) => s + j.cost, 0),
      awaitingSettlement: done.filter((j) => !settledOrders.has(String(j.order))).reduce((s, j) => s + j.cost, 0),
      upcoming: jobs.filter((j) => j.status !== 'completed').reduce((s, j) => s + j.cost, 0),
      acresDone: round1(done.reduce((s, j) => s + j.acres, 0)),
      jobs: jobs.map((j) => ({ ...jobView(j, { withFarmer: false }), settled: settledOrders.has(String(j.order)) })),
    },
  })
}
