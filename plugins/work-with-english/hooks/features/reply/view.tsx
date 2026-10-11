import type { Elements, RenderElement } from 'claude-code'

import type { WwePara } from '../../../types'
import { progressInline } from '../../core/copy/common'
import type { Block } from '../../core/text/segment'

// A reply as F6 draws it: each paragraph as Claude Code draws it, its
// translation in grey right under it, and, under the pointer, the buttons at
// the paragraph's bottom right, laid over its last line (P23).

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
}

/** 翻译, 收起译文, or 翻译中… while it asks */
export const toggleLabel = (para: WwePara) =>
  para.status === 'pending' ? progressInline('翻译') : para.status === 'done' && para.shown ? '收起译文' : '翻译'

/** The longest text one Markdown takes on 2.1.288 */
const MARKDOWN_MAX = 10_000

export function replyView(ui: ReplyUi, parts: readonly ReplyPart[], actions: ReplyActions) {
  const { Box, Text, Button, Markdown } = ui
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
            <Markdown text={(para.zh ?? '').slice(0, MARKDOWN_MAX)} dimColor />
          )
        return (
          <Box key={`para-${index}-${block.hash}`} flexDirection="column" paddingLeft={index === 0 ? 0 : 2}>
            {drawn}
            {under && <Box paddingLeft={indent}>{under}</Box>}
            {hasButtons && (
              <Box position="absolute" right={0} bottom={0} display="none" hover={{ display: 'flex' }}>
                <Button key={`toggle-${index}`} label={toggleLabel(para)} onPress={() => actions.toggle(block)} />
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}
