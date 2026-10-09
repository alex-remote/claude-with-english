import type { LangId } from '../copy/lang'
import { REPO_TEXT, SHARE_COPY } from '../copy/share'
import { WEEKS, type HeatLevel as DayLevel } from '../stats/heat'
import { pastWeekDate } from './dates'
import { QUOTE_INK, measure, semiboldInkTop, type FontKey } from './widths'

// The share card as an SVG document (F14 › 卡片): what `sips` turns into the
// PNG the user posts, and what the desktop's Svg draws in the Pane. The
// layout is the prototype's cardCanvas, constant for constant, in its
// 540-wide units; the viewBox draws it at twice that, 1080 px wide.
//
// sips (docs/references/claude-code-docs.md › 出图（P06）) reads only part of
// SVG, so the card keeps to it: each run of text is its own <text> placed by
// the measured widths (no tspan, no text-anchor), weights are numbers, a
// leading space is &#160;, and the icon comes as a data: URI.

/** A day's square, as the 统计 page's grid levels it (white, then 1–4 light to dark); -1 is a day after today, not drawn */
export type HeatLevel = DayLevel | -1

/** What the card shows: the seven days up to the day it is shared */
export type CardStats = {
  /** The seven days' first and last date, YYYY-MM-DD */
  from: string
  to: string
  /** English messages sent */
  sent: number
  /** 自己写的, rounded to a whole percent */
  ownPct: number
  /** Points against the seven days before; null when those had no English message */
  delta: number | null
  /** Words of Claude's English replies */
  words: number
  /** Words saved to the word book; sentences don't count */
  newWords: number
  /** Days in a row with an English message, up to `to` */
  streak: number
  /**
   * The last 12 weeks up to `to`, a day each from the oldest Monday: a column
   * a week, Monday on top, the last column only to `to`. The days after `to`
   * are left out or -1, so `heatWeeks(days, to).flat()` levels go in as they are.
   */
  heat: readonly HeatLevel[]
}

/** The product icon (icon.png cropped to its artwork), its pixel size giving its shape */
export type CardIcon = {
  /** data:image/png;base64,… — sips leaves out an image named by a path */
  href: string
  width: number
  height: number
}

export type CardData = CardStats & { icon?: CardIcon | null }

/** Every word on a card, for a drawing that lays the card out itself (the terminal's preview) */
export type CardWords = {
  title: readonly string[]
  date: string
  /** The five numbers, as they show */
  numbers: readonly [string, string, string, string, string]
  labels: readonly [string, string, string, string, string]
  heat: { title: string; note: string; less: string; more: string }
  pitch: readonly [string, string]
  repo: string
  footer: string
}

export function cardWords(stats: CardStats, lang: LangId): CardWords {
  const copy = SHARE_COPY[lang]
  return {
    title: copy.title,
    date: pastWeekDate(stats.from, stats.to, lang),
    numbers: [
      String(stats.sent),
      `${stats.ownPct}%`,
      copy.wordsNumber(stats.words),
      String(stats.newWords),
      String(stats.streak),
    ],
    labels: [
      copy.sentLabel(stats.sent),
      copy.ownLabel(stats.delta),
      copy.wordsLabel(),
      copy.newWordsLabel(stats.newWords),
      copy.streakLabel(),
    ],
    heat: { title: copy.heatTitle(), note: copy.heatNote(), less: copy.heatLess(), more: copy.heatMore() },
    pitch: copy.pitch,
    repo: REPO_TEXT,
    footer: copy.footer(),
  }
}

/** The card's colours, light whatever the theme, since the picture leaves the screen it was made on */
export const CARD_INK = {
  bg: '#FDF6F2',
  foot: '#F8ECE4',
  line: '#D4A27F',
  ink: '#1E1E1E',
  muted: '#6B6B66',
  accent: '#94552A',
  heat: ['#FFFFFF', '#F2DAC6', '#DCA276', '#BF7A45', '#A45D2B'],
  /** rgba(30, 30, 30, .1) */
  heatEdge: '#1E1E1E',
  heatEdgeOpacity: 0.1,
} as const

/** The picture's width in pixels */
export const CARD_PIXEL_WIDTH = 1080

/** The most the desktop's Svg element takes (SvgProps.source) */
export const SVG_MAX_LENGTH = 131072

/** The grid's weeks, the 统计 page's */
export const HEAT_WEEKS = WEEKS

/** GitHub's mark (Octicons mark-github-16, MIT); GitHub's logo rules keep it in black, never the accent */
const GITHUB_MARK =
  'M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656'

/** The cropped icon's shape in the prototype (329 × 240), for a card drawn without it */
const ICON_ASPECT = 329 / 240

const W = 540
const PAD = 40
const INNER = W - PAD * 2
const SCALE = CARD_PIXEL_WIDTH / W
const CELL = 20
const GAP = 5
/** The legend's swatches and the gap between them */
const SW = 12
const SWG = 3
const FOOT_H = 44
const QUOTE_SIZE = 104

type Face = { family: 'sans' | 'mono' | 'serif'; size: number; weight: number }

const sans = (size: number, weight = 400): Face => ({ family: 'sans', size, weight })
const mono = (size: number, weight = 700): Face => ({ family: 'mono', size, weight })

// Family names, never PostScript names, which sips swaps for another font
const FAMILY: Readonly<Record<Face['family'], string>> = {
  sans: "'PingFang SC', sans-serif",
  mono: 'Menlo, monospace',
  serif: 'Georgia, serif',
}

const fontKey = (face: Face): FontKey =>
  face.family === 'mono'
    ? face.weight >= 600
      ? 'Menlo-Bold'
      : 'Menlo-Regular'
    : face.weight >= 600
      ? 'PingFangSC-Semibold'
      : 'PingFangSC-Regular'

const widthOf = (text: string, face: Face) => measure(text, fontKey(face), face.size)

type TextOp = { text: string; x: number; y: number; face: Face; color: string }

/** Lines that fit `width`: broken at spaces in English, between any two characters in Chinese */
function wrap(text: string, face: Face, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const token of text.match(/[\u3000-\u9FFF\uFF00-\uFFEF]|[^\s\u3000-\u9FFF\uFF00-\uFFEF]+|\s+/g) ?? []) {
    const next = line + token
    if (line.trim() !== '' && widthOf(next.trimEnd(), face) > width) {
      lines.push(line.trimEnd())
      line = token.trimStart()
    } else {
      line = next
    }
  }
  if (line.trim() !== '') {
    lines.push(line.trimEnd())
  }
  return lines
}

export function cardSvg(data: CardData, lang: LangId): string {
  const words = cardWords(data, lang)
  const ops: TextOp[] = []
  // A block of lines, each `step` below the last, its first baseline `size` below `y`; returns where it ended
  const block = (text: string, x: number, top: number, face: Face, color: string, size: number, step: number, width = INNER) => {
    let y = top
    for (const line of wrap(text, face, width)) {
      ops.push({ text: line, x, y: y + size, face, color })
      y += step
    }
    return y
  }

  let y = PAD
  // The icon, top right, is as tall as a two-line title and the date together, from the title's cap line to
  // the date's descender, and reaches 10 into the margin; the title keeps 10 clear of it. Beside a one-line
  // title it keeps that size, centred on the title and the date
  const headTop = PAD + 30 - semiboldInkTop(words.title[0] ?? '', 30)
  const headBottom = PAD + words.title.length * 38 + 4 + 16 + 3
  const iconH = PAD + 2 * 38 + 4 + 16 + 3 - (PAD + 30 - semiboldInkTop('Hb', 30))
  const aspect = data.icon && data.icon.width > 0 && data.icon.height > 0 ? data.icon.width / data.icon.height : ICON_ASPECT
  const iconW = iconH * aspect
  const icon = {
    x: W - PAD + 10 - iconW,
    y: words.title.length > 1 ? headTop : (headTop + headBottom - iconH) / 2,
    w: iconW,
    h: iconH,
  }
  for (const line of words.title) {
    y = block(line, PAD, y, sans(30, 700), CARD_INK.ink, 30, 38, icon.x - 10 - PAD)
  }
  y = block(words.date, PAD, y + 4, sans(16), CARD_INK.muted, 16, 22) + 22

  // The numbers right-aligned in a column, each label beside its number
  const numFace = mono(28)
  const numW = Math.max(...words.numbers.map((n) => widthOf(n, numFace)))
  const labelX = PAD + numW + 16
  const labelW = W - PAD - labelX
  words.numbers.forEach((n, i) => {
    ops.push({ text: n, x: PAD + numW - widthOf(n, numFace), y: y + 29, face: numFace, color: CARD_INK.accent })
    const below = block(words.labels[i] ?? '', labelX, y + 6, sans(19), CARD_INK.ink, 21, 25, labelW)
    y = Math.max(y + 38, below + 12)
  })
  y += 8

  // The grid, and its legend in the space to its right: title, note, then Less, five levels, More, the last
  // row level with the grid's bottom; 24 right of the grid, or closer where that row would pass the margin
  const heatTop = y
  const gridW = HEAT_WEEKS * (CELL + GAP) - GAP
  const gridBottom = heatTop + 7 * (CELL + GAP) - GAP
  const keyFace = sans(14)
  const lessW = widthOf(words.heat.less, keyFace)
  const rowW = lessW + 5 + 5 * (SW + SWG) + 3 + widthOf(words.heat.more, keyFace)
  const keyX = Math.min(PAD + gridW + 24, W - PAD - rowW)
  const keyRow = gridBottom - SW
  ops.push({ text: words.heat.title, x: keyX, y: keyRow - 40, face: sans(16, 600), color: CARD_INK.ink })
  ops.push({ text: words.heat.note, x: keyX, y: keyRow - 16, face: sans(15), color: CARD_INK.muted })
  ops.push({ text: words.heat.less, x: keyX, y: gridBottom - 2, face: keyFace, color: CARD_INK.muted })
  const swX = keyX + lessW + 5
  ops.push({ text: words.heat.more, x: swX + 5 * (SW + SWG) + 3, y: gridBottom - 2, face: keyFace, color: CARD_INK.muted })
  y += 7 * (CELL + GAP) - GAP + 26

  // The pitch after a large opening quote in the light accent, the quote's top level with the pitch's cap line
  const pitchTop = y
  y += 24
  const pitchCap = y + 23 - semiboldInkTop(words.pitch[0], 23)
  // As a canvas measures the quote: how far its ink reaches left of the origin (negative: it starts right of
  // it), right of it, and above the baseline
  const quoteLeft = (-QUOTE_INK.left * QUOTE_SIZE) / 1000
  const quoteRight = (QUOTE_INK.right * QUOTE_SIZE) / 1000
  const quoteTop = (QUOTE_INK.top * QUOTE_SIZE) / 1000
  ops.push({
    text: '“',
    x: PAD - quoteLeft,
    y: pitchCap + quoteTop,
    face: { family: 'serif', size: QUOTE_SIZE, weight: 700 },
    color: CARD_INK.line,
  })
  const pitchX = PAD + quoteLeft + quoteRight + 12
  for (const line of words.pitch) {
    y = block(line, pitchX, y, sans(23, 700), CARD_INK.ink, 23, 31, W - PAD - pitchX)
  }

  // The repository's full address after GitHub's mark, one line, in type as large as fits it
  y += 16
  const textX = PAD + 30
  let repoPx = 19
  while (repoPx > 13 && widthOf(words.repo, mono(repoPx)) > W - PAD - textX) {
    repoPx--
  }
  const mark = { x: PAD, y: y + repoPx * 0.62 - 10, size: 20 }
  ops.push({ text: words.repo, x: textX, y: y + repoPx, face: mono(repoPx), color: CARD_INK.accent })
  y += repoPx + 8

  // The footer: a tinted band across the card's foot, set off by a hairline, the words centred in it
  const footTop = y + 18
  const footFace = sans(14)
  ops.push({
    text: words.footer,
    x: W / 2 - widthOf(words.footer, footFace) / 2,
    y: footTop + FOOT_H / 2 + 5,
    face: footFace,
    color: CARD_INK.muted,
  })
  const H = footTop + FOOT_H

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_PIXEL_WIDTH}" height="${num(H * SCALE)}" viewBox="0 0 ${W} ${num(H)}">`,
    `<rect x="1" y="1" width="${W - 2}" height="${num(H - 2)}" rx="24" fill="${CARD_INK.bg}"/>`,
    `<path d="${footPath(footTop, H)}" fill="${CARD_INK.foot}"/>`,
    `<rect x="1" y="${num(footTop)}" width="${W - 2}" height="1" fill="${CARD_INK.line}"/>`,
    `<rect x="1" y="1" width="${W - 2}" height="${num(H - 2)}" rx="24" fill="none" stroke="${CARD_INK.line}" stroke-width="2"/>`,
    `<g stroke="${CARD_INK.heatEdge}" stroke-opacity="${CARD_INK.heatEdgeOpacity}" stroke-width="1">`,
  ]
  data.heat.slice(0, HEAT_WEEKS * 7).forEach((level, i) => {
    if (level !== -1) {
      const x = PAD + Math.floor(i / 7) * (CELL + GAP) + 0.5
      parts.push(square(x, heatTop + (i % 7) * (CELL + GAP) + 0.5, CELL - 1, 4, CARD_INK.heat[level]))
    }
  })
  for (const level of [0, 1, 2, 3, 4] as const) {
    parts.push(square(swX + level * (SW + SWG) + 0.5, keyRow + 0.5, SW - 1, 3, CARD_INK.heat[level]))
  }
  parts.push('</g>')
  parts.push(
    `<line x1="${PAD}" y1="${num(pitchTop)}" x2="${W - PAD}" y2="${num(pitchTop)}" stroke="${CARD_INK.line}" stroke-width="1.5" stroke-dasharray="6 5"/>`,
  )
  parts.push(
    `<path transform="translate(${num(mark.x)} ${num(mark.y)}) scale(${mark.size / 16})" fill="${CARD_INK.ink}" d="${GITHUB_MARK}"/>`,
  )
  if (data.icon) {
    parts.push(
      `<image x="${num(icon.x)}" y="${num(icon.y)}" width="${num(icon.w)}" height="${num(icon.h)}" href="${attr(data.icon.href)}"/>`,
    )
  }
  for (const op of ops) {
    parts.push(textElement(op))
  }
  parts.push('</svg>')
  return parts.join('')
}

/** The footer band, its bottom corners rounded with the card's */
function footPath(top: number, h: number): string {
  const bottom = h - 1
  const r = 24
  return `M1 ${num(top)}H${W - 1}V${num(bottom - r)}A${r} ${r} 0 0 1 ${W - 1 - r} ${num(bottom)}H${1 + r}A${r} ${r} 0 0 1 1 ${num(bottom - r)}Z`
}

const square = (x: number, y: number, size: number, r: number, fill: string) =>
  `<rect x="${num(x)}" y="${num(y)}" width="${size}" height="${size}" rx="${r}" fill="${fill}"/>`

function textElement(op: TextOp): string {
  const weight = op.face.weight === 400 ? '' : ` font-weight="${op.face.weight}"`
  return (
    `<text x="${num(op.x)}" y="${num(op.y)}" font-family="${FAMILY[op.face.family]}" font-size="${op.face.size}"` +
    `${weight} fill="${op.color}">${escapeText(op.text)}</text>`
  )
}

/** Two decimals are finer than the 2× picture's pixels */
const num = (n: number) => String(Math.round(n * 100) / 100)

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

// sips drops a leading space and SVG collapses a run of them, so those become no-break spaces
const escapeText = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^ | (?= )/g, '&#160;')
