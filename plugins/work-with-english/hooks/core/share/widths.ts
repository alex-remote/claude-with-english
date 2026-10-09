// How wide text draws on the share card, so the card can be laid out without
// a browser: the advance widths of the fonts `sips` draws it with (PingFang SC
// and Menlo), measured with CoreText (NSString sizeWithAttributes gives the
// same) at 1000 px. Neither font kerns, so a line is the sum of its
// characters; that matches sips to 1–3 px (docs/references/claude-code-docs.md
// › 出图（P06）).

export type FontKey = 'PingFangSC-Regular' | 'PingFangSC-Semibold' | 'Menlo-Regular' | 'Menlo-Bold'

/** U+0020 to U+007E, in order */
const ASCII: Readonly<Record<'PingFangSC-Regular' | 'PingFangSC-Semibold', readonly number[]>> = {
  'PingFangSC-Regular': [
    333, 320.4, 436.8, 595.5, 599.1, 945, 728.2, 266, 320.7, 320.7, 489.4, 594.8, 264.2, 601.7, 264.2, 484.1,
    587.4, 395.4, 592.5, 589.5, 595.2, 593.4, 598.5, 548.3, 596.1, 599.7, 264.2, 264.2, 604.7, 604.7, 604.7, 546.1,
    863.1, 657.8, 678, 728, 707.1, 637.1, 577.1, 748.3, 720.9, 237.6, 518.3, 691.2, 588.3, 882.7, 719.7, 767.3,
    642.4, 767.3, 677.3, 633.5, 618.7, 714.6, 639.6, 931.5, 638.2, 663, 624.2, 320.7, 484.4, 320.7, 525.2, 500,
    333, 559.7, 586.3, 547.5, 586.3, 555.3, 373.4, 590.9, 557.3, 257.5, 267.1, 529.6, 236.2, 856.3, 560.1, 587.1,
    586.3, 586.3, 365.7, 505.6, 354.9, 560.8, 482.6, 756.1, 510.2, 497.1, 488.5, 315.6, 199.2, 315.6, 499.7,
  ],
  'PingFangSC-Semibold': [
    333, 333.2, 479.8, 623.8, 614.4, 1000, 756.2, 275, 353.2, 353.2, 514.4, 625.2, 280.8, 608.4, 280.8, 508,
    627.6, 431.2, 612.6, 617.8, 625.4, 616, 626.6, 568.8, 624, 626.6, 280.8, 280.8, 625.2, 625.2, 625.2, 560.8,
    875.6, 695, 702, 744.2, 730, 653.6, 593.6, 766.6, 745.2, 270.2, 550.4, 721.2, 604.2, 914.4, 743.2, 785.4,
    665, 785.4, 705.6, 660.6, 634.2, 742.2, 674.2, 957.8, 681, 704, 644.2, 356.8, 508, 356.8, 553.6, 500,
    333, 583.4, 614.4, 574, 614.4, 577.4, 391.4, 615.2, 586.4, 283.6, 288.4, 567.6, 271, 890.8, 590.2, 610.8,
    614.4, 614.4, 389.8, 534.6, 373.2, 591, 519.6, 787, 555.4, 537.2, 513.2, 356.8, 222.8, 356.8, 547.8,
  ],
}

/** Punctuation outside ASCII and below the CJK block, which PingFang draws narrower than 1 em */
const EXTRA: Readonly<Record<'PingFangSC-Regular' | 'PingFangSC-Semibold', Readonly<Record<string, number>>>> = {
  'PingFangSC-Regular': { '–': 824, '—': 1000, '…': 1000, '‘': 340, '’': 340, '“': 537.2, '”': 537.2, '·': 500, '×': 584 },
  'PingFangSC-Semibold': { '–': 824, '—': 1000, '…': 1000, '‘': 382, '’': 382, '“': 626.2, '”': 626.2, '·': 500, '×': 584 },
}

/** Menlo is monospaced; what it lacks (CJK) falls back to PingFang at 1 em */
const MENLO = 602.1

const EM = 1000
const SPACE = 0x20
const NBSP = 0xa0
const ZWJ = 0x200d

/**
 * How wide `text` draws in `font` at `size` px.
 *
 * An emoji draws 1 em whatever it is made of (a skin tone, a variation
 * selector or a ZWJ family adds nothing): sips drew 🚀, ⭐, 👍🏽, 👨‍👩‍👧 and ❤️
 * each 1 em wide in both fonts. A no-break space is as wide as a space.
 * Anything else the tables lack is taken as wide as M, so a line never
 * overruns.
 */
export function measure(text: string, font: FontKey, size: number): number {
  let sum = 0
  let joined = false
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? SPACE
    if (isZeroWidth(cp)) {
      joined = cp === ZWJ
      continue
    }
    if (isEmoji(ch, cp)) {
      // The emoji after a ZWJ is drawn in the same 1 em as the one before it
      sum += joined ? 0 : isRegionalIndicator(cp) ? EM / 2 : EM
      joined = false
      continue
    }
    joined = false
    sum += advance(cp === NBSP ? ' ' : ch, cp === NBSP ? SPACE : cp, font)
  }
  return (sum * size) / EM
}

function advance(ch: string, cp: number, font: FontKey): number {
  if (isWide(cp)) {
    return EM
  }
  if (font === 'Menlo-Regular' || font === 'Menlo-Bold') {
    return MENLO
  }
  const ascii = ASCII[font]
  if (cp >= SPACE && cp <= 0x7e) {
    return ascii[cp - SPACE] ?? EM
  }
  return EXTRA[font][ch] ?? ascii['M'.charCodeAt(0) - SPACE] ?? EM
}

/** CJK, fullwidth forms and the rest from U+2E80 up draw 1 em in both fonts */
const isWide = (cp: number) => cp >= 0x2e80

/** Joiners, variation selectors, skin tones and the keycap mark draw nothing of their own */
const isZeroWidth = (cp: number) =>
  cp === ZWJ || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x1f3fb && cp <= 0x1f3ff) || cp === 0x20e3

const isRegionalIndicator = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff

// ©, ® and ‼ are pictographic too but PingFang draws them as text
const isEmoji = (ch: string, cp: number) => (cp >= 0x2100 && /\p{Extended_Pictographic}/u.test(ch)) || isRegionalIndicator(cp)

/**
 * The height of PingFang SC Semibold's ink above the baseline, per 1000 px,
 * for U+0021 to U+007E; a space has none. The card lines the product icon
 * and the large quote mark up with the tops of its bold lines.
 */
const SEMIBOLD_TOPS: readonly number[] = [
  715, 715, 708, 776, 711, 726, 714, 828, 828, 701, 534, 157, 312, 160, 821, 729,
  714, 717, 729, 705, 706, 717, 705, 717, 717, 522, 522, 524, 415, 524, 735, 706,
  715, 715, 729, 718, 714, 715, 744, 714, 715, 715, 715, 714, 715, 715, 729, 715,
  729, 715, 729, 714, 715, 715, 715, 715, 715, 715, 828, 821, 827, 715, -37, 722,
  531, 729, 532, 728, 539, 721, 532, 728, 730, 730, 729, 729, 533, 533, 531, 532,
  532, 533, 532, 687, 521, 517, 517, 517, 518, 517, 828, 861, 827, 468,
]

/** A capital's top, for the few other characters */
const CAP_TOP = 715

/** The tallest CJK glyphs in the card's copy (何 830, 氛 831); most others sit a little lower */
const CJK_TOP = 831

/**
 * How far the ink of `text` in PingFang SC Semibold reaches above the
 * baseline at `size` px: the tallest of its characters, as a canvas's
 * `actualBoundingBoxAscent` gives it.
 */
export function semiboldInkTop(text: string, size: number): number {
  let top = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? SPACE
    top = Math.max(top, inkTopOf(cp))
  }
  return (top * size) / EM
}

function inkTopOf(cp: number): number {
  if (cp > SPACE && cp <= 0x7e) {
    return SEMIBOLD_TOPS[cp - SPACE - 1] ?? 0
  }
  if (cp === SPACE || cp === NBSP) {
    return 0
  }
  return isWide(cp) ? CJK_TOP : CAP_TOP
}

/**
 * The ink of Georgia Bold's “ per 1000 px, the large opening quote before
 * the pitch: where it starts right of its origin, where it ends, and how far
 * it reaches above the baseline.
 */
export const QUOTE_INK = { left: 35.2, right: 471.7, top: 745.1 } as const
