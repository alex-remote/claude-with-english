import type { WweTab } from '../../../types'
import { GITHUB_LABEL, PANE_TITLE, SETTINGS_TABS, TAB_LABELS } from '../../core/copy/settings'
import type { PaneActions, PaneUi, PaneVm } from './controls'
import { readingPage } from './pages/reading'
import { servicesPage } from './pages/services'
import { shortcutsPage } from './pages/shortcuts'
import { statsPage } from './pages/stats'
import { translatePage } from './pages/translate'
import { wordbookPage } from './pages/wordbook'

// The settings pane: its own title (a pane alone on screen draws none), the
// six tabs with GitHub at the right of their row, and the open page.

function pageOf(tab: WweTab, ui: PaneUi, vm: PaneVm, actions: PaneActions) {
  switch (tab) {
    case 'translate':
      return translatePage(ui, vm, actions)
    case 'reading':
      return readingPage(ui, vm, actions)
    case 'wordbook':
      return wordbookPage(ui, vm, actions)
    case 'services':
      return servicesPage(ui, vm, actions)
    case 'shortcuts':
      return shortcutsPage(ui)
    case 'stats':
      return statsPage(ui, vm, actions)
  }
}

export function paneView(ui: PaneUi, vm: PaneVm, actions: PaneActions) {
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="column">
      <Text bold>{PANE_TITLE}</Text>
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
          {SETTINGS_TABS.map(tab => (
            <Button
              key={`tab-${tab}`}
              label={TAB_LABELS[tab]}
              plain
              dimColor={tab !== vm.pane.tab}
              onPress={() => actions.tab(tab)}
            />
          ))}
        </Box>
        <Button key="github" label={GITHUB_LABEL} plain dimColor onPress={() => actions.github()} />
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {pageOf(vm.pane.tab, ui, vm, actions)}
      </Box>
    </Box>
  )
}
