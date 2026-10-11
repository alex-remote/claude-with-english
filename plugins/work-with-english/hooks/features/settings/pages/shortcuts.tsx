import { DESCRIPTIONS, ITEM_NAMES, SHORTCUT_FIXED, SHORTCUT_KEY, SHORTCUT_NOTES, SHORTCUT_ROWS } from '../../../core/copy/settings'
import { GROUP, note, switchRow } from '../controls'
import type { PaneActions, PaneUi, PaneVm } from '../controls'

// The 快捷键 page: what Control+A does, which can't be changed (快捷键和按钮),
// whether the band shows its two buttons too, and how Control+A fares under
// tmux and screen.

export function shortcutsPage(ui: PaneUi, vm: PaneVm, actions: PaneActions) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box {...GROUP}>
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
      <Box {...GROUP}>
        {switchRow(ui, 'band-buttons', ITEM_NAMES.bandButtons, vm.settings.bandButtons, () => actions.flip('bandButtons'))}
        {note(ui, DESCRIPTIONS.bandButtons)}
      </Box>
      {SHORTCUT_NOTES.map(text => note(ui, text))}
    </Box>
  )
}
