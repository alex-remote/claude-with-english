import { describe, expect, test } from 'claude-code/testing'
import type { Register, SettingsSource } from 'claude-code'

import { ERRORS, SETTINGS_TABS, SHORTCUT_ROWS } from '../../hooks/core/copy/settings'
import { REPO_URL } from '../../hooks/core/copy/share'
import { DEFAULT_VIEW, storeKeyOf } from '../../hooks/core/settings/schema'
import type { SettingKey } from '../../hooks/core/settings/schema'
import { INITIAL_PANE } from '../../hooks/core/state/defaults'
import { createSettings } from '../../hooks/features/settings/controller'
import type { Settings } from '../../hooks/features/settings/controller'
import type { PaneUi } from '../../hooks/features/settings/controls'
import { isModelAllowed, modelChoice } from '../../hooks/features/settings/pages/services'
import type { Host } from '../../hooks/host'
import type { WwePane, WweSettings, WweSettingsView } from '../../types'

// The settings pane, in two layers until register.tsx draws it:
// - its view is called with an element table that builds plain data, and its
//   controls are pressed through their own callbacks, against a Host whose
//   store, settings and state live in memory;
// - the trees that gives are drawn again by a small inline mod through
//   `$.ui.resolve(e)`, so the engine checks each page on both surfaces. The
//   inline mod can't run the pane itself: a mod imports nothing dynamically.

type Node = { type: string; props: Record<string, unknown>; children: Child[] }
type Child = Node | string

function flat(children: unknown): Child[] {
  if (children === undefined || children === null || typeof children === 'boolean') {
    return []
  }
  if (Array.isArray(children)) {
    return children.flatMap(flat)
  }
  return typeof children === 'string' || typeof children === 'number' ? [String(children)] : [children as Node]
}

const element = (type: string) => (props: Record<string, unknown>) => {
  const { children, ...rest } = props
  return { type, props: rest, children: flat(children) }
}

/** An element table that builds the tree as plain data, callbacks kept */
const UI = {
  Box: element('Box'),
  Text: element('Text'),
  Button: element('Button'),
  Input: element('Input'),
  Select: element('Select'),
} as unknown as PaneUi

const ORDER: readonly SettingsSource[] = ['user', 'project', 'local', 'flag', 'policy']

/** A Host with what the pane uses: a store, Claude Code's settings by source, the two state values */
function fakeHost(seed: Partial<WweSettings> = {}) {
  const store = new Map<string, unknown>(
    Object.entries(seed).map(([key, value]) => [storeKeyOf(key as SettingKey), value]),
  )
  const toasts: string[] = []
  const runs: string[][] = []
  const opened: unknown[] = []
  const sources: Partial<Record<SettingsSource, Record<string, unknown>>> = {}
  const state: { pane: WwePane; view: WweSettingsView } = { pane: INITIAL_PANE, view: DEFAULT_VIEW }
  const cell = <K extends keyof typeof state>(name: K) => ({
    get: async () => state[name],
    update: async (fn: (value: (typeof state)[K]) => (typeof state)[K]) => {
      state[name] = fn(state[name])
      return state[name]
    },
  })
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
      debug: () => undefined,
      open: async (pane: unknown) => {
        opened.push(pane)
        return { isPlaced: true }
      },
      invalidate: () => undefined,
    },
    proc: {
      run: async (argv: string[]) => {
        runs.push(argv)
        return { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
      },
    },
    settings: {
      read: async (args?: { source?: SettingsSource }) =>
        args?.source ? (sources[args.source] ?? {}) : Object.assign({}, ...ORDER.map(source => sources[source] ?? {})),
    },
    config: {
      set: async (args: { key: string; value: unknown }) => {
        sources.user = { ...sources.user, [args.key]: args.value }
        return { value: args.value }
      },
    },
    state: { settings: cell('view'), pane: cell('pane') },
  } as unknown as Host
  return { host, store, toasts, runs, opened, sources, state }
}

type Fake = ReturnType<typeof fakeHost>

const textOf = (node: Node): string =>
  node.children.map(child => (typeof child === 'string' ? child : textOf(child))).join('')

function every(node: Node, out: Node[] = []): Node[] {
  out.push(node)
  for (const child of node.children) {
    if (typeof child !== 'string') {
      every(child, out)
    }
  }
  return out
}

type Query = { key?: string; type?: string; text?: string }

/** The pane drawn from what the Host holds now, acted on by key as a surface would */
function drawing(settings: Settings, fake: Fake) {
  const tree = () => settings.view(UI, { pane: fake.state.pane, settings: fake.state.view }) as unknown as Node
  const matches = (query: Query) => (node: Node) =>
    (query.key === undefined || node.props.key === query.key) &&
    (query.type === undefined || node.type === query.type) &&
    (query.text === undefined || textOf(node) === query.text)
  const find = (query: Query) => every(tree()).find(matches(query))
  const handler = (key: string, type: string, name: string) => {
    const found = find({ key, type })
    if (!found) {
      throw new Error(`no ${type} keyed ${key}`)
    }
    return found.props[name] as (...args: unknown[]) => unknown
  }
  return {
    tree,
    find,
    findAll: (query: Query) => every(tree()).filter(matches(query)),
    label: (key: string) => find({ key })?.props.label,
    value: (key: string) => find({ key })?.props.value,
    press: async (key: string) => {
      await handler(key, 'Button', 'onPress')({ surface: 'terminal' })
    },
    input: async (key: string, text: string, kind: 'submit' | 'change' = 'submit') => {
      await handler(key, 'Input', kind === 'submit' ? 'onSubmit' : 'onInput')(text)
    },
    select: async (key: string, value: string) => {
      await handler(key, 'Select', 'onSelect')(value)
    },
  }
}

/** The pane as /wwe opens it, over a store holding `seed` */
async function opened(seed: Partial<WweSettings> = {}, before: (fake: Fake) => void = () => undefined) {
  const fake = fakeHost(seed)
  before(fake)
  const settings = createSettings(fake.host)
  await settings.open()
  return { fake, settings, ui: drawing(settings, fake) }
}

const focusOn = (element: string) => ({ component: 'Pane', requestId: 'wwe', element, origin: { kind: 'person' } }) as const

describe('设置 Pane', () => {
  test('/wwe：停在“翻译”页，拿到焦点，Esc 关闭，不憋住 Toast', async () => {
    const { fake } = await opened()
    expect(fake.opened).toEqual([{ id: 'wwe', title: 'work-with-english 设置', focus: true, closeOnEscape: true }])
    expect(fake.state.pane).toMatchObject({ view: 'settings', tab: 'translate', errors: {} })
  })

  test('六个标签依次切换，每页显示自己的设置，切换不保存', async () => {
    const { fake, ui } = await opened()
    expect(ui.find({ type: 'Text', text: 'work-with-english 设置' })).toBeDefined()
    expect(ui.findAll({ type: 'Button' }).slice(0, 7).map(button => button.props.label)).toEqual([
      '翻译',
      '阅读',
      '单词本',
      '服务',
      '快捷键',
      '统计',
      'GitHub',
    ])
    expect(ui.find({ type: 'Text', text: '简体中文 → 英语' })).toBeDefined()
    const pages: [string, () => unknown][] = [
      ['tab-reading', () => ui.find({ type: 'Text', text: '阅读方式' })],
      ['tab-wordbook', () => ui.find({ type: 'Text', text: '同步到 Anki' })],
      ['tab-services', () => ui.label('svc-claude')],
      ['tab-shortcuts', () => ui.find({ type: 'Text', text: SHORTCUT_ROWS[0] ?? '' })],
      ['tab-stats', () => ui.find({ type: 'Text', text: '每周提醒' })],
      ['tab-translate', () => ui.find({ type: 'Text', text: '严格模式' })],
    ]
    for (const [tab, shown] of pages) {
      await ui.press(tab)
      expect(shown()).toBeDefined()
      // Only the open tab is drawn at full strength
      expect(ui.find({ key: tab })?.props.dimColor).toBe(false)
    }
    await ui.press('tab-services')
    expect(ui.label('svc-claude')).toBe('Claude Code 账号（用于翻译）')
    expect(fake.toasts).toEqual([])
    expect(fake.store.size).toBe(0)
  })

  test('严格模式：按下就保存，store 里是新值，弹 Toast', async () => {
    const { fake, ui } = await opened()
    expect(ui.label('strict')).toBe('开')
    await ui.press('strict')
    expect(fake.store.get('settings/strict')).toBe(false)
    expect(fake.toasts).toEqual(['已保存：严格模式 关'])
    expect(ui.label('strict')).toBe('关')
  })

  test('翻译延迟：不合法时下面一行红字，不保存，输入框保留刚才打的内容；合法时保存', async () => {
    const { fake, ui } = await opened()
    await ui.input('delay', '50')
    expect(ui.find({ type: 'Text', text: ERRORS.delay })?.props.color).toBe('red')
    expect(fake.store.has('settings/delayMs')).toBe(false)
    expect(fake.toasts).toEqual([])
    expect(ui.value('delay')).toBe('50')

    await ui.input('delay', '1500')
    expect(fake.store.get('settings/delayMs')).toBe(1500)
    expect(fake.toasts).toEqual(['已保存：翻译延迟 1500 ms'])
    expect(ui.find({ type: 'Text', text: ERRORS.delay })).toBeUndefined()
    expect(ui.value('delay')).toBe('1500')
  })

  test('翻译延迟：只换单位不保存，数字换成新单位；之后输入的数按新单位保存', async () => {
    const { fake, ui } = await opened()
    await ui.select('delay-unit', 's')
    expect(fake.store.size).toBe(0)
    expect(fake.toasts).toEqual([])
    expect(ui.value('delay')).toBe('0.7')
    expect(ui.value('delay-unit')).toBe('s')

    await ui.input('delay', '1.5')
    expect(fake.store.get('settings/delayMs')).toBe(1500)
    expect(fake.store.get('settings/delayUnit')).toBe('s')
    expect(fake.toasts).toEqual(['已保存：翻译延迟 1.5 s'])
  })

  test('翻译延迟：先输入再换单位，按新单位读这个数', async () => {
    const { fake, ui } = await opened()
    await ui.input('delay', '2', 'change')
    await ui.select('delay-unit', 's')
    expect(fake.store.get('settings/delayMs')).toBe(2000)
    expect(fake.toasts).toEqual(['已保存：翻译延迟 2 s'])
  })

  test('翻译延迟：改过后出现“恢复默认”，按下回到 700 ms', async () => {
    const { fake, ui } = await opened({ delayMs: 1500, delayUnit: 's' })
    expect(ui.value('delay')).toBe('1.5')
    await ui.press('delay-reset')
    expect(fake.store.get('settings/delayMs')).toBe(700)
    expect(fake.store.get('settings/delayUnit')).toBe('ms')
    expect(fake.toasts).toEqual(['已保存：翻译延迟 700 ms'])
    expect(ui.find({ key: 'delay-reset' })).toBeUndefined()
    expect(ui.value('delay')).toBe('700')
  })

  test('翻译延迟：清空后回车，换一个 key 画回已保存的值，不保存', async () => {
    const { fake, ui } = await opened()
    const rev = fake.state.pane.rev
    await ui.input('delay', '')
    expect(fake.toasts).toEqual([])
    expect(fake.state.pane.rev).toBe(rev + 1)
    expect(ui.find({ key: 'delay' })).toBeUndefined()
    expect(ui.findAll({ type: 'Input' })[0]?.props).toMatchObject({ key: 'delay#1', value: '700' })
  })

  test('翻译服务：没配置完成的 OpenAI 兼容接口选了也不变，下拉框换 key 画回原值', async () => {
    const { fake, ui } = await opened()
    expect(ui.find({ key: 'translate-service' })?.props).toMatchObject({
      value: 'claude',
      options: [
        { value: 'claude', label: 'Claude Code 账号（Haiku）' },
        { value: 'openai', label: 'OpenAI 兼容接口（未配置完成）' },
      ],
    })
    await ui.select('translate-service', 'openai')
    expect(fake.store.has('settings/translateService')).toBe(false)
    expect(fake.toasts).toEqual([])
    expect(ui.find({ key: 'translate-service#1' })?.props.value).toBe('claude')
  })

  test('去配置翻译服务：切到“服务”页', async () => {
    const { fake, ui } = await opened()
    await ui.press('goto-services')
    expect(fake.state.pane).toMatchObject({ tab: 'services', svcTab: 'claude' })
    expect(ui.find({ key: 'claude-model' })).toBeDefined()
  })

  test('回复语言：未设置时显示“未设置”和“设为英语”', async () => {
    const { ui } = await opened()
    expect(ui.find({ type: 'Text', text: 'Claude Code 的 Language 设置：未设置' })).toBeDefined()
    expect(ui.label('reply-language')).toBe('设为英语')
  })

  test('回复语言：写成 english 时显示“设为英语”，按下写入 English 并弹 Toast', async () => {
    const { fake, ui } = await opened({}, f => {
      f.sources.user = { language: 'english' }
    })
    expect(ui.find({ type: 'Text', text: 'Claude Code 的 Language 设置：english' })).toBeDefined()
    await ui.press('reply-language')
    expect(fake.sources.user).toEqual({ language: 'English' })
    expect(fake.toasts).toEqual(['已保存：回复语言 英语'])
    expect(ui.find({ type: 'Text', text: '与目标语言一致' })).toBeDefined()
    expect(ui.find({ key: 'reply-language' })).toBeUndefined()
  })

  test('回复语言：项目设置或组织指定时不显示按钮，写明在哪里指定', async () => {
    const project = await opened({}, f => {
      f.sources.project = { language: 'Chinese' }
    })
    expect(project.ui.find({ key: 'reply-language' })).toBeUndefined()
    expect(project.ui.find({ type: 'Text', text: '回复语言由项目设置指定，这里不能修改。' })).toBeDefined()
    const policy = await opened({}, f => {
      f.sources.policy = { language: 'english' }
    })
    expect(policy.ui.find({ type: 'Text', text: '回复语言由组织设置指定，这里不能修改。' })).toBeDefined()
  })

  test('自动翻译回复：选“每轮最后”后出现条数框，条数不合法时红字', async () => {
    const { fake, ui } = await opened()
    await ui.press('tab-reading')
    expect(ui.find({ key: 'reply-count' })).toBeUndefined()
    await ui.select('auto-reply', 'last')
    expect(fake.store.get('settings/autoReply')).toBe('last')
    expect(fake.toasts).toEqual(['已保存：自动翻译回复 每轮最后 1 条'])
    expect(ui.value('reply-count')).toBe('1')
    expect(ui.find({ type: 'Text', text: '条' })).toBeDefined()

    await ui.input('reply-count', '100')
    expect(ui.find({ type: 'Text', text: ERRORS.replyCount })).toBeDefined()
    await ui.input('reply-count', '3')
    expect(fake.store.get('settings/autoReplyCount')).toBe(3)
    expect(fake.toasts.at(-1)).toBe('已保存：自动翻译回复 每轮最后 3 条')
  })

  test('阅读方式：选划选模式后“自动翻译回复”不显示，“自动翻译计划和提问”仍在', async () => {
    const { fake, ui } = await opened()
    await ui.press('tab-reading')
    expect(ui.label('reading-paragraph')).toBe('● 段落模式（默认）')
    expect(ui.label('reading-select')).toBe('○ 划选模式')
    await ui.press('reading-select')
    expect(fake.store.get('settings/readingMode')).toBe('select')
    expect(fake.toasts).toEqual(['已保存：阅读方式 划选模式'])
    expect(ui.label('reading-select')).toBe('● 划选模式')
    expect(ui.find({ key: 'auto-reply' })).toBeUndefined()
    expect(ui.find({ key: 'auto-plan-ask' })).toBeDefined()
  })

  test('单词本和统计：开关和牌组照常保存', async () => {
    const { fake, ui } = await opened()
    await ui.press('tab-wordbook')
    await ui.press('anki-sync')
    await ui.input('anki-deck', '英语')
    await ui.press('tab-stats')
    await ui.press('weekly-reminder')
    expect(fake.toasts).toEqual(['已保存：同步到 Anki 关', '已保存：牌组 英语', '已保存：每周提醒 关'])
  })

  test('GitHub：在浏览器里打开仓库', async () => {
    const { fake, ui } = await opened()
    await ui.press('github')
    expect(fake.runs).toEqual([['open', REPO_URL]])
  })

  test('模型：选“自定义模型 id”先不保存，填了 id 回车才保存', async () => {
    const { fake, ui } = await opened()
    await ui.press('tab-services')
    expect(ui.find({ key: 'model-id' })).toBeUndefined()
    await ui.select('claude-model', 'custom')
    expect(fake.toasts).toEqual([])
    expect(ui.value('claude-model')).toBe('custom')
    expect(ui.find({ key: 'model-id' })?.props).toMatchObject({ value: '', placeholder: '如 claude-haiku-4-5-20251001' })
    await ui.input('model-id', 'claude-haiku-4-5-20251001')
    expect(fake.store.get('settings/claudeModel')).toBe('claude-haiku-4-5-20251001')
    expect(fake.toasts).toEqual(['已保存：模型 claude-haiku-4-5-20251001'])
    await ui.press('tab-translate')
    expect(ui.find({ key: 'translate-service' })?.props).toMatchObject({
      options: [{ value: 'claude', label: 'Claude Code 账号（claude-haiku-4-5-20251001）' }, { value: 'openai' }],
    })
  })

  test('模型：选了“自定义模型 id”没填就离开，下拉框退回已保存的模型', async () => {
    const { fake, settings, ui } = await opened({ claudeModel: 'sonnet' })
    await ui.press('tab-services')
    await ui.select('claude-model', 'custom')
    await settings.onFocus(focusOn('claude-model'))
    await settings.onFocus(focusOn('model-id'))
    expect(ui.find({ key: 'model-id' })).toBeDefined()
    // Left by Shift+Tab back to the sub-menu, nothing typed
    await settings.onFocus(focusOn('svc-claude'))
    expect(ui.find({ key: 'model-id' })).toBeUndefined()
    expect(ui.findAll({ type: 'Select' })[0]?.props.value).toBe('sonnet')
    expect(fake.toasts).toEqual([])
  })

  test('组织限制了可用模型：只列允许的，默认的 Haiku 不在其中时改用第一个并注明', async () => {
    const { ui } = await opened({}, f => {
      f.sources.policy = { availableModels: ['sonnet', 'claude-opus-4-6'] }
    })
    expect(ui.find({ key: 'translate-service' })?.props).toMatchObject({
      options: [{ value: 'claude', label: 'Claude Code 账号（Sonnet）' }, { value: 'openai' }],
    })
    await ui.press('tab-services')
    expect(ui.find({ key: 'claude-model' })?.props).toMatchObject({
      value: 'sonnet',
      options: [
        { value: 'sonnet', label: 'Sonnet' },
        { value: 'opus', label: 'Opus' },
        { value: 'custom', label: '自定义模型 id' },
      ],
    })
    expect(ui.find({ type: 'Text', text: '组织不允许使用 Haiku，已改用 Sonnet。' })).toBeDefined()
  })

  test('失焦、切标签、关闭 Pane 都提交正在编辑的输入框', async () => {
    const { fake, settings, ui } = await opened()
    // Typed and left by Tab: the ring moving to the switch commits it
    await settings.onFocus(focusOn('delay'))
    await ui.input('delay', '900', 'change')
    expect(fake.toasts).toEqual([])
    await settings.onFocus(focusOn('strict'))
    expect(fake.store.get('settings/delayMs')).toBe(900)

    // Typed, then another tab
    await ui.input('delay', '800', 'change')
    await ui.press('tab-wordbook')
    expect(fake.store.get('settings/delayMs')).toBe(800)

    // Typed, then the pane closes
    await ui.input('anki-deck', 'English', 'change')
    await settings.onClose()
    expect(fake.store.get('settings/ankiDeck')).toBe('English')
    expect(fake.toasts).toEqual(['已保存：翻译延迟 900 ms', '已保存：翻译延迟 800 ms', '已保存：牌组 English'])
  })

  test('失焦时值没变：不保存，不弹 Toast', async () => {
    const { fake, settings, ui } = await opened()
    await ui.input('delay', '700', 'change')
    await settings.onFocus(focusOn('strict'))
    expect(fake.store.size).toBe(0)
    expect(fake.toasts).toEqual([])
  })

  test('关闭时值不合法：不保存，再打开显示已保存的值', async () => {
    const { fake, settings, ui } = await opened()
    await ui.input('delay', '9 s', 'change')
    await settings.onClose()
    expect(fake.store.has('settings/delayMs')).toBe(false)
    expect(fake.state.pane.errors).toEqual({ delayMs: ERRORS.delay })
    await settings.open()
    expect(fake.state.pane.errors).toEqual({})
    expect(ui.value('delay')).toBe('700')
  })
})

describe('模型下拉框', () => {
  test('别名按家族放行，版本前缀和完整 id 按前缀放行', () => {
    expect(isModelAllowed('haiku', null)).toBe(true)
    expect(isModelAllowed('sonnet', ['claude-sonnet-4-5'])).toBe(true)
    expect(isModelAllowed('haiku', ['sonnet', 'opus'])).toBe(false)
    expect(isModelAllowed('claude-sonnet-4-5-20250929', ['claude-sonnet-4-5'])).toBe(true)
    expect(isModelAllowed('claude-sonnet-4-6', ['claude-sonnet-4-5'])).toBe(false)
    expect(isModelAllowed('claude-opus-4-6', ['opus'])).toBe(true)
  })

  test('已保存的模型后来不被允许：仍然显示，后面标“（列表里没有）”', () => {
    const alias = modelChoice('opus', ['sonnet'], false)
    expect(alias.value).toBe('opus')
    expect(alias.options).toEqual([
      { value: 'sonnet', label: 'Sonnet' },
      { value: 'opus', label: 'Opus（列表里没有）' },
      { value: 'custom', label: '自定义模型 id' },
    ])
    const id = modelChoice('claude-opus-4-1', ['sonnet'], false)
    expect(id.value).toBe('custom')
    expect(id.options.at(-1)).toEqual({ value: 'custom', label: '自定义模型 id（列表里没有）' })
    expect(id.hasField).toBe(true)
  })

  test('没有限制时：Haiku 标“（默认）”，没有提示', () => {
    const choice = modelChoice('haiku', null, false)
    expect(choice.options.map(option => option.label)).toEqual(['Haiku（默认）', 'Sonnet', 'Opus', '自定义模型 id'])
    expect(choice).toMatchObject({ value: 'haiku', label: 'Haiku', replacedBy: null, hasField: false })
  })
})

// ---- Drawn by the engine on both surfaces -------------------------------

const HARNESS = 'wwe-harness'
const TREE_KEY = 'harness/tree'

/**
 * Draws whatever plain tree the store holds under TREE_KEY, with this
 * surface's own elements. It runs in its own environment: it sees nothing of
 * this file, so its strings are written out.
 */
const harness = {
  name: HARNESS,
  register: (on => {
    on('ui.render', { component: 'Pane' }, async ($, e, next) => {
      if (e.requestId !== 'wwe-harness') {
        return next(e)
      }
      const table = $.ui.resolve(e) as unknown as Record<string, (props: Record<string, unknown>) => unknown>
      const build = (child: unknown): unknown => {
        if (typeof child === 'string') {
          return child
        }
        const node = child as { type: string; props: Record<string, unknown>; children: unknown[] }
        const props: Record<string, unknown> = { ...node.props }
        if (node.children.length > 0) {
          props.children = node.children.map(build)
        }
        if (node.type === 'Button') {
          props.onPress = () => undefined
        } else if (node.type === 'Input') {
          props.onSubmit = () => undefined
        } else if (node.type === 'Select') {
          props.onSelect = () => undefined
        }
        const make = table[node.type]
        if (!make) {
          throw new Error(`${e.surface} has no ${node.type}`)
        }
        return make(props)
      }
      return build(await $.store.get('harness/tree')) as ReturnType<typeof next>
    })
  }) as Register,
}

const PANE = {
  plugin: HARNESS,
  component: 'Pane',
  requestId: HARNESS,
  viewport: { columns: 120, rows: 40, isFullscreen: true },
  props: {
    title: 'work-with-english 设置',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 36 },
    view: {},
  },
} as const

/** The tree as plain data: callbacks can't cross to the inline mod */
const plain = (tree: Node) => JSON.parse(JSON.stringify(tree)) as unknown

describe('设置 Pane 在两种 surface 上', () => {
  test('每一页和它们的几种状态，终端和桌面端都能画', { plugins: [harness] }, async ($, on) => {
    let tree: unknown = null
    on('store.get', ($, e) => ({ value: e.key === TREE_KEY ? tree : undefined }))
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))

    // Every page as it opens, then the states that add controls and lines
    const { fake, ui } = await opened({ delayMs: 1500 }, f => {
      f.sources.project = { language: 'Chinese' }
    })
    const states: [string, Node][] = []
    for (const tab of SETTINGS_TABS) {
      await ui.press(`tab-${tab}`)
      states.push([tab, ui.tree()])
    }
    await ui.press('tab-translate')
    await ui.input('delay', 'abc')
    await ui.select('translate-service', 'openai')
    states.push(['translate: refused delay and service', ui.tree()])
    const settable = await opened({}, f => {
      f.sources.user = { language: 'english' }
    })
    states.push(['translate: 设为英语', settable.ui.tree()])
    await ui.press('tab-reading')
    await ui.select('auto-reply', 'last')
    await ui.input('reply-count', '0')
    states.push(['reading: 每轮最后 with a refused count', ui.tree()])
    await ui.press('tab-services')
    await ui.select('claude-model', 'custom')
    states.push(['services: 自定义模型 id', ui.tree()])
    expect(fake.toasts.length).toBeGreaterThan(0)

    for (const surface of ['terminal', 'desktop'] as const) {
      for (const [name, drawn] of states) {
        tree = plain(drawn)
        const mounted = await $.ui.mount({ ...PANE, surface }).catch((error: unknown) => {
          throw new Error(`${surface}, ${name}: ${String(error)}`)
        })
        expect(await mounted.find({ type: 'Text', text: 'work-with-english 设置' })).toBeDefined()
        await mounted.unmount()
      }
    }
  })
})
