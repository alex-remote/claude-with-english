import type { SelectOption } from 'claude-code'

import type { WwePane, WweSettings, WweSettingsView } from '../../../../types'
import {
  AUTO_REPLY_LABELS,
  AUTO_REPLY_WHEN_LABELS,
  CACHE_CLEAR,
  CACHE_CONFIRM,
  CACHE_MEASURING,
  CACHE_NAME,
  CACHE_UNKNOWN,
  CANCEL,
  DEFAULT_SUFFIX,
  DESCRIPTIONS,
  ELEVEN_NEEDS_FIRST,
  FIELD_SUBMIT,
  ITEM_NAMES,
  NOT_IN_LIST_SUFFIX,
  READING_MODE_LABELS,
  REPLY_COUNT_UNIT,
  SPEECH_SERVICE_LABELS,
  SPEECH_SYSTEM_DESCRIPTION,
  SPEECH_SYSTEM_NOTE,
  STOP,
  SYSTEM_DEFAULT_VOICE,
  TRYING,
  TRY_VOICE,
  notConfiguredOption,
  radioLabel,
  serviceOption,
  sizeText,
} from '../../../core/copy/settings'
import { DEFAULT_SETTINGS } from '../../../core/settings/schema'
import { OPENAI_VOICES, isSpeechReady } from '../../../core/settings/services'
import { ACCENT, GROUP, alone, errorLine, note, switchRow } from '../controls'
import type { ControlKey, PaneActions, PaneUi, PaneVm } from '../controls'

// The 阅读 page (F6, F8, F9): 阅读方式 with 自动翻译回复 under the paragraph
// mode, 自动翻译计划和提问 for both modes, then 朗读服务 with its 声音 and
// 试听, and 本机缓存 with 清除.

/** 自动翻译回复's options in the feature map's order, the default marked */
const AUTO_REPLY_ORDER: readonly WweSettings['autoReply'][] = ['off', 'last', 'all']

const autoReplyOptions = AUTO_REPLY_ORDER.map(value => ({
  value,
  label: AUTO_REPLY_LABELS[value] + (value === DEFAULT_SETTINGS.autoReply ? DEFAULT_SUFFIX : ''),
}))

/** 翻译时机's options, the default first and marked */
const AUTO_REPLY_WHEN_ORDER: readonly WweSettings['autoReplyWhen'][] = ['written', 'turnEnd']

const autoReplyWhenOptions = AUTO_REPLY_WHEN_ORDER.map(value => ({
  value,
  label: AUTO_REPLY_WHEN_LABELS[value] + (value === DEFAULT_SETTINGS.autoReplyWhen ? DEFAULT_SUFFIX : ''),
}))

/** 朗读服务's options, each online one with its 朗读模型; one not configured can't be chosen (F8) */
export function speechOptions(settings: WweSettingsView): SelectOption[] {
  const online = (service: 'openai' | 'elevenlabs', model: string) => ({
    value: service,
    label: isSpeechReady(service, settings)
      ? serviceOption(SPEECH_SERVICE_LABELS[service], model)
      : notConfiguredOption(SPEECH_SERVICE_LABELS[service]),
  })
  return [
    { value: 'system', label: SPEECH_SERVICE_LABELS.system + DEFAULT_SUFFIX },
    online('openai', settings.openaiTtsModel),
    online('elevenlabs', settings.elevenModel),
  ]
}

export type VoiceChoice = {
  setting: 'voiceSystem' | 'voiceOpenai' | 'voiceEleven'
  control: ControlKey
  value: string
  options: SelectOption[]
}

/** A saved voice the list doesn't have still shows, marked once there is a list to miss it from */
function withSaved(options: SelectOption[], saved: string, isListed: boolean): SelectOption[] {
  if (saved === '' || options.some(option => option.value === saved)) {
    return options
  }
  const [first, ...rest] = options
  const missing = { value: saved, label: isListed ? saved + NOT_IN_LIST_SUFFIX : saved }
  return first?.value === '' ? [first, missing, ...rest] : [missing, ...options]
}

/**
 * 声音, which follows 朗读服务 (F8): the system's English voices after its
 * default; OpenAI's thirteen, coral the default; the ElevenLabs account's,
 * the first the default.
 */
export function voiceChoice(settings: WweSettingsView, pane: WwePane): VoiceChoice {
  switch (settings.speechService) {
    case 'system': {
      const names = pane.systemVoices ?? []
      const options = [{ value: '', label: SYSTEM_DEFAULT_VOICE }, ...names.map(name => ({ value: name, label: name }))]
      return {
        setting: 'voiceSystem',
        control: 'voice-system',
        value: settings.voiceSystem,
        options: withSaved(options, settings.voiceSystem, pane.systemVoices !== null),
      }
    }
    case 'openai': {
      const options = OPENAI_VOICES.map(voice => ({
        value: voice,
        label: voice + (voice === DEFAULT_SETTINGS.voiceOpenai ? DEFAULT_SUFFIX : ''),
      }))
      const value = settings.voiceOpenai === '' ? DEFAULT_SETTINGS.voiceOpenai : settings.voiceOpenai
      return { setting: 'voiceOpenai', control: 'voice-openai', value, options: withSaved(options, value, true) }
    }
    case 'elevenlabs': {
      const voices = pane.elevenList?.voices ?? []
      const options = voices.map(voice => ({ value: voice.id, label: voice.name }))
      const value = settings.voiceEleven === '' ? (voices[0]?.id ?? '') : settings.voiceEleven
      const all = withSaved(options, value, voices.length > 0)
      return {
        setting: 'voiceEleven',
        control: 'voice-eleven',
        value,
        // Only while nothing is fetched yet: a Select needs one option
        options: all.length > 0 ? all : [{ value: '', label: ELEVEN_NEEDS_FIRST }],
      }
    }
  }
}

/** 朗读服务, 声音 with 试听, and the line under them */
function speechSection(ui: PaneUi, vm: PaneVm, actions: PaneActions) {
  const { Box, Text, Button, Select } = ui
  const { settings, pane } = vm
  const voice = voiceChoice(settings, pane)
  let tryControl
  if (pane.trying === 'system') {
    tryControl = <Text dimColor>{TRYING}</Text>
  } else if (pane.trying === null && vm.speaking?.via === 'system') {
    // The system voice can't be stopped: 试听 waits until it is done (F8 › 同时只读一处)
    tryControl = <Text dimColor>{TRY_VOICE}</Text>
  } else {
    tryControl = (
      <Button key="voice-try" label={pane.trying === 'online' ? STOP : TRY_VOICE} onPress={() => actions.tryVoice()} />
    )
  }
  return (
    <Box {...GROUP}>
      {alone(
        ui,
        <Select
          key={vm.key('speech-service')}
          label={ITEM_NAMES.speechService}
          value={settings.speechService}
          options={speechOptions(settings)}
          onSelect={value => actions.pick('speechService', value)}
        />,
      )}
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        <Select
          key={vm.key(voice.control)}
          label={ITEM_NAMES[voice.setting]}
          value={voice.value}
          options={voice.options}
          onSelect={value => actions.pick(voice.setting, value)}
        />
        {tryControl}
      </Box>
      {settings.speechService === 'system' ? note(ui, SPEECH_SYSTEM_NOTE) : note(ui, DESCRIPTIONS.speechOnline)}
      {settings.speechService === 'system' &&
        alone(
          ui,
          <Button key="goto-speech" label={SPEECH_SYSTEM_DESCRIPTION.link} onPress={() => actions.gotoSpeech()} />,
        )}
    </Box>
  )
}

/** 本机缓存: the space it takes, and 清除 once there is any, which asks first */
function cacheSection(ui: PaneUi, vm: PaneVm, actions: PaneActions) {
  const { Box, Text, Button } = ui
  const { cache, confirm } = vm.pane
  let size
  if (cache.status === 'loading') {
    size = <Text dimColor>{CACHE_MEASURING}</Text>
  } else if (cache.status === 'failed') {
    size = <Text dimColor>{CACHE_UNKNOWN}</Text>
  } else {
    size = <Text>{sizeText(cache.kb)}</Text>
  }
  let buttons = null
  if (confirm === 'clear-cache') {
    buttons = (
      <Box flexDirection="row" columnGap={2}>
        <Button key="cache-yes" label={CACHE_CONFIRM} onPress={() => actions.confirm()} />
        <Button key="cache-no" label={CANCEL} plain onPress={() => actions.cancel()} />
      </Box>
    )
  } else if (cache.status === 'done' && cache.kb > 0) {
    buttons = <Button key="cache-clear" label={CACHE_CLEAR} onPress={() => actions.ask('clear-cache')} />
  }
  return (
    <Box {...GROUP}>
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        <Text bold>{CACHE_NAME}</Text>
        {size}
        {buttons}
      </Box>
      {note(ui, DESCRIPTIONS.cache)}
    </Box>
  )
}

export function readingPage(ui: PaneUi, vm: PaneVm, actions: PaneActions) {
  const { Box, Text, Button, Input, Select } = ui
  const { settings } = vm
  const isParagraph = settings.readingMode === 'paragraph'
  const isLast = settings.autoReply === 'last'
  const mode = (value: WweSettings['readingMode'], isDefault: boolean) => (
    <Button
      key={`reading-${value}`}
      label={radioLabel(READING_MODE_LABELS[value] + (isDefault ? DEFAULT_SUFFIX : ''), settings.readingMode === value)}
      plain
      onPress={() => actions.pick('readingMode', value)}
    />
  )
  // Each reading mode a card of its own, the chosen one in the accent, as the prototype draws them
  const modeCard = (value: WweSettings['readingMode']) =>
    settings.readingMode === value
      ? ({ flexDirection: 'column', borderStyle: 'round', borderColor: ACCENT, paddingX: 1 } as const)
      : ({ flexDirection: 'column', borderStyle: 'round', borderDimColor: true, paddingX: 1 } as const)
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box {...GROUP} rowGap={1}>
        <Text bold>{ITEM_NAMES.readingMode}</Text>
        <Box key="mode-paragraph" {...modeCard('paragraph')}>
          {alone(ui, mode('paragraph', true))}
          <Box flexDirection="column" paddingLeft={2}>
            {note(ui, DESCRIPTIONS.paragraphMode)}
            {isParagraph && (
              <Box flexDirection="column" paddingLeft={2}>
                <Box flexDirection="row" columnGap={1}>
                  <Select
                    key={vm.key('auto-reply')}
                    label={ITEM_NAMES.autoReply}
                    value={settings.autoReply}
                    options={autoReplyOptions}
                    onSelect={value => actions.pick('autoReply', value)}
                  />
                  {isLast && (
                    <Input
                      key={vm.key('reply-count')}
                      value={vm.fieldText('autoReplyCount', String(settings.autoReplyCount))}
                      submitLabel={FIELD_SUBMIT}
                      onInput={text => actions.edit('autoReplyCount', text)}
                      onSubmit={text => actions.submit('autoReplyCount', text)}
                    />
                  )}
                  {isLast && <Text>{REPLY_COUNT_UNIT}</Text>}
                  {settings.autoReply === 'all' && (
                    <Select
                      key={vm.key('auto-reply-when')}
                      label={ITEM_NAMES.autoReplyWhen}
                      value={settings.autoReplyWhen}
                      options={autoReplyWhenOptions}
                      onSelect={value => actions.pick('autoReplyWhen', value)}
                    />
                  )}
                </Box>
                {errorLine(ui, vm.pane.errors.autoReplyCount)}
                {note(ui, DESCRIPTIONS.autoReply)}
              </Box>
            )}
          </Box>
        </Box>
        <Box key="mode-select" {...modeCard('select')}>
          {alone(ui, mode('select', false))}
          <Box paddingLeft={2}>{note(ui, DESCRIPTIONS.selectMode)}</Box>
        </Box>
        {note(ui, DESCRIPTIONS.readingMode)}
      </Box>
      <Box {...GROUP}>
        {switchRow(ui, 'auto-plan-ask', ITEM_NAMES.autoPlanAsk, settings.autoPlanAsk, () => actions.flip('autoPlanAsk'))}
        {note(ui, DESCRIPTIONS.autoPlanAsk)}
      </Box>
      {speechSection(ui, vm, actions)}
      {cacheSection(ui, vm, actions)}
    </Box>
  )
}
