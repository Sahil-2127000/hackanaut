export const DAY = 86_400_000

/** Midnight (server local time) of the given date. */
export function startOfDay(d = new Date()) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export const addDays = (d, n) => new Date(startOfDay(d).getTime() + n * DAY)

/** "2026-11-18" in server local time; used as a map key. */
export function dayKey(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

/** "08:30" + date → Date. */
export function atTime(day, hhmm = '08:00') {
  const [h, m] = hhmm.split(':').map(Number)
  const x = startOfDay(day)
  x.setHours(h, m, 0, 0)
  return x
}
