import type { Elements, RenderElement } from 'claude-code'

import type { WwePara, WweSpeaking } from '../../../types'
import { speakButton } from '../../core/copy/band'
import { progressInline } from '../../core/copy/common'
import type { Block } from '../../core/text/segment'

// A reply as F6 draws it: each paragraph as Claude Code draws it, its
// translation in grey right under it, and, under the pointer, 翻译, 朗读 and
// 解析 at the paragraph's bottom right, laid over its last line (P23).

export type ReplyUi = Pick<Elements['terminal'] | Elements['desktop'], 'Box' | 'Text' | 'Button' | 'Markdown'>

export type ReplyPart = {
  /** The paragraph as Claude Code drew it */
  drawn: RenderElement
  block: Block
  para: WwePara
  /** Only finished paragraphs in the target language get buttons; code never */
  hasButtons: boolean
}

export type ReplyActions = {
  toggle: (block: Block) => void
  /** F8: read this paragraph aloud */
  speak: (block: Block) => void
  /** F11: analyse this paragraph in the pane */
  analyse: (block: Block) => void
}

/** 翻译, 收起译文, or 翻译中… while it asks */
export const toggleLabel = (para: WwePara) =>
  para.status === 'pending' ? progressInline('翻译') : para.status === 'done' && para.shown ? '收起译文' : '翻译'

/** The longest text one Markdown takes on 2.1.288 */
export const MARKDOWN_MAX = 10_000

/** A code fence's opening line: its indent and its marks ("  ```" of "  ```ts") */
const FENCE = /^[ \t]*(?:`{3,}|~{3,})/

/** Whether the line closes the fence `opened` began: marks alone, as many or more, at any indent */
const isClosing = (line: string, opened: string) => {
  const marks = opened.trim()
  return new RegExp(`^[ \\t]*[${marks.charAt(0)}]{${marks.length},}[ \\t]*$`).test(line)
}

/** A line's slices of at most `room` characters, never cutting a character in two */
function slicesOf(line: string, room: number): string[] {
  const slices: string[] = []
  for (let at = 0; at < line.length || slices.length === 0; ) {
    let end = Math.min(line.length, at + room)
    if (end < line.length && end - at > 1 && /[\uDC00-\uDFFF]/.test(line.charAt(end))) {
      end -= 1
    }
    slices.push(line.slice(at, end))
    at = end
  }
  return slices
}

/**
 * The text's lines put in pieces of at most `max` characters, a piece ending
 * after a blank line outside code when one is in reach, else after any line.
 * Code cut in two is closed and opened again, so both halves draw as code.
 */
function piecesOf(text: string, max: number): string[] {
  const pieces: string[] = []
  let lines: string[] = []
  /** Where the piece being filled may end at a blank line: the lines before it */
  let lastBlank = 0
  /** The fence open after the lines so far: the line that opened it, and the line that closes it */
  let open: { line: string; close: string } | null = null
  const end = (count: number) => {
    const rest = lines.slice(count)
    pieces.push([...lines.slice(0, count), ...(open && count === lines.length ? [open.close] : [])].join('\n'))
    lines = open && count === lines.length ? [open.line] : rest
    lastBlank = 0
  }
  for (const whole of text.split('\n')) {
    const reserve = open ? open.line.length + open.close.length + 2 : 0
    for (const line of slicesOf(whole, Math.max(1, max - reserve - 1))) {
      const closing = open ? `\n${open.close}` : ''
      if (lines.length > 0 && `${[...lines, line].join('\n')}${closing}`.length > max) {
        // Back to the last blank line outside code when the rest still fits a piece
        end(lastBlank > 0 && open === null && [...lines.slice(lastBlank), line].join('\n').length <= max ? lastBlank : lines.length)
      }
      lines.push(line)
    }
    const fence = FENCE.exec(whole)?.[0]
    if (open === null && fence !== undefined) {
      open = { line: whole, close: fence }
    } else if (open !== null && isClosing(whole, open.close)) {
      open = null
    } else if (open === null && whole.trim() === '') {
      lastBlank = lines.length
    }
  }
  pieces.push(lines.join('\n'))
  return pieces.map(piece => piece.replace(/^\s*\n|\s+$/g, '')).filter(piece => piece !== '')
}

/**
 * A translation as Markdown texts of at most MARKDOWN_MAX characters each:
 * 2.1.288 refuses a longer one, and the rule is to cut it, not to drop the
 * rest (2.1.288 的写法规则 › 超长时按段拆成几个).
 */
export const markdownPieces = (text: string, max = MARKDOWN_MAX) => (text.length <= max ? [text] : piecesOf(text, max))

/** A translation in grey, in as many Markdown as its length takes */
export function translationOf(ui: ReplyUi, zh: string) {
  const { Box, Markdown } = ui
  const pieces = markdownPieces(zh)
  return pieces.length === 1 ? (
    <Markdown text={pieces[0] ?? ''} dimColor />
  ) : (
    <Box flexDirection="column">
      {pieces.map((piece, i) => (
        <Markdown key={`zh-${i}`} text={piece} dimColor />
      ))}
    </Box>
  )
}

export function replyView(ui: ReplyUi, parts: readonly ReplyPart[], actions: ReplyActions, speaking: WweSpeaking = null) {
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="column">
      {parts.map(({ drawn, block, para, hasButtons }, index) => {
        // The first paragraph's row carries Claude Code's ● and its two columns;
        // the ones after it are drawn bare and need the same indent (P22)
        const indent = index === 0 ? 2 : 0
        const under =
          !para.shown || para.status === 'none' ? null : para.status === 'pending' ? (
            <Text dimColor>{progressInline('翻译')}</Text>
          ) : para.status === 'failed' ? (
            <Text dimColor>{para.error ?? ''}</Text>
          ) : (
            translationOf(ui, para.zh ?? '')
          )
        return (
          <Box key={`para-${index}-${block.hash}`} flexDirection="column" paddingLeft={index === 0 ? 0 : 2}>
            {drawn}
            {under && <Box paddingLeft={indent}>{under}</Box>}
            {hasButtons && (
              <Box position="absolute" right={0} bottom={0} display="none" hover={{ display: 'flex' }} columnGap={1}>
                <Button key={`toggle-${index}`} label={toggleLabel(para)} onPress={() => actions.toggle(block)} />
                <Button
                  key={`speak-${index}`}
                  label={speakButton(speaking?.key === `para-${block.hash}` ? speaking.via : null)}
                  dimColor={speaking !== null && speaking.via === 'system' && speaking.key !== `para-${block.hash}`}
                  onPress={() => actions.speak(block)}
                />
                <Button key={`analyse-${index}`} label="解析" onPress={() => actions.analyse(block)} />
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}
