import type { WweSettings } from '../../../types'
import { ERRORS } from '../copy/settings'
import { hostOf, isHttpUrl } from '../endpoints'
import { delayFieldText } from './format'
import { DEFAULT_SETTINGS, isConcurrencyInRange, isDelayInRange, isReplyCountInRange } from './schema'
import type { SettingKey } from './schema'

// The rules of 设置 › 保存 in docs/feature-map.md, as pure functions: what a
// field's commit (blur or Enter), a pick from a dropdown or a switch, and
// 恢复默认 do with the saved settings. The caller writes what they return.

/**
 * - `save`: write `value`, and `also` with it under the same toast.
 *   `keyStale` true or false sets or clears the "key not entered again since
 *   the address changed domain" flag; left out, the flag stays. `refetch`
 *   asks for the key's service lists again (F7 获取模型列表).
 * - `noop`: nothing is saved and no toast shows; the field shows the saved
 *   value again (an API key field stays empty).
 * - `revert`: an emptied field, or a choice that can't be taken: the control
 *   shows the saved value again.
 * - `invalid`: the field turns red with `message` under it and keeps what was typed.
 */
export type Commit<K extends SettingKey = SettingKey> =
  | {
      kind: 'save'
      value: WweSettings[K]
      also?: Partial<WweSettings>
      keyStale?: boolean
      refetch?: boolean
    }
  | { kind: 'noop' }
  | { kind: 'revert' }
  | { kind: 'invalid'; message: string; keepDraft: true }

/** The settings edited in a text field */
export type InputKey =
  | 'delayMs'
  | 'autoReplyCount'
  | 'translateConcurrency'
  | 'ankiDeck'
  | 'claudeModel'
  | 'openaiBaseUrl'
  | 'openaiKey'
  | 'openaiModel'
  | 'openaiTtsModel'
  | 'elevenKey'

/** The settings picked from a dropdown, a radio pair, a switch or a checkbox */
export type SelectKey = Exclude<
  SettingKey,
  'delayMs' | 'delayUnit' | 'autoReplyCount' | 'translateConcurrency' | 'ankiDeck' | 'openaiBaseUrl' | 'openaiKey' | 'openaiTtsModel' | 'elevenKey'
>

export type CommitExtra = {
  /** delayMs: the unit next to the field when it was committed */
  unit?: WweSettings['delayUnit']
  /** The address moved to another domain and the OpenAI key hasn't been entered again since */
  keyStale?: boolean
  /** The key's last fetch of models (and voices) failed */
  fetchFailed?: boolean
}

/** The 模型 dropdown's 自定义模型 id: it opens the id field and saves nothing yet */
export const CUSTOM_MODEL_OPTION = 'custom'

const NOOP = { kind: 'noop' } as const
const REVERT = { kind: 'revert' } as const
const invalid = (message: string) => ({ kind: 'invalid', message, keepDraft: true }) as const

/** A field left on blur or Enter. `draft` is the text in the field. */
export function commitInput<K extends InputKey>(
  key: K,
  draft: string,
  saved: WweSettings,
  extra: CommitExtra = {},
): Commit<K> {
  return commitAny(key, draft.trim(), saved, extra) as Commit<K>
}

function commitAny(key: InputKey, text: string, saved: WweSettings, extra: CommitExtra): Commit {
  if (key === 'openaiKey' || key === 'elevenKey') {
    return commitKey(key, text, saved, extra)
  }
  if (text === '') {
    return REVERT
  }
  switch (key) {
    case 'delayMs':
      return commitDelay(text, saved, extra.unit ?? saved.delayUnit)
    case 'autoReplyCount': {
      const n = /^\d+$/.test(text) ? Number(text) : NaN
      if (!isReplyCountInRange(n)) {
        return invalid(ERRORS.replyCount)
      }
      return n === saved.autoReplyCount ? NOOP : { kind: 'save', value: n }
    }
    case 'translateConcurrency': {
      const n = /^\d+$/.test(text) ? Number(text) : NaN
      if (!isConcurrencyInRange(n)) {
        return invalid(ERRORS.concurrency)
      }
      return n === saved.translateConcurrency ? NOOP : { kind: 'save', value: n }
    }
    case 'openaiBaseUrl':
      return commitBaseUrl(text, saved, extra)
  }
  return text === saved[key] ? NOOP : { kind: 'save', value: text }
}

/**
 * 翻译延迟: the number is read in the unit beside it. A new unit with the same
 * delay saves nothing (docs/dev-plan.md, 冲突怎么处理); a new delay saves the
 * unit it was typed in with it.
 */
function commitDelay(text: string, saved: WweSettings, unit: WweSettings['delayUnit']): Commit<'delayMs'> {
  // A decimal comma reads as a point, as in the prototype
  if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(text)) {
    return invalid(ERRORS.delay)
  }
  const number = Number(text.replace(',', '.'))
  const ms = Math.round(unit === 's' ? number * 1000 : number)
  if (!isDelayInRange(ms)) {
    return invalid(ERRORS.delay)
  }
  if (ms === saved.delayMs) {
    return NOOP
  }
  return unit === saved.delayUnit
    ? { kind: 'save', value: ms }
    : { kind: 'save', value: ms, also: { delayUnit: unit } }
}

/**
 * The unit dropdown beside 翻译延迟. Switching it saves nothing; a number
 * typed before the switch is read in the new unit and committed: 1.5, then s,
 * saves 1.5 s. `draft` is null when the field wasn't edited.
 */
export function switchDelayUnit(
  draft: string | null,
  saved: WweSettings,
  from: WweSettings['delayUnit'],
  to: WweSettings['delayUnit'],
): Commit<'delayMs'> {
  if (draft === null || draft.trim() === '' || draft.trim() === delayFieldText(saved.delayMs, from)) {
    return NOOP
  }
  return commitInput('delayMs', draft, saved, { unit: to })
}

/** Whether 恢复默认 shows beside 翻译延迟 */
export const canResetDelay = (saved: WweSettings) => saved.delayMs !== DEFAULT_SETTINGS.delayMs

/** 恢复默认: back to 700 ms */
export function resetDelay(saved: WweSettings): Commit<'delayMs'> {
  if (!canResetDelay(saved)) {
    return NOOP
  }
  const value = DEFAULT_SETTINGS.delayMs
  const unit = DEFAULT_SETTINGS.delayUnit
  return saved.delayUnit === unit ? { kind: 'save', value } : { kind: 'save', value, also: { delayUnit: unit } }
}

/**
 * 请求地址. Moving it to another domain while a key is saved holds the old
 * key back: no list is fetched until the key is entered again (F7). The
 * domain is the host name, so a new port or path keeps it.
 */
function commitBaseUrl(text: string, saved: WweSettings, extra: CommitExtra): Commit<'openaiBaseUrl'> {
  if (!isHttpUrl(text)) {
    return invalid(ERRORS.baseUrl)
  }
  if (text === saved.openaiBaseUrl) {
    return NOOP
  }
  const hasKey = saved.openaiKey !== ''
  const moved = saved.openaiBaseUrl !== '' && hasKey && hostOf(text) !== hostOf(saved.openaiBaseUrl)
  const refetch = hasKey && !saved.openaiManual && !moved && !extra.keyStale
  return moved ? { kind: 'save', value: text, keyStale: true, refetch } : { kind: 'save', value: text, refetch }
}

/**
 * API Key. Left empty it stays empty. The key already saved counts as saving
 * it again when the address changed domain since, or when the last fetch with
 * it failed: then it is how the user retries (F7, 通用状态).
 */
function commitKey(
  key: 'openaiKey' | 'elevenKey',
  text: string,
  saved: WweSettings,
  extra: CommitExtra,
): Commit<'openaiKey' | 'elevenKey'> {
  if (text === '') {
    return NOOP
  }
  if (key === 'elevenKey') {
    return text === saved.elevenKey && !extra.fetchFailed ? NOOP : { kind: 'save', value: text, refetch: true }
  }
  if (text === saved.openaiKey && !extra.keyStale && !extra.fetchFailed) {
    return NOOP
  }
  const refetch = saved.openaiBaseUrl !== '' && !saved.openaiManual
  return { kind: 'save', value: text, keyStale: false, refetch }
}

export type SelectExtra = {
  /** The option is greyed out (未配置完成) and can't be taken */
  isDisabled?: boolean
  /** openaiManual: as CommitExtra's */
  keyStale?: boolean
}

/** A dropdown, a radio pair, a switch or a checkbox: saved as soon as it is picked. */
export function selectValue<K extends SelectKey>(
  key: K,
  value: WweSettings[K],
  saved: WweSettings,
  extra: SelectExtra = {},
): Commit<K> {
  if (extra.isDisabled) {
    return REVERT
  }
  if (key === 'claudeModel' && value === CUSTOM_MODEL_OPTION) {
    return NOOP
  }
  if (value === saved[key]) {
    return NOOP
  }
  if (key === 'openaiManual') {
    // Unticked, the list is fetched once with what is saved
    const refetch =
      value === false && saved.openaiBaseUrl !== '' && saved.openaiKey !== '' && !extra.keyStale
    return { kind: 'save', value, refetch } as Commit<K>
  }
  return { kind: 'save', value }
}
