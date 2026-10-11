import type { WweSettings } from '../../../../types'
import {
  AUTO_REPLY_LABELS,
  DEFAULT_SUFFIX,
  DESCRIPTIONS,
  FIELD_SUBMIT,
  ITEM_NAMES,
  READING_MODE_LABELS,
  REPLY_COUNT_UNIT,
  radioLabel,
} from '../../../core/copy/settings'
import { DEFAULT_SETTINGS } from '../../../core/settings/schema'
import { alone, errorLine, note, switchRow } from '../controls'
import type { PaneActions, PaneUi, PaneVm } from '../controls'

// The 阅读 page's first half (F6, F9): 阅读方式 with 自动翻译回复 under the
// paragraph mode, and 自动翻译计划和提问 for both modes. 朗读服务, 声音 and
// 本机缓存 come with M4 and M6.

/** 自动翻译回复's options in the feature map's order, the default marked */
const AUTO_REPLY_ORDER: readonly WweSettings['autoReply'][] = ['off', 'last', 'all']

const autoReplyOptions = AUTO_REPLY_ORDER.map(value => ({
  value,
  label: AUTO_REPLY_LABELS[value] + (value === DEFAULT_SETTINGS.autoReply ? DEFAULT_SUFFIX : ''),
}))

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
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        <Text bold>{ITEM_NAMES.readingMode}</Text>
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
              </Box>
              {errorLine(ui, vm.pane.errors.autoReplyCount)}
              {note(ui, DESCRIPTIONS.autoReply)}
            </Box>
          )}
        </Box>
        {alone(ui, mode('select', false))}
        <Box paddingLeft={2}>{note(ui, DESCRIPTIONS.selectMode)}</Box>
        {note(ui, DESCRIPTIONS.readingMode)}
      </Box>
      <Box flexDirection="column">
        {switchRow(ui, 'auto-plan-ask', ITEM_NAMES.autoPlanAsk, settings.autoPlanAsk, () => actions.flip('autoPlanAsk'))}
        {note(ui, DESCRIPTIONS.autoPlanAsk)}
      </Box>
    </Box>
  )
}
