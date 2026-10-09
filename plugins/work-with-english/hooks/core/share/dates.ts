import { SHARE_COPY } from '../copy/share'
import type { LangId } from '../copy/lang'

// The card is dated with the first and last of its seven days and the year,
// never "today" or "this week": a post is read days after it went out, and
// the reader takes those words for the day they read it (F14). Dates come in
// as this machine's calendar writes them, YYYY-MM-DD (core/time.ts).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

type Ymd = { y: number; m: number; d: number }

function ymdOf(date: string): Ymd {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) {
    throw new RangeError(`not a date written YYYY-MM-DD: ${JSON.stringify(date)}`)
  }
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

/**
 * The first and last day: "Sep 30 – Oct 6, 2026"; a month both ends share is
 * written once in English, "Oct 1 – 7, 2026". Chinese keeps the month on
 * both ends, "2026.10.1 – 10.7", since "10.1 – 7" reads as a decimal. Across
 * a year both ends carry theirs.
 */
export function dateRange(from: string, to: string, lang: LangId): string {
  const a = ymdOf(from)
  const b = ymdOf(to)
  const sameYear = a.y === b.y
  if (lang === 'zh') {
    const dot = (x: Ymd) => `${x.m}.${x.d}`
    return sameYear ? `${a.y}.${dot(a)} – ${dot(b)}` : `${a.y}.${dot(a)} – ${b.y}.${dot(b)}`
  }
  const day = (x: Ymd) => `${MONTHS[x.m - 1] ?? ''} ${x.d}`
  if (sameYear && a.m === b.m) {
    return `${day(a)} – ${b.d}, ${b.y}`
  }
  return sameYear ? `${day(a)} – ${day(b)}, ${b.y}` : `${day(a)}, ${a.y} – ${day(b)}, ${b.y}`
}

/** The card's date line: "Sep 30 – Oct 6, 2026 (past week)", "2026.9.30 – 10.6（最近一周）" */
export const pastWeekDate = (from: string, to: string, lang: LangId) =>
  SHARE_COPY[lang].pastWeek(dateRange(from, to, lang))
