import { dayText, rangeText } from '../copy/stats'
import { addDays, mondayOf } from '../time'

// F13 › 时间范围, and F14's seven days: which days a range covers. Days are
// written YYYY-MM-DD on this machine's calendar and compare as text; a week
// runs Monday to Sunday. Today comes in, so nothing here reads the clock.

/** The 统计 page's 本周, 上周 and 全部, and the share card's seven days up to today */
export type RangeKind = 'week' | 'last' | 'all' | '7d'

/** The first and the last day, both counted */
export type DayRange = { from: string; to: string }

/**
 * The days a range covers. 全部 starts on the first day anything was
 * counted (`firstDay`, from core/stats/aggregate) and is today alone before that.
 */
export function rangeOf(kind: RangeKind, today: string, firstDay: string | null = null): DayRange {
  const monday = mondayOf(today)
  switch (kind) {
    case 'week':
      return { from: monday, to: today }
    case 'last':
      return { from: addDays(monday, -7), to: addDays(monday, -1) }
    case '7d':
      return { from: addDays(today, -6), to: today }
    case 'all':
      return { from: firstDay !== null && firstDay < today ? firstDay : today, to: today }
  }
}

/**
 * The seven days before a range, which 自己写的 is compared with: last week
 * for 本周 (a whole week against the days of this one so far), the week
 * before for 上周, the seven days before for the card. 全部 has none.
 */
export function previousOf(kind: RangeKind, today: string): DayRange | null {
  if (kind === 'all') {
    return null
  }
  const { from } = rangeOf(kind, today)
  return { from: addDays(from, -7), to: addDays(from, -1) }
}

/**
 * The line under the range buttons: 10月5日至今天, 9月28日至10月4日. A range
 * across New Year writes the year on both ends, as Chinese dates do.
 */
export function rangeLabel(range: DayRange, today: string): string {
  const withYear = range.from.slice(0, 4) !== range.to.slice(0, 4)
  const to = range.to === today ? null : dayText(range.to, withYear)
  return rangeText(dayText(range.from, withYear), to)
}
