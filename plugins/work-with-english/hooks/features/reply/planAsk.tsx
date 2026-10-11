import type { RenderElement } from 'claude-code'

import type { WwePara } from '../../../types'
import { progressInline } from '../../core/copy/common'
import { hash } from '../../core/hash'
import type { Block } from '../../core/text/segment'
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
 * A line's translation. Around the question dialog only plain Text may go
 * (Claude Code refuses a Markdown there: its rows are not bounded).
 */
const under = (ui: ReplyUi, para: WwePara, isPlain: boolean) => {
  const { Text } = ui
  if (para.status === 'pending') {
    return <Text dimColor>{progressInline('翻译')}</Text>
  }
  if (para.status === 'failed') {
    return <Text dimColor>{para.error ?? ''}</Text>
  }
  if (!para.zh) {
    return null
  }
  return isPlain ? <Text dimColor>{para.zh}</Text> : translationOf(ui, para.zh)
}

/** The dialog's translation above it, its options numbered as the dialog numbers them. */
export function askView(ui: ReplyUi, lines: readonly AskLine[], paras: readonly WwePara[], drawn: RenderElement) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column">
      <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
        {lines.map((line, i) => {
          const para = paras[i]
          if (!para || para.status === 'none') {
            return null
          }
          return (
            <Box key={`ask-${i}`} flexDirection="row" paddingLeft={line.isOption ? (line.number > 0 ? 2 : 5) : 0} columnGap={1}>
              {line.number > 0 && <Text dimColor>{`${line.number}.`}</Text>}
              {under(ui, para, true)}
            </Box>
          )
        })}
      </Box>
      {drawn}
    </Box>
  )
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
          return <Box key={`plan-${i}-${block.hash}`}>{under(ui, para, false)}</Box>
        })}
      </Box>
    </Box>
  )
}
