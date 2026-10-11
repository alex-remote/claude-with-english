import { DESCRIPTIONS, FIELD_SUBMIT, ITEM_NAMES } from '../../../core/copy/settings'
import { alone, errorLine, note, switchRow } from '../controls'
import type { PaneActions, PaneUi, PaneVm } from '../controls'

// The 单词本 page (F12): the lists of words and sentences (features/wordbook
// draws them into the page's slot), then 同步到 Anki with its status line
// (in the slot too) and 牌组.

export function wordbookPage(ui: PaneUi, vm: PaneVm, actions: PaneActions) {
  const { Box, Input } = ui
  const { settings } = vm
  return (
    <Box flexDirection="column" rowGap={1}>
      {vm.slots.wordbook}
      <Box flexDirection="column">
        {switchRow(ui, 'anki-sync', ITEM_NAMES.ankiSync, settings.ankiSync, () => actions.flip('ankiSync'))}
        {note(ui, DESCRIPTIONS.ankiSync)}
      </Box>
      <Box flexDirection="column">
        {alone(
          ui,
          <Input
            key={vm.key('anki-deck')}
            label={ITEM_NAMES.ankiDeck}
            value={vm.fieldText('ankiDeck', settings.ankiDeck)}
            submitLabel={FIELD_SUBMIT}
            onInput={text => actions.edit('ankiDeck', text)}
            onSubmit={text => actions.submit('ankiDeck', text)}
          />,
        )}
        {errorLine(ui, vm.pane.errors.ankiDeck)}
        {note(ui, DESCRIPTIONS.ankiDeck)}
      </Box>
    </Box>
  )
}
