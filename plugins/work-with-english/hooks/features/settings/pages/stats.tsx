import { DESCRIPTIONS, ITEM_NAMES } from '../../../core/copy/settings'
import { privacyNote } from '../../../core/copy/stats'
import { note, switchRow } from '../controls'
import type { PaneActions, PaneUi, PaneVm } from '../controls'

// The 统计 page (F13): the figures, the two charts and 生成分享卡 (features/
// stats draws them into the page's slot), then 每周提醒, and last the line
// on what the statistics keep.

export function statsPage(ui: PaneUi, vm: PaneVm, actions: PaneActions) {
  const { Box } = ui
  return (
    <Box flexDirection="column" rowGap={1}>
      {vm.slots.stats}
      <Box flexDirection="column">
        {switchRow(ui, 'weekly-reminder', ITEM_NAMES.weeklyReminder, vm.settings.weeklyReminder, () =>
          actions.flip('weeklyReminder'),
        )}
        {note(ui, DESCRIPTIONS.weeklyReminder)}
      </Box>
      {note(ui, privacyNote())}
    </Box>
  )
}
