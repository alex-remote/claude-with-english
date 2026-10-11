import { SHORTCUT_FIXED, SHORTCUT_KEY, SHORTCUT_NOTES, SHORTCUT_ROWS } from '../../../core/copy/settings'
import { note } from '../controls'
import type { PaneUi } from '../controls'

// The 快捷键 page: what Control+A does, which can't be changed (快捷键和按钮),
// and how it fares under tmux and screen.

export function shortcutsPage(ui: PaneUi) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        {SHORTCUT_ROWS.map((row, index) => (
          <Box key={`shortcut-${index}`} flexDirection="row" columnGap={2}>
            {/* Only the description wraps in a narrow pane */}
            <Box flexShrink={0}>
              <Text bold>{SHORTCUT_KEY}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text>{row}</Text>
            </Box>
            <Box flexShrink={0}>
              <Text dimColor>{SHORTCUT_FIXED}</Text>
            </Box>
          </Box>
        ))}
      </Box>
      {SHORTCUT_NOTES.map(text => note(ui, text))}
    </Box>
  )
}
