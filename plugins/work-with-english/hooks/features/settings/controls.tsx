import type { Elements, RenderElement } from 'claude-code'

import type { WwePane, WweSettings, WweSettingsView, WweTab } from '../../../types'
import { onOff } from '../../core/copy/settings'
import type { ServiceTab } from '../../core/copy/settings'
import type { InputKey, SelectKey } from '../../core/settings/save'

// What the settings pages share: the elements they draw with, what they are
// drawn from, what their controls call, and the rows several pages use.
// 2.1.288's elements have no red field and no disabled control: a refused
// value is a red line under its field, a choice that can't be taken is
// refused on pick and its dropdown drawn again under a new key (P24).

export type PaneUi = Pick<Elements['terminal'] | Elements['desktop'], 'Box' | 'Text' | 'Button' | 'Input' | 'Select'>

/** The table `$.ui.resolve(e)` handed out, when it can draw fields: mobile has no Input or Select. */
export function paneUiOf(table: Elements[keyof Elements]): PaneUi | null {
  return 'Input' in table && 'Select' in table ? table : null
}

/** The fields and dropdowns, which are drawn under a new key to show the saved value again */
export type ControlKey =
  | 'delay'
  | 'delay-unit'
  | 'translate-service'
  | 'auto-reply'
  | 'reply-count'
  | 'anki-deck'
  | 'claude-model'
  | 'model-id'

/** The settings a switch flips */
export type SwitchKey = 'strict' | 'autoPlanAsk' | 'ankiSync' | 'weeklyReminder'

export type PaneVm = {
  pane: WwePane
  settings: WweSettingsView
  /** The unit beside 翻译延迟 now; picking another saves nothing until a delay is typed */
  delayUnit: WweSettings['delayUnit']
  /** 自定义模型 id is picked and its id not saved yet */
  isCustomModelOpen: boolean
  /** The organization's `availableModels`; null when it sets none */
  allowedModels: readonly string[] | null
  /** A control's key as drawn now */
  key: (control: ControlKey) => string
  /** What a field holds when drawn: what was typed while it is refused, else the saved text */
  fieldText: (setting: InputKey, saved: string) => string
}

/** What the controls call; a promise settles once the change is saved and drawn */
export type PaneActions = {
  tab: (tab: WweTab) => Promise<void>
  serviceTab: (tab: ServiceTab) => Promise<void>
  /** 去配置翻译服务 */
  gotoServices: () => Promise<void>
  github: () => Promise<void>
  /** A field's text changed: kept as its draft */
  edit: (setting: InputKey, text: string) => void
  /** Enter in a field */
  submit: (setting: InputKey, text: string) => Promise<void>
  /** A dropdown's or a radio's pick; the value as the control holds it */
  pick: (setting: SelectKey, value: string) => Promise<void>
  flip: (setting: SwitchKey) => Promise<void>
  delayUnit: (unit: string) => Promise<void>
  resetDelay: () => Promise<void>
  /** F5 设为英语 */
  setReplyLanguage: () => Promise<void>
}

/** A setting's name with its switch at the right */
export function switchRow(ui: PaneUi, key: string, name: string, isOn: boolean, onPress: () => unknown) {
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
      <Text bold>{name}</Text>
      <Button key={key} label={onOff(isOn)} plain onPress={onPress} />
    </Box>
  )
}

/** A control in a row of its own, so it keeps its own width */
export const alone = (ui: PaneUi, control: RenderElement) => <ui.Box flexDirection="row">{control}</ui.Box>

/** The line under a refused field saying how to fix it */
export const errorLine = (ui: PaneUi, message: string | undefined) =>
  message === undefined ? null : <ui.Text color="red">{message}</ui.Text>

export const note = (ui: PaneUi, text: string) => <ui.Text dimColor>{text}</ui.Text>
