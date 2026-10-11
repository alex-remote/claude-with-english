import { summarize } from '../stats/aggregate'
import type { DayMap } from '../stats/aggregate'
import { heatWeeks } from '../stats/heat'
import type { CardStats } from './card'

// F14 › 统计是最近 7 天，格子图到分享当天: the card's numbers whichever range
// the 统计 page shows. The seven days up to today, 自己写的 against the seven
// before, new words without sentences, the streak up to today, and the
// grid of the last 12 weeks up to today.

/** The card for the seven days up to `today`; null when they have no English message (the button can't be pressed) */
export function cardStatsOf(days: DayMap, today: string): CardStats | null {
  const week = summarize(days, '7d', today)
  if (week.totals.sent === 0 || week.ownPct === null) {
    return null
  }
  return {
    from: week.range.from,
    to: week.range.to,
    sent: week.totals.sent,
    ownPct: week.ownPct,
    delta: week.delta,
    words: week.totals.words,
    newWords: week.totals.newWords,
    streak: week.streak,
    heat: heatWeeks(days, today).flatMap(column => column.map(day => day.level)),
  }
}
