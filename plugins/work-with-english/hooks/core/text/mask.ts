// The parts of a text that language judging leaves out and translation keeps
// as they are (docs/feature-map.md, 语言判断 › 不参与判断的部分): code, pasted
// content and its placeholders, and the names written in visible ASCII (URLs,
// paths, file names, @ mentions, slash commands, flags). A name ends at the
// first character outside visible ASCII, so in 看看src/app.ts的问题 the Chinese
// on both sides still counts.

export type MaskKind =
  /** ```…```; an unclosed fence runs to the end, as Markdown reads it */
  | 'codeBlock'
  /** `…`, or a pair of · around text: the Chinese IME types · for the backtick key */
  | 'inlineCode'
  /** <pasted_content id="…">…</pasted_content id="…">, a long paste as prompt.submit receives it */
  | 'pasted'
  /** [Image #N] */
  | 'image'
  /** [Pasted text #N +M lines], a long paste as the Prompt shows it */
  | 'pastedText'
  /** A scheme's ://, or an e-mail address */
  | 'url'
  | 'mention'
  | 'flag'
  /** A /name in a sentence; command.ts tells whether a leading one is a command */
  | 'command'
  | 'path'
  | 'file'

export type MaskSpan = { start: number; end: number; kind: MaskKind }

// Tried in this order at each position. An unpaired backtick or · is plain
// text, and so is a · with a space on its inner side: that is a separator
// (A · B), not code.
const BLOCKS: readonly [MaskKind, RegExp][] = [
  ['codeBlock', /```[\s\S]*?(?:```|$)/],
  ['pasted', /<pasted_content\b[^>]*>[\s\S]*?(?:<\/pasted_content\b[^>]*>|$)/],
  ['inlineCode', /``[^`\n][^\n]*?``|`[^`\n]+`|·(?=[^\s·])[^·\n]*?[^\s·]·/],
  ['image', /\[Image #\d+\]/],
  ['pastedText', /\[Pasted text #\d+[^\]\n]*\]/],
]
const BLOCK = new RegExp(BLOCKS.map(([, re]) => `(${re.source})`).join('|'), 'g')

const ASCII_RUN = /[\x21-\x7e]+/g
// Bounded, as schemes are short: unbounded, it is quadratic on a long run of ASCII
const SCHEME = /[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\//
const EMAIL = /^[^@]+@[^@]+\.[A-Za-z]{2,}$/
const FLAG = /^--?[A-Za-z][\w-]*(?:=[\x21-\x7e]*)?$/
const COMMAND = /^\/[A-Za-z][\w:-]*$/
const PATH = /[/\\]/

/** The left-out parts of `text`, in order and not overlapping. */
export function maskSpans(text: string): MaskSpan[] {
  const spans: MaskSpan[] = []
  let gap = 0
  for (const m of text.matchAll(BLOCK)) {
    const start = m.index ?? 0
    addNames(text, gap, start, spans)
    const group = m.slice(1).findIndex(g => g !== undefined)
    spans.push({ start, end: start + m[0].length, kind: BLOCKS[group]?.[0] ?? 'codeBlock' })
    gap = start + m[0].length
  }
  addNames(text, gap, text.length, spans)
  return spans
}

/** `text` with each left-out part replaced by a space, so the words around it stay apart. */
export function visibleText(text: string): string {
  let out = ''
  let at = 0
  for (const span of maskSpans(text)) {
    out += `${text.slice(at, span.start)} `
    at = span.end
  }
  return out + text.slice(at)
}

function addNames(text: string, from: number, to: number, out: MaskSpan[]) {
  const gap = text.slice(from, to)
  for (const m of gap.matchAll(ASCII_RUN)) {
    const start = from + (m.index ?? 0)
    const span = nameSpan(text, start, start + m[0].length)
    if (span) {
      out.push(span)
    }
  }
}

function nameSpan(text: string, runStart: number, runEnd: number): MaskSpan | null {
  const [start, end] = trimRun(text, runStart, runEnd)
  if (start >= end) {
    return null
  }
  const name = text.slice(start, end)
  const scheme = name.includes('://') ? SCHEME.exec(name) : null
  // A URL may sit inside Markdown's [text](…); the text before it is still language
  if (scheme) {
    const [urlStart, urlEnd] = trimRun(text, start + scheme.index, end)
    return { start: urlStart, end: urlEnd, kind: 'url' }
  }
  const kind: MaskKind | null =
    name.length > 1 && name.startsWith('@')
      ? 'mention'
      : EMAIL.test(name)
        ? 'url'
        : FLAG.test(name)
          ? 'flag'
          : COMMAND.test(name)
            ? 'command'
            : PATH.test(name)
              ? 'path'
              : isFileName(name)
                ? 'file'
                : null
  return kind ? { start, end, kind } : null
}

const OPENS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '<': '>' }
const CLOSES: Record<string, string> = { ')': '(', ']': '[', '}': '{', '>': '<' }

// What a sentence puts around a name is not the name's own: quotes, Markdown
// emphasis, a closing period or comma, and a bracket left unpaired.
function trimRun(text: string, start: number, end: number): [number, number] {
  let a = start
  let b = end
  for (;;) {
    const c = text[a] ?? ''
    const close = OPENS[c]
    if (a < b && ('"\'*'.includes(c) || (close !== undefined && !text.slice(a + 1, b).includes(close)))) {
      a++
    } else {
      break
    }
  }
  for (;;) {
    const c = text[b - 1] ?? ''
    const open = CLOSES[c]
    if (b > a && ('.,;:!?"\'*'.includes(c) || (open !== undefined && !text.slice(a, b - 1).includes(open)))) {
      b--
    } else {
      break
    }
  }
  return [a, b]
}

// name.ext, a.b.ext or .dotfile, the extension starting with a letter: so
// v1.2.3 and 3.14 are not file names. A line and column may follow, as
// developers cite them (app.ts:42). Single letters joined by dots are
// abbreviations (e.g., i.e., U.S.), which a reply translation should
// translate. Split rather than one pattern, which would backtrack on a long
// run of ASCII.
function isFileName(name: string): boolean {
  const parts = name.replace(/(?::\d+){1,2}$/, '').split('.')
  if (parts.every(part => part.length === 1)) {
    return false
  }
  const ext = parts.pop()
  if (ext === undefined || parts.length === 0 || !/^[A-Za-z][\w-]*$/.test(ext)) {
    return false
  }
  return parts.every((part, i) => (i === 0 ? /^[\w-]*$/ : /^[\w-]+$/).test(part))
}
