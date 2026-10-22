import type { Elements, RenderChildren, RenderElement } from 'claude-code'

import type { WwePane, WweSettings, WweSettingsView, WweSpeaking, WweTab } from '../../../types'
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
  | 'auto-reply-when'
  | 'anki-deck'
  | 'claude-model'
  | 'model-id'
  | 'openai-url'
  | 'openai-key'
  | 'openai-model'
  | 'openai-model-id'
  | 'openai-tts-model'
  | 'eleven-key'
  | 'eleven-model'
  | 'speech-service'
  | 'voice-system'
  | 'voice-openai'
  | 'voice-eleven'

/** The settings a switch flips */
export type SwitchKey = 'strict' | 'bandButtons' | 'autoPlanAsk' | 'ankiSync' | 'weeklyReminder'

/**
 * What other features draw on a settings page, above its settings: the
 * 单词本 page's lists and its line on Anki under 同步到 Anki (F12), the 统计
 * page's figures (F13). register.tsx
 * draws them from their own `$.state` and hands them in.
 */
export type PaneSlots = { wordbook?: RenderChildren; ankiStatus?: RenderChildren; stats?: RenderChildren }

export type PaneVm = {
  pane: WwePane
  slots: PaneSlots
  /** What reads aloud now (F8): 试听 can't be pressed while the system voice reads elsewhere */
  speaking: WweSpeaking
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
  /** F7: the 手动填写 checkbox beside 翻译模型 */
  toggleManual: () => Promise<void>
  /** F8: 去配置朗读服务, to the OpenAI-compatible tab's 朗读模型 */
  gotoSpeech: () => Promise<void>
  /** F8: 试听, or 停止 while it reads online */
  tryVoice: () => void
  /** 删除配置 or 清除: shows the confirmation; `confirm` carries it out, `cancel` takes it back */
  ask: (what: NonNullable<WwePane['confirm']>) => Promise<void>
  confirm: () => Promise<void>
  cancel: () => Promise<void>
}

/** The warm line the prototype draws a chosen card in, readable on a light and a dark background */
export const ACCENT = '#C8915F'

/** One setting, or a few that go together, in a card with a round border, as the prototype sets each apart */
export const GROUP = { flexDirection: 'column', borderStyle: 'round', borderDimColor: true, paddingX: 1 } as const

/** The tab, sub-tab or choice showing now as the main button; the others as plain dim labels */
export const tabStyle = (isCurrent: boolean) =>
  isCurrent ? ({ variant: 'primary' } as const) : ({ plain: true, dimColor: true } as const)

/** A setting's name with its switch at the right */
export function switchRow(ui: PaneUi, key: string, name: string, isOn: boolean, onPress: () => unknown) {
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
      <Text bold>{name}</Text>
      <Button key={key} label={onOff(isOn)} variant={isOn ? 'primary' : 'secondary'} onPress={onPress} />
    </Box>
  )
}

/** A control in a row of its own, so it keeps its own width */
export const alone = (ui: PaneUi, control: RenderElement) => <ui.Box flexDirection="row">{control}</ui.Box>

/** The line under a refused field saying how to fix it */
export const errorLine = (ui: PaneUi, message: string | undefined) =>
  message === undefined ? null : <ui.Text color="red">{message}</ui.Text>

export const note = (ui: PaneUi, text: string) => <ui.Text dimColor>{text}</ui.Text>
