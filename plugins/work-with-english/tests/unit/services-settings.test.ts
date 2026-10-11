import { describe, expect, test } from 'claude-code/testing'

import {
  cacheCleared,
  configDeleted,
  inUseText,
  modelsFailed,
  elevenFailed,
  openaiMissingText,
  sizeText,
} from '../../hooks/core/copy/settings'
import { allowedOf, modelInUse } from '../../hooks/core/settings/models'
import { DEFAULT_VIEW } from '../../hooks/core/settings/schema'
import {
  elevenListOf,
  englishVoicesOf,
  isSpeechReady,
  isTranslateReady,
  openaiListOf,
  openaiMissing,
} from '../../hooks/core/settings/services'
import type { Host } from '../../hooks/host'
import { run } from '../../hooks/services/translate/index'
import type { WweSettingsView } from '../../types'

// M6's pure parts of the 服务 and 阅读 pages: when a service can be chosen,
// the lists as stored, the system's voices, the copy, and the model a
// translation sends under an organization's availableModels.

const view = (patch: Partial<WweSettingsView> = {}): WweSettingsView => ({ ...DEFAULT_VIEW, ...patch })

describe('配置完成才能选（F7、F8）', () => {
  test('翻译：OpenAI 兼容接口要请求地址、API Key 和翻译模型', () => {
    expect(openaiMissing(view())).toEqual(['openaiBaseUrl', 'openaiKey', 'openaiModel'])
    expect(openaiMissing(view({ openaiBaseUrl: 'https://x/v1', openaiKeyMask: '' }))).toEqual(['openaiModel'])
    expect(isTranslateReady('claude', view())).toBe(true)
    expect(isTranslateReady('openai', view({ openaiBaseUrl: 'https://x/v1', openaiKeyMask: 'sk-…a1b2' }))).toBe(false)
    expect(
      isTranslateReady('openai', view({ openaiBaseUrl: 'https://x/v1', openaiKeyMask: 'sk-…a1b2', openaiModel: 'm' })),
    ).toBe(true)
  })

  test('朗读：OpenAI 兼容接口要朗读模型；ElevenLabs 要 Key 和获取到的声音', () => {
    const openai = view({ openaiBaseUrl: 'https://x/v1', openaiKeyMask: 'sk-…a1b2' })
    expect(isSpeechReady('system', view())).toBe(true)
    expect(isSpeechReady('openai', openai)).toBe(false)
    expect(isSpeechReady('openai', { ...openai, openaiTtsModel: 'tts-1' })).toBe(true)
    expect(isSpeechReady('elevenlabs', view({ elevenKeyMask: 'sk_…9z8y' }))).toBe(false)
    expect(isSpeechReady('elevenlabs', view({ elevenKeyMask: 'sk_…9z8y', voiceEleven: 'voice-george' }))).toBe(true)
  })
})

describe('store 里的列表', () => {
  test('坏掉的当没有；重复的 id 只留一个', () => {
    expect(openaiListOf(undefined)).toBeNull()
    expect(openaiListOf({ ids: 'gpt-4o', from: 'x' })).toBeNull()
    expect(openaiListOf({ ids: ['a', 'a', 3, 'b'], from: 'https://x/v1/models' })).toEqual({
      ids: ['a', 'b'],
      from: 'https://x/v1/models',
    })
    expect(elevenListOf({ models: [] })).toBeNull()
    expect(elevenListOf({ models: [{ id: 'm' }], voices: [{ id: 'v', name: 'V' }, { name: 'no id' }] })).toEqual({
      models: [{ id: 'm', name: 'm' }],
      voices: [{ id: 'v', name: 'V' }],
    })
  })
})

describe('系统里的英语声音（say -v ?）', () => {
  test('只留英语的，每个一次，名字里可以有空格和括号', () => {
    const stdout = [
      'Albert              en_US    # Hello! My name is Albert.',
      'Alice               it_IT    # Ciao! Mi chiamo Alice.',
      'Bad News            en_US    # Hello! My name is Bad News.',
      'Daniel (English (UK)) en_GB    # Hello! My name is Daniel.',
      'Daniel (English (UK)) en_GB    # Hello! My name is Daniel.',
      'Eddy (German (Germany)) de_DE    # Hallo! Ich heiße Eddy.',
      'Tingting            zh_CN    # 你好！我叫婷婷。',
      '',
    ].join('\n')
    expect(englishVoicesOf(stdout)).toEqual(['Albert', 'Bad News', 'Daniel (English (UK))'])
    expect(englishVoicesOf('')).toEqual([])
  })
})

describe('M6 的文案', () => {
  test('缓存大小和清除后的 Toast（F6 › 存多久）', () => {
    expect([0, 512, 1024, 1536, 12 * 1024, 150 * 1024 + 300, 1.5 * 1024 * 1024].map(sizeText)).toEqual([
      '0 KB',
      '512 KB',
      '1 MB',
      '1.5 MB',
      '12 MB',
      '150 MB',
      '1.5 GB',
    ])
    expect(cacheCleared(12 * 1024)).toBe('已清除译文和朗读缓存，释放了 12 MB。')
  })

  test('配置状态（F7 › 页面提示）', () => {
    expect(openaiMissingText(['请求地址', 'API Key'])).toBe('还缺请求地址、API Key。填全后可以在“翻译”页选用。')
    expect(inUseText('gpt-4o-mini', null)).toBe('✓ 使用中，翻译使用 gpt-4o-mini')
    expect(inUseText('gpt-4o-mini', 'tts-1')).toBe('✓ 使用中，翻译使用 gpt-4o-mini，朗读使用 tts-1')
    expect(inUseText(null, 'tts-1')).toBe('✓ 使用中，朗读使用 tts-1')
  })

  test('获取失败和删除配置', () => {
    expect(modelsFailed('401 API Key 不对或已过期，请检查 API Key 或勾选“手动填写”')).toBe(
      '获取模型列表失败：401 API Key 不对或已过期，请检查 API Key 或勾选“手动填写”。',
    )
    expect(elevenFailed('401 API Key 不对或已过期，请检查 API Key')).toBe(
      '获取模型和声音失败：401 API Key 不对或已过期，请检查 API Key。',
    )
    expect(configDeleted('openai', false, false)).toBe('已删除 OpenAI 兼容接口的配置。')
    expect(configDeleted('openai', true, false)).toBe('已删除 OpenAI 兼容接口的配置，翻译改回 Claude Code 账号。')
    expect(configDeleted('elevenlabs', false, true)).toBe('已删除 ElevenLabs 的配置，朗读改回系统声音。')
  })
})

const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

/** A Host whose model answers "ok" and records the model asked; `availableModels` as the merged settings hold it */
function fakeHost(store: Record<string, unknown>, settings: () => Promise<Record<string, unknown>>) {
  const models: string[] = []
  let reads = 0
  const host = {
    model: {
      complete: async (request: { model: string }) => {
        models.push(request.model)
        return { isAnswered: true, text: 'ok', usage: USAGE }
      },
    },
    store: { get: async (key: string) => store[key] },
    settings: {
      read: () => {
        reads += 1
        return settings()
      },
    },
    ui: { debug: () => undefined },
  } as unknown as Host
  return { host, models, reads: () => reads }
}

describe('组织限制了可用模型时，翻译用的模型和“服务”页显示的一致（F7）', () => {
  test('modelInUse：默认的 Haiku 不被允许时用列表里第一个；别的已保存模型照用', () => {
    expect(modelInUse('haiku', null)).toBe('haiku')
    expect(modelInUse('haiku', allowedOf(['sonnet', 'opus']))).toBe('sonnet')
    expect(modelInUse('haiku', allowedOf(['claude-opus-4-6']))).toBe('opus')
    expect(modelInUse('opus', allowedOf(['sonnet']))).toBe('opus')
    expect(modelInUse('claude-haiku-4-5-20251001', allowedOf(['sonnet']))).toBe('claude-haiku-4-5-20251001')
    expect(modelInUse('haiku', allowedOf([]))).toBe('haiku')
  })

  test('翻译时读 availableModels，按它选模型', async () => {
    const { host, models } = fakeHost({}, async () => ({ availableModels: ['sonnet', 'opus'] }))
    expect(await run(host, { kind: 'draft', text: '你好' })).toEqual({ ok: true, value: 'ok' })
    expect(models).toEqual(['sonnet'])
  })

  test('保存的不是默认模型时不读；读不到时照用 Haiku', async () => {
    const saved = fakeHost({ 'settings/claudeModel': 'opus' }, async () => ({ availableModels: ['sonnet'] }))
    await run(saved.host, { kind: 'draft', text: '你好' })
    expect(saved.models).toEqual(['opus'])
    expect(saved.reads()).toBe(0)
    const broken = fakeHost({}, () => Promise.reject(new Error('settings unavailable')))
    await run(broken.host, { kind: 'draft', text: '你好' })
    expect(broken.models).toEqual(['haiku'])
  })
})
