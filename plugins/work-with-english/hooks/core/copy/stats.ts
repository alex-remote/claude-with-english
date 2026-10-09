import type { RangeKind } from '../stats/range'

// Every word of the 统计 page (F13) and its weekly reminder: the feature
// map's frame and rules first, then the prototype (the charts' alt text and
// hover titles). The numbers come in already counted by core/stats. The
// 每周提醒 switch's name and description are the settings table's
// (copy/settings), and the line beside a 生成分享卡 that can't be pressed is
// F14's (copy/share), so neither is repeated here.

type PageRange = Exclude<RangeKind, '7d'>

/** The three ways a message was written (F13 › 写法) */
export type Way = 'used' | 'retyped' | 'direct'

/** The range buttons: 本周, 上周, 全部 */
export const rangeTab = (kind: PageRange) => RANGE_TABS[kind]

const RANGE_TABS: Readonly<Record<PageRange, string>> = { week: '本周', last: '上周', all: '全部' }

/** A count as the page writes it, with thousands separators: 2,673 */
export const count = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** A day of a range's line: 10月5日, or 2025年12月29日 when the range crosses a year */
export const dayText = (date: string, withYear = false) => {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  const d = Number(date.slice(8, 10))
  return withYear ? `${y}年${m}月${d}日` : `${m}月${d}日`
}

/** Under the range buttons: 10月5日至今天, 9月28日至10月4日 (`to` null for today) */
export const rangeText = (from: string, to: string | null) => `${from}至${to ?? '今天'}`

/** No English message was ever sent: the numbers and both charts give way to this */
export const noData = () => '还没有数据。发出第一条英文消息后开始统计。'

/** The range on show has no English message */
export const noMessagesInRange = () => '这段时间没有发出英文消息。'

export const sentName = () => '英文消息'
export const ownName = () => '自己写的'
export const wayName = (way: Way) => WAY_NAMES[way]
export const wordsName = () => '英文回复'
export const bookName = () => '单词本新增'
export const streakName = () => '连续使用'

const WAY_NAMES: Readonly<Record<Way, string>> = { used: '用译文', retyped: '照着敲', direct: '直接写' }

/** 25 条 */
export const sentValue = (n: number) => `${count(n)} 条`

/** 76% */
export const ownValue = (pct: number) => `${pct}%`

/** Under the three-colour bar: 用译文 24% */
export const wayValue = (way: Way, pct: number) => `${wayName(way)} ${pct}%`

/** 2,673 词 */
export const wordsValue = (n: number) => `${count(n)} 词`

/** 1 个词 1 个句子 */
export const bookValue = (words: number, sentences: number) =>
  `${count(words)} 个词 ${count(sentences)} 个句子`

/** 18 天; 上周 counts up to its Sunday, so it says so: 13 天（截至上周日） */
export const streakValue = (days: number, kind: RangeKind) =>
  `${count(days)} 天${kind === 'last' ? '（截至上周日）' : ''}`

/**
 * After 自己写的, against the week before: 比上周高 8 个百分点, 比上周低 3 个百分点,
 * 和上周一样. Viewing 上周, the week before it is 前一周.
 */
export const delta = (points: number, kind: RangeKind) => {
  const than = kind === 'week' ? '上周' : '前一周'
  if (points > 0) {
    return `比${than}高 ${points} 个百分点`
  }
  return points < 0 ? `比${than}低 ${-points} 个百分点` : `和${than}一样`
}

export const trendTitle = () => '自己写的比例（最近 12 周）'

/** The bar chart's left end: 7月20日那周 27%; a week without English messages has no number */
export const trendStart = (day: string, pct: number | null) => `${day}那周${pct === null ? '' : ` ${pct}%`}`

/** The bar chart's right end: 本周 76% */
export const trendEnd = (pct: number | null) => `本周${pct === null ? '' : ` ${pct}%`}`

export const trendAlt = () => '最近 12 周每周自己写的比例'

/** A bar's hover title on the desktop: 7月20日那周：27% */
export const trendBarTitle = (day: string, pct: number | null) =>
  `${day}那周：${pct === null ? '没有数据' : `${pct}%`}`

export const heatTitle = () => '每天的英文消息（最近 12 周）'

export const heatAlt = () => '最近 12 周每天发出的英文消息'

/** A square's hover title on the desktop: 10月5日：12 条 */
export const heatDayTitle = (day: string, n: number) => `${day}：${count(n)} 条`

/** Either end of the five colours under the grid */
export const heatLess = () => '少'
export const heatMore = () => '多'

/** F14's button, shown for 本周 and 上周 */
export const shareButton = () => '生成分享卡'

/** F13 › 周报提醒: the first start of a week, when last week had an English message */
export const reportToast = () => '上周的学习周报已生成，输入 /wwe 查看。'

/** The page's last line */
export const privacyNote = () => '统计只存在本机，只记数字，不记消息内容。'
