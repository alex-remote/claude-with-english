import { dayText, heatAlt, heatDayTitle, heatLess, heatMore, trendAlt, trendBarTitle, wayValue } from '../copy/stats'
import type { Way } from '../copy/stats'
import { measure } from '../share/widths'
import type { WaysSplit } from './aggregate'
import type { HeatDay, Trend } from './heat'
import { WEEKS } from './heat'

// F13's charts as the two surfaces draw them (docs/references/claude-code-docs.md
// › F13 › 画柱子和格子): the terminal's Raster cells, packed as the element
// takes them, and the desktop's SVG documents, light with a dark variant.
// The words in them are copy/stats's; nothing here reads a clock or a file.

// ---- Terminal: Raster cells --------------------------------------------

/** A Raster colour meaning the terminal's own, foreground or background (RasterProps) */
export const DEFAULT_COLOR = 0x01000000

/** What a Raster element takes besides its key */
export type RasterData = { columns: number; rows: number; cells: string }

/** One cell: a width-1 character, its colour and its background, as 0xRRGGBB or DEFAULT_COLOR */
export type Cell = readonly [glyph: string, fg: number, bg: number]

const BLANK: Cell = [' ', DEFAULT_COLOR, DEFAULT_COLOR]

/**
 * The terminal's colours: a terminal may be light or dark and says not which,
 * so these are middle tones that read on both, and a square's level shows in
 * its glyph as well as its colour.
 */
export const TERMINAL_INK = {
  /** The squares of levels 1–4 and the legend's */
  heat: '#BF7A45',
  /** A week's bar, and the bar of the week on show */
  bar: '#DCA276',
  barShown: '#A45D2B',
  ways: { used: '#9E9E98', retyped: '#DCA276', direct: '#A45D2B' } as Readonly<Record<Way, string>>,
} as const

/** Level 0, a day without an English message, is a dot on the terminal's own colours; 1–4 grow denser */
export const HEAT_GLYPHS = ['·', '░', '▒', '▓', '█'] as const

/** A bar's top, in eighths of a cell */
const EIGHTHS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const

/** A week's column, or a week's bar: two cells wide, a blank cell between two weeks */
const WEEK_COLUMNS = 3

/** How wide the terminal's charts are: twelve weeks of two cells and the gaps */
export const CHART_COLUMNS = WEEKS * WEEK_COLUMNS - 1

/** How many rows the bars of 自己写的比例 rise through */
export const TREND_ROWS = 4

/** '#BF7A45' as a Raster colour */
export const rgbOf = (hex: string) => Number.parseInt(hex.slice(1), 16)

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard padded base64 */
export function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += B64[(n >> 18) & 63]
    out += B64[(n >> 12) & 63]
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '='
    out += i + 2 < bytes.length ? B64[n & 63] : '='
  }
  return out
}

/** The cells row-major as a Raster's `cells`: three little-endian u32 each */
export function packCells(cells: readonly Cell[]): string {
  const bytes = new Uint8Array(cells.length * 12)
  const view = new DataView(bytes.buffer)
  cells.forEach(([glyph, fg, bg], i) => {
    view.setUint32(i * 12, glyph.codePointAt(0) ?? 0x20, true)
    view.setUint32(i * 12 + 4, fg, true)
    view.setUint32(i * 12 + 8, bg, true)
  })
  return base64(bytes)
}

/** A level's two cells: a dot then a blank for 0, the level's glyph twice for 1–4, nothing for a day to come */
function dayCells(level: number | undefined, half: number): Cell {
  if (level === undefined || level < 0) {
    return BLANK
  }
  if (level === 0) {
    return half === 0 ? [HEAT_GLYPHS[0], DEFAULT_COLOR, DEFAULT_COLOR] : BLANK
  }
  return [HEAT_GLYPHS[Math.min(4, level) as 1 | 2 | 3 | 4], rgbOf(TERMINAL_INK.heat), DEFAULT_COLOR]
}

/**
 * 每天的英文消息 on the terminal: a column a week, Monday on top, a day two
 * cells wide. `levels` runs a day at a time from the first Monday, as
 * `heatWeeks(...).flat()` or the card's heat; a day missing or -1 is blank.
 */
export function heatRaster(levels: readonly (number | undefined)[]): RasterData {
  const rows = 7
  const cells: Cell[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < CHART_COLUMNS; c++) {
      const half = c % WEEK_COLUMNS
      cells.push(half === 2 ? BLANK : dayCells(levels[Math.floor(c / WEEK_COLUMNS) * 7 + r], half))
    }
  }
  return { columns: CHART_COLUMNS, rows, cells: packCells(cells) }
}

/** The legend between 少 and 多: the five levels, drawn as the grid draws them */
export function heatKeyRaster(): RasterData {
  const columns = 5 * WEEK_COLUMNS - 1
  const cells: Cell[] = []
  for (let c = 0; c < columns; c++) {
    const half = c % WEEK_COLUMNS
    cells.push(half === 2 ? BLANK : dayCells(Math.floor(c / WEEK_COLUMNS), half))
  }
  return { columns, rows: 1, cells: packCells(cells) }
}

/**
 * 自己写的比例 on the terminal: a bar a week, two cells wide, rising through
 * TREND_ROWS rows in eighths. A week without an English message has no bar;
 * one at 0% still shows a sliver, so it reads as measured.
 */
export function trendRaster(bars: readonly { pct: number | null; isShown: boolean }[]): RasterData {
  const steps = TREND_ROWS * 8
  const cells: Cell[] = []
  for (let r = 0; r < TREND_ROWS; r++) {
    const below = (TREND_ROWS - 1 - r) * 8
    for (let c = 0; c < bars.length * WEEK_COLUMNS - 1; c++) {
      const bar = bars[Math.floor(c / WEEK_COLUMNS)]
      if (c % WEEK_COLUMNS === 2 || !bar || bar.pct === null) {
        cells.push(BLANK)
        continue
      }
      const height = Math.max(1, Math.round((Math.min(100, Math.max(0, bar.pct)) / 100) * steps))
      const fill = Math.min(8, height - below)
      const color = rgbOf(bar.isShown ? TERMINAL_INK.barShown : TERMINAL_INK.bar)
      cells.push(fill <= 0 ? BLANK : [EIGHTHS[fill - 1] ?? '█', color, DEFAULT_COLOR])
    }
  }
  return { columns: bars.length * WEEK_COLUMNS - 1, rows: TREND_ROWS, cells: packCells(cells) }
}

/** 用译文, 照着敲, 直接写: the order of progress, and of the bar */
export const WAYS: readonly Way[] = ['used', 'retyped', 'direct']

/** The three ways as a one-row bar; `split` is in cells (splitWays with the width as its scale) */
export function waysRaster(split: WaysSplit): RasterData {
  const cells: Cell[] = []
  for (const way of WAYS) {
    for (let i = 0; i < split[way]; i++) {
      cells.push(['█', rgbOf(TERMINAL_INK.ways[way]), DEFAULT_COLOR])
    }
  }
  return { columns: Math.max(1, cells.length), rows: 1, cells: packCells(cells.length > 0 ? cells : [BLANK]) }
}

// ---- Desktop: SVG documents --------------------------------------------

/**
 * The prototype's colours for the charts, light and dark. Each element
 * carries its light colour as an attribute and a class; a stylesheet in the
 * document gives the class its dark colour when the app is dark, and the
 * attribute stands should a surface leave the stylesheet out.
 */
export const CHART_INK = {
  light: {
    heat: ['#FFFFFF', '#F2DAC6', '#DCA276', '#BF7A45', '#A45D2B'],
    edge: '#1E1E1E',
    edgeOpacity: 0.1,
    bar: '#DCA276',
    barShown: '#94552A',
    used: '#CFCFC8',
    retyped: '#DCA276',
    direct: '#94552A',
    axis: '#D9D9D4',
    muted: '#6B6B66',
    faint: '#9E9E98',
  },
  dark: {
    heat: ['#2B2B28', '#4D3627', '#8F5C38', '#B87A4E', '#E0A274'],
    edge: '#FFFFFF',
    edgeOpacity: 0.06,
    bar: '#8F5C38',
    barShown: '#E3AB82',
    used: '#4A4A45',
    retyped: '#8F5C38',
    direct: '#E3AB82',
    axis: '#3A3A36',
    muted: '#A3A29B',
    faint: '#74736D',
  },
} as const

type Ink = (typeof CHART_INK)['light'] | (typeof CHART_INK)['dark']

/** The classes every chart may use, each with its fill (or stroke) per theme */
function rules(ink: Ink): string {
  return [
    ...ink.heat.map((fill, level) => `.h${level}{fill:${fill}}`),
    `.e{stroke:${ink.edge};stroke-opacity:${ink.edgeOpacity}}`,
    `.b{fill:${ink.bar}}`,
    `.s{fill:${ink.barShown}}`,
    `.used{fill:${ink.used}}`,
    `.retyped{fill:${ink.retyped}}`,
    `.direct{fill:${ink.direct}}`,
    `.a{fill:${ink.axis}}`,
    `.m{fill:${ink.muted}}`,
    `.f{fill:${ink.faint}}`,
  ].join('')
}

const STYLE = `<style>${rules(CHART_INK.light)}@media (prefers-color-scheme: dark){${rules(CHART_INK.dark)}}</style>`

const LIGHT = CHART_INK.light

const FONT = "font-family=\"'PingFang SC', sans-serif\""
const MONO = "font-family=\"Menlo, 'PingFang SC', monospace\""

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const num = (n: number) => String(Math.round(n * 100) / 100)

const svg = (width: number, height: number, alt: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}">` +
  `<title>${esc(alt)}</title>${STYLE}${body}</svg>`

/** A chart's SVG and the size it is drawn at, in CSS pixels */
export type SvgChart = { source: string; width: number; height: number; alt: string }

const BAR_W = 22
const BAR_GAP = 3
const PLOT_H = 52
const AXIS_FONT = 10.5

/**
 * 自己写的比例 on the desktop: a bar a week on a 0–100% scale, the week on show
 * darker, each week's percentage in its hover title, the two ends under the
 * axis. A week without an English message has no bar.
 */
export function trendSvg(chart: Trend): SvgChart {
  const width = Math.max(0, chart.bars.length * (BAR_W + BAR_GAP) - BAR_GAP)
  const height = PLOT_H + 1 + 4 + AXIS_FONT + 3
  const parts: string[] = []
  chart.bars.forEach((bar, i) => {
    const x = i * (BAR_W + BAR_GAP)
    const title = `<title>${esc(trendBarTitle(dayText(bar.from), bar.pct))}</title>`
    // The whole column takes the pointer, so a week with a low bar or none still shows its title
    const hit = `<rect x="${x}" y="0" width="${BAR_W}" height="${PLOT_H}" fill="#000000" fill-opacity="0"/>`
    let drawn = ''
    if (bar.pct !== null) {
      const h = Math.max(2, (Math.min(100, Math.max(0, bar.pct)) / 100) * PLOT_H)
      const cls = bar.isShown ? 's' : 'b'
      const fill = bar.isShown ? LIGHT.barShown : LIGHT.bar
      drawn = `<rect class="${cls}" fill="${fill}" x="${x}" y="${num(PLOT_H - h)}" width="${BAR_W}" height="${num(h)}" rx="2"/>`
    }
    parts.push(`<g>${title}${hit}${drawn}</g>`)
  })
  parts.push(`<rect class="a" fill="${LIGHT.axis}" x="0" y="${PLOT_H}" width="${width}" height="1"/>`)
  const baseline = PLOT_H + 1 + 4 + AXIS_FONT
  parts.push(`<text class="f" fill="${LIGHT.faint}" x="0" y="${baseline}" ${MONO} font-size="${AXIS_FONT}">${esc(chart.start)}</text>`)
  parts.push(
    `<text class="f" fill="${LIGHT.faint}" x="${width}" y="${baseline}" text-anchor="end" ${MONO} font-size="${AXIS_FONT}">${esc(chart.end)}</text>`,
  )
  return { source: svg(width, height, trendAlt(), parts.join('')), width, height, alt: trendAlt() }
}

const CELL = 10
const CELL_GAP = 3
const KEY_FONT = 11
const KEY_SW = 9

/**
 * 每天的英文消息 on the desktop: a square a day, a column a week, Monday on
 * top, each day's count in its hover title; under it 少, the five levels, 多.
 */
export function heatSvg(weeks: readonly (readonly HeatDay[])[]): SvgChart {
  const gridW = WEEKS * (CELL + CELL_GAP) - CELL_GAP
  const gridH = 7 * (CELL + CELL_GAP) - CELL_GAP
  const keyTop = gridH + 8
  const height = keyTop + KEY_FONT + 2
  const parts: string[] = [`<g class="e" stroke="${LIGHT.edge}" stroke-opacity="${LIGHT.edgeOpacity}" stroke-width="1">`]
  weeks.forEach((week, w) => {
    week.forEach((day, d) => {
      const x = w * (CELL + CELL_GAP) + 0.5
      const y = d * (CELL + CELL_GAP) + 0.5
      parts.push(
        `<rect class="h${day.level}" fill="${LIGHT.heat[day.level]}" x="${x}" y="${y}" width="${CELL - 1}" height="${CELL - 1}" rx="2">` +
          `<title>${esc(heatDayTitle(dayText(day.date), day.count))}</title></rect>`,
      )
    })
  })
  // 少, the five levels, 多: a CJK character is one em wide in any font
  const swX = KEY_FONT + 3
  for (const level of [0, 1, 2, 3, 4] as const) {
    const x = swX + level * (KEY_SW + 3) + 0.5
    parts.push(
      `<rect class="h${level}" fill="${LIGHT.heat[level]}" x="${x}" y="${keyTop + 1.5}" width="${KEY_SW - 1}" height="${KEY_SW - 1}" rx="2"/>`,
    )
  }
  parts.push('</g>')
  const baseline = keyTop + KEY_FONT - 1
  const moreX = swX + 5 * (KEY_SW + 3)
  parts.push(`<text class="f" fill="${LIGHT.faint}" x="0" y="${baseline}" ${FONT} font-size="${KEY_FONT}">${esc(heatLess())}</text>`)
  parts.push(`<text class="f" fill="${LIGHT.faint}" x="${moreX}" y="${baseline}" ${FONT} font-size="${KEY_FONT}">${esc(heatMore())}</text>`)
  const width = Math.max(gridW, moreX + KEY_FONT)
  return { source: svg(width, height, heatAlt(), parts.join('')), width, height, alt: heatAlt() }
}

const WAYS_W = BAR_W * WEEKS + BAR_GAP * (WEEKS - 1)
const WAYS_BAR_H = 8
const WAYS_FONT = 11.5

/** The alt text of the three-colour bar: 用译文 24%，照着敲 36%，直接写 40% */
export const waysAlt = (split: WaysSplit) => WAYS.map(way => wayValue(way, split[way])).join('，')

/**
 * The three ways on the desktop: a rounded bar in three colours, `split` in
 * percents adding up to 100, and under it each way's swatch and share.
 */
export function waysSvg(split: WaysSplit): SvgChart {
  const parts: string[] = [
    `<clipPath id="bar"><rect x="0" y="0" width="${WAYS_W}" height="${WAYS_BAR_H}" rx="${WAYS_BAR_H / 2}"/></clipPath>`,
    `<g clip-path="url(#bar)">`,
  ]
  let x = 0
  for (const way of WAYS) {
    const w = (split[way] / 100) * WAYS_W
    if (w > 0) {
      parts.push(`<rect class="${way}" fill="${LIGHT[way]}" x="${num(x)}" y="0" width="${num(w)}" height="${WAYS_BAR_H}"/>`)
    }
    x += w
  }
  parts.push('</g>')
  const keyTop = WAYS_BAR_H + 6
  const baseline = keyTop + KEY_SW
  let kx = 0
  for (const way of WAYS) {
    const label = wayValue(way, split[way])
    parts.push(`<rect class="${way}" fill="${LIGHT[way]}" x="${num(kx)}" y="${keyTop}" width="${KEY_SW}" height="${KEY_SW}" rx="2"/>`)
    parts.push(
      `<text class="m" fill="${LIGHT.muted}" x="${num(kx + KEY_SW + 4)}" y="${baseline}" ${FONT} font-size="${WAYS_FONT}">${esc(label)}</text>`,
    )
    kx += KEY_SW + 4 + measure(label, 'PingFangSC-Regular', WAYS_FONT) + 10
  }
  const height = keyTop + WAYS_FONT + 3
  const width = Math.max(WAYS_W, Math.ceil(kx))
  return { source: svg(width, height, waysAlt(split), parts.join('')), width, height, alt: waysAlt(split) }
}
