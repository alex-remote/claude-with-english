// F8: what 朗读 reads. 不读的 are taken out (code blocks, inline code's
// backticks, list markers and numbers, table pipes, heading #, quote >), and
// what is left is cut into pieces read one after another, since
// `$.audio.speak` and OpenAI's speech endpoint each take at most 4096 characters.

export const SPEAK_MAX_CHARS = 4096

const FENCE = /^[ \t]*(`{3,}|~{3,})/
const QUOTE = /^[ \t]*(?:>[ \t]?)+/
const HEADING = /^[ \t]*#{1,6}(?:[ \t]+|$)/
const HEADING_CLOSE = /[ \t]+#+[ \t]*$/
const LIST_MARKER = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/
const DELIMITER = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/

/** The text to read, in pieces of at most 4096 characters; empty when nothing is left to read. */
export function speakable(markdown: string): string[] {
  const text = plain(markdown)
  if (!/[\p{L}\p{N}]/u.test(text)) return []
  return text.length <= SPEAK_MAX_CHARS ? [text] : pack(units(text, SPEAK_MAX_CHARS), SPEAK_MAX_CHARS)
}

function plain(markdown: string): string {
  const lines = markdown.split(/\r?\n/).map((line) => line.replace(QUOTE, ''))
  const out: string[] = []
  let fenceClose: RegExp | null = null
  let inTable = false
  lines.forEach((line, i) => {
    if (fenceClose) {
      if (fenceClose.test(line)) fenceClose = null
      return
    }
    const fence = FENCE.exec(line)?.[1]
    if (fence) {
      fenceClose = new RegExp(`^[ \\t]*${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`)
      return
    }
    const next = lines[i + 1] ?? ''
    if (!line.includes('|')) {
      inTable = false
    } else if (!inTable && next.includes('|') && DELIMITER.test(next)) {
      inTable = true
    } else if (inTable && DELIMITER.test(line)) {
      return
    }

    let text = line
    if (HEADING.test(text)) {
      text = text.replace(HEADING, '').replace(HEADING_CLOSE, '')
    } else {
      text = text.replace(LIST_MARKER, '')
    }
    if (inTable) text = cells(text)
    out.push(text.replace(/`/g, '').trim())
  })
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** A table row's cells, the pipes between them read as pauses. */
function cells(row: string): string {
  return row
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell) => cell !== '')
    .join(', ')
}

/** Sentences; a sentence longer than `max` in words; a word longer than `max` in slices. */
function units(text: string, max: number): string[] {
  const sentences: string[] = []
  let from = 0
  for (const m of text.matchAll(/[.!?]+["'”’)\]]*\s+|[。！？]+["'”’)\]]*\s*|\n\s*/g)) {
    const end = (m.index ?? 0) + m[0].length
    sentences.push(text.slice(from, end))
    from = end
  }
  if (from < text.length) sentences.push(text.slice(from))

  return sentences.flatMap((sentence) =>
    sentence.length <= max
      ? [sentence]
      : (sentence.match(/\s*\S+\s*/g) ?? []).flatMap((word) => (word.length <= max ? [word] : slices(word, max))),
  )
}

/** Cut between code points, so no piece ends in half a surrogate pair. */
function slices(word: string, max: number): string[] {
  const out: string[] = []
  let current = ''
  for (const ch of word) {
    if (current.length + ch.length > max) {
      out.push(current)
      current = ''
    }
    current += ch
  }
  if (current) out.push(current)
  return out
}

/** As few pieces as the units fit in, each at most `max` long. */
function pack(units: readonly string[], max: number): string[] {
  const out: string[] = []
  let current = ''
  for (const unit of units) {
    if (current && current.length + unit.length > max) {
      out.push(current.trim())
      current = ''
    }
    current += unit
  }
  if (current.trim()) out.push(current.trim())
  return out.filter((piece) => piece !== '')
}
