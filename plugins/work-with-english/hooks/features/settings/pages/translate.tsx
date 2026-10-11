import type { SelectOption } from 'claude-code'

import type { WweSettingsView } from '../../../../types'
import {
  DELAY_UNITS,
  DESCRIPTIONS,
  FIELD_SUBMIT,
  ITEM_NAMES,
  LANGUAGES_NAME,
  LANGUAGES_VALUE,
  REPLY_LANGUAGE_MATCHES,
  REPLY_LANGUAGE_NAME,
  REPLY_LANGUAGE_SET,
  RESET_DEFAULT,
  TRANSLATE_SERVICE_DESCRIPTION,
  TRANSLATE_SERVICE_LABELS,
  TRANSLATE_SERVICE_NOTE,
  notConfiguredOption,
  replyLanguageFixed,
  replyLanguageValue,
  serviceOption,
} from '../../../core/copy/settings'
import { delayFieldText } from '../../../core/settings/format'
import { DEFAULT_SETTINGS } from '../../../core/settings/schema'
import { alone, errorLine, note, switchRow } from '../controls'
import type { PaneActions, PaneUi, PaneVm } from '../controls'
import { replyLanguageRow } from '../language'
import { isServiceReady, modelChoice } from './services'

// The 翻译 page, in the order of the 设置 table: the two languages, 翻译延迟
// (F1), 严格模式 (F4), 回复语言 (F5) and 翻译服务 (F7).

/** 翻译服务's options, each with the model it would use; one not configured can't be chosen */
export function serviceOptions(settings: WweSettingsView, claudeModel: string): SelectOption[] {
  return [
    { value: 'claude', label: serviceOption(TRANSLATE_SERVICE_LABELS.claude, claudeModel) },
    {
      value: 'openai',
      label: isServiceReady('openai', settings)
        ? serviceOption(TRANSLATE_SERVICE_LABELS.openai, settings.openaiModel)
        : notConfiguredOption(TRANSLATE_SERVICE_LABELS.openai),
    },
  ]
}

export function translatePage(ui: PaneUi, vm: PaneVm, actions: PaneActions) {
  const { Box, Text, Button, Input, Select } = ui
  const { settings, pane } = vm
  const language = pane.replyLanguage
  const row = language === null ? null : replyLanguageRow(language)
  const model = modelChoice(settings.claudeModel, vm.allowedModels, false)
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        <Text bold>{LANGUAGES_NAME}</Text>
        <Text>{LANGUAGES_VALUE}</Text>
        {note(ui, DESCRIPTIONS.languages)}
      </Box>
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          <Input
            key={vm.key('delay')}
            label={ITEM_NAMES.delayMs}
            value={vm.fieldText('delayMs', delayFieldText(settings.delayMs, vm.delayUnit))}
            submitLabel={FIELD_SUBMIT}
            onInput={text => actions.edit('delayMs', text)}
            onSubmit={text => actions.submit('delayMs', text)}
          />
          <Select
            key={vm.key('delay-unit')}
            value={vm.delayUnit}
            options={DELAY_UNITS.map(unit => ({ value: unit, label: unit }))}
            onSelect={unit => actions.delayUnit(unit)}
          />
          {settings.delayMs !== DEFAULT_SETTINGS.delayMs && (
            <Button key="delay-reset" label={RESET_DEFAULT} onPress={() => actions.resetDelay()} />
          )}
        </Box>
        {errorLine(ui, pane.errors.delayMs)}
        {note(ui, DESCRIPTIONS.delay)}
      </Box>
      <Box flexDirection="column">
        {switchRow(ui, 'strict', ITEM_NAMES.strict, settings.strict, () => actions.flip('strict'))}
        {note(ui, DESCRIPTIONS.strict)}
      </Box>
      <Box flexDirection="column">
        <Text bold>{REPLY_LANGUAGE_NAME}</Text>
        {language !== null && (
          <Box flexDirection="row" columnGap={2} flexWrap="wrap">
            <Text>{replyLanguageValue(language.value)}</Text>
            {row?.kind === 'matches' && <Text color="green">{REPLY_LANGUAGE_MATCHES}</Text>}
            {row?.kind === 'settable' && (
              <Button key="reply-language" label={REPLY_LANGUAGE_SET} onPress={() => actions.setReplyLanguage()} />
            )}
          </Box>
        )}
        {row?.kind === 'fixed' && <Text color="yellow">{replyLanguageFixed(row.source)}</Text>}
        {note(ui, DESCRIPTIONS.replyLanguage)}
      </Box>
      <Box flexDirection="column">
        {alone(
          ui,
          <Select
            key={vm.key('translate-service')}
            label={ITEM_NAMES.translateService}
            value={settings.translateService}
            options={serviceOptions(settings, model.label)}
            onSelect={value => actions.pick('translateService', value)}
          />,
        )}
        {note(ui, TRANSLATE_SERVICE_NOTE)}
        {alone(
          ui,
          <Button key="goto-services" label={TRANSLATE_SERVICE_DESCRIPTION.link} onPress={() => actions.gotoServices()} />,
        )}
      </Box>
    </Box>
  )
}
