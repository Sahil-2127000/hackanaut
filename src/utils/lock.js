/**
 * In-process named locks. Work queued under the same name runs one at a time, so two
 * requests can never book the same farm, machine-day or vehicle-day at once.
 * (One API process is enough for the pilot; several instances would need a DB lock.)
 */
const chains = new Map()

export function withLock(name, task) {
  const prev = chains.get(name) ?? Promise.resolve()
  const run = prev.then(task, task)
  chains.set(
    name,
    run.catch(() => {}),
  )
  return run
}
