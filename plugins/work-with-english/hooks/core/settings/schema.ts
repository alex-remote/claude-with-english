import type { WweSettings, WweSettingsView } from '../../../types'

// Every setting of the 设置 table in docs/feature-map.md: its default, where
// `$.store` keeps it, the name its toast says, and how a value is checked and
// shown. One key per setting, so sessions writing different settings never
// overwrite each other (interface.md › Save from more than one session).

export type SettingKey = keyof WweSettings

export const DEFAULT_SETTINGS: WweSettings = {
  delayMs: 700,
  delayUnit: 'ms',
  strict: true,
  translateService: 'claude',
  readingMode: 'paragraph',
  autoReply: 'all',
  autoReplyCount: 1,
  autoPlanAsk: true,
  speechService: 'system',
  voiceSystem: '',
  voiceOpenai: 'coral',
  voiceEleven: '',
  ankiSync: true,
  ankiDeck: 'work-with-english',
  claudeModel: 'haiku',
  openaiBaseUrl: '',
  openaiKey: '',
  openaiModel: '',
  openaiManual: false,
  openaiTtsModel: '',
  elevenKey: '',
  elevenModel: 'eleven_multilingual_v2',
  weeklyReminder: true,
  cardLanguage: 'target',
}

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingKey[]

/** Where `$.store` keeps a setting. */
export const storeKeyOf = (key: SettingKey) => `settings/${key}`

/** F1: the translation delay's range, in ms */
export const DELAY_MIN_MS = 100
export const DELAY_MAX_MS = 5000

/** F6: the range of "每轮最后 N 条" */
export const REPLY_COUNT_MIN = 1
export const REPLY_COUNT_MAX = 99

/** One stored value, kept only when it has the default's type (and, for a choice, one of its values). */
export function coerceSetting<K extends SettingKey>(key: K, stored: unknown): WweSettings[K] {
  const fallback = DEFAULT_SETTINGS[key]
  if (typeof stored !== typeof fallback) {
    return fallback
  }
  const choices = CHOICES[key]
  if (choices && !choices.includes(stored as string)) {
    return fallback
  }
  if (key === 'delayMs' && !isDelayInRange(stored as number)) {
    return fallback
  }
  if (key === 'autoReplyCount' && !isReplyCountInRange(stored as number)) {
    return fallback
  }
  return stored as WweSettings[K]
}

const CHOICES: Partial<Record<SettingKey, readonly string[]>> = {
  delayUnit: ['ms', 's'],
  translateService: ['claude', 'openai'],
  readingMode: ['paragraph', 'select'],
  autoReply: ['all', 'last', 'off'],
  speechService: ['system', 'openai', 'elevenlabs'],
  cardLanguage: ['target', 'source'],
}

export const isDelayInRange = (ms: number) =>
  Number.isFinite(ms) && ms >= DELAY_MIN_MS && ms <= DELAY_MAX_MS

export const isReplyCountInRange = (n: number) =>
  Number.isInteger(n) && n >= REPLY_COUNT_MIN && n <= REPLY_COUNT_MAX

/**
 * F7: what a saved API key's placeholder shows: the first 3 and last 4
 * characters, or nothing of it when it has fewer than 8 (设置 › 保存).
 */
export function maskKey(key: string): string | null {
  if (key === '') {
    return null
  }
  return key.length < 8 ? '' : `${key.slice(0, 3)}…${key.slice(-4)}`
}

/** The settings as drawings get them: never a key itself. */
export function viewOf(settings: WweSettings): WweSettingsView {
  const { openaiKey, elevenKey, ...rest } = settings
  return { ...rest, openaiKeyMask: maskKey(openaiKey), elevenKeyMask: maskKey(elevenKey) }
}

export const DEFAULT_VIEW: WweSettingsView = viewOf(DEFAULT_SETTINGS)
