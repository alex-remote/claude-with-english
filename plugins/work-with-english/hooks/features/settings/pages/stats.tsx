import { DESCRIPTIONS, ITEM_NAMES } from '../../../core/copy/settings'
import { note, switchRow } from '../controls'
import type { PaneActions, PaneUi, PaneVm } from '../controls'

// The 统计 page's setting (F13). The figures, the two charts and the share
// card above it come with M8.

export function statsPage(ui: PaneUi, vm: PaneVm, actions: PaneActions) {
  const { Box } = ui
  return (
    <Box flexDirection="column">
      {switchRow(ui, 'weekly-reminder', ITEM_NAMES.weeklyReminder, vm.settings.weeklyReminder, () =>
        actions.flip('weeklyReminder'),
      )}
      {note(ui, DESCRIPTIONS.weeklyReminder)}
    </Box>
  )
}
