import type { SelectOption } from 'claude-code'

import type { WweSettings, WweSettingsView } from '../../../../types'
import {
  CLAUDE_MODEL_LABELS,
  CUSTOM_MODEL_FIELD,
  CUSTOM_MODEL_LABEL,
  CUSTOM_MODEL_PLACEHOLDER,
  DEFAULT_SUFFIX,
  DESCRIPTIONS,
  FIELD_SUBMIT,
  ITEM_NAMES,
  NOT_IN_LIST_SUFFIX,
  modelReplaced,
  serviceTabLabel,
  usedFor,
} from '../../../core/copy/settings'
import type { ServiceTab } from '../../../core/copy/settings'
import { CUSTOM_MODEL_OPTION } from '../../../core/settings/save'
import { DEFAULT_SETTINGS } from '../../../core/settings/schema'
import { alone, errorLine, note } from '../controls'
import type { PaneActions, PaneUi, PaneVm } from '../controls'

// The 服务 page (F7): a sub-menu with one tab per service, and the chosen
// service's settings under it. The first version's Claude Code 账号 comes
// first; OpenAI 兼容接口 and ElevenLabs join the menu in M6.

export const SERVICE_TABS: readonly ServiceTab[] = ['claude']

/** The tab the page opens on: the service that translates, while it has one */
export const serviceTabOf = (service: WweSettings['translateService']): ServiceTab =>
  SERVICE_TABS.includes(service) ? service : 'claude'

/** Whether a service can be chosen to translate: the OpenAI-compatible one is configured in M6 */
export const isServiceReady = (service: WweSettings['translateService'], settings: WweSettingsView) =>
  service === 'claude' || (SERVICE_TABS.includes('openai') && settings.openaiBaseUrl !== '' && settings.openaiKeyMask !== null && settings.openaiModel !== '')

export const MODEL_ALIASES = ['haiku', 'sonnet', 'opus'] as const

const isAlias = (model: string): model is (typeof MODEL_ALIASES)[number] =>
  (MODEL_ALIASES as readonly string[]).includes(model)

/** `availableModels` as the merged settings hold it; null when it restricts nothing */
export function allowedOf(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const list = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
  return list.length === 0 ? null : list
}

const familyOf = (id: string) => MODEL_ALIASES.find(alias => id.includes(alias)) ?? null

/**
 * Whether the organization's list lets a model through (model-config.md ›
 * Restrict model selection): an entry names a family, a version prefix or a
 * full id, and an alias passes while any version of its family does.
 */
export function isModelAllowed(model: string, allowed: readonly string[] | null): boolean {
  if (allowed === null) {
    return true
  }
  const wanted = model.trim().toLowerCase()
  return allowed.some(raw => {
    const entry = raw.trim().toLowerCase()
    if (isAlias(wanted)) {
      return familyOf(entry) === wanted
    }
    if (isAlias(entry)) {
      return familyOf(wanted) === entry
    }
    return wanted === entry || wanted.startsWith(`${entry}-`)
  })
}

export type ModelChoice = {
  options: SelectOption[]
  /** What the dropdown shows */
  value: string
  /** The model as the 翻译 page names it: Claude Code 账号（Haiku） */
  label: string
  /** The alias the default Haiku gave way to, as named */
  replacedBy: string | null
  /** The id field under the dropdown shows */
  hasField: boolean
}

/**
 * The 模型 dropdown under an organization's list: only what it allows, the
 * default Haiku given up for the first that is allowed, and a saved model
 * the list leaves out still shown, marked （列表里没有）(F7).
 */
export function modelChoice(saved: string, allowed: readonly string[] | null, isCustomOpen: boolean): ModelChoice {
  const permitted: readonly string[] = MODEL_ALIASES.filter(alias => isModelAllowed(alias, allowed))
  const replacement = saved === DEFAULT_SETTINGS.claudeModel && !permitted.includes(saved) ? permitted[0] : undefined
  const options: SelectOption[] = MODEL_ALIASES.filter(
    alias => permitted.includes(alias) || (alias === saved && replacement === undefined),
  ).map(alias => ({
    value: alias,
    label:
      (CLAUDE_MODEL_LABELS[alias] ?? alias) +
      (alias === DEFAULT_SETTINGS.claudeModel ? DEFAULT_SUFFIX : '') +
      (permitted.includes(alias) ? '' : NOT_IN_LIST_SUFFIX),
  }))
  const isSavedAlias = isAlias(saved)
  options.push({
    value: CUSTOM_MODEL_OPTION,
    label: CUSTOM_MODEL_LABEL + (isSavedAlias || isModelAllowed(saved, allowed) ? '' : NOT_IN_LIST_SUFFIX),
  })
  const shown = replacement ?? saved
  const hasField = isCustomOpen || !isSavedAlias
  return {
    options,
    value: hasField ? CUSTOM_MODEL_OPTION : shown,
    label: isSavedAlias ? (CLAUDE_MODEL_LABELS[shown] ?? shown) : saved,
    replacedBy: replacement === undefined ? null : (CLAUDE_MODEL_LABELS[replacement] ?? replacement),
    hasField,
  }
}

export function servicesPage(ui: PaneUi, vm: PaneVm, actions: PaneActions) {
  const { Box, Text, Button, Input, Select } = ui
  const { settings } = vm
  const current = SERVICE_TABS.includes(vm.pane.svcTab) ? vm.pane.svcTab : 'claude'
  const choice = modelChoice(settings.claudeModel, vm.allowedModels, vm.isCustomModelOpen)
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        {SERVICE_TABS.map(tab => (
          <Button
            key={`svc-${tab}`}
            label={serviceTabLabel(tab, usedFor(settings.translateService === tab, settings.speechService === tab))}
            plain
            dimColor={tab !== current}
            onPress={() => actions.serviceTab(tab)}
          />
        ))}
      </Box>
      <Box flexDirection="column">
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
    </Box>
  )
}
