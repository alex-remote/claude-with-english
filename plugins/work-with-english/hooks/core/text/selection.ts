import type { WweSettings } from '../../../types'

// F9 划词翻译: what a selection (or, on the desktop, what ⌘C copied) is, whether
// the selection row shows for it, and the sentence it sits in for 本句.

export type SelectionClass =
  | { kind: 'word'; word: string }
  | { kind: 'text'; text: string }
  /** The row still shows the selection, clipped, before 选中的文字太长 */
  | { kind: 'long'; text: string }
  | { kind: 'none' }

export type SelectionKind = SelectionClass['kind']

/** Past this many characters a passage is only said to be too long */
export const SELECTION_MAX = 600

const HAN = /\p{Script=Han}/u
// Leading and trailing punctuation comes off first: a double-click on config. takes the full stop along
const EDGES = /^([^\p{L}\p{N}]*)([\s\S]*?)([^\p{L}\p{N}]*)$/u
const WORDISH = /^\p{Script=Latin}[\p{Script=Latin}'’-]*(?: \p{Script=Latin}[\p{Script=Latin}'’-]*){0,3}$/u

function splitEdges(text: string): { core: string; tail: string } {
  const m = EDGES.exec(text)
  return { core: m?.[2] ?? '', tail: m?.[3] ?? '' }
}

export function classifySelection(raw: string): SelectionClass {
  const whole = raw.replace(/\s+/g, ' ').trim()
  const { core, tail } = splitEdges(whole)
  // A selected translation is only there to compare against, so Chinese never gets a row
  if (!/[A-Za-z]/.test(core) || HAN.test(core)) {
    return { kind: 'none' }
  }
  // Several words ending in . ? ! or : are a whole sentence (I found the cause.); one word with it is still a word
  const isSentence = core.includes(' ') && /[.?!:]/.test(tail)
  if (!isSentence && WORDISH.test(core)) {
    return { kind: 'word', word: core }
  }
  // A passage keeps its own punctuation and line breaks; only the judging goes without them
  const text = raw.trim()
  return core.length > SELECTION_MAX ? { kind: 'long', text } : { kind: 'text', text }
}

/**
 * Whether the selection row shows: in 段落模式 only for a word or a phrase,
 * so copying code or a path doesn't bring it up; in 划选模式 for any English.
 * A word is looked up in code as in prose, but a passage all in code doesn't
 * show. `inCode`: the terminal tells from the reply's Markdown; the desktop
 * app can't, so it passes `looksLikeCode(text)`.
 */
export function shouldShow(kind: SelectionKind, readingMode: WweSettings['readingMode'], inCode = false): boolean {
  if (kind === 'none') {
    return false
  }
  return kind === 'word' || (readingMode === 'select' && !inCode)
}

const SHELL = /^(?:\$\s+\S|(?:npx|npm|pnpm|yarn|bun|bunx|git|cd|node|python3?|pip3?|brew|curl)\s)/
// What prose almost never has: an arrow, a brace, a line ending in ;, a declaration, an import, a comment
const CODE_MARK = /=>|[{}]|;$|^(?:const|let|var)\s+[\w$]+\s*[=:]|^import\s.*\sfrom\s+['"]|^(?:\/\/|\/\*|#\s)/
const PLAIN_WORD = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/

const isPlainWord = (token: string) =>
  PLAIN_WORD.test(token.replace(/^[(["'“‘]+/, '').replace(/[.,;:!?)\]"'”’]+$/, ''))

function isCodeLine(line: string): boolean {
  if (SHELL.test(line) || CODE_MARK.test(line)) {
    return true
  }
  const tokens = line.split(/\s+/)
  return tokens.filter(isPlainWord).length * 2 < tokens.length
}

/**
 * The desktop app can't say whether copied text came from code, so a passage
 * counts as code when every line of it looks like code: a shell command, a
 * code mark, or fewer plain words than other tokens. A sentence with a path in
 * it is still prose.
 */
export function looksLikeCode(text: string): boolean {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.length > 0 && lines.every(isCodeLine)
}

const HEADING = /^#{1,6}\s+/
const LIST_ITEM = /^(?:[-*+]|\d+[.)])\s+/
const TABLE_RULE = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/
// Code spans keep their text (the terminal shows inline code without backticks), links keep their label,
// and emphasis markers go
const INLINE = /(`+)([\s\S]+?)\1|!?\[([^\]]*)\]\([^)]*\)|\*\*|~~|(?<![\w*])\*(?=[^\s*])|(?<=[^\s*])\*(?![\w*])/g

const plainInline = (s: string) =>
  s.replace(INLINE, (_m, _ticks, code: string | undefined, label: string | undefined) => code ?? label ?? '')

/** The prose of a reply as the screen shows it: one string per paragraph, list item, heading or table cell. */
function proseBlocks(markdown: string): string[] {
  const blocks: string[] = []
  let para: string[] = []
  let fence = ''
  const flush = () => {
    if (para.length > 0) {
      blocks.push(plainInline(para.join(' ')))
      para = []
    }
  }
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim()
    const opens = /^(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      if (opens && opens[0] === fence[0] && opens.length >= fence.length) {
        fence = ''
      }
      continue
    }
    if (opens) {
      flush()
      fence = opens
      continue
    }
    const unquoted = line.replace(/^(?:>\s?)+/, '')
    if (!unquoted) {
      flush()
      continue
    }
    if (unquoted.startsWith('|')) {
      flush()
      if (!TABLE_RULE.test(unquoted)) {
        for (const cell of unquoted.split(/(?<!\\)\|/)) {
          if (cell.trim()) {
            blocks.push(plainInline(cell.trim()))
          }
        }
      }
      continue
    }
    if (HEADING.test(unquoted)) {
      flush()
      blocks.push(plainInline(unquoted.replace(HEADING, '')))
      continue
    }
    // A list item's lazy continuation lines stay with it
    if (LIST_ITEM.test(unquoted)) {
      flush()
      para.push(unquoted.replace(LIST_ITEM, ''))
      continue
    }
    para.push(unquoted)
  }
  flush()
  return blocks
}

// A sentence ends at . ? or ! with whitespace after it and no lowercase word next (so e.g. the stays whole)
const SENTENCE_END = /[.?!]+["'”’)\]]*(?=\s+(?![\sa-z])|$)/g

function sentenceSpans(block: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  let start = 0
  for (const m of block.matchAll(SENTENCE_END)) {
    const end = m.index + m[0].length
    spans.push([start, end])
    start = end
  }
  if (block.slice(start).trim()) {
    spans.push([start, block.length])
  }
  return spans
}

/**
 * How many sentences a selected passage touches, for F11's 这句的难词: each
 * of its lines (a paragraph, a list item) split as sentenceOf splits a
 * block. A sentence cut short by the selection still counts as one.
 */
export function sentenceCount(text: string): number {
  return text
    .split('\n')
    // A list item's marker (1. or -) is no sentence of its own, as in proseBlocks
    .map((line) => line.replace(/\s+/g, ' ').trim().replace(LIST_ITEM, ''))
    .filter(Boolean)
    .reduce((count, line) => count + sentenceSpans(line).length, 0)
}

function matcherOf(selected: string): RegExp | null {
  const { core } = splitEdges(selected.trim())
  if (!core) {
    return null
  }
  const body = core
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’]/g, "['’]"))
    .join('\\s+')
  // Not part of a longer word or of a hyphenated one: cause isn't in because, dry isn't in --dry-run,
  // but dry-run is
  return new RegExp(`(?<![\\p{L}\\p{N}_]|[\\p{L}\\p{N}]-)${body}(?![\\p{L}\\p{N}_]|-[\\p{L}\\p{N}])`, 'iu')
}

/**
 * The sentence of a reply's Markdown that the selected text sits in, taken
 * at its first appearance in the prose, for 本句. Code blocks don't count.
 * Null when the text isn't in the prose.
 */
export function sentenceOf(markdown: string, selectedText: string): string | null {
  const re = matcherOf(selectedText)
  if (!re) {
    return null
  }
  for (const block of proseBlocks(markdown)) {
    const m = re.exec(block)
    if (!m) {
      continue
    }
    const from = m.index
    const to = from + m[0].length
    const spans = sentenceSpans(block).filter(([s, e]) => e > from && s < to)
    const first = spans[0]
    const last = spans[spans.length - 1]
    return first && last ? block.slice(first[0], last[1]).trim() : null
  }
  return null
}

/**
 * The desktop app can't say which reply copied text came from, so 本句 is the
 * sentence in the newest reply that has the word. `replies` are Markdown,
 * oldest first.
 */
export function findSentenceInReplies(replies: readonly string[], word: string): string | null {
  for (let i = replies.length - 1; i >= 0; i--) {
    const found = sentenceOf(replies[i] ?? '', word)
    if (found) {
      return found
    }
  }
  return null
}
