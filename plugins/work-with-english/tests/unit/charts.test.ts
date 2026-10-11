import { describe, expect, test } from 'claude-code/testing'

import { SVG_MAX_LENGTH } from '../../hooks/core/share/card'
import { cardStatsOf } from '../../hooks/core/share/week'
import { ZERO_ROW, splitWays } from '../../hooks/core/stats/aggregate'
import type { DayMap, StatsRow } from '../../hooks/core/stats/aggregate'
import {
  CHART_COLUMNS,
  CHART_INK,
  DEFAULT_COLOR,
  HEAT_GLYPHS,
  TERMINAL_INK,
  TREND_ROWS,
  base64,
  heatKeyRaster,
  heatRaster,
  heatSvg,
  packCells,
  rgbOf,
  trendRaster,
  trendSvg,
  waysAlt,
  waysRaster,
  waysSvg,
} from '../../hooks/core/stats/charts'
import { heatWeeks, trend } from '../../hooks/core/stats/heat'

// F13's charts as each surface draws them: the terminal's Raster cells,
// packed as RasterProps says, and the desktop's SVG documents with a dark
// variant and hover titles; and F14's seven days, whichever range shows.

const row = (used = 0, retyped = 0, direct = 0, more: Partial<StatsRow> = {}): StatsRow => ({
  ...ZERO_ROW,
  used,
  retyped,
  direct,
  ...more,
})

const TODAY = '2026-10-09'

/** The frame's days (tests/unit/stats.test.ts): this week 25 messages at 76%, the first of the 12 weeks at 27% */
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

/** The cells a Raster's `cells` holds, read back: [character, foreground, background] */
function cellsOf(packed: string): [string, number, number][] {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const clean = packed.replace(/=+$/, '')
  const bytes: number[] = []
  for (let i = 0; i < clean.length; i += 4) {
    const n = [0, 1, 2, 3].reduce((acc, k) => (acc << 6) | Math.max(0, alphabet.indexOf(clean[i + k] ?? 'A')), 0)
    bytes.push((n >> 16) & 255, (n >> 8) & 255, n & 255)
  }
  const whole = Math.floor((clean.length * 6) / 8)
  const view = new DataView(Uint8Array.from(bytes.slice(0, whole)).buffer)
  const cells: [string, number, number][] = []
  for (let i = 0; i + 12 <= whole; i += 12) {
    cells.push([String.fromCodePoint(view.getUint32(i, true)), view.getUint32(i + 4, true), view.getUint32(i + 8, true)])
  }
  return cells
}

/** The characters of one row of a Raster, as a string */
const rowText = (cells: [string, number, number][], columns: number, r: number) =>
  cells
    .slice(r * columns, (r + 1) * columns)
    .map(([ch]) => ch)
    .join('')

describe('Raster cells', () => {
  test('base64 is standard and padded', () => {
    const bytes = (s: string) => Uint8Array.from([...s].map(ch => ch.charCodeAt(0)))
    expect(base64(bytes(''))).toBe('')
    expect(base64(bytes('f'))).toBe('Zg==')
    expect(base64(bytes('fo'))).toBe('Zm8=')
    expect(base64(bytes('foo'))).toBe('Zm9v')
    expect(base64(bytes('foobar'))).toBe('Zm9vYmFy')
    expect(base64(Uint8Array.of(0xff, 0xfe, 0xfd))).toBe('//79')
  })

  test('a cell is three little-endian u32: the docs’ one orange cell', () => {
    // RasterProps' example: Uint32Array.of(0x2588, 0xff8800, 0x01000000)
    expect(packCells([['█', 0xff8800, DEFAULT_COLOR]])).toBe('iCUAAACI/wAAAAAB')
    expect(cellsOf(packCells([['█', 0xff8800, DEFAULT_COLOR]]))).toEqual([['█', 0xff8800, DEFAULT_COLOR]])
    expect(rgbOf('#BF7A45')).toBe(0xbf7a45)
  })
})

describe('每天的英文消息 on the terminal', () => {
  test('a column a week, a day two cells wide, Monday on top; the last column only up to today', () => {
    const weeks = heatWeeks(DAYS, TODAY)
    const raster = heatRaster(weeks.flatMap(week => week.map(day => day.level)))
    expect(raster).toMatchObject({ columns: CHART_COLUMNS, rows: 7 })
    expect(CHART_COLUMNS).toBe(35)
    const cells = cellsOf(raster.cells)
    expect(cells.length).toBe(35 * 7)
    // Friday is today: Saturday and Sunday of the last column are blank
    expect(rowText(cells, 35, 5).slice(33)).toBe('  ')
    expect(rowText(cells, 35, 6).slice(33)).toBe('  ')
    expect(rowText(cells, 35, 4).slice(33)).not.toBe('  ')
    // A blank column between two weeks
    expect(cells.filter((_, i) => i % 35 === 2).every(([ch, fg, bg]) => ch === ' ' && fg === DEFAULT_COLOR && bg === DEFAULT_COLOR)).toBe(true)
  })

  test('level 0 is a dot on the terminal’s own colours; 1–4 grow denser in one colour', () => {
    const cells = cellsOf(heatRaster([0, 1, 2, 3, 4, -1, 0]).cells)
    const column = [0, 1, 2, 3, 4, 5, 6].map(r => cells[r * 35])
    expect(column.map(cell => cell?.[0])).toEqual(['·', '░', '▒', '▓', '█', ' ', '·'])
    expect(column[0]).toEqual(['·', DEFAULT_COLOR, DEFAULT_COLOR])
    expect(column[1]).toEqual(['░', rgbOf(TERMINAL_INK.heat), DEFAULT_COLOR])
    // A day is two cells: the dot stands alone, a level fills both
    expect(cells[1]).toEqual([' ', DEFAULT_COLOR, DEFAULT_COLOR])
    expect(cells[35 + 1]?.[0]).toBe('░')
  })

  test('the legend draws the five levels the way the grid does', () => {
    const key = heatKeyRaster()
    expect(key).toMatchObject({ columns: 14, rows: 1 })
    expect(rowText(cellsOf(key.cells), 14, 0)).toBe(`${HEAT_GLYPHS[0]}  ░░ ▒▒ ▓▓ ██`)
  })
})

describe('自己写的比例 on the terminal', () => {
  test('a bar a week rising through four rows in eighths; the week on show in the darker colour', () => {
    const bars = [
      { pct: 100, isShown: false },
      { pct: 50, isShown: false },
      { pct: 0, isShown: false },
      { pct: null, isShown: false },
      { pct: 80, isShown: true },
    ]
    const raster = trendRaster(bars)
    expect(raster).toMatchObject({ columns: 14, rows: TREND_ROWS })
    const cells = cellsOf(raster.cells)
    const rows = [0, 1, 2, 3].map(r => rowText(cells, 14, r))
    expect(rows).toEqual(['██          ▂▂', '██          ██', '██ ██       ██', '██ ██ ▁▁    ██'])
    expect(cells[12]?.[1]).toBe(rgbOf(TERMINAL_INK.barShown))
    expect(cells[3 * 14]?.[1]).toBe(rgbOf(TERMINAL_INK.bar))
  })

  test('the twelve weeks of the frame fill the charts’ width', () => {
    expect(trendRaster(trend(DAYS, TODAY, 'week').bars).columns).toBe(CHART_COLUMNS)
  })
})

describe('the three ways on the terminal', () => {
  test('a one-row bar in the three colours, its cells as splitWays gives them', () => {
    const split = splitWays(row(6, 9, 10), CHART_COLUMNS)
    expect(split).toEqual({ used: 8, retyped: 13, direct: 14 })
    const raster = waysRaster(split ?? { used: 0, retyped: 0, direct: 0 })
    expect(raster).toMatchObject({ columns: 35, rows: 1 })
    const colours = cellsOf(raster.cells).map(([, fg]) => fg)
    expect(colours.filter(c => c === rgbOf(TERMINAL_INK.ways.used)).length).toBe(8)
    expect(colours.at(-1)).toBe(rgbOf(TERMINAL_INK.ways.direct))
  })
})

describe('the charts on the desktop', () => {
  test('自己写的比例: a bar a week with its title, the two ends under the axis, a dark variant', () => {
    const chart = trendSvg(trend(DAYS, TODAY, 'week'))
    expect(chart.source.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(chart.source).toContain('<title>最近 12 周每周自己写的比例</title>')
    expect(chart.source).toContain('<title>7月20日那周：27%</title>')
    expect(chart.source).toContain('<title>7月27日那周：没有数据</title>')
    expect(chart.source).toContain('>7月20日那周 27%</text>')
    expect(chart.source).toContain('>本周 76%</text>')
    expect(chart.source).toContain('@media (prefers-color-scheme: dark)')
    expect(chart.source).toContain(`.s{fill:${CHART_INK.dark.barShown}}`)
    // Only this week is the darker bar
    expect(chart.source.match(/class="s"/g)?.length).toBe(1)
    expect(chart.alt).toBe('最近 12 周每周自己写的比例')
    expect(chart.source.length).toBeLessThanOrEqual(SVG_MAX_LENGTH)
  })

  test('每天的英文消息: a square a day up to today with its count, the legend under it', () => {
    const weeks = heatWeeks(DAYS, TODAY)
    const chart = heatSvg(weeks)
    const days = weeks.flat().length
    expect(days).toBe(11 * 7 + 5)
    // Each day's square has a title; the five swatches have none
    expect(chart.source.match(/<title>\d+月\d+日：/g)?.length).toBe(days)
    expect(chart.source).toContain('<title>10月5日：5 条</title>')
    expect(chart.source).toContain('>少</text>')
    expect(chart.source).toContain('>多</text>')
    expect(chart.source).toContain(`.h0{fill:${CHART_INK.light.heat[0]}}`)
    expect(chart.source).toContain(`.h4{fill:${CHART_INK.dark.heat[4]}}`)
    expect(chart.source.length).toBeLessThanOrEqual(SVG_MAX_LENGTH)
  })

  test('the three ways: a rounded bar and each way’s share, adding up to 100', () => {
    const chart = waysSvg({ used: 24, retyped: 36, direct: 40 })
    expect(chart.alt).toBe('用译文 24%，照着敲 36%，直接写 40%')
    expect(waysAlt({ used: 0, retyped: 100, direct: 0 })).toBe('用译文 0%，照着敲 100%，直接写 0%')
    for (const text of ['用译文 24%', '照着敲 36%', '直接写 40%']) {
      expect(chart.source).toContain(`>${text}</text>`)
    }
    expect(chart.source).toContain('clip-path="url(#bar)"')
    // A way nobody used has no segment, only its swatch
    expect(waysSvg({ used: 0, retyped: 100, direct: 0 }).source.match(/class="used"/g)?.length).toBe(1)
  })

  test('words are escaped', () => {
    const chart = trendSvg({ bars: [], start: 'a<b', end: 'c&d' })
    expect(chart.source).toContain('>a&lt;b</text>')
    expect(chart.source).toContain('>c&amp;d</text>')
  })
})

describe('the card’s seven days (F14)', () => {
  test('the seven days up to today, whichever range the page shows, against the seven before', () => {
    const card = cardStatsOf(DAYS, TODAY)
    expect(card).toMatchObject({
      from: '2026-10-03',
      to: TODAY,
      sent: 32,
      ownPct: 75,
      delta: 15,
      words: 2673,
      newWords: 1,
      streak: 18,
    })
    // New words only, sentences left out
    expect(card?.newWords).toBe(1)
    // The grid to today: 11 whole weeks and Monday to Friday
    expect(card?.heat.length).toBe(11 * 7 + 5)
    expect(card?.heat.slice(0, 3)).toEqual([4, 0, 0])
  })

  test('no card without an English message in the last seven days', () => {
    expect(cardStatsOf(DAYS, '2026-10-17')).toBeNull()
    expect(cardStatsOf({}, TODAY)).toBeNull()
    expect(cardStatsOf({ [TODAY]: row(0, 0, 0, { words: 300 }) }, TODAY)).toBeNull()
  })
})
