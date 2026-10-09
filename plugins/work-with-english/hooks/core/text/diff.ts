import type { WweMark } from '../../../types'

// F15: which words of a correction the band marks. Worked out here, word by
// word, rather than taken from positions the model returns (dev-plan, 模块划分).
//
// - Words the correction changed or added are marked; words next to each
//   other in one change are one span, so a Chinese fragment put into English
//   is marked whole.
// - Punctuation alone is never marked: "error" → "error?" stays unmarked.
// - Deleted words are not shown. When English words were only taken out, the
//   word right after the gap is marked instead ("I have fixed" → "I fixed"
//   marks "fixed"), so the change is still visible.

type Kind = 'word' | 'han' | 'punct'
type Token = { text: string; kind: Kind; start: number; end: number }

const TOKEN =
  /(\p{Script=Han}+)|((?:(?!\p{Script=Han})[\p{L}\p{M}\p{N}_])+(?:['’-](?:(?!\p{Script=Han})[\p{L}\p{M}\p{N}_])+)*)|(\S)/gu

// Above this many table cells the middle of the two texts is treated as one
// change: a pause must never stall on an enormous Prompt.
const MAX_CELLS = 4_000_000

/** The spans of `corrected` (character offsets, end exclusive) to mark. */
export function diffMarks(original: string, corrected: string): WweMark[] {
  const a = tokenize(original)
  const b = tokenize(corrected)
  const marks: WweMark[] = []
  let lastA = -1
  let lastB = -1
  for (const [ia, ib] of [...matchPairs(a, b), [a.length, b.length] as const]) {
    const deleted = a.slice(lastA + 1, ia)
    const added = b.slice(lastB + 1, ib).filter((t) => t.kind !== 'punct')
    const first = added[0]
    const last = added[added.length - 1]
    if (first && last) {
      marks.push({ start: first.start, end: last.end })
    } else if (deleted.some((t) => t.kind === 'word')) {
      const next = b[ib]
      if (next?.kind === 'word') marks.push({ start: next.start, end: next.end })
    }
    lastA = ia
    lastB = ib
  }
  return marks
}

/** English words (with ' and - inside), runs of Chinese, and single punctuation marks; spaces are not tokens. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  for (const m of text.matchAll(TOKEN)) {
    const kind: Kind = m[1] ? 'han' : m[2] ? 'word' : 'punct'
    const start = m.index ?? 0
    tokens.push({ text: m[0], kind, start, end: start + m[0].length })
  }
  return tokens
}

/** The index pairs of one longest common subsequence, in order. */
function matchPairs(a: readonly Token[], b: readonly Token[]): Array<readonly [number, number]> {
  const same = (i: number, j: number) => a[i]?.text === b[j]?.text
  let lo = 0
  while (lo < a.length && lo < b.length && same(lo, lo)) lo++
  let endA = a.length
  let endB = b.length
  while (endA > lo && endB > lo && same(endA - 1, endB - 1)) {
    endA--
    endB--
  }

  const pairs: Array<readonly [number, number]> = []
  for (let k = 0; k < lo; k++) pairs.push([k, k])

  const n = endA - lo
  const m = endB - lo
  if (n > 0 && m > 0 && n * m <= MAX_CELLS) {
    // suffix[i][j]: the LCS length of a[lo+i..] and b[lo+j..] within the middle
    const width = m + 1
    const suffix = new Int32Array((n + 1) * width)
    const at = (i: number, j: number) => suffix[i * width + j] ?? 0
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        suffix[i * width + j] = same(lo + i, lo + j) ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (same(lo + i, lo + j)) {
        pairs.push([lo + i, lo + j])
        i++
        j++
      } else if (at(i + 1, j) >= at(i, j + 1)) {
        i++
      } else {
        j++
      }
    }
  }

  for (let k = 0; k < a.length - endA; k++) pairs.push([endA + k, endB + k])
  return pairs
}
