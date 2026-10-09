import { describe, expect, test } from 'claude-code/testing'

import * as copy from '../../hooks/core/copy/stats'
import {
  ZERO_ROW,
  addRows,
  canShare,
  firstDay,
  hasUnmerged,
  mergeDay,
  ownPct,
  splitWays,
  streak,
  sumRange,
  summarize,
  toDayFile,
  toRow,
} from '../../hooks/core/stats/aggregate'
import type { DayMap, StatsRow } from '../../hooks/core/stats/aggregate'
import { WEEKS, heatScale, heatWeeks, trend } from '../../hooks/core/stats/heat'
import { previousOf, rangeLabel, rangeOf } from '../../hooks/core/stats/range'

const row = (used = 0, retyped = 0, direct = 0, more: Partial<StatsRow> = {}): StatsRow => ({
  ...ZERO_ROW,
  used,
  retyped,
  direct,
  ...more,
})

// Friday 2026-10-09, the day F13's frame was drawn: this week is 10月5日至今天,
// and the first of the last 12 weeks is 7月20日那周.
const TODAY = '2026-10-09'

// The frame's numbers: this week 25 messages (6 用译文, 9 照着敲, 10 直接写),
// 2,673 words, 1 word and 1 sentence, 76% against last week's 68%; 18 days in
// a row up to today; the first week of the 12 at 27%.
const DAYS: DayMap = {
  '2026-07-20': row(8, 2, 1),
  '2026-09-22': row(1),
  '2026-09-23': row(1),
  '2026-09-24': row(1),
  '2026-09-25': row(1),
  '2026-09-26': row(1),
  '2026-09-27': row(1),
  '2026-09-28': row(2, 2, 1),
  '2026-09-29': row(1, 2, 1),
  '2026-09-30': row(1, 1, 1),
  '2026-10-01': row(1, 1, 1),
  '2026-10-02': row(1, 1, 1),
  '2026-10-03': row(1, 1, 2),
  '2026-10-04': row(1, 1, 1),
  '2026-10-05': row(2, 2, 1, { words: 500 }),
  '2026-10-06': row(1, 2, 2, { words: 600 }),
  '2026-10-07': row(1, 2, 2, { words: 573, newWords: 1 }),
  '2026-10-08': row(1, 2, 2, { words: 500, newSents: 1 }),
  '2026-10-09': row(1, 1, 3, { words: 500 }),
}

describe('ranges (F13 › 时间范围)', () => {
  test('本周 runs Monday to today, 上周 Monday to Sunday', () => {
    expect(rangeOf('week', TODAY)).toEqual({ from: '2026-10-05', to: '2026-10-09' })
    expect(rangeOf('last', TODAY)).toEqual({ from: '2026-09-28', to: '2026-10-04' })
  })

  test('on a Monday 本周 is today alone, and on a Sunday the whole week', () => {
    expect(rangeOf('week', '2026-10-05')).toEqual({ from: '2026-10-05', to: '2026-10-05' })
    expect(rangeOf('week', '2026-10-11')).toEqual({ from: '2026-10-05', to: '2026-10-11' })
  })

  test('全部 starts on the first day counted, and is today alone before any', () => {
    expect(rangeOf('all', TODAY, '2026-07-20')).toEqual({ from: '2026-07-20', to: TODAY })
    expect(rangeOf('all', TODAY)).toEqual({ from: TODAY, to: TODAY })
  })

  test('the share card takes the seven days up to today, against the seven before (F14)', () => {
    expect(rangeOf('7d', TODAY)).toEqual({ from: '2026-10-03', to: '2026-10-09' })
    expect(previousOf('7d', TODAY)).toEqual({ from: '2026-09-26', to: '2026-10-02' })
  })

  test('本周 is compared with last week, 上周 with the week before, 全部 with nothing', () => {
    expect(previousOf('week', TODAY)).toEqual({ from: '2026-09-28', to: '2026-10-04' })
    expect(previousOf('last', TODAY)).toEqual({ from: '2026-09-21', to: '2026-09-27' })
    expect(previousOf('all', TODAY)).toBeNull()
  })

  test('本周 is written 10月5日至今天, 上周 9月28日至10月4日', () => {
    expect(rangeLabel(rangeOf('week', TODAY), TODAY)).toBe('10月5日至今天')
    expect(rangeLabel(rangeOf('last', TODAY), TODAY)).toBe('9月28日至10月4日')
    expect(rangeLabel(rangeOf('all', TODAY, '2026-07-20'), TODAY)).toBe('7月20日至今天')
  })

  test('a range across New Year writes the year on both ends', () => {
    expect(rangeLabel(rangeOf('week', '2026-01-02'), '2026-01-02')).toBe('2025年12月29日至今天')
    expect(rangeLabel(rangeOf('last', '2026-01-06'), '2026-01-06')).toBe('2025年12月29日至2026年1月4日')
    expect(rangeLabel(rangeOf('last', '2026-01-02'), '2026-01-02')).toBe('12月22日至12月28日')
  })
})

describe('reading a day (stats/<YYYY-MM-DD>/)', () => {
  test('without day.json, every session file of the day is added up', () => {
    const day = mergeDay(null, { b: row(0, 1, 0, { words: 10 }), a: row(1) })
    expect(day).toEqual({ ...row(1, 1, 0, { words: 10 }), merged: ['a', 'b'] })
  })

  test('with day.json, only the session files it has not merged are added', () => {
    const dayFile = { ...row(3), merged: ['a'] }
    const sessions = { a: row(3), b: row(0, 0, 2) }
    expect(mergeDay(dayFile, sessions)).toEqual({ ...row(3, 0, 2), merged: ['a', 'b'] })
    expect(hasUnmerged(dayFile, sessions)).toBe(true)
    expect(hasUnmerged({ ...row(3, 0, 2), merged: ['a', 'b'] }, sessions)).toBe(false)
  })

  test('a session open across midnight: yesterday, never merged, still counts in 本周', () => {
    const yesterday = mergeDay(null, { s1: row(0, 0, 4) })
    const days: DayMap = { '2026-10-08': yesterday, '2026-10-09': mergeDay(null, { s1: row(0, 0, 1) }) }
    expect(summarize(days, 'week', TODAY).totals.sent).toBe(5)
  })

  test('a day.json without its merged list is skipped, so the day is added up again', () => {
    expect(toDayFile({ used: 2 })).toBeNull()
    expect(toDayFile({ used: 2, merged: [1] })).toBeNull()
    expect(toDayFile({ used: 2, merged: ['a'] })).toEqual({ ...row(2), merged: ['a'] })
  })

  test('a file read as anything but an object is no row; a number that is not a count reads as 0', () => {
    expect(toRow(null)).toBeNull()
    expect(toRow([1, 2])).toBeNull()
    expect(toRow('x')).toBeNull()
    expect(toRow({ used: 2, retyped: -1, direct: 'x', words: Number.NaN, newWords: 1.5 })).toEqual(row(2))
  })

  test('a message adds one to its way', () => {
    expect(addRows(row(1, 2, 3), { direct: 1 })).toEqual(row(1, 2, 4))
  })
})

describe('the numbers (F13 › 怎么算)', () => {
  test('the frame: 25 条, 76%, 比上周高 8 个百分点, 2,673 词, 1 个词 1 个句子, 18 天', () => {
    const week = summarize(DAYS, 'week', TODAY)
    expect(week.status).toBe('ok')
    expect(week.totals).toEqual({ ...row(6, 9, 10, { words: 2673, newWords: 1, newSents: 1 }), sent: 25 })
    expect(week.ownPct).toBe(76)
    expect(week.ways).toEqual({ used: 24, retyped: 36, direct: 40 })
    expect(week.delta).toBe(8)
    expect(week.streak).toBe(18)

    expect(copy.sentValue(week.totals.sent)).toBe('25 条')
    expect(copy.ownValue(76)).toBe('76%')
    expect(copy.delta(8, 'week')).toBe('比上周高 8 个百分点')
    expect([copy.wayValue('used', 24), copy.wayValue('retyped', 36), copy.wayValue('direct', 40)]).toEqual([
      '用译文 24%',
      '照着敲 36%',
      '直接写 40%',
    ])
    expect(copy.wordsValue(week.totals.words)).toBe('2,673 词')
    expect(copy.bookValue(week.totals.newWords, week.totals.newSents)).toBe('1 个词 1 个句子')
    expect(copy.streakValue(week.streak, 'week')).toBe('18 天')
  })

  test('自己写的 is 照着敲 and 直接写 over the English messages', () => {
    expect(ownPct(row(6, 9, 10))).toBe(76)
    expect(ownPct(row(8, 2, 1))).toBe(27)
    expect(ownPct(ZERO_ROW)).toBeNull()
  })

  test('the three ways add up to 100, and 照着敲 with 直接写 to 自己写的', () => {
    expect(splitWays(row(1, 1, 1))).toEqual({ used: 33, retyped: 33, direct: 34 })
    expect(splitWays(row(0, 3, 0))).toEqual({ used: 0, retyped: 100, direct: 0 })
    expect(splitWays(ZERO_ROW)).toBeNull()
    // Every mix of up to 12 messages a way: the sums hold, nothing is negative, and a way nobody used shows 0%
    const broken: string[] = []
    for (let used = 0; used <= 12; used++) {
      for (let retyped = 0; retyped <= 12; retyped++) {
        for (let direct = 0; direct <= 12; direct++) {
          const r = row(used, retyped, direct)
          const ways = splitWays(r)
          const holds =
            ways === null
              ? used + retyped + direct === 0
              : ways.used + ways.retyped + ways.direct === 100 &&
                ways.retyped + ways.direct === ownPct(r) &&
                [ways.used, ways.retyped, ways.direct].every(p => p >= 0) &&
                (used > 0 || ways.used === 0) &&
                (retyped > 0 || ways.retyped === 0) &&
                (direct > 0 || ways.direct === 0)
          if (!holds) {
            broken.push(`${used}/${retyped}/${direct}`)
          }
        }
      }
    }
    expect(broken).toEqual([])
  })

  test('a bar of N cells splits the same way, adding up to N', () => {
    expect(splitWays(row(6, 9, 10), 22)).toEqual({ used: 5, retyped: 8, direct: 9 })
  })

  test('上周: compared with the week before, and its streak up to last Sunday', () => {
    const last = summarize(DAYS, 'last', TODAY)
    expect(last.ownPct).toBe(68)
    expect(last.delta).toBe(68)
    expect(copy.delta(68, 'last')).toBe('比前一周高 68 个百分点')
    expect(last.streak).toBe(13)
    expect(copy.streakValue(13, 'last')).toBe('13 天（截至上周日）')
  })

  test('lower, or the same: 比上周低 N 个百分点, 和上周一样 (和前一周一样 for 上周)', () => {
    expect(copy.delta(-3, 'week')).toBe('比上周低 3 个百分点')
    expect(copy.delta(0, 'week')).toBe('和上周一样')
    expect(copy.delta(0, 'last')).toBe('和前一周一样')
    const same: DayMap = { '2026-10-01': row(1, 1), '2026-10-06': row(2, 2) }
    expect(summarize(same, 'week', TODAY).delta).toBe(0)
    const lower: DayMap = { '2026-10-01': row(0, 1), '2026-10-06': row(1, 1) }
    expect(summarize(lower, 'week', TODAY).delta).toBe(-50)
  })

  test('全部 is never compared; nor is a week whose week before had no English message', () => {
    expect(summarize(DAYS, 'all', TODAY).delta).toBeNull()
    const onlyThisWeek: DayMap = { '2026-10-06': row(1, 1), '2026-10-01': row(0, 0, 0, { words: 80 }) }
    const week = summarize(onlyThisWeek, 'week', TODAY)
    expect(week.ownPct).toBe(50)
    expect(week.delta).toBeNull()
  })

  test('the card: the seven days up to today, against the seven before (F14)', () => {
    const card = summarize(DAYS, '7d', TODAY)
    expect(card.totals.sent).toBe(32)
    expect(card.ownPct).toBe(75)
    expect(card.delta).toBe(15)
    expect(copy.delta(15, '7d')).toBe('比前一周高 15 个百分点')
    expect(card.streak).toBe(18)
  })

  test('全部 adds up every day from the first one counted', () => {
    const all = summarize(DAYS, 'all', TODAY)
    expect(all.range).toEqual({ from: '2026-07-20', to: TODAY })
    expect(all.totals.sent).toBe(11 + 6 + 25 + 25)
    expect(rangeLabel(all.range, TODAY)).toBe('7月20日至今天')
    const withReplies = { ...DAYS, '2026-07-01': row(0, 0, 0, { words: 50 }) }
    expect(firstDay(withReplies, TODAY)).toBe('2026-07-01')
    expect(summarize(withReplies, 'all', TODAY).totals.words).toBe(2673 + 50)
  })

  test('单词本新增 adds up words and sentences in the range', () => {
    expect(sumRange(DAYS, rangeOf('week', TODAY))).toMatchObject({ newWords: 1, newSents: 1 })
    expect(sumRange(DAYS, rangeOf('last', TODAY))).toMatchObject({ newWords: 0, newSents: 0 })
  })
})

describe('连续使用', () => {
  test('days in a row with an English message, up to today', () => {
    expect(streak(DAYS, TODAY, TODAY)).toBe(18)
  })

  test('today without one yet counts up to yesterday', () => {
    expect(streak(DAYS, '2026-10-10', '2026-10-10')).toBe(18)
    expect(summarize(DAYS, 'week', '2026-10-10').streak).toBe(18)
  })

  test('a day missed before today ends it', () => {
    expect(streak(DAYS, '2026-10-11', '2026-10-11')).toBe(0)
  })

  test('a day with replies but no English message does not count', () => {
    const days: DayMap = { '2026-10-08': row(0, 0, 0, { words: 300 }), '2026-10-09': row(1) }
    expect(streak(days, TODAY, TODAY)).toBe(1)
  })
})

describe('没有数据时', () => {
  test('no English message ever: 还没有数据, even with replies counted', () => {
    expect(summarize({}, 'week', TODAY).status).toBe('noData')
    expect(summarize({ [TODAY]: row(0, 0, 0, { words: 120 }) }, 'all', TODAY).status).toBe('noData')
    expect(copy.noData()).toBe('还没有数据。发出第一条英文消息后开始统计。')
  })

  test('none in the range on show: 这段时间没有发出英文消息', () => {
    const days: DayMap = { '2026-07-20': row(1) }
    const week = summarize(days, 'week', TODAY)
    expect(week.status).toBe('empty')
    expect(week.ownPct).toBeNull()
    expect(week.ways).toBeNull()
    expect(week.delta).toBeNull()
    expect(copy.noMessagesInRange()).toBe('这段时间没有发出英文消息。')
  })

  test('生成分享卡 can be pressed only with an English message in the last seven days', () => {
    expect(canShare(DAYS, TODAY)).toBe(true)
    expect(canShare({ '2026-10-02': row(1) }, TODAY)).toBe(false)
    expect(canShare({ '2026-10-03': row(1) }, TODAY)).toBe(true)
  })
})

describe('自己写的比例（最近 12 周）', () => {
  test('a bar a week, oldest first, this week to today', () => {
    const { bars } = trend(DAYS, TODAY, 'week')
    expect(bars).toHaveLength(WEEKS)
    expect(bars[0]).toMatchObject({ from: '2026-07-20', to: '2026-07-26', pct: 27 })
    expect(bars.slice(1, 9).map(bar => bar.pct)).toEqual([null, null, null, null, null, null, null, null])
    expect(bars.slice(9).map(bar => bar.pct)).toEqual([0, 68, 76])
    expect(bars[11]).toMatchObject({ from: '2026-10-05', to: TODAY })
  })

  test('both ends say their week: 7月20日那周 27%, 本周 76%', () => {
    const { start, end } = trend(DAYS, TODAY, 'week')
    expect(start).toBe('7月20日那周 27%')
    expect(end).toBe('本周 76%')
    expect(trend({}, TODAY, 'week')).toMatchObject({ start: '7月20日那周', end: '本周' })
  })

  test('the week on show stands out: this week for 本周, last week for 上周, none for 全部', () => {
    const shown = (kind: 'week' | 'last' | 'all') =>
      trend(DAYS, TODAY, kind).bars.flatMap((bar, i) => (bar.isShown ? [i] : []))
    expect(shown('week')).toEqual([11])
    expect(shown('last')).toEqual([10])
    expect(shown('all')).toEqual([])
  })
})

describe('每天的英文消息（最近 12 周）', () => {
  test('a column a week, Monday on top, the last column only up to today', () => {
    const weeks = heatWeeks(DAYS, TODAY)
    expect(weeks).toHaveLength(WEEKS)
    expect(weeks.slice(0, 11).every(week => week.length === 7)).toBe(true)
    expect(weeks[11]?.map(day => day.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', TODAY])
    expect(weeks[0]?.[0]).toMatchObject({ date: '2026-07-20', count: 11 })
    expect(weeks[0]?.[6]?.date).toBe('2026-07-26')
  })

  test('a day without use is level 0 (white); a day with messages 1 to 4', () => {
    const weeks = heatWeeks(DAYS, TODAY)
    expect(weeks[0]?.[1]).toMatchObject({ date: '2026-07-21', count: 0, level: 0 })
    const used = weeks.flat().filter(day => day.count > 0)
    expect(used.every(day => day.level >= 1 && day.level <= 4)).toBe(true)
    expect(used.find(day => day.count === 1)?.level).toBe(1)
    expect(used.find(day => day.count === 11)?.level).toBe(4)
  })

  test('the days with messages split evenly into four, more is darker', () => {
    const levelOf = heatScale([1, 2, 3, 4, 5, 6, 7, 8])
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(levelOf)).toEqual([1, 1, 2, 2, 3, 3, 4, 4])
    const four = heatScale([40, 3, 0, 12, 7])
    expect([3, 7, 12, 40, 0].map(four)).toEqual([1, 2, 3, 4, 0])
  })

  test('a few messages a day or dozens, the grid has the same depth', () => {
    const few = heatScale([1, 2, 3, 4])
    const many = heatScale([20, 40, 60, 80])
    expect([1, 2, 3, 4].map(few)).toEqual([20, 40, 60, 80].map(many))
  })

  test('every day with the same count: all in the middle, level 3', () => {
    const levelOf = heatScale([5, 5, 5, 5, 0, 0])
    expect([5, 0].map(levelOf)).toEqual([3, 0])
    expect(heatScale([3])(3)).toBe(3)
    const days: DayMap = { '2026-10-05': row(5), '2026-10-07': row(5), [TODAY]: row(5) }
    const levels = heatWeeks(days, TODAY)[11]?.map(day => day.level)
    expect(levels).toEqual([3, 0, 3, 0, 3])
  })

  test('days that tie share a level, from the middle of their ranks', () => {
    const levelOf = heatScale([1, 1, 1, 1, 5])
    expect([1, 5].map(levelOf)).toEqual([2, 4])
  })
})

describe('the 统计 page’s words', () => {
  test('the range buttons, the rows and the charts', () => {
    expect([copy.rangeTab('week'), copy.rangeTab('last'), copy.rangeTab('all')]).toEqual(['本周', '上周', '全部'])
    expect([copy.sentName(), copy.ownName(), copy.wordsName(), copy.bookName(), copy.streakName()]).toEqual([
      '英文消息',
      '自己写的',
      '英文回复',
      '单词本新增',
      '连续使用',
    ])
    expect([copy.wayName('used'), copy.wayName('retyped'), copy.wayName('direct')]).toEqual(['用译文', '照着敲', '直接写'])
    expect(copy.trendTitle()).toBe('自己写的比例（最近 12 周）')
    expect(copy.heatTitle()).toBe('每天的英文消息（最近 12 周）')
    expect([copy.heatLess(), copy.heatMore()]).toEqual(['少', '多'])
    expect(copy.shareButton()).toBe('生成分享卡')
  })

  test('counts carry thousands separators', () => {
    expect(copy.count(25)).toBe('25')
    expect(copy.count(2673)).toBe('2,673')
    expect(copy.count(1234567)).toBe('1,234,567')
    expect(copy.sentValue(1355)).toBe('1,355 条')
  })

  test('hover titles and alt text, from the prototype', () => {
    expect(copy.heatDayTitle(copy.dayText('2026-10-05'), 12)).toBe('10月5日：12 条')
    expect(copy.trendBarTitle('7月20日', 27)).toBe('7月20日那周：27%')
    expect(copy.trendBarTitle('7月27日', null)).toBe('7月27日那周：没有数据')
    expect(copy.heatAlt()).toBe('最近 12 周每天发出的英文消息')
    expect(copy.trendAlt()).toBe('最近 12 周每周自己写的比例')
  })

  test('the weekly report’s toast and the page’s last line', () => {
    expect(copy.reportToast()).toBe('上周的学习周报已生成，输入 /wwe 查看。')
    expect(copy.privacyNote()).toBe('统计只存在本机，只记数字，不记消息内容。')
  })
})
