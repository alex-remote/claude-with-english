import type { WwePane, WweSettings, WweSettingsView } from '../../../types'
import type { SettingKey } from './schema'

// F7, F8: what the 服务 page knows of each service apart from its settings:
// when a service is configured enough to be chosen, the lists fetched for it
// as `$.store` keeps them, and the voices it can read with.

export type OpenaiList = NonNullable<WwePane['openaiList']>
export type ElevenList = NonNullable<WwePane['elevenList']>

/** Where `$.store` keeps the last list fetched for each service; a failed fetch leaves it as it was */
export const CATALOG_KEYS = { openai: 'catalog/openai', elevenlabs: 'catalog/eleven' } as const

/**
 * The store's flag for a key held back from a new domain (F7 › 换了请求地址的
 * 域名); services/settings.ts sets it on a save, 删除配置 clears it with the key.
 */
export const KEY_STALE_FLAG = 'flag/keyStale'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isText = (value: unknown): value is string => typeof value === 'string' && value !== ''

/** `catalog/openai` as stored, or null when there is none or it is broken */
export function openaiListOf(raw: unknown): OpenaiList | null {
  if (!isRecord(raw) || !Array.isArray(raw.ids) || !isText(raw.from)) {
    return null
  }
  return { ids: [...new Set(raw.ids.filter(isText))], from: raw.from }
}

const namedOf = (raw: unknown): { id: string; name: string }[] | null =>
  Array.isArray(raw)
    ? raw.flatMap(item =>
        isRecord(item) && isText(item.id) ? [{ id: item.id, name: isText(item.name) ? item.name : item.id }] : [],
      )
    : null

/** `catalog/eleven` as stored, or null when there is none or it is broken */
export function elevenListOf(raw: unknown): ElevenList | null {
  if (!isRecord(raw)) {
    return null
  }
  const models = namedOf(raw.models)
  const voices = namedOf(raw.voices)
  return models && voices ? { models, voices } : null
}

/** The three settings the OpenAI-compatible service needs to translate, in the order the page shows them */
export const OPENAI_NEEDS = ['openaiBaseUrl', 'openaiKey', 'openaiModel'] as const

/** What the OpenAI-compatible service still lacks to translate (F7 › 页面提示 › 配置状态) */
export function openaiMissing(settings: WweSettingsView): (typeof OPENAI_NEEDS)[number][] {
  return OPENAI_NEEDS.filter(key =>
    key === 'openaiKey' ? settings.openaiKeyMask === null : settings[key] === '',
  )
}

/** Whether a service can be chosen to translate (F7: 没配置完成的服务不能选) */
export const isTranslateReady = (service: WweSettings['translateService'], settings: WweSettingsView) =>
  service === 'claude' || openaiMissing(settings).length === 0

/**
 * Whether a service can be chosen to read aloud (F8): the OpenAI-compatible
 * one with its address, key and 朗读模型; ElevenLabs once its key has given a
 * voice, which its first fetch saves.
 */
export function isSpeechReady(service: WweSettings['speechService'], settings: WweSettingsView): boolean {
  switch (service) {
    case 'system':
      return true
    case 'openai':
      return settings.openaiBaseUrl !== '' && settings.openaiKeyMask !== null && settings.openaiTtsModel !== ''
    case 'elevenlabs':
      return settings.elevenKeyMask !== null && settings.elevenModel !== '' && settings.voiceEleven !== ''
  }
}

/** What 删除配置 empties, by service: everything on its tab, the key too, and ElevenLabs' voice of that account */
export const SERVICE_SETTINGS: Record<'openai' | 'elevenlabs', readonly SettingKey[]> = {
  openai: ['openaiBaseUrl', 'openaiKey', 'openaiModel', 'openaiManual', 'openaiTtsModel'],
  elevenlabs: ['elevenKey', 'elevenModel', 'voiceEleven'],
}

/** F8: OpenAI's built-in voices, in the feature map's order */
export const OPENAI_VOICES: readonly string[] = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
]

const VOICE_LINE = /^(.+?)\s+([a-z]{2,3}[_-][A-Za-z0-9]+)(?:\s+#.*)?$/

/**
 * The English voices `say -v ?` lists, each once, in its order: a line is
 * the voice's name (which may hold spaces and brackets), its locale and a
 * sample after `#`, as "Daniel (English (UK)) en_GB    # Hello!".
 */
export function englishVoicesOf(stdout: string): string[] {
  const names: string[] = []
  for (const line of stdout.split('\n')) {
    const match = VOICE_LINE.exec(line.trim())
    const name = match?.[1]?.trim()
    if (name && /^en[_-]/.test(match?.[2] ?? '') && !names.includes(name)) {
      names.push(name)
    }
  }
  return names
}
