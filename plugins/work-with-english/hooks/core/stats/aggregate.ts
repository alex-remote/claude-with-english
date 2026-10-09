import { addDays } from '../time'
import { previousOf, rangeOf } from './range'
import type { DayRange, RangeKind } from './range'

// F13 › 怎么算: the numbers of a day, of a range, and what the 统计 page and
// F14's card show of them. Only numbers: no message text is ever kept.

/** What stats/<YYYY-MM-DD>/<sessionId>.json keeps: one session's numbers for one day */
export type StatsRow = {
  /** English messages whose text F2 put in (用译文) */
  used: number
  /** English messages written while the band had shown a translation (照着敲) */
  retyped: number
  /** English messages written without one (直接写) */
  direct: number
  /** Words of Claude's replies in English, code blocks left out (英文回复) */
  words: number
  /** Words and sentences added to the word book (单词本新增) */
  newWords: number
  newSents: number
}

/** stats/<YYYY-MM-DD>/day.json: the sessions of that day added up, and which they were */
export type DayFile = StatsRow & { merged: readonly string[] }

/** Each day's numbers, every session added in (`mergeDay`), by YYYY-MM-DD */
export type DayMap = Readonly<Record<string, StatsRow>>

/** A range added up, with its English messages counted */
export type StatsTotals = StatsRow & { sent: number }

/** The three ways in whole parts of a scale (100 for percents), adding up to it */
export type WaysSplit = { used: number; retyped: number; direct: number }

export const ZERO_ROW: StatsRow = { used: 0, retyped: 0, direct: 0, words: 0, newWords: 0, newSents: 0 }

const FIELDS = Object.keys(ZERO_ROW) as (keyof StatsRow)[]

/** A row with some numbers added: a session's file after one more message, or two days together */
export function addRows(row: StatsRow, more: Partial<StatsRow>): StatsRow {
  const sum = { ...ZERO_ROW }
  for (const key of FIELDS) {
    sum[key] = row[key] + (more[key] ?? 0)
  }
  return sum
}

/** English messages: every one was written one of the three ways */
export const sentOf = (row: StatsRow | undefined) => (row ? row.used + row.retyped + row.direct : 0)

/**
 * A session's file as read: null when it holds no object; a number that is
 * missing or not a count reads as 0.
 */
export function toRow(value: unknown): StatsRow | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const row = { ...ZERO_ROW }
  for (const key of FIELDS) {
    const n = (value as Record<string, unknown>)[key]
    if (typeof n === 'number' && Number.isInteger(n) && n > 0) {
      row[key] = n
    }
  }
  return row
}

/**
 * A day.json as read, or null without a list of what it merged. Merging
 * keeps the session files, so a day.json that can't be trusted is skipped
 * and the day added up from them again.
 */
export function toDayFile(value: unknown): DayFile | null {
  const row = toRow(value)
  const merged = row && (value as { merged?: unknown }).merged
  if (!row || !Array.isArray(merged) || !merged.every(id => typeof id === 'string')) {
    return null
  }
  return { ...row, merged: merged as string[] }
}

/**
 * One day: its day.json, plus the session files it hasn't merged (keyed by
 * session id); without a day.json, every session file added up. The result
 * is what the day reads as and, for a day before today, the next day.json.
 */
export function mergeDay(dayFile: DayFile | null, sessions: Readonly<Record<string, StatsRow>>): DayFile {
  const merged = [...(dayFile?.merged ?? [])]
  let row = dayFile ? addRows(ZERO_ROW, dayFile) : ZERO_ROW
  for (const [id, session] of Object.entries(sessions).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!merged.includes(id)) {
      row = addRows(row, session)
      merged.push(id)
    }
  }
  return { ...row, merged }
}

/** Whether a day has session files its day.json doesn't hold yet, so merging would write */
export const hasUnmerged = (dayFile: DayFile | null, sessions: Readonly<Record<string, StatsRow>>) =>
  Object.keys(sessions).some(id => !dayFile?.merged.includes(id))

/** The days of a range added up */
export function sumRange(days: DayMap, range: DayRange): StatsTotals {
  let row = ZERO_ROW
  for (const [date, day] of Object.entries(days)) {
    if (date >= range.from && date <= range.to) {
      row = addRows(row, day)
    }
  }
  return { ...row, sent: sentOf(row) }
}

/**
 * The three ways' shares of a scale, null without a message. 自己写的 is
 * rounded first and 用译文 is what it leaves; 直接写 is 自己写的 less 照着敲.
 * So the three add up to the scale, 照着敲 and 直接写 add up to 自己写的
 * as shown, and a way nobody used stays 0. A bar of N cells takes N as the scale.
 */
export function splitWays(row: StatsRow, scale = 100): WaysSplit | null {
  const sent = sentOf(row)
  if (sent === 0) {
    return null
  }
  const own = Math.round(((row.retyped + row.direct) / sent) * scale)
  const retyped = Math.round((row.retyped / sent) * scale)
  return { used: scale - own, retyped, direct: own - retyped }
}

/** 自己写的: 照着敲 and 直接写 as a whole percent of the English messages; null without one */
export function ownPct(row: StatsRow): number | null {
  const ways = splitWays(row)
  return ways && ways.retyped + ways.direct
}

/** The first day anything was counted, up to today: where 全部 starts */
export function firstDay(days: DayMap, today: string): string | null {
  let first: string | null = null
  for (const [date, day] of Object.entries(days)) {
    if (date <= today && (first === null || date < first) && FIELDS.some(key => day[key] > 0)) {
      first = date
    }
  }
  return first
}

/** Whether an English message was ever sent: without one the page says 还没有数据 */
export const hasMessages = (days: DayMap) => Object.values(days).some(day => sentOf(day) > 0)

/**
 * 连续使用: days in a row, up to `end`, with at least one English message.
 * When `end` is today and today has none yet, it counts up to yesterday.
 */
export function streak(days: DayMap, end: string, today: string): number {
  let day = end === today && sentOf(days[today]) === 0 ? addDays(end, -1) : end
  let n = 0
  while (sentOf(days[day]) > 0) {
    n += 1
    day = addDays(day, -1)
  }
  return n
}

/** Whether F14's button can be pressed: the card is always the last seven days */
export const canShare = (days: DayMap, today: string) => sumRange(days, rangeOf('7d', today)).sent > 0

export type StatsSummary = {
  /** noData: no English message ever; empty: none in this range */
  status: 'noData' | 'empty' | 'ok'
  range: DayRange
  totals: StatsTotals
  /** 自己写的, a whole percent; null without an English message */
  ownPct: number | null
  /** The three ways in percents, adding up to 100 */
  ways: WaysSplit | null
  /**
   * Points 自己写的 is above the week before (below when negative); null
   * for 全部, and when either week has no English message.
   */
  delta: number | null
  /** 连续使用 up to the range's last day */
  streak: number
}

/** Everything the 统计 page shows of a range (F14 takes `7d`) */
export function summarize(days: DayMap, kind: RangeKind, today: string): StatsSummary {
  const range = rangeOf(kind, today, firstDay(days, today))
  const totals = sumRange(days, range)
  const pct = ownPct(totals)
  const previous = previousOf(kind, today)
  const before = previous && ownPct(sumRange(days, previous))
  return {
    status: !hasMessages(days) ? 'noData' : totals.sent > 0 ? 'ok' : 'empty',
    range,
    totals,
    ownPct: pct,
    ways: splitWays(totals),
    delta: pct !== null && before !== null ? pct - before : null,
    streak: streak(days, range.to, today),
  }
}
