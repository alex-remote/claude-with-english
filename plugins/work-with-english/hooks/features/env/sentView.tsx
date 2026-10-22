import type { Elements, RenderElement } from 'claude-code'

import type { WwePara } from '../../../types'
import { progressInline } from '../../core/copy/common'

// A message a summary card's button sent: written by Claude, not by the
// person, so drawn with its translation under the bubble, on its right.

export type SentUi = Pick<Elements['terminal'] | Elements['desktop'], 'Box' | 'Text'>

export function sentView(ui: SentUi, drawn: RenderElement, para: WwePara) {
  const { Box, Text } = ui
  const under = para.status === 'pending' ? progressInline('翻译') : para.status === 'done' ? para.zh : null
  if (!under) {
    return drawn
  }
  return (
    <Box flexDirection="column">
      {drawn}
      <Box alignSelf="flex-end">
        <Text dimColor>{under}</Text>
      </Box>
    </Box>
  )
}
