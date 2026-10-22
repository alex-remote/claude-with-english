import type { WweSettings } from '../../../types'
import { savedToast } from '../copy/common'
import {
  AUTO_REPLY_LABELS,
  AUTO_REPLY_WHEN_LABELS,
  CONCURRENCY_UNIT,
  CARD_LANGUAGE_NAMES,
  CLAUDE_MODEL_LABELS,
  ITEM_NAMES,
  READING_MODE_LABELS,
  SPEECH_SERVICE_LABELS,
  SYSTEM_DEFAULT_VOICE,
  TRANSLATE_SERVICE_LABELS,
  lastRepliesText,
  onOff,
} from '../copy/settings'
import { maskKey } from './schema'
import type { SettingKey } from './schema'

// How a saved value reads in its toast (设置 › 保存): "翻译延迟 1.5 s",
// "严格模式 关", "阅读方式 划选模式", an API key by its mask.

/** The other settings a value is shown with: the delay's unit, the count of 每轮最后 */
export type FormatContext = Partial<Pick<WweSettings, 'delayUnit' | 'autoReplyCount'>>

/** The number the delay field shows in a unit: 700 in ms, 0.7 in s. */
export function delayFieldText(ms: number, unit: WweSettings['delayUnit']): string {
  // ms is a whole number, so the shortest form of ms / 1000 has at most three decimals and reads back to ms
  return unit === 's' ? String(ms / 1000) : String(ms)
}

export const formatDelay = (ms: number, unit: WweSettings['delayUnit']) =>
  `${delayFieldText(ms, unit)} ${unit}`

/** A value as its toast shows it, after the setting's name. */
export function formatValue<K extends SettingKey>(
  key: K,
  value: WweSettings[K],
  context: FormatContext = {},
): string {
  const v = value as WweSettings[SettingKey]
  switch (key) {
    case 'delayMs':
      return formatDelay(v as number, context.delayUnit ?? 'ms')
    case 'autoReply':
      return v === 'last'
        ? lastRepliesText(context.autoReplyCount ?? 1)
        : AUTO_REPLY_LABELS[v as WweSettings['autoReply']]
    case 'autoReplyCount':
      return lastRepliesText(v as number)
    case 'translateConcurrency':
      return `${v as number} ${CONCURRENCY_UNIT}`
    case 'autoReplyWhen':
      return AUTO_REPLY_WHEN_LABELS[v as WweSettings['autoReplyWhen']]
    case 'readingMode':
      return READING_MODE_LABELS[v as WweSettings['readingMode']]
    case 'translateService':
      return TRANSLATE_SERVICE_LABELS[v as WweSettings['translateService']]
    case 'speechService':
      return SPEECH_SERVICE_LABELS[v as WweSettings['speechService']]
    case 'cardLanguage':
      return CARD_LANGUAGE_NAMES[v as WweSettings['cardLanguage']]
    case 'claudeModel':
      return CLAUDE_MODEL_LABELS[v as string] ?? (v as string)
    case 'voiceSystem':
      return v === '' ? SYSTEM_DEFAULT_VOICE : (v as string)
    case 'openaiKey':
    case 'elevenKey':
      return maskKey(v as string) ?? ''
  }
  return typeof v === 'boolean' ? onOff(v) : String(v)
}

/**
 * The toast a save raises: "已保存：<设置项> <新值>". `label` stands for the
 * value when what is stored is an id, such as an ElevenLabs voice's. Null for
 * 手动填写, which only switches how the model is filled in.
 */
export function toastText<K extends SettingKey>(
  key: K,
  value: WweSettings[K],
  context: FormatContext = {},
  label?: string,
): string | null {
  if (key === 'openaiManual') {
    return null
  }
  return savedToast(ITEM_NAMES[key], label ?? formatValue(key, value, context))
}
