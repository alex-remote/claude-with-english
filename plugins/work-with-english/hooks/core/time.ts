// Dates on this machine's calendar, written YYYY-MM-DD: the stats folders,
// the once-a-day tip, the week a report covers (F13: a week runs Monday to
// Sunday, by local time). The time and the UTC offset are always passed in,
// so the functions stay pure; the caller reads the offset from
// `date +%z` or Intl.

const DAY_MS = 86_400_000
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Minutes east of UTC from `date +%z` ("+0800" is 480, "-0530" is -330),
 * or null when the text is not an offset. A colon ("+08:00") is taken too.
 */
export function parseUtcOffset(text: string): number | null {
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(text.trim())
  if (!match) {
    return null
  }
  const [, sign, hours, minutes] = match
  const h = Number(hours)
  const m = Number(minutes)
  if (h > 14 || m > 59) {
    return null
  }
  return (sign === '-' ? -1 : 1) * (h * 60 + m)
}

/** The local date at `ms` (epoch milliseconds) for an offset in minutes east of UTC. */
export function localDate(ms: number, offsetMinutes: number): string {
  return fromDay(Math.floor((ms + offsetMinutes * 60_000) / DAY_MS))
}

/** Whether the text is a real date written YYYY-MM-DD (2026-02-30 is not). */
export function isLocalDate(text: string): boolean {
  return toDay(text) !== null
}

/** The date `days` after `date` (before it when negative). */
export function addDays(date: string, days: number): string {
  return fromDay(dayOf(date) + days)
}

/** How many days `to` is after `from`: negative when it is before. */
export function daysBetween(from: string, to: string): number {
  return dayOf(to) - dayOf(from)
}

/** The Monday of the week `date` is in. */
export function mondayOf(date: string): string {
  const day = dayOf(date)
  // Day 0, 1970-01-01, was a Thursday: 3 days after a Monday
  return fromDay(day - ((day + 3) % 7 + 7) % 7)
}

/** The days since 1970-01-01, or null when the text is not a real date. */
function toDay(text: string): number | null {
  const match = DATE_PATTERN.exec(text)
  if (!match) {
    return null
  }
  const [, y, m, d] = match.map(Number) as [number, number, number, number]
  const ms = Date.UTC(y, m - 1, d)
  const back = new Date(ms)
  // Date.UTC rolls 02-30 over into March; a real date comes back as written
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return null
  }
  return ms / DAY_MS
}

function dayOf(date: string): number {
  const day = toDay(date)
  if (day === null) {
    throw new RangeError(`not a date written YYYY-MM-DD: ${JSON.stringify(date)}`)
  }
  return day
}

function fromDay(day: number): string {
  const at = new Date(day * DAY_MS)
  const y = String(at.getUTCFullYear()).padStart(4, '0')
  const m = String(at.getUTCMonth() + 1).padStart(2, '0')
  const d = String(at.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
