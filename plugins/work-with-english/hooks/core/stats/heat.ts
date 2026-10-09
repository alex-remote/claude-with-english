import { dayText, trendEnd, trendStart } from '../copy/stats'
import { addDays, mondayOf } from '../time'
import { ownPct, sentOf, sumRange } from './aggregate'
import type { DayMap } from './aggregate'
import type { RangeKind } from './range'

// F13 › 两张图: 自己写的比例, a bar a week, to see progress; 每天的英文消息,
// a square a day, to see persistence. Both cover the last 12 weeks up to
// today, whichever range the page shows.

export const WEEKS = 12

export type TrendBar = {
  /** The week's Monday */
  from: string
  /** Its Sunday, or today for this week */
  to: string
  /** 自己写的 that week; null without an English message (no bar) */
  pct: number | null
  /** The week the page shows: this week for 本周, last week for 上周 */
  isShown: boolean
}

export type Trend = {
  /** Oldest first, this week last */
  bars: TrendBar[]
  /** Under the left end: 7月20日那周 27% */
  start: string
  /** Under the right end: 本周 76% */
  end: string
}

export function trend(days: DayMap, today: string, kind: RangeKind): Trend {
  const monday = mondayOf(today)
  const shownBack = kind === 'week' ? 0 : kind === 'last' ? 1 : -1
  const bars = Array.from({ length: WEEKS }, (_, i): TrendBar => {
    const back = WEEKS - 1 - i
    const from = addDays(monday, -7 * back)
    const to = back === 0 ? today : addDays(from, 6)
    return { from, to, pct: ownPct(sumRange(days, { from, to })), isShown: back === shownBack }
  })
  const [first] = bars
  const last = bars[WEEKS - 1]
  return {
    bars,
    start: trendStart(dayText(first?.from ?? monday), first?.pct ?? null),
    end: trendEnd(last?.pct ?? null),
  }
}

/** 0 is a day without an English message (white); 1 to 4 run light to dark */
export type HeatLevel = 0 | 1 | 2 | 3 | 4

export type HeatDay = { date: string; count: number; level: HeatLevel }

/**
 * The squares, a column a week and Monday on top: 12 columns, the last
 * one ending today, so it can hold fewer than 7.
 */
export function heatWeeks(days: DayMap, today: string): HeatDay[][] {
  const start = addDays(mondayOf(today), -7 * (WEEKS - 1))
  const dates: string[] = []
  for (let date = start; date <= today; date = addDays(date, 1)) {
    dates.push(date)
  }
  const counts = dates.map(date => sentOf(days[date]))
  const levelOf = heatScale(counts)
  const weeks: HeatDay[][] = []
  dates.forEach((date, i) => {
    const count = counts[i] ?? 0
    const week = (weeks[Math.floor(i / 7)] ??= [])
    week.push({ date, count, level: levelOf(count) })
  })
  return weeks
}

/**
 * The level of a day's count among the days with messages in `counts`,
 * split evenly into four by rank, as on GitHub's graph: whether someone
 * sends a few a day or dozens, the grid has depth. Days with the same count
 * take the middle of the ranks they share, so ties don't all fall to the
 * lightest or the darkest; when every day has the same count, all sit at 3.
 */
export function heatScale(counts: readonly number[]): (count: number) => HeatLevel {
  const busy = counts.filter(n => n > 0)
  return count => {
    if (count <= 0) {
      return 0
    }
    let below = 0
    let same = 0
    for (const n of busy) {
      if (n < count) {
        below += 1
      } else if (n === count) {
        same += 1
      }
    }
    // The rank's midpoint in quarters: 4 × (below + same / 2) / busy.length
    const quarter = busy.length > 0 ? Math.floor((4 * below + 2 * same) / busy.length) : 2
    return Math.min(4, 1 + quarter) as HeatLevel
  }
}
