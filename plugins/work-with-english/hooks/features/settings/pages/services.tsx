import type { SelectOption } from 'claude-code'

import type { WweSettings, WweSettingsView } from '../../../../types'
import {
  CANCEL,
  CUSTOM_MODEL_FIELD,
  CUSTOM_MODEL_PLACEHOLDER,
  DEFAULT_SUFFIX,
  DELETE_CONFIG,
  DELETE_CONFIRM,
  DELETE_NOTE,
  DESCRIPTIONS,
  ELEVEN_KEY_SHAPE,
  ELEVEN_MISSING,
  ELEVEN_MODEL_NOTE,
  ELEVEN_NEEDS_FIRST,
  ELEVEN_READY,
  FETCHING_ELEVEN,
  FETCHING_MODELS,
  FIELD_SUBMIT,
  ITEM_NAMES,
  KEY_STALE_HINT,
  MANUAL_ENTRY,
  MODEL_GONE_HINT,
  NOT_IN_LIST_SUFFIX,
  NO_LIST,
  OPENAI_KEY_SHAPE,
  OPENAI_MODEL_PLACEHOLDER,
  OPENAI_NEEDS_FIRST,
  OPENAI_READY,
  OPENAI_TTS_MODEL_PLACEHOLDER,
  OPENAI_URL_PLACEHOLDER,
  PICK_MODEL,
  checkboxLabel,
  elevenFailed,
  elevenFrom,
  elevenInUse,
  inUseText,
  keyPlaceholder,
  modelReplaced,
  modelsFailed,
  modelsFrom,
  openaiMissingText,
  serviceTabLabel,
  usedFor,
} from '../../../core/copy/settings'
import type { ServiceTab } from '../../../core/copy/settings'
import { MODEL_ALIASES, modelChoice } from '../../../core/settings/models'
import { DEFAULT_SETTINGS } from '../../../core/settings/schema'
import { isSpeechReady, isTranslateReady, openaiMissing } from '../../../core/settings/services'
import { GROUP, alone, errorLine, note, tabStyle } from '../controls'
import type { PaneActions, PaneUi, PaneVm } from '../controls'

// The 服务 page (F7, F8): a sub-menu with one tab per service, each tab
// saying what the service is used for, and the chosen service's settings
// under it. A tab only switches what shows; it saves nothing.

export { MODEL_ALIASES, allowedOf, isModelAllowed, modelChoice } from '../../../core/settings/models'
export type { ModelChoice } from '../../../core/settings/models'

export const SERVICE_TABS: readonly ServiceTab[] = ['claude', 'openai', 'elevenlabs']

/** The tab the page opens on: the service that translates */
export const serviceTabOf = (service: WweSettings['translateService']): ServiceTab => service

/** Whether a service can be chosen to translate (F7: 没配置完成的服务不能选) */
export const isServiceReady = isTranslateReady

const isAlias = (model: string) => (MODEL_ALIASES as readonly string[]).includes(model)

/** A line of the page in the color it reads in: done in green, still to do in yellow */
const statusLine = (ui: PaneUi, text: string, isDone: boolean) => (
  <ui.Text color={isDone ? 'green' : 'yellow'}>{text}</ui.Text>
)

/** 删除配置, or 确定删除 and 取消 once pressed */
function deleteRow(ui: PaneUi, vm: PaneVm, actions: PaneActions, service: 'openai' | 'elevenlabs') {
  const { Box, Text, Button } = ui
  const what = service === 'openai' ? 'delete-openai' : 'delete-elevenlabs'
  const isAsked = vm.pane.confirm === what
  return (
    <Box flexDirection="row" columnGap={2} flexWrap="wrap">
      <Text dimColor>{DELETE_NOTE}</Text>
      {isAsked ? (
        <Box flexDirection="row" columnGap={2}>
          <Button key={`${what}-yes`} label={DELETE_CONFIRM} onPress={() => actions.confirm()} />
          <Button key={`${what}-no`} label={CANCEL} plain onPress={() => actions.cancel()} />
        </Box>
      ) : (
        <Button key={what} label={DELETE_CONFIG} onPress={() => actions.ask(what)} />
      )}
    </Box>
  )
}

function claudeTab(ui: PaneUi, vm: PaneVm, actions: PaneActions) {
  const { Box, Text, Input, Select } = ui
  const { settings } = vm
  const choice = modelChoice(settings.claudeModel, vm.allowedModels, vm.isCustomModelOpen)
  return (
    <Box {...GROUP}>
      {alone(
        ui,
        <Select
          key={vm.key('claude-model')}
          label={ITEM_NAMES.claudeModel}
          value={choice.value}
          options={choice.options}
          onSelect={value => actions.pick('claudeModel', value)}
        />,
      )}
      {choice.replacedBy !== null && <Text color="yellow">{modelReplaced(choice.replacedBy)}</Text>}
      {choice.hasField &&
        alone(
          ui,
          <Input
            key={vm.key('model-id')}
            label={CUSTOM_MODEL_FIELD}
            placeholder={CUSTOM_MODEL_PLACEHOLDER}
            value={vm.fieldText('claudeModel', isAlias(settings.claudeModel) ? '' : settings.claudeModel)}
            submitLabel={FIELD_SUBMIT}
            onInput={text => actions.edit('claudeModel', text)}
            onSubmit={text => actions.submit('claudeModel', text)}
          />,
        )}
      {errorLine(ui, vm.pane.errors.claudeModel)}
      {note(ui, DESCRIPTIONS.claudeModel)}
    </Box>
  )
}

/** F7 › 页面提示 › 配置状态: in use, configured, or what is still missing */
export function openaiStatus(settings: WweSettingsView): { text: string; isDone: boolean } {
  const translates = settings.translateService === 'openai'
  const reads = settings.speechService === 'openai'
  if (translates || reads) {
    return {
      text: inUseText(translates ? settings.openaiModel : null, reads ? settings.openaiTtsModel : null),
      isDone: true,
    }
  }
  const missing = openaiMissing(settings)
  return missing.length > 0
    ? { text: openaiMissingText(missing.map(key => ITEM_NAMES[key])), isDone: false }
    : { text: OPENAI_READY, isDone: true }
}

/** 翻译模型's options: the list fetched, a saved model it lacks marked, and a first choice while none is saved */
export function openaiModelOptions(saved: string, ids: readonly string[]): SelectOption[] {
  const options: SelectOption[] = []
  if (saved === '') {
    options.push({ value: '', label: PICK_MODEL })
  } else if (!ids.includes(saved)) {
    options.push({ value: saved, label: ids.length > 0 ? saved + NOT_IN_LIST_SUFFIX : saved })
  }
  return [...options, ...ids.map(id => ({ value: id, label: id }))]
}

function openaiModelRow(ui: PaneUi, vm: PaneVm, actions: PaneActions) {
  const { Box, Text, Input, Select } = ui
  const { settings, pane } = vm
  const list = pane.openaiList
  const label = ITEM_NAMES.openaiModel
  if (settings.openaiManual) {
    return (
      <Input
        key={vm.key('openai-model-id')}
        label={label}
        placeholder={OPENAI_MODEL_PLACEHOLDER}
        value={vm.fieldText('openaiModel', settings.openaiModel)}
        submitLabel={FIELD_SUBMIT}
        onInput={text => actions.edit('openaiModel', text)}
        onSubmit={text => actions.submit('openaiModel', text)}
      />
    )
  }
  if (pane.openaiFetch.status === 'loading') {
    return <Text dimColor>{`${label}：${FETCHING_MODELS}`}</Text>
  }
  if (list === null && settings.openaiModel === '') {
    const hasBoth = settings.openaiBaseUrl !== '' && settings.openaiKeyMask !== null
    return <Text dimColor>{`${label}：${hasBoth ? NO_LIST : OPENAI_NEEDS_FIRST}`}</Text>
  }
  return (
    <Box flexDirection="row">
      <Select
        key={vm.key('openai-model')}
        label={label}
        value={settings.openaiModel}
        options={openaiModelOptions(settings.openaiModel, list?.ids ?? [])}
        onSelect={value => actions.pick('openaiModel', value)}
      />
    </Box>
  )
}

function openaiTab(ui: PaneUi, vm: PaneVm, actions: PaneActions) {
  const { Box, Text, Button, Input } = ui
  const { settings, pane } = vm
  const status = openaiStatus(settings)
  const list = pane.openaiList
  const fetch = pane.openaiFetch
  const isGone = list !== null && settings.openaiModel !== '' && !list.ids.includes(settings.openaiModel)
  const hasAny =
    settings.openaiBaseUrl !== '' ||
    settings.openaiKeyMask !== null ||
    settings.openaiModel !== '' ||
    settings.openaiTtsModel !== ''
  const focusTts = pane.autoFocus === 'openai-tts-model' ? { autoFocus: true as const } : {}
  return (
    <Box flexDirection="column" rowGap={1}>
      {statusLine(ui, status.text, status.isDone)}
      <Box {...GROUP}>
        {alone(
          ui,
          <Input
            key={vm.key('openai-url')}
            label={ITEM_NAMES.openaiBaseUrl}
            placeholder={OPENAI_URL_PLACEHOLDER}
            value={vm.fieldText('openaiBaseUrl', settings.openaiBaseUrl)}
            submitLabel={FIELD_SUBMIT}
            onInput={text => actions.edit('openaiBaseUrl', text)}
            onSubmit={text => actions.submit('openaiBaseUrl', text)}
          />,
        )}
        {errorLine(ui, pane.errors.openaiBaseUrl)}
        {note(ui, DESCRIPTIONS.openaiBaseUrl)}
      </Box>
      <Box {...GROUP}>
        {alone(
          ui,
          <Input
            key={vm.key('openai-key')}
            label={ITEM_NAMES.openaiKey}
            placeholder={keyPlaceholder(settings.openaiKeyMask, OPENAI_KEY_SHAPE)}
            value={vm.fieldText('openaiKey', '')}
            submitLabel={FIELD_SUBMIT}
            onInput={text => actions.edit('openaiKey', text)}
            onSubmit={text => actions.submit('openaiKey', text)}
          />,
        )}
        {pane.keyStale && <Text color="yellow">{KEY_STALE_HINT}</Text>}
        {note(ui, DESCRIPTIONS.openaiKey)}
      </Box>
      <Box {...GROUP}>
        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
          {openaiModelRow(ui, vm, actions)}
          <Button
            key="openai-manual"
            label={checkboxLabel(MANUAL_ENTRY, settings.openaiManual)}
            plain
            onPress={() => actions.toggleManual()}
          />
        </Box>
        {!settings.openaiManual && fetch.status === 'failed' && fetch.error !== null && (
          <Text color="red">{fetch.error}</Text>
        )}
        {!settings.openaiManual && fetch.status === 'idle' && isGone && <Text color="yellow">{MODEL_GONE_HINT}</Text>}
        {!settings.openaiManual && fetch.status === 'idle' && list !== null && (
          <Text dimColor>{modelsFrom(list.ids.length, list.from)}</Text>
        )}
        {note(ui, DESCRIPTIONS.openaiModel)}
      </Box>
      <Box {...GROUP}>
        {alone(
          ui,
          <Input
            key={vm.key('openai-tts-model')}
            label={ITEM_NAMES.openaiTtsModel}
            placeholder={OPENAI_TTS_MODEL_PLACEHOLDER}
            value={vm.fieldText('openaiTtsModel', settings.openaiTtsModel)}
            submitLabel={FIELD_SUBMIT}
            onInput={text => actions.edit('openaiTtsModel', text)}
            onSubmit={text => actions.submit('openaiTtsModel', text)}
            {...focusTts}
          />,
        )}
        {note(ui, DESCRIPTIONS.openaiTtsModel)}
      </Box>
      {note(ui, DESCRIPTIONS.openaiPage)}
      {hasAny && deleteRow(ui, vm, actions, 'openai')}
    </Box>
  )
}

/** The name ElevenLabs gives the saved voice, or its id when the list has none */
export function elevenVoiceName(settings: WweSettingsView, voices: readonly { id: string; name: string }[]): string {
  return voices.find(voice => voice.id === settings.voiceEleven)?.name ?? settings.voiceEleven
}

/** ElevenLabs' 朗读模型: the models that can read aloud, the default marked, a saved one the list lacks marked */
export function elevenModelOptions(saved: string, models: readonly { id: string }[]): SelectOption[] {
  const ids = models.map(model => model.id)
  const label = (id: string) => id + (id === DEFAULT_SETTINGS.elevenModel ? DEFAULT_SUFFIX : '')
  const options: SelectOption[] = ids.includes(saved)
    ? []
    : [{ value: saved, label: label(saved) + (ids.length > 0 ? NOT_IN_LIST_SUFFIX : '') }]
  return [...options, ...ids.map(id => ({ value: id, label: label(id) }))]
}

function elevenTab(ui: PaneUi, vm: PaneVm, actions: PaneActions) {
  const { Box, Text, Input, Select } = ui
  const { settings, pane } = vm
  const list = pane.elevenList
  const fetch = pane.elevenFetch
  const hasKey = settings.elevenKeyMask !== null
  const label = ITEM_NAMES.elevenModel
  let status: { text: string; isDone: boolean } | null = null
  if (!hasKey) {
    status = { text: ELEVEN_MISSING, isDone: false }
  } else if (fetch.status !== 'loading' && isSpeechReady('elevenlabs', settings)) {
    status =
      settings.speechService === 'elevenlabs'
        ? { text: elevenInUse(settings.elevenModel, elevenVoiceName(settings, list?.voices ?? [])), isDone: true }
        : { text: ELEVEN_READY, isDone: true }
  }
  let model
  if (fetch.status === 'loading') {
    model = <Text dimColor>{`${label}：${FETCHING_ELEVEN}`}</Text>
  } else if (!hasKey) {
    model = <Text dimColor>{`${label}：${ELEVEN_NEEDS_FIRST}`}</Text>
  } else {
    model = alone(
      ui,
      <Select
        key={vm.key('eleven-model')}
        label={label}
        value={settings.elevenModel}
        options={elevenModelOptions(settings.elevenModel, list?.models ?? [])}
        onSelect={value => actions.pick('elevenModel', value)}
      />,
    )
  }
  return (
    <Box flexDirection="column" rowGap={1}>
      {status !== null && statusLine(ui, status.text, status.isDone)}
      <Box {...GROUP}>
        {alone(
          ui,
          <Input
            key={vm.key('eleven-key')}
            label={ITEM_NAMES.elevenKey}
            placeholder={keyPlaceholder(settings.elevenKeyMask, ELEVEN_KEY_SHAPE)}
            value={vm.fieldText('elevenKey', '')}
            submitLabel={FIELD_SUBMIT}
            onInput={text => actions.edit('elevenKey', text)}
            onSubmit={text => actions.submit('elevenKey', text)}
          />,
        )}
        {note(ui, DESCRIPTIONS.elevenKey)}
      </Box>
      <Box {...GROUP}>
        {model}
        {hasKey && fetch.status === 'failed' && fetch.error !== null && <Text color="red">{fetch.error}</Text>}
        {hasKey && fetch.status === 'idle' && list === null && <Text dimColor>{NO_LIST}</Text>}
        {hasKey && fetch.status === 'idle' && list !== null && (
          <Text dimColor>{elevenFrom(list.models.length, list.voices.length)}</Text>
        )}
        {note(ui, ELEVEN_MODEL_NOTE)}
      </Box>
      {note(ui, DESCRIPTIONS.elevenPage)}
      {hasKey && deleteRow(ui, vm, actions, 'elevenlabs')}
    </Box>
  )
}

export function servicesPage(ui: PaneUi, vm: PaneVm, actions: PaneActions) {
  const { Box, Button } = ui
  const { settings } = vm
  const current = SERVICE_TABS.includes(vm.pane.svcTab) ? vm.pane.svcTab : 'claude'
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        {SERVICE_TABS.map(tab => (
          <Button
            key={`svc-${tab}`}
            label={serviceTabLabel(tab, usedFor(settings.translateService === tab, settings.speechService === tab))}
            {...tabStyle(tab === current)}
            onPress={() => actions.serviceTab(tab)}
          />
        ))}
      </Box>
      {current === 'claude' && claudeTab(ui, vm, actions)}
      {current === 'openai' && openaiTab(ui, vm, actions)}
      {current === 'elevenlabs' && elevenTab(ui, vm, actions)}
    </Box>
  )
}

