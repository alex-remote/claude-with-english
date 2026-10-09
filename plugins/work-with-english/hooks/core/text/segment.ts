import { hash } from '../hash'

// F6 段落对照: a reply's Markdown cut into the pieces that each get their own
// translation underneath. Line-based on purpose: the cuts only need to agree
// with what a reader sees as one paragraph, not to parse every CommonMark rule.

export type BlockKind = 'para' | 'list' | 'heading' | 'table' | 'quote' | 'code'

/** One piece of a reply: its kind, its Markdown as written, and the hash its translation is cached under. */
export type Block = { kind: BlockKind; text: string; hash: string }

const BLANK = /^\s*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})/
const NESTED_FENCE = /^[ \t]*(`{3,}|~{3,})/
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/
const RULE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/
const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/
const QUOTE = /^ {0,3}>/
const ITEM = /^ *(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/
const LIST_START = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/
// As in CommonMark, only a bullet or "1." starts a list inside a paragraph,
// so a sentence that happens to begin "2. " stays where it is.
const LIST_IN_PARA = /^ {0,3}(?:[-*+]|1[.)])[ \t]+\S/
const DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/

export function segment(markdown: string): Block[] {
  const lines = markdown.split(/\r?\n/)
  const blocks: Block[] = []
  const push = (kind: BlockKind, from: number, to: number) => {
    const text = lines.slice(from, to).join('\n')
    blocks.push({ kind, text, hash: hash(text) })
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (BLANK.test(line)) {
      i++
    } else if (FENCE.test(line)) {
      const end = fenceEnd(lines, i)
      push('code', i, end)
      i = end
    } else if (HEADING.test(line) || RULE.test(line)) {
      // A rule is only symbols: its own block, which needsTranslation skips.
      push(HEADING.test(line) ? 'heading' : 'para', i, i + 1)
      i++
    } else if (isTableStart(lines, i)) {
      const end = runEnd(lines, i + 2, (l) => l.includes('|'))
      push('table', i, end)
      i = end
    } else if (QUOTE.test(line)) {
      const end = runEnd(lines, i + 1, (l, j) => QUOTE.test(l) || !startsBlock(lines, j))
      push('quote', i, end)
      i = end
    } else if (LIST_START.test(line)) {
      const end = listEnd(lines, i)
      push('list', i, end)
      i = end
    } else {
      let end = i + 1
      let kind: BlockKind = 'para'
      while (end < lines.length) {
        const next = lines[end] ?? ''
        if (BLANK.test(next)) break
        if (SETEXT.test(next)) {
          kind = 'heading'
          end++
          break
        }
        if (startsBlock(lines, end)) break
        end++
      }
      push(kind, i, end)
      i = end
    }
  }
  return blocks
}

/** Code blocks are shown as they are; a block of symbols, digits or inline code alone has nothing to translate. */
export function needsTranslation(block: Block): boolean {
  if (block.kind === 'code') return false
  return /\p{L}/u.test(block.text.replace(/(`+)[\s\S]*?\1/g, ''))
}

/** The line after a fence's closing line, or the end when it never closes. */
function fenceEnd(lines: readonly string[], start: number): number {
  const open = NESTED_FENCE.exec(lines[start] ?? '')?.[1] ?? '```'
  // Any indent: a fence inside a list item closes as deep as it opened.
  const close = new RegExp(`^[ \\t]*${open[0] === '`' ? '`' : '~'}{${open.length},}[ \\t]*$`)
  for (let j = start + 1; j < lines.length; j++) {
    if (close.test(lines[j] ?? '')) return j + 1
  }
  return lines.length
}

function isTableStart(lines: readonly string[], i: number): boolean {
  const head = lines[i] ?? ''
  const delimiter = lines[i + 1] ?? ''
  return head.includes('|') && delimiter.includes('|') && DELIMITER.test(delimiter)
}

/** A line that ends a paragraph, a quote's lazy lines, or a list's unindented lines. */
function startsBlock(lines: readonly string[], j: number): boolean {
  const line = lines[j] ?? ''
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    LIST_IN_PARA.test(line) ||
    isTableStart(lines, j)
  )
}

/** The first line from `from` on that is blank or fails `keep`. */
function runEnd(lines: readonly string[], from: number, keep: (line: string, j: number) => boolean): number {
  let j = from
  while (j < lines.length) {
    const line = lines[j] ?? ''
    if (BLANK.test(line) || !keep(line, j)) break
    j++
  }
  return j
}

// One list is one block, nested items, continuation lines and the blank
// lines between loose items included; it ends at a blank line followed by
// something unindented that is not another item, or at another block.
function listEnd(lines: readonly string[], start: number): number {
  const continues = (line: string) => (ITEM.test(line) && !RULE.test(line)) || indentOf(line) >= 2
  let j = start + 1
  while (j < lines.length) {
    const line = lines[j] ?? ''
    if (BLANK.test(line)) {
      let k = j
      while (k < lines.length && BLANK.test(lines[k] ?? '')) k++
      if (k < lines.length && continues(lines[k] ?? '')) {
        j = k
        continue
      }
      break
    }
    // Skipped whole, so a code line such as YAML's "---" does not end the list.
    if (indentOf(line) >= 2 && NESTED_FENCE.test(line)) {
      j = fenceEnd(lines, j)
      continue
    }
    if (RULE.test(line)) break
    if (!continues(line) && startsBlock(lines, j)) break
    j++
  }
  return j
}

function indentOf(line: string): number {
  let n = 0
  for (const ch of line) {
    if (ch === ' ') n++
    else if (ch === '\t') n += 4
    else break
  }
  return n
}
