import { describe, expect, test } from 'claude-code/testing'

import {
  CARD_LANGUAGE_LABELS,
  ELEVEN_KEY_SHAPE,
  ERRORS,
  ITEM_NAMES,
  OPENAI_KEY_SHAPE,
  SETTINGS_TABS,
  SPEECH_SERVICE_LABELS,
  TAB_LABELS,
  DESCRIPTIONS,
  AUTO_REPLY_LABELS,
  READING_MODE_LABELS,
  REPLY_LANGUAGE_SET,
  keyPlaceholder,
  notConfiguredOption,
  replyLanguageSaved,
  serviceOption,
  usedFor,
} from '../../hooks/core/copy/settings'
import { delayFieldText, formatValue, toastText } from '../../hooks/core/settings/format'
import {
  CUSTOM_MODEL_OPTION,
  canResetDelay,
  commitInput,
  resetDelay,
  selectValue,
  switchDelayUnit,
} from '../../hooks/core/settings/save'
import { DEFAULT_SETTINGS, DEFAULT_VIEW, SETTING_KEYS, maskKey, storeKeyOf } from '../../hooks/core/settings/schema'
import type { Host } from '../../hooks/host'
import { isKeyStale, loadAll, refresh, saveSetting } from '../../hooks/services/settings'
import type { WweSettings, WweSettingsView } from '../../types'

const saved = (patch: Partial<WweSettings> = {}): WweSettings => ({ ...DEFAULT_SETTINGS, ...patch })

const KEY = 'sk-abcdefgha1b2'
const OPENAI = saved({ openaiBaseUrl: 'https://api.openai.com/v1', openaiKey: KEY, openaiModel: 'gpt-4o-mini' })

describe('设置 › 保存：不保存的三种情况', () => {
  test('值没变：输入框和下拉框都不保存', () => {
    expect(commitInput('ankiDeck', 'claude-with-english', saved())).toEqual({ kind: 'noop' })
    expect(commitInput('autoReplyCount', '1', saved())).toEqual({ kind: 'noop' })
    expect(commitInput('openaiBaseUrl', 'https://api.openai.com/v1', OPENAI)).toEqual({ kind: 'noop' })
    expect(selectValue('strict', true, saved())).toEqual({ kind: 'noop' })
    expect(selectValue('readingMode', 'paragraph', saved())).toEqual({ kind: 'noop' })
  })

  test('输入框是空的：失焦后恢复成已保存的值', () => {
    expect(commitInput('ankiDeck', '', saved())).toEqual({ kind: 'revert' })
    expect(commitInput('ankiDeck', '   ', saved())).toEqual({ kind: 'revert' })
    expect(commitInput('delayMs', '', saved(), { unit: 'ms' })).toEqual({ kind: 'revert' })
    expect(commitInput('autoReplyCount', '', saved())).toEqual({ kind: 'revert' })
    expect(commitInput('openaiBaseUrl', '', OPENAI)).toEqual({ kind: 'revert' })
    expect(commitInput('openaiModel', '', OPENAI)).toEqual({ kind: 'revert' })
    expect(commitInput('openaiTtsModel', '', saved({ openaiTtsModel: 'gpt-4o-mini-tts' }))).toEqual({
      kind: 'revert',
    })
  })

  test('API Key 例外：空着失焦时保持空，不保存', () => {
    expect(commitInput('openaiKey', '', OPENAI)).toEqual({ kind: 'noop' })
    expect(commitInput('elevenKey', '', saved({ elevenKey: KEY }))).toEqual({ kind: 'noop' })
  })

  test('值不合法：标红、写怎么改、保留刚才打的内容', () => {
    expect(commitInput('openaiBaseUrl', 'openrouter.ai/api/v1', OPENAI)).toEqual({
      kind: 'invalid',
      message: '请求地址要以 http:// 或 https:// 开头',
      keepDraft: true,
    })
    expect(commitInput('openaiBaseUrl', 'ftp://example.com', OPENAI)).toMatchObject({ kind: 'invalid' })
    expect(commitInput('openaiBaseUrl', 'https://', OPENAI)).toMatchObject({ kind: 'invalid' })
  })
})

describe('设置的默认值（功能地图“设置”表的“默认”列）', () => {
  test('每项的默认值，按 Toast 的写法', () => {
    const shown = (key: keyof WweSettings) => formatValue(key, DEFAULT_SETTINGS[key], DEFAULT_SETTINGS)
    expect(shown('delayMs')).toBe('700 ms')
    expect(shown('strict')).toBe('开')
    expect(shown('translateService')).toBe('Claude Code 账号')
    expect(shown('readingMode')).toBe('段落模式')
    expect(shown('autoReply')).toBe('全部')
    expect(DEFAULT_SETTINGS.autoReplyCount).toBe(1)
    expect(shown('autoPlanAsk')).toBe('开')
    expect(shown('askLayout')).toBe('逐项展示')
    expect(shown('speechService')).toBe('系统声音')
    expect(shown('voiceSystem')).toBe('系统默认')
    expect(shown('voiceOpenai')).toBe('coral')
    expect(shown('ankiSync')).toBe('开')
    expect(shown('ankiDeck')).toBe('claude-with-english')
    expect(shown('claudeModel')).toBe('Haiku')
    expect([DEFAULT_SETTINGS.openaiBaseUrl, DEFAULT_SETTINGS.openaiKey, DEFAULT_SETTINGS.openaiModel]).toEqual(['', '', ''])
    expect(DEFAULT_SETTINGS.openaiTtsModel).toBe('')
    expect(DEFAULT_SETTINGS.elevenKey).toBe('')
    expect(shown('elevenModel')).toBe('eleven_multilingual_v2')
    expect(shown('weeklyReminder')).toBe('开')
    expect(shown('cardLanguage')).toBe('英语')
  })
})

describe('设置 › 保存：输入框', () => {
  test('改了牌组、自定义模型 id、翻译模型、朗读模型就保存', () => {
    expect(commitInput('ankiDeck', ' English ', saved())).toEqual({ kind: 'save', value: 'English' })
    expect(commitInput('claudeModel', 'claude-haiku-4-5-20251001', saved())).toEqual({
      kind: 'save',
      value: 'claude-haiku-4-5-20251001',
    })
    expect(commitInput('openaiModel', 'gpt-4o', OPENAI)).toEqual({ kind: 'save', value: 'gpt-4o' })
    expect(commitInput('openaiTtsModel', 'gpt-4o-mini-tts', OPENAI)).toEqual({
      kind: 'save',
      value: 'gpt-4o-mini-tts',
    })
  })

  test('条数：1 到 99 的整数，不合法时写“请输入 1 到 99 之间的整数”', () => {
    expect(commitInput('autoReplyCount', '3', saved())).toEqual({ kind: 'save', value: 3 })
    expect(commitInput('autoReplyCount', '99', saved())).toEqual({ kind: 'save', value: 99 })
    for (const bad of ['0', '100', '1.5', '-2', 'abc', '3 条']) {
      expect(commitInput('autoReplyCount', bad, saved())).toEqual({
        kind: 'invalid',
        message: '请输入 1 到 99 之间的整数',
        keepDraft: true,
      })
    }
  })
})

describe('设置 › 保存：翻译延迟', () => {
  test('按旁边的单位读数字：1.5 s 存成 1500 ms，单位一起存', () => {
    expect(commitInput('delayMs', '1.5', saved(), { unit: 's' })).toEqual({
      kind: 'save',
      value: 1500,
      also: { delayUnit: 's' },
    })
    expect(commitInput('delayMs', '1200', saved(), { unit: 'ms' })).toEqual({ kind: 'save', value: 1200 })
    expect(commitInput('delayMs', '2', saved({ delayMs: 1500, delayUnit: 's' }), { unit: 's' })).toEqual({
      kind: 'save',
      value: 2000,
    })
  })

  test('小数点写成逗号也认（同原型）', () => {
    expect(commitInput('delayMs', '1,5', saved(), { unit: 's' })).toMatchObject({ kind: 'save', value: 1500 })
    expect(commitInput('delayMs', '.5', saved(), { unit: 's' })).toMatchObject({ kind: 'save', value: 500 })
  })

  test('范围 100 ms 到 5 s，超出时写原型里的提示', () => {
    expect(ERRORS.delay).toBe('请输入 100 ms 到 5 s 之间的数字')
    expect(commitInput('delayMs', '100', saved(), { unit: 'ms' })).toEqual({ kind: 'save', value: 100 })
    expect(commitInput('delayMs', '5', saved(), { unit: 's' })).toMatchObject({ kind: 'save', value: 5000 })
    for (const [text, unit] of [
      ['99', 'ms'],
      ['5001', 'ms'],
      ['5.1', 's'],
      ['0', 's'],
      ['-1', 'ms'],
      ['abc', 'ms'],
      ['1.5 s', 'ms'],
      ['1.5 min', 's'],
    ] as const) {
      expect(commitInput('delayMs', text, saved(), { unit })).toEqual({
        kind: 'invalid',
        message: ERRORS.delay,
        keepDraft: true,
      })
    }
  })

  test('只换了单位、值没变：不保存，也不弹 Toast', () => {
    expect(commitInput('delayMs', '0.7', saved(), { unit: 's' })).toEqual({ kind: 'noop' })
    expect(switchDelayUnit(null, saved(), 'ms', 's')).toEqual({ kind: 'noop' })
    expect(switchDelayUnit('700', saved(), 'ms', 's')).toEqual({ kind: 'noop' })
  })

  test('换单位前打的数字按新单位读：先打 1.5，再选 s，存 1.5 s', () => {
    expect(switchDelayUnit('1.5', saved(), 'ms', 's')).toEqual({
      kind: 'save',
      value: 1500,
      also: { delayUnit: 's' },
    })
  })

  test('输入框里显示的数字按单位写，读回来还是原来的值', () => {
    expect(delayFieldText(700, 'ms')).toBe('700')
    expect(delayFieldText(700, 's')).toBe('0.7')
    expect(delayFieldText(1234, 's')).toBe('1.234')
    expect(commitInput('delayMs', delayFieldText(1234, 's'), saved({ delayMs: 1234 }), { unit: 's' })).toEqual({
      kind: 'noop',
    })
  })

  test('恢复默认：回到 700 ms，点了立即保存；本来就是默认时不显示', () => {
    expect(canResetDelay(saved())).toBe(false)
    expect(resetDelay(saved())).toEqual({ kind: 'noop' })
    expect(canResetDelay(saved({ delayMs: 1500, delayUnit: 's' }))).toBe(true)
    expect(resetDelay(saved({ delayMs: 1500, delayUnit: 's' }))).toEqual({
      kind: 'save',
      value: 700,
      also: { delayUnit: 'ms' },
    })
    expect(resetDelay(saved({ delayMs: 1200 }))).toEqual({ kind: 'save', value: 700 })
    expect(toastText('delayMs', 700, { delayUnit: 'ms' })).toBe('已保存：翻译延迟 700 ms')
  })
})

describe('设置 › 保存：请求地址和 API Key（F7 获取模型列表）', () => {
  test('换了请求地址的域名：先不获取，标记要重新输入 Key', () => {
    expect(commitInput('openaiBaseUrl', 'https://openrouter.ai/api/v1', OPENAI)).toEqual({
      kind: 'save',
      value: 'https://openrouter.ai/api/v1',
      keyStale: true,
      refetch: false,
    })
  })

  test('同一个域名换路径：照常获取', () => {
    expect(commitInput('openaiBaseUrl', 'https://api.openai.com/v1/chat/completions', OPENAI)).toEqual({
      kind: 'save',
      value: 'https://api.openai.com/v1/chat/completions',
      refetch: true,
    })
  })

  test('还没有 Key、原来没有地址、勾着手动填写时', () => {
    expect(commitInput('openaiBaseUrl', 'https://openrouter.ai/api/v1', saved())).toEqual({
      kind: 'save',
      value: 'https://openrouter.ai/api/v1',
      refetch: false,
    })
    expect(commitInput('openaiBaseUrl', 'https://openrouter.ai/api/v1', saved({ openaiKey: KEY }))).toEqual({
      kind: 'save',
      value: 'https://openrouter.ai/api/v1',
      refetch: true,
    })
    expect(
      commitInput('openaiBaseUrl', 'https://api.openai.com/v2', { ...OPENAI, openaiManual: true }),
    ).toMatchObject({ kind: 'save', refetch: false })
  })

  test('Key 还没重新输入时，又换了地址也不获取', () => {
    expect(commitInput('openaiBaseUrl', 'https://openrouter.ai/api', OPENAI, { keyStale: true })).toEqual({
      kind: 'save',
      value: 'https://openrouter.ai/api',
      keyStale: true,
      refetch: false,
    })
  })

  test('域名按主机名比：大小写、端口和路径不同都算同一个域名', () => {
    expect(commitInput('openaiBaseUrl', 'https://API.OpenAI.com/v1/chat/completions', OPENAI)).toEqual({
      kind: 'save',
      value: 'https://API.OpenAI.com/v1/chat/completions',
      refetch: true,
    })
    const local = saved({ openaiBaseUrl: 'http://localhost:11434/v1', openaiKey: KEY })
    expect(commitInput('openaiBaseUrl', 'http://localhost:8080/v1', local)).toEqual({
      kind: 'save',
      value: 'http://localhost:8080/v1',
      refetch: true,
    })
  })

  test('换了域名后重新输入的 Key 即使和原来一样，也算保存一次，照常弹 Toast 并获取', () => {
    expect(commitInput('openaiKey', KEY, OPENAI, { keyStale: true })).toEqual({
      kind: 'save',
      value: KEY,
      keyStale: false,
      refetch: true,
    })
  })

  test('获取失败后重新输入同一个 Key 就重试', () => {
    expect(commitInput('openaiKey', KEY, OPENAI, { fetchFailed: true })).toMatchObject({
      kind: 'save',
      refetch: true,
    })
    expect(commitInput('elevenKey', KEY, saved({ elevenKey: KEY }), { fetchFailed: true })).toEqual({
      kind: 'save',
      value: KEY,
      refetch: true,
    })
  })

  test('其他时候和已保存的一样就不保存；新的 Key 保存并获取', () => {
    expect(commitInput('openaiKey', KEY, OPENAI)).toEqual({ kind: 'noop' })
    expect(commitInput('elevenKey', KEY, saved({ elevenKey: KEY }))).toEqual({ kind: 'noop' })
    expect(commitInput('openaiKey', 'sk-new-key-9999', OPENAI)).toEqual({
      kind: 'save',
      value: 'sk-new-key-9999',
      keyStale: false,
      refetch: true,
    })
    expect(commitInput('openaiKey', KEY, saved())).toEqual({ kind: 'save', value: KEY, keyStale: false, refetch: false })
    expect(commitInput('elevenKey', KEY, saved())).toEqual({ kind: 'save', value: KEY, refetch: true })
  })
})

describe('设置 › 保存：下拉框和开关，选完立即保存', () => {
  test('选了别的值就保存', () => {
    expect(selectValue('strict', false, saved())).toEqual({ kind: 'save', value: false })
    expect(selectValue('readingMode', 'select', saved())).toEqual({ kind: 'save', value: 'select' })
    expect(selectValue('autoReply', 'last', saved())).toEqual({ kind: 'save', value: 'last' })
    expect(selectValue('claudeModel', 'sonnet', saved())).toEqual({ kind: 'save', value: 'sonnet' })
    expect(selectValue('cardLanguage', 'source', saved())).toEqual({ kind: 'save', value: 'source' })
  })

  test('选“自定义模型 id”时先不保存', () => {
    expect(selectValue('claudeModel', CUSTOM_MODEL_OPTION, saved())).toEqual({ kind: 'noop' })
  })

  test('没配置完成的服务不能选：下拉框退回已保存的值', () => {
    expect(selectValue('translateService', 'openai', saved(), { isDisabled: true })).toEqual({ kind: 'revert' })
    expect(selectValue('speechService', 'elevenlabs', saved(), { isDisabled: true })).toEqual({ kind: 'revert' })
  })

  test('“手动填写”勾选框：保存但不弹 Toast；取消勾选时获取一次', () => {
    expect(selectValue('openaiManual', true, OPENAI)).toEqual({ kind: 'save', value: true, refetch: false })
    expect(selectValue('openaiManual', false, { ...OPENAI, openaiManual: true })).toEqual({
      kind: 'save',
      value: false,
      refetch: true,
    })
    expect(
      selectValue('openaiManual', false, { ...OPENAI, openaiManual: true }, { keyStale: true }),
    ).toEqual({ kind: 'save', value: false, refetch: false })
    expect(toastText('openaiManual', true)).toBeNull()
  })
})

describe('Toast：已保存：<设置项> <新值>', () => {
  test('功能地图和原型里的例子', () => {
    expect(toastText('delayMs', 1500, { delayUnit: 's' })).toBe('已保存：翻译延迟 1.5 s')
    expect(toastText('delayMs', 700, { delayUnit: 'ms' })).toBe('已保存：翻译延迟 700 ms')
    expect(toastText('delayMs', 1500, { delayUnit: 'ms' })).toBe('已保存：翻译延迟 1500 ms')
    expect(toastText('strict', false)).toBe('已保存：严格模式 关')
    expect(toastText('strict', true)).toBe('已保存：严格模式 开')
    expect(toastText('readingMode', 'select')).toBe('已保存：阅读方式 划选模式')
    expect(toastText('readingMode', 'paragraph')).toBe('已保存：阅读方式 段落模式')
  })

  test('自动翻译回复和条数', () => {
    expect(toastText('autoReply', 'all')).toBe('已保存：自动翻译回复 全部')
    expect(toastText('autoReply', 'off')).toBe('已保存：自动翻译回复 关闭')
    expect(toastText('autoReply', 'last', { autoReplyCount: 1 })).toBe('已保存：自动翻译回复 每轮最后 1 条')
    expect(toastText('autoReplyCount', 3)).toBe('已保存：自动翻译回复 每轮最后 3 条')
  })

  test('服务、模型、声音、卡片语言', () => {
    expect(toastText('translateService', 'claude')).toBe('已保存：翻译服务 Claude Code 账号')
    expect(toastText('translateService', 'openai')).toBe('已保存：翻译服务 OpenAI 兼容接口')
    expect(toastText('speechService', 'system')).toBe('已保存：朗读服务 系统声音')
    expect(toastText('speechService', 'elevenlabs')).toBe('已保存：朗读服务 ElevenLabs')
    expect(toastText('claudeModel', 'haiku')).toBe('已保存：模型 Haiku')
    expect(toastText('claudeModel', 'claude-haiku-4-5-20251001')).toBe('已保存：模型 claude-haiku-4-5-20251001')
    expect(toastText('voiceSystem', '')).toBe('已保存：声音 系统默认')
    expect(toastText('voiceOpenai', 'coral')).toBe('已保存：声音 coral')
    expect(toastText('voiceEleven', 'voice-id-1', {}, 'Rachel')).toBe('已保存：声音 Rachel')
    expect(toastText('cardLanguage', 'target')).toBe('已保存：卡片语言 英语')
    expect(toastText('cardLanguage', 'source')).toBe('已保存：卡片语言 简体中文')
  })

  test('开关、输入框', () => {
    expect(toastText('autoPlanAsk', false)).toBe('已保存：自动翻译计划和提问 关')
    expect(toastText('ankiSync', true)).toBe('已保存：同步到 Anki 开')
    expect(toastText('weeklyReminder', false)).toBe('已保存：每周提醒 关')
    expect(toastText('ankiDeck', 'English')).toBe('已保存：牌组 English')
    expect(toastText('openaiBaseUrl', 'https://openrouter.ai/api/v1')).toBe(
      '已保存：请求地址 https://openrouter.ai/api/v1',
    )
    expect(toastText('openaiModel', 'gpt-4o-mini')).toBe('已保存：翻译模型 gpt-4o-mini')
    expect(toastText('elevenModel', 'eleven_multilingual_v2')).toBe('已保存：朗读模型 eleven_multilingual_v2')
  })

  test('API Key 只显示前 3 位和末 4 位，不到 8 位时只写已保存', () => {
    expect(toastText('openaiKey', KEY)).toBe('已保存：API Key sk-…a1b2')
    expect(toastText('elevenKey', 'sk_1234567890abcd')).toBe('已保存：API Key sk_…abcd')
    expect(toastText('openaiKey', 'sk-1234')).toBe('已保存：API Key')
    expect(formatValue('openaiKey', KEY)).not.toContain('defgh')
  })

  test('每个设置项都有名字，Toast 里不出现英文的值名', () => {
    for (const key of SETTING_KEYS) {
      expect(ITEM_NAMES[key].length).toBeGreaterThan(0)
    }
    expect(formatValue('readingMode', 'paragraph')).toBe('段落模式')
    expect(formatValue('autoReply', 'all')).toBe('全部')
  })
})

describe('设置的文案', () => {
  test('六页的顺序和名字', () => {
    expect(SETTINGS_TABS.map(tab => TAB_LABELS[tab])).toEqual(['翻译', '阅读', '单词本', '服务', '快捷键', '统计'])
  })

  test('选项的显示文字', () => {
    expect(Object.values(READING_MODE_LABELS)).toEqual(['段落模式', '划选模式'])
    expect([AUTO_REPLY_LABELS.off, AUTO_REPLY_LABELS.last, AUTO_REPLY_LABELS.all]).toEqual(['关闭', '每轮最后', '全部'])
    expect(Object.values(SPEECH_SERVICE_LABELS)).toEqual(['系统声音', 'OpenAI 兼容接口', 'ElevenLabs'])
    expect(serviceOption('Claude Code 账号', 'Haiku')).toBe('Claude Code 账号（Haiku）')
    expect(notConfiguredOption('OpenAI 兼容接口')).toBe('OpenAI 兼容接口（未配置完成）')
    expect(CARD_LANGUAGE_LABELS).toEqual({ target: '目标语言（英语）', source: '源语言（简体中文）' })
    expect([usedFor(true, false), usedFor(false, true), usedFor(true, true), usedFor(false, false)]).toEqual([
      '用于翻译',
      '用于朗读',
      '用于翻译和朗读',
      null,
    ])
  })

  test('F5：“设为英语”点了立即保存，也弹 Toast', () => {
    expect(REPLY_LANGUAGE_SET).toBe('设为英语')
    expect(replyLanguageSaved()).toBe('已保存：回复语言 英语')
  })

  test('API Key 输入框的提示文字', () => {
    expect(keyPlaceholder(maskKey(KEY), OPENAI_KEY_SHAPE)).toBe('已保存 sk-…a1b2，输入新的 Key 替换')
    expect(keyPlaceholder(maskKey('sk-1234'), OPENAI_KEY_SHAPE)).toBe('已保存')
    expect(keyPlaceholder(maskKey(''), OPENAI_KEY_SHAPE)).toBe('sk-…')
    expect(keyPlaceholder(null, ELEVEN_KEY_SHAPE)).toBe('sk_…')
  })

  test('说明里的语言名和句子同一种语言，不用“·”分隔', () => {
    expect(DESCRIPTIONS.strict).toBe('防止 AI 对话上下文混入简体中文，始终使用英语。关闭后可直接发送。')
    for (const text of Object.values(DESCRIPTIONS)) {
      expect(text).not.toContain('·')
      expect(text).not.toMatch(/Chinese|English/)
    }
  })
})

/** A Host with only what the settings service uses: a store, the settings cell and toasts. */
function fakeHost(store = new Map<string, unknown>()) {
  const toasts: string[] = []
  let view: WweSettingsView = DEFAULT_VIEW
  let writes = 0
  const host = {
    store: {
      get: async (key: string) => store.get(key),
      set: async (key: string, value: unknown) => {
        store.set(key, value)
      },
      delete: async (key: string) => {
        store.delete(key)
      },
    },
    ui: {
      toast: (text: string) => {
        toasts.push(text)
      },
    },
    state: {
      settings: {
        get: async () => view,
        update: async (fn: (value: WweSettingsView) => WweSettingsView) => {
          writes += 1
          view = fn(view)
          return view
        },
      },
    },
  } as unknown as Host
  return { host, store, toasts, view: () => view, writes: () => writes }
}

describe('services/settings', () => {
  test('loadAll：没存过的取默认值，坏掉的值也取默认值', async () => {
    const { host } = fakeHost(
      new Map<string, unknown>([
        [storeKeyOf('strict'), false],
        [storeKeyOf('delayMs'), 'fast'],
        [storeKeyOf('autoReply'), 'some'],
        [storeKeyOf('autoReplyCount'), 0],
        [storeKeyOf('ankiDeck'), 'English'],
      ]),
    )
    expect(await loadAll(host)).toEqual({ ...DEFAULT_SETTINGS, strict: false, ankiDeck: 'English' })
  })

  test('saveSetting：写进 store，更新 $.state，弹 Toast', async () => {
    const fake = fakeHost()
    const settings = await saveSetting(fake.host, 'strict', false)
    expect(settings.strict).toBe(false)
    expect(fake.store.get('settings/strict')).toBe(false)
    expect(fake.view().strict).toBe(false)
    expect(fake.toasts).toEqual(['已保存：严格模式 关'])
  })

  test('saveSetting：翻译延迟和单位一起存，只弹一次 Toast', async () => {
    const fake = fakeHost()
    const commit = commitInput('delayMs', '1.5', saved(), { unit: 's' })
    if (commit.kind !== 'save') {
      throw new Error(commit.kind)
    }
    await saveSetting(fake.host, 'delayMs', commit.value, { also: commit.also })
    expect(fake.store.get('settings/delayMs')).toBe(1500)
    expect(fake.store.get('settings/delayUnit')).toBe('s')
    expect(fake.view()).toMatchObject({ delayMs: 1500, delayUnit: 's' })
    expect(fake.toasts).toEqual(['已保存：翻译延迟 1.5 s'])
  })

  test('saveSetting：API Key 存明文，$.state 和 Toast 里只有掩码', async () => {
    const fake = fakeHost()
    await saveSetting(fake.host, 'openaiKey', KEY)
    expect(fake.store.get('settings/openaiKey')).toBe(KEY)
    expect(fake.view().openaiKeyMask).toBe('sk-…a1b2')
    expect(JSON.stringify(fake.view())).not.toContain(KEY)
    expect(fake.toasts).toEqual(['已保存：API Key sk-…a1b2'])
  })

  test('saveSetting：手动填写不弹 Toast', async () => {
    const fake = fakeHost()
    await saveSetting(fake.host, 'openaiManual', true)
    expect(fake.store.get('settings/openaiManual')).toBe(true)
    expect(fake.toasts).toEqual([])
  })

  test('saveSetting：换了域名时设上标记，重新输入 Key 后清掉，其他会话也读得到', async () => {
    const shared = new Map<string, unknown>([
      ['settings/openaiBaseUrl', OPENAI.openaiBaseUrl],
      ['settings/openaiKey', KEY],
    ])
    const mine = fakeHost(shared)
    const other = fakeHost(shared)
    const url = commitInput('openaiBaseUrl', 'https://openrouter.ai/api/v1', await loadAll(mine.host))
    if (url.kind !== 'save') {
      throw new Error(url.kind)
    }
    await saveSetting(mine.host, 'openaiBaseUrl', url.value, { keyStale: url.keyStale })
    expect(await isKeyStale(other.host)).toBe(true)
    expect(mine.toasts).toEqual(['已保存：请求地址 https://openrouter.ai/api/v1'])

    const key = commitInput('openaiKey', KEY, await loadAll(other.host), { keyStale: await isKeyStale(other.host) })
    if (key.kind !== 'save') {
      throw new Error(key.kind)
    }
    await saveSetting(other.host, 'openaiKey', key.value, { keyStale: key.keyStale })
    expect(await isKeyStale(mine.host)).toBe(false)
    expect(other.toasts).toEqual(['已保存：API Key sk-…a1b2'])
  })

  test('另一个会话改了别的设置：保存前重读，不用旧值覆盖', async () => {
    const shared = new Map<string, unknown>()
    const mine = fakeHost(shared)
    const other = fakeHost(shared)
    await refresh(mine.host)
    expect(mine.view().strict).toBe(true)

    await saveSetting(other.host, 'strict', false)
    await saveSetting(mine.host, 'readingMode', 'select')

    expect(shared.get('settings/strict')).toBe(false)
    expect(mine.view()).toMatchObject({ strict: false, readingMode: 'select' })
    expect(mine.toasts).toEqual(['已保存：阅读方式 划选模式'])
  })

  test('另一个会话改了同一个设置：本会话再存时按新值显示', async () => {
    const shared = new Map<string, unknown>()
    const mine = fakeHost(shared)
    const other = fakeHost(shared)
    await saveSetting(other.host, 'autoReply', 'last')
    await saveSetting(other.host, 'autoReplyCount', 3)
    await saveSetting(mine.host, 'autoReply', 'last')
    expect(mine.toasts).toEqual(['已保存：自动翻译回复 每轮最后 3 条'])
  })

  test('refresh：有变化才写 $.state', async () => {
    const shared = new Map<string, unknown>()
    const mine = fakeHost(shared)
    const other = fakeHost(shared)

    await refresh(mine.host)
    expect(mine.writes()).toBe(0)

    await saveSetting(other.host, 'delayMs', 1200)
    const settings = await refresh(mine.host)
    expect(settings.delayMs).toBe(1200)
    expect(mine.view().delayMs).toBe(1200)
    expect(mine.writes()).toBe(1)

    await refresh(mine.host)
    expect(mine.writes()).toBe(1)
    expect(mine.toasts).toEqual([])
  })

  test('refresh：另一个会话换了 Key，镜像拿到新 Key，掩码一样时不重画', async () => {
    const shared = new Map<string, unknown>([['settings/openaiKey', 'sk-aaaaaaaa9999']])
    const mine = fakeHost(shared)
    await refresh(mine.host)
    const writes = mine.writes()
    shared.set('settings/openaiKey', 'sk-bbbbbbbb9999')
    const settings = await refresh(mine.host)
    expect(settings.openaiKey).toBe('sk-bbbbbbbb9999')
    expect(mine.writes()).toBe(writes)
  })
})
