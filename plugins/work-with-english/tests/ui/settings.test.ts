import { describe, expect, test } from 'claude-code/testing'
import type { Register, SettingsSource } from 'claude-code'

import { ERRORS, SETTINGS_TABS, SHORTCUT_ROWS } from '../../hooks/core/copy/settings'
import { REPO_URL } from '../../hooks/core/copy/share'
import { DEFAULT_VIEW, storeKeyOf } from '../../hooks/core/settings/schema'
import type { SettingKey } from '../../hooks/core/settings/schema'
import { INITIAL_PANE } from '../../hooks/core/state/defaults'
import { createSettings } from '../../hooks/features/settings/controller'
import type { Settings, SettingsDeps } from '../../hooks/features/settings/controller'
import type { PaneUi } from '../../hooks/features/settings/controls'
import { isModelAllowed, modelChoice } from '../../hooks/features/settings/pages/services'
import type { Speaker } from '../../hooks/features/speak/controller'
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

/** Where the fake Host's data directory is: ~/.claude/plugins/data/<name>-inline */
const DATA_DIR = '/Users/test/.claude/plugins/data/work-with-english-inline'

type Reply = { status: number; text: string }
type Run = { exitCode: number; stdout: string; stderr: string }

/**
 * A Host with what the pane uses: a store, Claude Code's settings by source,
 * the two state values, files, and what `http.fetch` and `process.run`
 * answer, which a test can set before it acts.
 */
function fakeHost(seed: Partial<WweSettings> = {}) {
  const store = new Map<string, unknown>(
    Object.entries(seed).map(([key, value]) => [storeKeyOf(key as SettingKey), value]),
  )
  const toasts: string[] = []
  const runs: string[][] = []
  const opened: unknown[] = []
  const files = new Map<string, string>()
  const fetches: { url: string; headers: Record<string, string> }[] = []
  const sources: Partial<Record<SettingsSource, Record<string, unknown>>> = {}
  const state: { pane: WwePane; view: WweSettingsView } = { pane: INITIAL_PANE, view: DEFAULT_VIEW }
  const answers = {
    /** What each GET answers, by URL; a test may hand back a promise it settles later */
    fetch: (url: string): Reply | Promise<Reply> => ({ status: 404, text: `no answer for ${url}` }),
    /** What each command answers; exit 0 and nothing printed by default */
    run: (_argv: string[]): Run => ({ exitCode: 0, stdout: '', stderr: '' }),
  }
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
      keys: async () => [...store.keys()],
    },
    clock: {
      now: async () => Date.UTC(2026, 9, 12, 2, 0, 0),
      // The 30 s race never runs out in these tests
      after: () => ({ cancel: () => undefined }),
    },
    env: {
      home: async () => '/Users/test',
      configDir: async () => undefined,
      pluginCacheDir: async () => undefined,
    },
    plugin: { name: 'work-with-english', root: '/dev/work-with-english' },
    fs: {
      read: async (path: string) => {
        const text = files.get(path)
        if (text === undefined) {
          throw new Error(`ENOENT: ${path}`)
        }
        return text
      },
      write: async (path: string, text: string) => {
        files.set(path, text)
      },
    },
    http: {
      fetch: async (url: string, init?: { headers?: Record<string, string> }) => {
        fetches.push({ url, headers: init?.headers ?? {} })
        const reply = await answers.fetch(url)
        return { status: reply.status, ok: reply.status < 300, headers: {}, text: reply.text }
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
        return { ...answers.run(argv), isStdoutTruncated: false, isStderrTruncated: false }
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
  return { host, store, toasts, runs, opened, sources, state, files, fetches, answers }
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
async function opened(
  seed: Partial<WweSettings> = {},
  before: (fake: Fake) => void = () => undefined,
  deps: SettingsDeps = {},
) {
  const fake = fakeHost(seed)
  before(fake)
  const settings = createSettings(fake.host, deps)
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
      // The open tab is the main button; the others are plain dim labels
      expect(ui.find({ key: tab })?.props.variant).toBe('primary')
      expect(ui.find({ key: tab })?.props.dimColor).toBeUndefined()
    }
    await ui.press('tab-services')
    expect(ui.label('svc-claude')).toBe('Claude Code 账号（用于翻译）')
    expect(fake.toasts).toEqual([])
    expect(fake.store.size).toBe(0)
  })

  test('横条按钮：在“快捷键”页，默认开，按下就保存并弹 Toast', async () => {
    const { fake, ui } = await opened()
    await ui.press('tab-shortcuts')
    expect(ui.label('band-buttons')).toBe('开')
    await ui.press('band-buttons')
    expect(fake.store.get('settings/bandButtons')).toBe(false)
    expect(fake.toasts).toEqual(['已保存：横条按钮 关'])
    expect(ui.label('band-buttons')).toBe('关')
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

  test('去配置翻译服务：切到“服务”页的 OpenAI 兼容接口', async () => {
    const { fake, ui } = await opened()
    await ui.press('goto-services')
    expect(fake.state.pane).toMatchObject({ tab: 'services', svcTab: 'openai' })
    expect(ui.find({ key: 'openai-url' })).toBeDefined()
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

// ---- M6: the 服务 page's other services, 朗读 and 本机缓存 ----------------

const OPENAI_URL = 'https://api.openai.com/v1'
const OPENAI_KEY = 'sk-abcdefgha1b2'
const ELEVEN_KEY = 'sk_elevenkey9z8y'
const ELEVEN = 'https://api.elevenlabs.io'
const MODELS_URL = `${OPENAI_URL}/models`
const ELEVEN_MODELS_URL = `${ELEVEN}/v1/models`
const ELEVEN_VOICES_URL = `${ELEVEN}/v2/voices?page_size=100&include_total_count=false`
const BACKUP = `${DATA_DIR}/backup/store.json`

/** The OpenAI-compatible service with an address, a key and a model */
const OPENAI_SET: Partial<WweSettings> = { openaiBaseUrl: OPENAI_URL, openaiKey: OPENAI_KEY, openaiModel: 'gpt-4o-mini' }

const modelsReply = (ids: string[]): Reply => ({ status: 200, text: JSON.stringify({ data: ids.map(id => ({ id })) }) })
const unauthorized: Reply = { status: 401, text: JSON.stringify({ error: { message: 'Incorrect API key', code: 'invalid_api_key' } }) }
const elevenModels: Reply = {
  status: 200,
  text: JSON.stringify([
    { model_id: 'eleven_multilingual_v2', name: 'Eleven Multilingual v2', can_do_text_to_speech: true },
    { model_id: 'eleven_flash_v2_5', name: 'Eleven Flash v2.5', can_do_text_to_speech: true },
    { model_id: 'eleven_english_sts_v2', name: 'Speech to speech', can_do_text_to_speech: false },
  ]),
}
const elevenVoices: Reply = {
  status: 200,
  text: JSON.stringify({ voices: [{ voice_id: 'voice-george', name: 'George' }, { voice_id: 'voice-sarah', name: 'Sarah' }] }),
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>(settle => {
    resolve = settle
  })
  return { promise, resolve }
}

/** Lets callbacks that are not awaited (试听's end) run to their end */
const flush = async () => {
  for (let i = 0; i < 50; i += 1) {
    await Promise.resolve()
  }
}

/** A speaker whose 试听 reads until the test ends it, or 停止 does */
function fakeSpeaker() {
  const tested: string[] = []
  let stops = 0
  let end = () => undefined as void
  const speaker = {
    speak: async () => undefined,
    test: (key: string) => {
      tested.push(key)
      return new Promise<void>(resolve => {
        end = resolve
      })
    },
    stop: async () => {
      stops += 1
      end()
    },
  } as unknown as Speaker
  return { speaker, tested, stops: () => stops, end: () => end() }
}

/** A control's key as drawn now, with the generation a redraw gave it */
const keyOf = (ui: ReturnType<typeof drawing>, base: string) =>
  String(every(ui.tree()).find(node => String(node.props.key ?? '').split('#')[0] === base)?.props.key)

describe('“服务”页：OpenAI 兼容接口（F7）', () => {
  test('三个标签写用途；没填全时写还缺什么，页面底部写发给了谁', async () => {
    const { fake, ui } = await opened()
    await ui.press('tab-services')
    expect(['svc-claude', 'svc-openai', 'svc-elevenlabs'].map(key => ui.label(key))).toEqual([
      'Claude Code 账号（用于翻译）',
      'OpenAI 兼容接口',
      'ElevenLabs',
    ])
    await ui.press('svc-openai')
    expect(ui.find({ type: 'Text', text: '还缺请求地址、API Key、翻译模型。填全后可以在“翻译”页选用。' })).toBeDefined()
    expect(ui.find({ type: 'Text', text: 'Prompt 里的文字、Claude 的回复和你选中的文字会发到这个地址翻译、解析或朗读。' })).toBeDefined()
    expect(ui.find({ type: 'Text', text: '翻译模型：先填请求地址和 API Key' })).toBeDefined()
    expect(ui.find({ key: 'openai-key' })?.props.placeholder).toBe('sk-…')
    // Nothing filled in, nothing to delete
    expect(ui.find({ key: 'delete-openai' })).toBeUndefined()
    expect(fake.toasts).toEqual([])
    expect(fake.store.size).toBe(0)
  })

  test('请求地址不合法：红字，不保存；合法时保存，还没有 Key 时不获取', async () => {
    const { fake, ui } = await opened()
    await ui.press('tab-services')
    await ui.press('svc-openai')
    await ui.input('openai-url', 'api.openai.com/v1')
    expect(ui.find({ type: 'Text', text: ERRORS.baseUrl })?.props.color).toBe('red')
    expect(ui.value('openai-url')).toBe('api.openai.com/v1')
    expect(fake.store.has('settings/openaiBaseUrl')).toBe(false)
    await ui.input('openai-url', OPENAI_URL)
    expect(fake.store.get('settings/openaiBaseUrl')).toBe(OPENAI_URL)
    expect(fake.toasts).toEqual([`已保存：请求地址 ${OPENAI_URL}`])
    expect(ui.find({ type: 'Text', text: ERRORS.baseUrl })).toBeUndefined()
    expect(fake.fetches).toEqual([])
  })

  test('API Key 保存后清空，提示文字换成掩码；获取中、获取成功、选模型、配置完成', async () => {
    const { fake, settings, ui } = await opened({ openaiBaseUrl: OPENAI_URL })
    const reply = deferred<Reply>()
    fake.answers.fetch = () => reply.promise
    await ui.press('tab-services')
    await ui.press('svc-openai')
    await ui.input('openai-key', OPENAI_KEY)
    expect(fake.store.get('settings/openaiKey')).toBe(OPENAI_KEY)
    expect(fake.toasts).toEqual(['已保存：API Key sk-…a1b2'])
    // Drawn again under a new key, empty, the mask in its placeholder
    expect(ui.find({ key: 'openai-key' })).toBeUndefined()
    expect(ui.findAll({ type: 'Input' }).find(node => String(node.props.key).startsWith('openai-key#'))?.props).toMatchObject({
      value: '',
      placeholder: '已保存 sk-…a1b2，输入新的 Key 替换',
    })
    expect(ui.find({ type: 'Text', text: '翻译模型：正在获取模型列表…' })).toBeDefined()
    expect(ui.find({ key: 'openai-model' })).toBeUndefined()

    reply.resolve(modelsReply(['gpt-4o-mini', 'gpt-4o', 'gpt-4o-mini']))
    await settings.settled()
    // The key goes in a header, never in the address
    expect(fake.fetches).toEqual([{ url: MODELS_URL, headers: { Authorization: `Bearer ${OPENAI_KEY}` } }])
    expect(fake.store.get('catalog/openai')).toEqual({ ids: ['gpt-4o', 'gpt-4o-mini'], from: MODELS_URL })
    expect(ui.find({ key: 'openai-model' })?.props).toMatchObject({
      value: '',
      options: [
        { value: '', label: '选择模型' },
        { value: 'gpt-4o', label: 'gpt-4o' },
        { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
      ],
    })
    expect(ui.find({ type: 'Text', text: `共 2 个，来自 ${MODELS_URL}` })).toBeDefined()

    await ui.select('openai-model', 'gpt-4o-mini')
    expect(fake.store.get('settings/openaiModel')).toBe('gpt-4o-mini')
    expect(fake.toasts.at(-1)).toBe('已保存：翻译模型 gpt-4o-mini')
    expect(ui.find({ key: 'openai-model' })?.props.options).toEqual([
      { value: 'gpt-4o', label: 'gpt-4o' },
      { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
    ])
    expect(ui.find({ type: 'Text', text: '✓ 已配置完成，可以在“翻译”页选用。' })?.props.color).toBe('green')

    // Now it can be chosen to translate, with its model named
    await ui.press('tab-translate')
    expect(ui.find({ key: 'translate-service' })?.props.options).toEqual([
      { value: 'claude', label: 'Claude Code 账号（Haiku）' },
      { value: 'openai', label: 'OpenAI 兼容接口（gpt-4o-mini）' },
    ])
    await ui.select('translate-service', 'openai')
    expect(fake.store.get('settings/translateService')).toBe('openai')
    expect(fake.toasts.at(-1)).toBe('已保存：翻译服务 OpenAI 兼容接口')
    await ui.press('tab-services')
    expect(ui.label('svc-openai')).toBe('OpenAI 兼容接口（用于翻译）')
    expect(ui.find({ type: 'Text', text: '✓ 使用中，翻译使用 gpt-4o-mini' })).toBeDefined()
  })

  test('获取失败：写原因，保留上次的列表；重新输入同一个 Key 就重试，照常弹 Toast', async () => {
    const { fake, settings, ui } = await opened(OPENAI_SET, f => {
      f.store.set('catalog/openai', { ids: ['gpt-4o-mini', 'o3'], from: MODELS_URL })
    })
    fake.answers.fetch = () => unauthorized
    await ui.press('tab-services')
    await ui.press('svc-openai')
    await ui.input('openai-key', 'sk-wrong-key-0000')
    await settings.settled()
    expect(ui.find({ type: 'Text', text: '获取模型列表失败：401 API Key 不对或已过期，请检查 API Key 或勾选“手动填写”。' })?.props.color).toBe('red')
    // The last list stays, and so does the model
    expect(fake.store.get('catalog/openai')).toEqual({ ids: ['gpt-4o-mini', 'o3'], from: MODELS_URL })
    expect(ui.find({ key: 'openai-model' })?.props).toMatchObject({ value: 'gpt-4o-mini' })
    expect(ui.find({ type: 'Text', text: `共 2 个，来自 ${MODELS_URL}` })).toBeUndefined()

    fake.answers.fetch = () => modelsReply(['gpt-4o-mini'])
    await ui.input(keyOf(ui, 'openai-key'), 'sk-wrong-key-0000')
    expect(fake.toasts).toEqual(['已保存：API Key sk-…0000', '已保存：API Key sk-…0000'])
    await settings.settled()
    expect(fake.fetches).toHaveLength(2)
    expect(ui.find({ type: 'Text', text: `共 1 个，来自 ${MODELS_URL}` })).toBeDefined()
  })

  test('换了请求地址的域名：先不获取，提示重新输入 Key；输入同一个 Key 也算保存并获取', async () => {
    const { fake, settings, ui } = await opened(OPENAI_SET)
    fake.answers.fetch = () => modelsReply(['openai/gpt-4o-mini'])
    await ui.press('tab-services')
    await ui.press('svc-openai')
    await ui.input('openai-url', 'https://openrouter.ai/api/v1')
    await settings.settled()
    expect(fake.toasts).toEqual(['已保存：请求地址 https://openrouter.ai/api/v1'])
    expect(fake.store.get('flag/keyStale')).toBe(true)
    expect(fake.fetches).toEqual([])
    expect(ui.find({ type: 'Text', text: '请求地址换了域名，重新输入 API Key 后才获取模型列表。' })).toBeDefined()

    await ui.input('openai-key', OPENAI_KEY)
    await settings.settled()
    expect(fake.toasts.at(-1)).toBe('已保存：API Key sk-…a1b2')
    expect(fake.store.has('flag/keyStale')).toBe(false)
    expect(fake.fetches.map(fetch => fetch.url)).toEqual(['https://openrouter.ai/api/v1/models'])
    expect(ui.find({ type: 'Text', text: '请求地址换了域名，重新输入 API Key 后才获取模型列表。' })).toBeUndefined()
  })

  test('已保存的模型不在新列表里：不清空，标“（列表里没有）”，下面加一句提示', async () => {
    const { settings, fake, ui } = await opened(OPENAI_SET)
    fake.answers.fetch = () => modelsReply(['gpt-4.1', 'gpt-4.1-mini'])
    await ui.press('tab-services')
    await ui.press('svc-openai')
    await ui.input('openai-key', 'sk-other-key-5555')
    await settings.settled()
    expect(fake.store.get('settings/openaiModel')).toBe('gpt-4o-mini')
    expect(ui.find({ key: 'openai-model' })?.props).toMatchObject({
      value: 'gpt-4o-mini',
      options: [
        { value: 'gpt-4o-mini', label: 'gpt-4o-mini（列表里没有）' },
        { value: 'gpt-4.1', label: 'gpt-4.1' },
        { value: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
      ],
    })
    expect(ui.find({ type: 'Text', text: '已保存的模型不在新获取的列表里，仍按它翻译。' })).toBeDefined()
  })

  test('手动填写：勾上后是输入框，不弹 Toast，不获取；取消勾选时获取一次', async () => {
    const { fake, settings, ui } = await opened(OPENAI_SET)
    fake.answers.fetch = () => modelsReply(['gpt-4o-mini'])
    await ui.press('tab-services')
    await ui.press('svc-openai')
    expect(ui.label('openai-manual')).toBe('☐ 手动填写')
    await ui.press('openai-manual')
    expect(fake.store.get('settings/openaiManual')).toBe(true)
    expect(ui.label('openai-manual')).toBe('☑ 手动填写')
    expect(ui.find({ key: 'openai-model-id' })?.props).toMatchObject({ value: 'gpt-4o-mini', placeholder: '如 gpt-4o-mini' })
    await ui.input('openai-model-id', 'deepseek-chat')
    expect(fake.toasts).toEqual(['已保存：翻译模型 deepseek-chat'])
    // A key saved while ticked asks for no list
    await ui.input('openai-key', 'sk-other-key-5555')
    await settings.settled()
    expect(fake.fetches).toEqual([])

    await ui.press('openai-manual')
    await settings.settled()
    expect(fake.toasts.at(-1)).toBe('已保存：API Key sk-…5555')
    expect(fake.fetches).toHaveLength(1)
    expect(ui.find({ key: 'openai-model' })?.props).toMatchObject({ value: 'deepseek-chat' })
  })

  test('配置状态：翻译和朗读都在用，或只用于朗读', async () => {
    const both = await opened({ ...OPENAI_SET, openaiTtsModel: 'gpt-4o-mini-tts', translateService: 'openai', speechService: 'openai' })
    await both.ui.press('tab-services')
    expect(both.ui.label('svc-openai')).toBe('OpenAI 兼容接口（用于翻译和朗读）')
    await both.ui.press('svc-openai')
    expect(both.ui.find({ type: 'Text', text: '✓ 使用中，翻译使用 gpt-4o-mini，朗读使用 gpt-4o-mini-tts' })).toBeDefined()
    const speech = await opened({ openaiBaseUrl: OPENAI_URL, openaiKey: OPENAI_KEY, openaiTtsModel: 'tts-1', speechService: 'openai' })
    await speech.ui.press('tab-services')
    await speech.ui.press('svc-openai')
    expect(speech.ui.find({ type: 'Text', text: '✓ 使用中，朗读使用 tts-1' })).toBeDefined()
  })

  test('删除配置：先确认；正在用时翻译和朗读退回默认，弹 Toast，备份里不留 Key', async () => {
    const seed = { ...OPENAI_SET, openaiTtsModel: 'tts-1', translateService: 'openai', speechService: 'openai' } as const
    const { fake, ui } = await opened(seed, f => {
      f.store.set('catalog/openai', { ids: ['gpt-4o-mini'], from: MODELS_URL })
      f.files.set(BACKUP, JSON.stringify({ v: 1, date: '2026-10-11', entries: { 'settings/openaiKey': OPENAI_KEY } }))
    })
    await ui.press('tab-services')
    expect(fake.state.pane.svcTab).toBe('openai')
    expect(ui.find({ type: 'Text', text: '清掉这个服务的全部配置，包括 API Key。' })).toBeDefined()
    await ui.press('delete-openai')
    expect(ui.find({ key: 'delete-openai' })).toBeUndefined()
    expect(ui.label('delete-openai-yes')).toBe('确定删除')
    await ui.press('delete-openai-no')
    expect(ui.find({ key: 'delete-openai-yes' })).toBeUndefined()
    expect(fake.store.get('settings/openaiKey')).toBe(OPENAI_KEY)

    await ui.press('delete-openai')
    await ui.press('delete-openai-yes')
    for (const key of ['openaiBaseUrl', 'openaiKey', 'openaiModel', 'openaiTtsModel']) {
      expect(fake.store.has(`settings/${key}`)).toBe(false)
    }
    expect(fake.store.has('catalog/openai')).toBe(false)
    expect(fake.store.get('settings/translateService')).toBe('claude')
    expect(fake.store.get('settings/speechService')).toBe('system')
    expect(fake.toasts).toEqual(['已删除 OpenAI 兼容接口的配置，翻译改回 Claude Code 账号，朗读改回系统声音。'])
    expect(fake.state.view).toMatchObject({ translateService: 'claude', speechService: 'system', openaiKeyMask: null })
    const backup = fake.files.get(BACKUP) ?? ''
    expect(backup).not.toContain(OPENAI_KEY)
    expect(JSON.parse(backup).entries['settings/translateService']).toBe('claude')
    expect(ui.find({ type: 'Text', text: '还缺请求地址、API Key、翻译模型。填全后可以在“翻译”页选用。' })).toBeDefined()
    expect(ui.find({ key: 'delete-openai' })).toBeUndefined()
  })
})

describe('“服务”页：ElevenLabs（F8）', () => {
  test('填好 Key 后获取能朗读的模型和声音，存下第一个声音；页面写明只用于朗读', async () => {
    const { fake, settings, ui } = await opened()
    const gate = deferred<void>()
    fake.answers.fetch = async url => {
      await gate.promise
      return url === ELEVEN_MODELS_URL ? elevenModels : elevenVoices
    }
    await ui.press('tab-services')
    await ui.press('svc-elevenlabs')
    expect(ui.find({ type: 'Text', text: '还缺 API Key。填好后会获取你账号里的模型和声音，然后可以在“阅读”页选用。' })).toBeDefined()
    expect(ui.find({ type: 'Text', text: 'ElevenLabs 只能用于朗读。要朗读的文字会发给 ElevenLabs。' })).toBeDefined()
    expect(ui.find({ key: 'eleven-key' })?.props.placeholder).toBe('sk_…')
    await ui.input('eleven-key', ELEVEN_KEY)
    expect(ui.find({ type: 'Text', text: '朗读模型：正在获取模型和声音…' })).toBeDefined()
    gate.resolve()
    await settings.settled()
    expect(fake.toasts).toEqual(['已保存：API Key sk_…9z8y'])
    expect(fake.fetches.map(fetch => fetch.url).sort()).toEqual([ELEVEN_MODELS_URL, ELEVEN_VOICES_URL])
    expect(fake.fetches.every(fetch => fetch.headers['xi-api-key'] === ELEVEN_KEY)).toBe(true)
    expect(fake.store.get('settings/voiceEleven')).toBe('voice-george')
    expect(fake.store.get('catalog/eleven')).toEqual({
      models: [
        { id: 'eleven_multilingual_v2', name: 'Eleven Multilingual v2' },
        { id: 'eleven_flash_v2_5', name: 'Eleven Flash v2.5' },
      ],
      voices: [
        { id: 'voice-george', name: 'George' },
        { id: 'voice-sarah', name: 'Sarah' },
      ],
    })
    expect(ui.find({ type: 'Text', text: '共 2 个能朗读的模型、2 个声音，来自你的 ElevenLabs 账号' })).toBeDefined()
    expect(ui.find({ key: 'eleven-model' })?.props).toMatchObject({
      value: 'eleven_multilingual_v2',
      options: [
        { value: 'eleven_multilingual_v2', label: 'eleven_multilingual_v2（默认）' },
        { value: 'eleven_flash_v2_5', label: 'eleven_flash_v2_5' },
      ],
    })
    expect(ui.find({ type: 'Text', text: '✓ 已配置完成，可以在“阅读”页选用。' })).toBeDefined()
    await ui.select('eleven-model', 'eleven_flash_v2_5')
    expect(fake.toasts.at(-1)).toBe('已保存：朗读模型 eleven_flash_v2_5')
  })

  test('获取失败：Key 照样保存，保留上次的列表和已选的值，写原因', async () => {
    const list = { models: [{ id: 'eleven_multilingual_v2', name: 'v2' }], voices: [{ id: 'voice-sarah', name: 'Sarah' }] }
    const { fake, settings, ui } = await opened({ elevenKey: ELEVEN_KEY, voiceEleven: 'voice-sarah' }, f => {
      f.store.set('catalog/eleven', list)
    })
    fake.answers.fetch = () => unauthorized
    await ui.press('tab-services')
    await ui.press('svc-elevenlabs')
    await ui.input('eleven-key', 'sk_badkey00001111')
    await settings.settled()
    expect(fake.store.get('settings/elevenKey')).toBe('sk_badkey00001111')
    expect(fake.toasts).toEqual(['已保存：API Key sk_…1111'])
    expect(ui.find({ type: 'Text', text: '获取模型和声音失败：401 API Key 不对或已过期，请检查 API Key。' })?.props.color).toBe('red')
    expect(fake.store.get('catalog/eleven')).toEqual(list)
    expect(fake.store.get('settings/voiceEleven')).toBe('voice-sarah')
  })

  test('删除配置：清掉 Key、模型、声音和列表；正在朗读时退回系统声音', async () => {
    const { fake, ui } = await opened(
      { elevenKey: ELEVEN_KEY, elevenModel: 'eleven_flash_v2_5', voiceEleven: 'voice-sarah', speechService: 'elevenlabs' },
      f => f.store.set('catalog/eleven', { models: [], voices: [{ id: 'voice-sarah', name: 'Sarah' }] }),
    )
    await ui.press('tab-services')
    expect(ui.label('svc-elevenlabs')).toBe('ElevenLabs（用于朗读）')
    await ui.press('svc-elevenlabs')
    expect(ui.find({ type: 'Text', text: '✓ 使用中，朗读使用 eleven_flash_v2_5，声音 Sarah' })).toBeDefined()
    await ui.press('delete-elevenlabs')
    await ui.press('delete-elevenlabs-yes')
    for (const key of ['elevenKey', 'elevenModel', 'voiceEleven']) {
      expect(fake.store.has(`settings/${key}`)).toBe(false)
    }
    expect(fake.store.has('catalog/eleven')).toBe(false)
    expect(fake.store.get('settings/speechService')).toBe('system')
    expect(fake.toasts).toEqual(['已删除 ElevenLabs 的配置，朗读改回系统声音。'])
    expect(fake.files.get(BACKUP)).not.toContain(ELEVEN_KEY)
  })
})

describe('“阅读”页：朗读服务、声音、试听和本机缓存（F6、F8）', () => {
  const SAY = [
    'Albert              en_US    # Hello! My name is Albert.',
    'Alice               it_IT    # Ciao! Mi chiamo Alice.',
    'Daniel (English (UK)) en_GB    # Hello! My name is Daniel.',
    'Daniel (English (UK)) en_GB    # Hello! My name is Daniel.',
    'Samantha            en_US    # Hello! My name is Samantha.',
  ].join('\n')

  test('没配置完成的在线语音不能选，下拉框换 key 画回系统声音；系统声音的声音来自 say -v ?', async () => {
    const { fake, settings, ui } = await opened({}, f => {
      f.answers.run = argv => ({ exitCode: 0, stdout: argv[0] === 'say' ? SAY : '', stderr: '' })
    })
    await ui.press('tab-reading')
    await settings.settled()
    expect(ui.find({ key: 'speech-service' })?.props).toMatchObject({
      value: 'system',
      options: [
        { value: 'system', label: '系统声音（默认）' },
        { value: 'openai', label: 'OpenAI 兼容接口（未配置完成）' },
        { value: 'elevenlabs', label: 'ElevenLabs（未配置完成）' },
      ],
    })
    await ui.select('speech-service', 'elevenlabs')
    expect(fake.store.has('settings/speechService')).toBe(false)
    expect(fake.toasts).toEqual([])
    expect(ui.find({ key: 'speech-service#1' })?.props.value).toBe('system')

    expect(fake.runs).toContainEqual(['say', '-v', '?'])
    expect(ui.find({ key: 'voice-system' })?.props).toMatchObject({
      value: '',
      options: [
        { value: '', label: '系统默认' },
        { value: 'Albert', label: 'Albert' },
        { value: 'Daniel (English (UK))', label: 'Daniel (English (UK))' },
        { value: 'Samantha', label: 'Samantha' },
      ],
    })
    await ui.select('voice-system', 'Samantha')
    expect(fake.store.get('settings/voiceSystem')).toBe('Samantha')
    expect(fake.toasts).toEqual(['已保存：声音 Samantha'])
    expect(
      ui.find({ type: 'Text', text: '系统自带的声音，免费、离线可用，但听起来比较机械。想要更自然的声音，可以换成在线语音。' }),
    ).toBeDefined()
    // Read once a session
    await ui.press('tab-translate')
    await ui.press('tab-reading')
    await settings.settled()
    expect(fake.runs.filter(argv => argv[0] === 'say')).toHaveLength(1)
  })

  test('OpenAI 兼容接口配好朗读模型后能选；声音列 13 个，coral 是默认；说明换成在线语音的', async () => {
    const { fake, ui } = await opened({ openaiBaseUrl: OPENAI_URL, openaiKey: OPENAI_KEY, openaiTtsModel: 'gpt-4o-mini-tts' })
    await ui.press('tab-reading')
    expect(ui.find({ key: 'speech-service' })?.props.options).toContainEqual({
      value: 'openai',
      label: 'OpenAI 兼容接口（gpt-4o-mini-tts）',
    })
    await ui.select('speech-service', 'openai')
    expect(fake.toasts).toEqual(['已保存：朗读服务 OpenAI 兼容接口'])
    const voices = ui.find({ key: 'voice-openai' })?.props
    expect(voices?.value).toBe('coral')
    expect((voices?.options as { value: string }[]).map(option => option.value)).toEqual([
      'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar',
    ])
    expect((voices?.options as { label: string }[])[3]?.label).toBe('coral（默认）')
    await ui.select('voice-openai', 'nova')
    expect(fake.toasts.at(-1)).toBe('已保存：声音 nova')
    expect(
      ui.find({ type: 'Text', text: '在线语音更自然，读到一半可以停止。按字数收费，读过的内容会缓存，再读不重复收费。声音由 AI 生成。' }),
    ).toBeDefined()
    expect(ui.find({ key: 'goto-speech' })).toBeUndefined()
  })

  test('ElevenLabs：声音列账号里的，Toast 写声音的名字', async () => {
    const { fake, ui } = await opened(
      { elevenKey: ELEVEN_KEY, voiceEleven: 'voice-george', speechService: 'elevenlabs' },
      f => f.store.set('catalog/eleven', { models: [], voices: [{ id: 'voice-george', name: 'George' }, { id: 'voice-sarah', name: 'Sarah' }] }),
    )
    await ui.press('tab-reading')
    expect(ui.find({ key: 'voice-eleven' })?.props).toMatchObject({
      value: 'voice-george',
      options: [
        { value: 'voice-george', label: 'George' },
        { value: 'voice-sarah', label: 'Sarah' },
      ],
    })
    await ui.select('voice-eleven', 'voice-sarah')
    expect(fake.store.get('settings/voiceEleven')).toBe('voice-sarah')
    expect(fake.toasts).toEqual(['已保存：声音 Sarah'])
  })

  test('试听：系统声音读的时候写“试听中…”，读完恢复', async () => {
    const speaking = fakeSpeaker()
    const { ui } = await opened({}, () => undefined, { speaker: speaking.speaker })
    await ui.press('tab-reading')
    expect(ui.label('voice-try')).toBe('试听')
    await ui.press('voice-try')
    await flush()
    expect(speaking.tested).toEqual(['try'])
    expect(ui.find({ key: 'voice-try' })).toBeUndefined()
    expect(ui.find({ type: 'Text', text: '试听中…' })?.props.dimColor).toBe(true)
    speaking.end()
    await flush()
    expect(ui.label('voice-try')).toBe('试听')
  })

  test('试听：在线语音读的时候写“停止”，按下就停', async () => {
    const speaking = fakeSpeaker()
    const seed = { openaiBaseUrl: OPENAI_URL, openaiKey: OPENAI_KEY, openaiTtsModel: 'tts-1', speechService: 'openai' } as const
    const { ui } = await opened(seed, () => undefined, { speaker: speaking.speaker })
    await ui.press('tab-reading')
    await ui.press('voice-try')
    await flush()
    expect(ui.label('voice-try')).toBe('停止')
    await ui.press('voice-try')
    await flush()
    expect(speaking.stops()).toBe(1)
    expect(speaking.tested).toEqual(['try'])
    expect(ui.label('voice-try')).toBe('试听')
  })

  test('去配置朗读服务：切到“服务”页的 OpenAI 兼容接口，朗读模型带 autoFocus', async () => {
    const { fake, ui } = await opened()
    await ui.press('tab-reading')
    expect(ui.label('goto-speech')).toBe('去配置朗读服务')
    await ui.press('goto-speech')
    expect(fake.state.pane).toMatchObject({ tab: 'services', svcTab: 'openai', autoFocus: 'openai-tts-model' })
    expect(ui.find({ key: 'openai-tts-model' })?.props.autoFocus).toBe(true)
    expect(ui.find({ key: 'openai-url' })?.props.autoFocus).toBeUndefined()
    // Any other way onto the tab leaves the focus where it is
    await ui.press('svc-claude')
    await ui.press('svc-openai')
    expect(ui.find({ key: 'openai-tts-model' })?.props.autoFocus).toBeUndefined()
  })

  test('本机缓存：显示 replies 和 tts 占的空间；清除要确认，只删这两个目录，弹 Toast', async () => {
    let isCleared = false
    const { fake, settings, ui } = await opened({}, f => {
      f.answers.run = argv =>
        argv[0] === 'du'
          ? { exitCode: 0, stdout: isCleared ? '' : `1024\t${DATA_DIR}/replies\n2048\t${DATA_DIR}/tts\n`, stderr: '' }
          : { exitCode: 0, stdout: '', stderr: '' }
    })
    await ui.press('tab-reading')
    await settings.settled()
    expect(fake.runs).toContainEqual(['du', '-sk', `${DATA_DIR}/replies`, `${DATA_DIR}/tts`])
    expect(ui.find({ type: 'Text', text: '3 MB' })).toBeDefined()
    await ui.press('cache-clear')
    expect(ui.label('cache-yes')).toBe('确定清除')
    await ui.press('cache-no')
    expect(ui.find({ key: 'cache-yes' })).toBeUndefined()
    await ui.press('cache-clear')
    const before = fake.runs.length
    await ui.press('cache-yes')
    isCleared = true
    expect(fake.runs.slice(before).filter(argv => argv[0] === 'rm')).toEqual([
      ['rm', '-rf', `${DATA_DIR}/replies`],
      ['rm', '-rf', `${DATA_DIR}/tts`],
    ])
    expect(fake.toasts).toEqual(['已清除译文和朗读缓存，释放了 3 MB。'])
    expect(ui.find({ type: 'Text', text: '0 KB' })).toBeDefined()
    expect(ui.find({ key: 'cache-clear' })).toBeUndefined()
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
  test('每一页和它们的几种状态，终端和桌面端都能画', { plugins: [harness], timeoutMs: 120_000 }, async ($, on) => {
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

describe('M6 的页面在两种 surface 上', () => {
  test(
    '“服务”页的三个服务、“阅读”页的朗读和缓存，各种状态终端和桌面端都能画',
    { plugins: [harness], timeoutMs: 120_000 },
    async ($, on) => {
      let tree: unknown = null
      on('store.get', ($, e) => ({ value: e.key === TREE_KEY ? tree : undefined }))
      on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
      const states: [string, Node][] = []
      const SAY = 'Samantha            en_US    # Hello! My name is Samantha.'

      // Nothing configured
      const empty = await opened()
      await empty.ui.press('tab-services')
      await empty.ui.press('svc-openai')
      states.push(['openai: nothing filled in', empty.ui.tree()])
      await empty.ui.press('svc-elevenlabs')
      states.push(['eleven: no key', empty.ui.tree()])

      // Fetching
      const loading = await opened({ openaiBaseUrl: OPENAI_URL })
      loading.fake.answers.fetch = () => new Promise<Reply>(() => undefined)
      await loading.ui.press('tab-services')
      await loading.ui.press('svc-openai')
      await loading.ui.input('openai-key', OPENAI_KEY)
      states.push(['openai: fetching', loading.ui.tree()])
      await loading.ui.press('svc-elevenlabs')
      await loading.ui.input('eleven-key', ELEVEN_KEY)
      states.push(['eleven: fetching', loading.ui.tree()])

      // A list with the saved model missing from it, in use, 删除配置 asked
      const listed = await opened({ ...OPENAI_SET, openaiModel: 'gone-model', translateService: 'openai' }, f => {
        f.store.set('catalog/openai', { ids: ['gpt-4o', 'gpt-4o-mini'], from: MODELS_URL })
      })
      await listed.ui.press('tab-services')
      await listed.ui.press('delete-openai')
      states.push(['openai: listed, model gone, delete asked', listed.ui.tree()])

      // Failed, then the address moved to another domain, then 手动填写
      const failed = await opened(OPENAI_SET)
      failed.fake.answers.fetch = () => unauthorized
      await failed.ui.press('tab-services')
      await failed.ui.press('svc-openai')
      await failed.ui.input('openai-key', 'sk-wrong-key-0000')
      await failed.settings.settled()
      await failed.ui.input('openai-url', 'not an address')
      states.push(['openai: fetch failed, address refused', failed.ui.tree()])
      await failed.ui.input(keyOf(failed.ui, 'openai-url'), 'https://openrouter.ai/api/v1')
      states.push(['openai: key held back', failed.ui.tree()])
      await failed.ui.press('openai-manual')
      states.push(['openai: 手动填写', failed.ui.tree()])

      // ElevenLabs fetched, in use, delete asked; and a failed fetch
      const eleven = await opened({ speechService: 'elevenlabs', elevenKey: ELEVEN_KEY, voiceEleven: 'voice-george' }, f => {
        f.store.set('catalog/eleven', {
          models: [{ id: 'eleven_multilingual_v2', name: 'v2' }],
          voices: [{ id: 'voice-george', name: 'George' }],
        })
      })
      await eleven.ui.press('tab-services')
      await eleven.ui.press('svc-elevenlabs')
      await eleven.ui.press('delete-elevenlabs')
      states.push(['eleven: in use, delete asked', eleven.ui.tree()])
      eleven.fake.answers.fetch = () => unauthorized
      await eleven.ui.press('delete-elevenlabs-no')
      await eleven.ui.input('eleven-key', 'sk_badkey00001111')
      await eleven.settings.settled()
      states.push(['eleven: fetch failed', eleven.ui.tree()])
      await eleven.ui.press('tab-reading')
      states.push(['reading: ElevenLabs voices', eleven.ui.tree()])

      // 阅读: the system's voices, 试听中…, the cache measured and 清除 asked
      const speaking = fakeSpeaker()
      const reading = await opened(
        {},
        f => {
          f.answers.run = argv => ({
            exitCode: 0,
            stdout: argv[0] === 'say' ? SAY : argv[0] === 'du' ? `2048\t${DATA_DIR}/replies\n` : '',
            stderr: '',
          })
        },
        { speaker: speaking.speaker },
      )
      await reading.ui.press('tab-reading')
      states.push(['reading: measuring', reading.ui.tree()])
      await reading.settings.settled()
      await reading.ui.press('voice-try')
      await flush()
      await reading.ui.press('cache-clear')
      states.push(['reading: 试听中…, 清除 asked', reading.ui.tree()])
      speaking.end()
      await reading.ui.press('goto-speech')
      states.push(['services: 去配置朗读服务', reading.ui.tree()])

      // 阅读 with an online voice reading
      const online = await opened(
        { openaiBaseUrl: OPENAI_URL, openaiKey: OPENAI_KEY, openaiTtsModel: 'tts-1', speechService: 'openai' },
        () => undefined,
        { speaker: fakeSpeaker().speaker },
      )
      await online.ui.press('tab-reading')
      await online.ui.press('voice-try')
      await flush()
      states.push(['reading: online, 停止', online.ui.tree()])

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
    },
  )
})
