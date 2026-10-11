import { describe, expect, test } from 'claude-code/testing'
import type { Elements, Register } from 'claude-code'

import { REPO_URL } from '../../hooks/core/copy/share'
import { SVG_MAX_LENGTH } from '../../hooks/core/share/card'
import { composeUrl, shareText } from '../../hooks/core/share/text'
import { DEFAULT_VIEW, storeKeyOf } from '../../hooks/core/settings/schema'
import { INITIAL_PANE } from '../../hooks/core/state/defaults'
import { shareUiOf, shareView } from '../../hooks/features/share/view'
import { createStatsPage } from '../../hooks/features/stats/controller'
import type { StatsPage } from '../../hooks/features/stats/controller'
import type { Host } from '../../hooks/host'
import type { WwePane, WweSettingsView, WweStats } from '../../types'

// The share card's page (F14) as tests/ui/settings.test.ts draws the
// settings: the view built as plain data with each surface's element table
// and pressed by key, against a Host whose files, store, clock, clipboard
// and processes live in memory (nothing reaches the real clipboard, a
// browser or X); then the trees drawn by an inline mod on both surfaces.

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

const COMMON = ['Box', 'Text', 'Button', 'Input', 'Select', 'Link', 'Code', 'Markdown', 'Client']
const tableOf = (types: string[]) => Object.fromEntries([...COMMON, ...types].map(type => [type, element(type)]))

const UI = {
  // The terminal's table has an Svg too on 2.1.296 (drawn as nothing): Raster decides the surface
  terminal: tableOf(['Raster', 'Image', 'Svg']) as unknown as Elements['terminal'],
  desktop: tableOf(['Svg']) as unknown as Elements['desktop'],
}

type Surface = keyof typeof UI

const DATA = '/Users/t/.claude/plugins/data/work-with-english-inline'
const ROOT = '/plugins/work-with-english'

/** Noon UTC on Friday 2026-10-09 */
const NOW = Date.UTC(2026, 9, 9, 12)

/** As long as assets/card-icon.png (83,997 bytes) in base64 */
const ICON_BASE64 = 'A'.repeat(111_996)

const row = (used = 0, retyped = 0, direct = 0, more: Record<string, number> = {}) => ({
  used,
  retyped,
  direct,
  words: 0,
  newWords: 0,
  newSents: 0,
  ...more,
})

/** The seven days up to today: 32 messages, 75%, 15 points up, 2,673 words, 1 new word, 18 days in a row */
function files(): Map<string, string> {
  const days: Record<string, ReturnType<typeof row>> = {
    '2026-09-22': row(1),
    '2026-09-23': row(1),
    '2026-09-24': row(1),
    '2026-09-25': row(1),
    '2026-09-26': row(1),
    '2026-09-27': row(1),
    '2026-09-28': row(2, 2, 1),
    '2026-09-29': row(1, 2, 1),
    '2026-09-30': row(1, 1, 1),
    '2026-10-01': row(1, 1, 1),
    '2026-10-02': row(1, 1, 1),
    '2026-10-03': row(1, 1, 2),
    '2026-10-04': row(1, 1, 1),
    '2026-10-05': row(2, 2, 1, { words: 500 }),
    '2026-10-06': row(1, 2, 2, { words: 600 }),
    '2026-10-07': row(1, 2, 2, { words: 573, newWords: 1 }),
    '2026-10-08': row(1, 2, 2, { words: 500, newSents: 1 }),
    '2026-10-09': row(1, 1, 3, { words: 500 }),
  }
  return new Map(Object.entries(days).map(([date, counts]) => [`${DATA}/stats/${date}/s1.json`, JSON.stringify(counts)]))
}

type Run = { argv: string[]; stdin?: string }
type RunResult = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean; isStderrTruncated: boolean }

const OK: RunResult = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

/** A Host with what the share page uses; `answer` decides what each process returns */
function fakeHost(seed: { cardLanguage?: 'target' | 'source' } = {}) {
  const fs = files()
  const store = new Map<string, unknown>(
    seed.cardLanguage ? [[storeKeyOf('cardLanguage'), seed.cardLanguage]] : [],
  )
  const toasts: string[] = []
  const runs: Run[] = []
  const copies: { text: string; surface?: string }[] = []
  const timers: (() => void)[] = []
  const world = {
    answer: (argv: string[]): Promise<RunResult> | RunResult => (argv[0] === 'missing' ? { ...OK, exitCode: 1 } : OK),
    isCopied: true,
  }
  const state: { pane: WwePane; settings: WweSettingsView; stats: WweStats | null } = {
    pane: { ...INITIAL_PANE, tab: 'stats' },
    settings: { ...DEFAULT_VIEW, cardLanguage: seed.cardLanguage ?? 'target' },
    stats: null,
  }
  const cell = <K extends keyof typeof state>(name: K) => ({
    get: async () => state[name],
    update: async (fn: (value: (typeof state)[K]) => (typeof state)[K]) => {
      state[name] = fn(state[name])
      return state[name]
    },
  })
  const host = {
    clock: {
      now: async () => NOW,
      after: (ms: number, fn: () => void) => {
        timers.push(fn)
        return { cancel: () => undefined }
      },
    },
    env: { home: async () => '/Users/t', configDir: async () => undefined, pluginCacheDir: async () => undefined },
    plugin: { name: 'work-with-english', root: ROOT },
    fs: {
      read: async (path: string) => {
        const text = fs.get(path)
        if (text === undefined) {
          throw new Error(`ENOENT ${path}`)
        }
        return text
      },
      readBytes: async (path: string) => {
        if (path !== `${ROOT}/assets/card-icon.png`) {
          throw new Error(`ENOENT ${path}`)
        }
        return { base64: ICON_BASE64 }
      },
      write: async (path: string, text: string) => {
        fs.set(path, text)
      },
      list: async (dir: string) => {
        const names = new Map<string, 'file' | 'dir'>()
        for (const path of fs.keys()) {
          if (path.startsWith(`${dir}/`)) {
            const [name, ...rest] = path.slice(dir.length + 1).split('/')
            if (name) {
              names.set(name, rest.length > 0 ? 'dir' : 'file')
            }
          }
        }
        return [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0 }))
      },
    },
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
      copy: async (args: { text: string; surface?: string }) => {
        copies.push(args)
        return world.isCopied ? { isCopied: true } : { isCopied: false, reason: 'no channel' }
      },
    },
    proc: {
      run: async (argv: string[], init?: { stdin?: string }) => {
        runs.push(init?.stdin === undefined ? { argv } : { argv, stdin: init.stdin })
        return world.answer(argv)
      },
    },
    state: { settings: cell('settings'), pane: cell('pane'), stats: cell('stats') },
  } as unknown as Host
  return { host, fs, store, toasts, runs, copies, timers, world, state }
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

/** The default 5 seconds is short on a busy machine; nothing here waits on purpose */
const SLOW = { timeoutMs: 30_000 }

/** The share page drawn from what the Host holds now, acted on by key as a surface would */
function drawing(page: StatsPage, fake: Fake, surface: Surface) {
  const tree = () => {
    const share = fake.state.stats?.share
    const ui = shareUiOf(UI[surface])
    if (!share || !ui || fake.state.pane.view !== 'share') {
      throw new Error('the pane does not show the share card')
    }
    return shareView(ui, { share }, {
      back: () => page.back(),
      setCardLanguage: value => page.setCardLanguage(value),
      postToX: () => page.postToX(),
      copyImage: () => page.copyImage(),
      copyText: on => page.copyText(on),
    }) as unknown as Node
  }
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
    texts: () =>
      every(tree())
        .filter(node => node.type === 'Text')
        .map(textOf),
    press: async (key: string) => {
      await handler(key, 'Button', 'onPress')({ surface })
    },
    select: async (key: string, value: string) => {
      await handler(key, 'Select', 'onSelect')(value)
    },
  }
}

/** The share page as 生成分享卡 opens it */
async function opened(surface: Surface = 'terminal', seed: { cardLanguage?: 'target' | 'source' } = {}) {
  const fake = fakeHost(seed)
  const page = createStatsPage(fake.host)
  await page.load()
  await page.openShare()
  return { fake, page, ui: drawing(page, fake, surface) }
}

const EN_POST = shareText('en')
const ZH_POST = shareText('zh')

describe('分享卡页', () => {
  test('左上角“← 返回统计”，右上角“发到 X”“复制图片”；卡片语言、分享文字和字数、说明', SLOW, async () => {
    const { ui } = await opened()
    expect(ui.find({ key: 'share-back', type: 'Button' })?.props).toMatchObject({ label: '← 返回统计', plain: true })
    expect(ui.find({ key: 'share-post', type: 'Button' })?.props.label).toBe('发到 X')
    expect(ui.find({ key: 'share-image', type: 'Button' })?.props.label).toBe('复制图片')
    expect(ui.find({ key: 'share-text', type: 'Button' })?.props.label).toBe('复制文字')
    expect(ui.find({ key: 'card-language', type: 'Select' })?.props).toMatchObject({
      label: '卡片语言',
      value: 'target',
      options: [
        { value: 'target', label: '目标语言（英语）' },
        { value: 'source', label: '源语言（简体中文）' },
      ],
    })
    const texts = ui.texts()
    expect(texts).toContain('卡片和分享文字用这种语言。默认用目标语言，看到分享的朋友多半更熟悉它。')
    expect(texts).toContain('分享文字（271/280）')
    // The post line for line, its blank lines kept as gaps
    for (const line of EN_POST.split('\n').filter(line => line !== '')) {
      expect(texts).toContain(line)
    }
    expect(texts.at(-1)).toBe(
      '“发到 X”先把卡片复制成图片，再在浏览器里打开填好文字的发帖页，在那里点一下输入框，按 ⌘V 贴上卡片，发不发由你决定。发到别处时，用“复制图片”和“复制文字”。复制会替换剪贴板里原来的内容。',
    )
  })

  test('终端：卡片用 Box、Text、Raster 拼，不放产品图标和 GitHub 标志', SLOW, async () => {
    const { ui } = await opened('terminal')
    const texts = ui.texts()
    for (const text of [
      'How to Vibe Code',
      'in English?',
      'Oct 3 – 9, 2026 (past week)',
      '32',
      'messages in English',
      '75%',
      'written by myself, up 15 points',
      '2,673',
      "words of Claude's replies read",
      'new word saved',
      '18',
      'day streak',
      'Last 12 weeks',
      'Each square is a day',
      'Think in your language.',
      'Work with Claude Code in English.',
      'github.com/alex-remote/',
      'claude-with-english',
      'A free, open-source Claude Code plugin',
    ]) {
      expect(texts).toContain(text)
    }
    expect(ui.findAll({ type: 'Raster' }).map(raster => raster.props.key)).toEqual(['card-heat', 'card-heat-key'])
    expect(ui.findAll({ type: 'Svg' })).toEqual([])
    expect(ui.findAll({ type: 'Image' })).toEqual([])
  })

  test('桌面端：卡片就是出图用的 SVG，带产品图标，不超过 Svg 的上限', SLOW, async () => {
    const { ui } = await opened('desktop')
    const [card] = ui.findAll({ type: 'Svg' })
    const source = String(card?.props.source)
    expect(card?.props.alt).toBe('分享卡')
    expect(source).toContain('width="1080"')
    expect(source).toContain(`href="data:image/png;base64,${ICON_BASE64}"`)
    expect(source).toContain('>How to Vibe Code</text>')
    expect(source.length).toBeLessThanOrEqual(SVG_MAX_LENGTH)
    expect(ui.findAll({ type: 'Raster' })).toEqual([])
  })

  test('卡片语言：选了就保存并弹 Toast，卡片和分享文字换成中文；选同一项不保存', SLOW, async () => {
    const { fake, ui } = await opened('desktop')
    await ui.select('card-language', 'target')
    expect(fake.toasts).toEqual([])
    expect(fake.store.size).toBe(0)

    await ui.select('card-language', 'source')
    expect(fake.store.get(storeKeyOf('cardLanguage'))).toBe('source')
    expect(fake.toasts).toEqual(['已保存：卡片语言 简体中文'])
    expect(fake.state.settings.cardLanguage).toBe('source')
    expect(ui.find({ key: 'card-language' })?.props.value).toBe('source')
    expect(ui.texts()).toContain('分享文字（257/280）')
    expect(ui.texts()).toContain(ZH_POST.split('\n')[0] ?? '')
    const source = String(ui.find({ type: 'Svg' })?.props.source)
    expect(source).toContain('>如何用英语氛围编程？</text>')
    expect(source.length).toBeLessThanOrEqual(SVG_MAX_LENGTH)

    await ui.select('card-language', 'target')
    expect(fake.toasts.at(-1)).toBe('已保存：卡片语言 英语')
  })

  test('打开时按已保存的卡片语言', SLOW, async () => {
    const { ui } = await opened('terminal', { cardLanguage: 'source' })
    expect(ui.find({ key: 'card-language' })?.props.value).toBe('source')
    expect(ui.texts()).toContain('如何用英语氛围编程？')
    expect(ui.texts()).toContain('2026.10.3 – 10.9（最近一周）')
  })

  test('复制图片：sips 出图，osascript 放进剪贴板，弹 Toast', SLOW, async () => {
    const { fake, ui } = await opened()
    await ui.press('share-image')
    const svg = `${DATA}/share/card-en.svg`
    const png = `${DATA}/share/card-en.png`
    expect(fake.runs.map(run => run.argv)).toEqual([
      ['sips', '-s', 'format', 'png', svg, '--out', png],
      ['osascript', '-e', `set the clipboard to (read (POSIX file ${JSON.stringify(png)}) as «class PNGf»)`],
    ])
    expect(fake.fs.get(svg)).toContain(`href="data:image/png;base64,${ICON_BASE64}"`)
    expect(fake.toasts).toEqual(['已复制卡片图片。'])
    expect(fake.state.stats?.share).toMatchObject({ busy: null, error: null })
  })

  test('发到 X：先复制图片，再在浏览器里打开填好文字的发帖页，弹 Toast；不发帖', SLOW, async () => {
    const { fake, ui } = await opened()
    await ui.press('share-post')
    expect(fake.runs.map(run => run.argv[0])).toEqual(['sips', 'osascript', 'open'])
    expect(fake.runs[2]?.argv).toEqual(['open', composeUrl(EN_POST)])
    expect(fake.runs[2]?.argv[1]).toStartWith('https://x.com/intent/tweet?text=')
    expect(fake.toasts).toEqual(['卡片图片已复制。在发帖页点一下输入框，再按 ⌘V 贴上。'])
  })

  test('复制文字：交给按下的那个 surface 复制；复制不了时用 pbcopy', SLOW, async () => {
    const { fake, ui } = await opened('desktop')
    await ui.press('share-text')
    expect(fake.copies).toEqual([{ text: EN_POST, surface: 'desktop' }])
    expect(fake.runs).toEqual([])
    expect(fake.toasts).toEqual(['已复制分享文字。'])

    fake.world.isCopied = false
    await ui.press('share-text')
    expect(fake.runs).toEqual([{ argv: ['pbcopy'], stdin: EN_POST }])
    expect(fake.toasts).toEqual(['已复制分享文字。', '已复制分享文字。'])
    expect(EN_POST).toContain(REPO_URL)
  })

  test('进行中：按钮换成“正在…”，其他两个不能点；按了也不会再跑', SLOW, async () => {
    const { fake, page, ui } = await opened()
    let finish: (result: RunResult) => void = () => undefined
    let started: () => void = () => undefined
    const isStarted = new Promise<void>(resolve => {
      started = resolve
    })
    fake.world.answer = argv =>
      argv[0] === 'sips'
        ? new Promise<RunResult>(resolve => {
            finish = resolve
            started()
          })
        : OK
    const pressed = ui.press('share-image')
    await isStarted
    expect(fake.state.stats?.share?.busy).toBe('image')
    expect(ui.find({ key: 'share-image' })).toMatchObject({ type: 'Text', props: { dimColor: true } })
    expect(ui.texts()).toContain('正在复制图片…')
    expect(ui.find({ key: 'share-post', type: 'Button' })).toBeUndefined()
    expect(ui.find({ key: 'share-text', type: 'Button' })).toBeUndefined()
    await page.copyText('terminal')
    await page.postToX()
    expect(fake.runs.length).toBe(1)
    expect(fake.copies).toEqual([])

    finish(OK)
    await pressed
    expect(fake.toasts).toEqual(['已复制卡片图片。'])
    expect(ui.find({ key: 'share-post', type: 'Button' })).toBeDefined()
  })

  test('点得快：连按两下只复制一次', SLOW, async () => {
    const { fake, ui } = await opened()
    await Promise.all([ui.press('share-image'), ui.press('share-image'), ui.press('share-text')])
    expect(fake.runs.map(run => run.argv[0])).toEqual(['sips', 'osascript'])
    expect(fake.copies).toEqual([])
    expect(fake.toasts).toEqual(['已复制卡片图片。'])
  })

  test('失败：在按钮下面写原因，不弹 Toast；再按一次就重试', SLOW, async () => {
    const { fake, ui } = await opened()
    fake.world.answer = argv => (argv[0] === 'sips' ? { ...OK, exitCode: 1, stderr: 'Error 13' } : OK)
    await ui.press('share-image')
    expect(fake.toasts).toEqual([])
    expect(ui.find({ type: 'Text', text: '复制图片失败：无法生成卡片图片' })?.props.color).toBe('red')

    fake.world.answer = argv => (argv[0] === 'open' ? { ...OK, exitCode: 1 } : OK)
    await ui.press('share-post')
    expect(ui.texts()).toContain('发到 X 失败：无法打开浏览器')
    expect(ui.texts()).not.toContain('复制图片失败：无法生成卡片图片')

    fake.world.answer = () => OK
    await ui.press('share-post')
    expect(ui.texts().some(text => text.includes('失败'))).toBe(false)
    expect(fake.toasts).toEqual(['卡片图片已复制。在发帖页点一下输入框，再按 ⌘V 贴上。'])

    fake.world.isCopied = false
    fake.world.answer = argv => (argv[0] === 'pbcopy' ? { ...OK, exitCode: 1 } : OK)
    await ui.press('share-text')
    expect(ui.texts()).toContain('复制文字失败：无法写入剪贴板')
  })

  test('30 秒没有结果算失败', SLOW, async () => {
    const { fake, ui } = await opened()
    let started: () => void = () => undefined
    const isStarted = new Promise<void>(resolve => {
      started = resolve
    })
    fake.world.answer = argv =>
      argv[0] === 'osascript'
        ? new Promise<RunResult>(() => {
            started()
          })
        : OK
    const pressed = ui.press('share-image')
    await isStarted
    for (const fire of fake.timers) {
      fire()
    }
    await pressed
    expect(ui.texts()).toContain('复制图片失败：30 秒内没有结果')
    expect(fake.toasts).toEqual([])
    expect(fake.state.stats?.share?.busy).toBeNull()
  })

  test('← 返回统计：回到“统计”页，范围不变', SLOW, async () => {
    const { fake, page, ui } = await opened()
    await page.setRange('lastWeek')
    await ui.press('share-back')
    expect(fake.state.pane).toMatchObject({ view: 'settings', tab: 'stats', statsRange: 'lastWeek' })
    expect(fake.state.stats?.share).toBeNull()
    expect(fake.state.stats?.status).toBe('done')
  })
})

// ---- Drawn by the engine on both surfaces -------------------------------

const HARNESS = 'wwe-harness'
const TREE_KEY = 'harness/tree'

/** Draws whatever plain tree the store holds, with this surface's own elements (see tests/ui/settings.test.ts) */
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
    title: 'claude-with-english 设置',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 36 },
    view: {},
  },
} as const

const plain = (tree: Node) => JSON.parse(JSON.stringify(tree)) as unknown

describe('分享卡页在两种 surface 上', () => {
  test('两种卡片语言、进行中和失败，终端和桌面端都能画', { plugins: [harness], timeoutMs: 240_000 }, async ($, on) => {
    let tree: unknown = null
    on('store.get', ($, e) => ({ value: e.key === TREE_KEY ? tree : undefined }))
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))

    for (const surface of ['terminal', 'desktop'] as const) {
      const states: [string, Node][] = []
      const { fake, ui } = await opened(surface)
      states.push(['English', ui.tree()])
      await ui.select('card-language', 'source')
      states.push(['Chinese', ui.tree()])
      fake.world.answer = argv => (argv[0] === 'sips' ? { ...OK, exitCode: 1 } : OK)
      await ui.press('share-image')
      states.push(['failed', ui.tree()])
      await fake.host.state.stats.update(stats =>
        stats?.share ? { ...stats, share: { ...stats.share, busy: 'post', svg: null } } : stats,
      )
      states.push(['busy, the picture being made', ui.tree()])

      for (const [name, drawn] of states) {
        tree = plain({ type: 'Box', props: { flexDirection: 'column' }, children: [drawn] })
        const mounted = await $.ui.mount({ ...PANE, surface }).catch((error: unknown) => {
          throw new Error(`${surface}, ${name}: ${String(error)}`)
        })
        expect(await mounted.find({ type: 'Text', text: '卡片和分享文字用这种语言。默认用目标语言，看到分享的朋友多半更熟悉它。' })).toBeDefined()
        await mounted.unmount()
      }
    }
  })
})
