import type { Elements, RenderElement } from 'claude-code'

import type { WwePara } from '../../../types'
import { progressInline } from '../../core/copy/common'

// F6 on the desktop: a tool call's row shows the description Claude gave the
// call ("Verified the workflow, …"), so its translation goes under the row,
// folded or unfolded. A group's own line only counts its calls: left as it is.

export type ToolLineUi = Pick<Elements['terminal'] | Elements['desktop'], 'Box' | 'Text'>

/** The description Claude gave a call (Bash's, a subagent's), when it gave one */
export function descriptionOf(input: unknown): string | null {
  const value = typeof input === 'object' && input !== null ? (input as { description?: unknown }).description : undefined
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

export function toolLineView(ui: ToolLineUi, drawn: RenderElement, para: WwePara) {
  const { Box, Text } = ui
  const under = para.status === 'pending' ? progressInline('翻译') : para.status === 'done' ? para.zh : null
  if (!under) {
    return drawn
  }
  return (
    <Box flexDirection="column">
      {drawn}
      <Text dimColor>{under}</Text>
    </Box>
  )
}
