import type { RenderElement } from 'claude-code'

import type { WwePara } from '../../../types'
import { CARD_ASK, askNumbered } from '../../core/copy/card'
import { progressInline } from '../../core/copy/common'
import { hash } from '../../core/hash'
import { NO_PARA } from '../../core/state/defaults'
import type { Block } from '../../core/text/segment'
import { cardSection, shownOf } from '../env/nextStep'
import { translationOf } from './view'
import type { ReplyUi } from './view'

// F6 › 计划和提问: the lines of a question Claude asks, translated above its
// dialog (the dialog itself is Claude Code's and stays as it is), and the
// plan, translated under it once approved (P16: the plan's text arrives with
// the result of the call that leaves plan mode).

/** One line of an AskUserQuestion dialog to translate: a question, or one of its options */
export type AskLine = { text: string; isOption: boolean; number: number }

/** The questions and options of the tool's `questions` input, as the dialog draws them. */
export function askLines(questions: readonly unknown[]): AskLine[] {
  const lines: AskLine[] = []
  for (const question of questions) {
    if (typeof question !== 'object' || question === null) {
      continue
    }
    const { question: text, options } = question as { question?: unknown; options?: unknown }
    if (typeof text === 'string' && text.trim() !== '') {
      lines.push({ text, isOption: false, number: 0 })
    }
    if (Array.isArray(options)) {
      options.forEach((option, i) => {
        const label = typeof option === 'object' && option !== null ? (option as { label?: unknown }).label : undefined
        const description =
          typeof option === 'object' && option !== null ? (option as { description?: unknown }).description : undefined
        if (typeof label === 'string' && label.trim() !== '') {
          lines.push({ text: label, isOption: true, number: i + 1 })
        }
        if (typeof description === 'string' && description.trim() !== '') {
          lines.push({ text: description, isOption: true, number: 0 })
        }
      })
    }
  }
  return lines
}

/** A line as the translation pipeline takes it: one paragraph, keyed by its text */
export const blockOfLine = (line: AskLine): Block => ({ kind: 'para', text: line.text, hash: hash(line.text) })

/** The plan's text from the result of the call that left plan mode, if it carries one */
export function planOf(output: unknown): string | null {
  if (typeof output !== 'object' || output === null) {
    return null
  }
  const plan = (output as { plan?: unknown }).plan
  return typeof plan === 'string' && plan.trim() !== '' ? plan : null
}

/**
 * The rows above the dialog: at most 12 in the terminal and 48 on the
 * desktop, counted at 40 columns; a taller tree is refused and the dialog
 * drawn alone (2.1.304 types, `RenderPropsOf['AskUserQuestion']`).
 */
export const askRows = (surface: string) => (surface === 'terminal' ? 12 : 48)
const ASK_COLUMNS = 40

/** Columns a text takes: two for a wide character (Han, kana, Hangul, full-width forms) */
function columnsOf(text: string): number {
  let columns = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      code >= 0x20000
    columns += isWide ? 2 : 1
  }
  return columns
}

/**
 * The dialog's translation in the summary card's form (features/env/nextStep):
 * per question a paragraph, "问题：" and its translation ("问题 1/2：" when the
 * dialog asks several, as it shows them one by one), then "- " and each
 * option's, with its description's after "：". A text not translated reads
 * as 翻译中…, why it failed, or its own words.
 */
export function askParagraphs(lines: readonly AskLine[], paras: readonly WwePara[], withDescriptions: boolean): string[][] {
  const paragraphs: string[][] = []
  const total = lines.filter(line => !line.isOption).length
  lines.forEach((line, i) => {
    const shown = shownOf(paras[i] ?? NO_PARA) ?? line.text
    const current = paragraphs.at(-1)
    if (!line.isOption || !current) {
      paragraphs.push([`${total > 1 ? askNumbered(paragraphs.length + 1, total) : CARD_ASK}${shown}`])
    } else if (line.number > 0) {
      current.push(`- ${shown}`)
    } else if (withDescriptions && current.length > 1) {
      current[current.length - 1] += `：${shown}`
    }
  })
  return paragraphs
}

/** The rows the paragraphs take at 40 columns, each row after its quote or indent, and the rows around them */
function rowsTaken(paragraphs: readonly (readonly string[])[], isTerminal: boolean): number {
  const room = ASK_COLUMNS - 2
  const rows = paragraphs.flat().reduce((sum, row) => sum + Math.max(1, Math.ceil(columnsOf(row) / room)), 0)
  // The desktop's rule, title and the blank rows between them; a blank quote row between questions; the margin
  return rows + (isTerminal ? 0 : 4) + (isTerminal ? 0 : Math.max(0, paragraphs.length - 1)) + 1
}

/**
 * What goes above the dialog within its rows: all of it, else without the
 * options' descriptions, else the rows that fit from the top. None when no
 * line has a translation yet.
 */
export function askFitted(lines: readonly AskLine[], paras: readonly WwePara[], surface: string): string[][] {
  if (paras.every(para => para.status === 'none')) {
    return []
  }
  const isTerminal = surface === 'terminal'
  const budget = askRows(surface)
  for (const withDescriptions of [true, false]) {
    const paragraphs = askParagraphs(lines, paras, withDescriptions)
    if (rowsTaken(paragraphs, isTerminal) <= budget) {
      return paragraphs
    }
  }
  const fitted: string[][] = []
  for (const paragraph of askParagraphs(lines, paras, false)) {
    const kept: string[] = []
    for (const row of paragraph) {
      if (rowsTaken([...fitted, [...kept, row]], isTerminal) > budget) {
        return kept.length > 0 ? [...fitted, kept] : fitted
      }
      kept.push(row)
    }
    fitted.push(kept)
  }
  return fitted
}

/**
 * The dialog's translation above it, in the summary card's form: on the
 * desktop as its Markdown quote under a rule and a title; in the terminal,
 * which takes only plain Text there, as the same rows in grey.
 */
export function askView(ui: ReplyUi, lines: readonly AskLine[], paras: readonly WwePara[], drawn: RenderElement, surface: string) {
  const { Box, Text, Markdown } = ui
  const paragraphs = askFitted(lines, paras, surface)
  if (paragraphs.length === 0) {
    return drawn
  }
  if (surface !== 'terminal') {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Markdown text={cardSection(paragraphs.map(rows => rows.join('\n')))} />
        </Box>
        {drawn}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
        {paragraphs.flat().map((row, i) => (
          <Box key={`ask-${i}`}>
            <Text dimColor>{row}</Text>
          </Box>
        ))}
      </Box>
      {drawn}
    </Box>
  )
}

/** A plan paragraph's translation under it: 翻译中…, why it failed, or the translation */
const under = (ui: ReplyUi, para: WwePara) => {
  const { Text } = ui
  if (para.status === 'pending') {
    return <Text dimColor>{progressInline('翻译')}</Text>
  }
  if (para.status === 'failed') {
    return <Text dimColor>{para.error ?? ''}</Text>
  }
  return para.zh ? translationOf(ui, para.zh) : null
}

/** The approved plan as Claude Code draws it, its paragraphs' translations under it. */
export function planView(ui: ReplyUi, blocks: readonly Block[], paras: readonly WwePara[], drawn: RenderElement) {
  const { Box } = ui
  return (
    <Box flexDirection="column">
      {drawn}
      <Box flexDirection="column" paddingLeft={2} rowGap={1}>
        {blocks.map((block, i) => {
          const para = paras[i]
          if (!para || para.status === 'none' || !para.shown) {
            return null
          }
          return <Box key={`plan-${i}-${block.hash}`}>{under(ui, para)}</Box>
        })}
      </Box>
    </Box>
  )
}
