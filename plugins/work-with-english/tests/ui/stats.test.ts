import { describe, expect, test } from 'claude-code/testing'
import type { Elements, Register } from 'claude-code'

import { SVG_MAX_LENGTH } from '../../hooks/core/share/card'
import { DEFAULT_VIEW, storeKeyOf } from '../../hooks/core/settings/schema'
import { INITIAL_PANE } from '../../hooks/core/state/defaults'
import { createStatsPage } from '../../hooks/features/stats/controller'
import type { StatsPage } from '../../hooks/features/stats/controller'
import { statsSlot } from '../../hooks/features/stats/view'
import type { Host } from '../../hooks/host'
import type { WwePane, WweSettingsView, WweStats } from '../../types'

// The 统计 page's figures (F13), in two layers as tests/ui/settings.test.ts
// draws the settings: the view called with element tables that build plain
// data (one with Raster for the terminal, one with Svg for the desktop) and
// pressed by key, against a Host whose files, store and state live in
// memory; then the trees drawn again by an inline mod through
// `$.ui.resolve(e)`, so the engine checks them on both surfaces.

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

/** Element tables that build the tree as plain data, as each surface's own table is shaped */
const UI = {
  terminal: tableOf(['Raster', 'Image']) as unknown as Elements['terminal'],
  desktop: tableOf(['Svg']) as unknown as Elements['desktop'],
}

type Surface = keyof typeof UI

const DATA = '/Users/t/.claude/plugins/data/work-with-english-inline'

/** Noon UTC on Friday 2026-10-09: the same date on this machine's calendar wherever it runs */
const NOW = Date.UTC(2026, 9, 9, 12)

const row = (used = 0, retyped = 0, direct = 0, more: Record<string, number> = {}) => ({
  used,
  retyped,
  direct,
  words: 0,
  newWords: 0,
  newSents: 0,
  ...more,
})

/**
 * The frame's days (tests/unit/stats.test.ts), as session files: this week
 * 25 messages at 76%, 8 points above last week; 2,673 words; 1 word and 1
 * sentence; 18 days in a row.
 */
const FRAME: Record<string, ReturnType<typeof row>> = {
  '2026-07-20': row(8, 2, 1),
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

/** The frame's days as files: one session a day, and today in two sessions' files */
function frameFiles(): Map<string, string> {
  const files = new Map<string, string>()
  for (const [date, counts] of Object.entries(FRAME)) {
    files.set(`${DATA}/stats/${date}/s1.json`, JSON.stringify(counts))
  }
  files.set(`${DATA}/stats/2026-10-09/s1.json`, JSON.stringify(row(1, 1, 1, { words: 300 })))
  files.set(`${DATA}/stats/2026-10-09/night.json`, JSON.stringify(row(0, 0, 2, { words: 200 })))
  return files
}

const OK = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

/** A Host with what the 统计 page uses: files, a store, a clock, three state values */
function fakeHost(files: Map<string, string> = frameFiles(), options: { failList?: boolean } = {}) {
  const store = new Map<string, unknown>()
  const toasts: string[] = []
  const runs: string[][] = []
  const state: { pane: WwePane; settings: WweSettingsView; stats: WweStats | null } = {
    pane: { ...INITIAL_PANE, tab: 'stats' },
    settings: DEFAULT_VIEW,
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
    clock: { now: async () => NOW, after: () => ({ cancel: () => undefined }) },
    env: { home: async () => '/Users/t', configDir: async () => undefined, pluginCacheDir: async () => undefined },
    plugin: { name: 'work-with-english', root: '/plugins/work-with-english' },
    fs: {
      read: async (path: string) => {
        const text = files.get(path)
        if (text === undefined) {
          throw new Error(`ENOENT ${path}`)
        }
        return text
      },
      readBytes: async () => ({ base64: 'iVBORw0KGgo=' }),
      write: async (path: string, text: string) => {
        files.set(path, text)
      },
      list: async (dir: string) => {
        if (options.failList) {
          throw new Error('EACCES')
        }
        const names = new Map<string, 'file' | 'dir'>()
        for (const path of files.keys()) {
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
      copy: async () => ({ isCopied: true }),
    },
    proc: {
      run: async (argv: string[]) => {
        runs.push(argv)
        return OK
      },
    },
    state: { settings: cell('settings'), pane: cell('pane'), stats: cell('stats') },
  } as unknown as Host
  return { host, files, store, toasts, runs, state }
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

/** The slot drawn from what the Host holds now, acted on by key as a surface would */
function drawing(page: StatsPage, fake: Fake, surface: Surface = 'terminal') {
  const tree = () =>
    statsSlot(
      UI[surface],
      { stats: fake.state.stats, range: fake.state.pane.statsRange },
      { setRange: range => page.setRange(range), openShare: () => page.openShare() },
    ) as unknown as Node
  const matches = (query: Query) => (node: Node) =>
    (query.key === undefined || node.props.key === query.key) &&
    (query.type === undefined || node.type === query.type) &&
    (query.text === undefined || textOf(node) === query.text)
  const find = (query: Query) => every(tree()).find(matches(query))
  return {
    tree,
    find,
    findAll: (query: Query) => every(tree()).filter(matches(query)),
    texts: () =>
      every(tree())
        .filter(node => node.type === 'Text')
        .map(textOf),
    press: async (key: string) => {
      const button = find({ key, type: 'Button' })
      if (!button) {
        throw new Error(`no Button keyed ${key}`)
      }
      await (button.props.onPress as (e: unknown) => unknown)({ surface })
    },
  }
}

/** The page as the 统计 tab opens it: the files read */
async function opened(files?: Map<string, string>, surface: Surface = 'terminal') {
  const fake = fakeHost(files)
  const page = createStatsPage(fake.host)
  await page.load()
  return { fake, page, ui: drawing(page, fake, surface) }
}

describe('统计页', () => {
  test('打开时读统计文件：今天以前的会话文件并进 day.json，今天的几个会话文件加在一起', SLOW, async () => {
    const { fake } = await opened()
    expect(fake.state.stats).toMatchObject({ status: 'done', today: '2026-10-09', error: null, share: null })
    expect(fake.state.stats?.days['2026-10-09']).toMatchObject({ used: 1, retyped: 1, direct: 3, words: 500 })
    // The days before today merged, today left to its session files
    expect(JSON.parse(fake.files.get(`${DATA}/stats/2026-10-08/day.json`) ?? '{}')).toMatchObject({ merged: ['s1'] })
    expect(fake.files.has(`${DATA}/stats/2026-10-09/day.json`)).toBe(false)
    expect(fake.toasts).toEqual([])
  })

  test('本周：功能地图的那一屏', SLOW, async () => {
    const { ui } = await opened()
    const texts = ui.texts()
    for (const text of [
      '10月5日至今天',
      '英文消息',
      '25 条',
      '76%',
      '比上周高 8 个百分点',
      '用译文 24%',
      '照着敲 36%',
      '直接写 40%',
      '2,673 词',
      '1 个词 1 个句子',
      '18 天',
      '自己写的比例（最近 12 周）',
      '7月20日那周 27%',
      '本周 76%',
      '每天的英文消息（最近 12 周）',
      '统计只存在本机，只记数字，不记消息内容。',
    ]) {
      expect(texts).toContain(text)
    }
    expect(ui.find({ key: 'range-week' })?.props.dimColor).toBe(false)
    expect(ui.find({ key: 'range-lastWeek' })?.props.dimColor).toBe(true)
    expect(ui.find({ key: 'share-open', type: 'Button' })?.props.label).toBe('生成分享卡')
  })

  test('上周：和前一周比，连续使用截至上周日；切换不保存，不弹 Toast', SLOW, async () => {
    const { fake, ui } = await opened()
    await ui.press('range-lastWeek')
    expect(fake.state.pane.statsRange).toBe('lastWeek')
    const texts = ui.texts()
    expect(texts).toContain('9月28日至10月4日')
    expect(texts).toContain('25 条')
    expect(texts).toContain('68%')
    expect(texts).toContain('比前一周高 68 个百分点')
    expect(texts).toContain('13 天（截至上周日）')
    expect(ui.find({ key: 'range-lastWeek' })?.props.dimColor).toBe(false)
    expect(ui.find({ key: 'share-open', type: 'Button' })).toBeDefined()
    expect(fake.store.size).toBe(0)
    expect(fake.toasts).toEqual([])
  })

  test('全部：从第一天算起，不比较，没有“生成分享卡”', SLOW, async () => {
    const { ui } = await opened()
    await ui.press('range-all')
    const texts = ui.texts()
    expect(texts).toContain('7月20日至今天')
    expect(texts).toContain('67 条')
    expect(texts.some(text => text.includes('百分点') || text.includes('一样'))).toBe(false)
    expect(ui.find({ key: 'share-open' })).toBeUndefined()
    expect(texts).not.toContain('生成分享卡')
    // The charts stay on every range
    expect(texts).toContain('自己写的比例（最近 12 周）')
  })

  test('一条英文消息都没发过：只写还没有数据，不显示图；按钮不能点，旁边写原因', SLOW, async () => {
    const files = new Map([[`${DATA}/stats/2026-10-09/s1.json`, JSON.stringify(row(0, 0, 0, { words: 120 }))]])
    const { ui } = await opened(files)
    const texts = ui.texts()
    expect(texts).toContain('还没有数据。发出第一条英文消息后开始统计。')
    expect(texts).not.toContain('自己写的比例（最近 12 周）')
    expect(ui.findAll({ type: 'Raster' })).toEqual([])
    expect(ui.find({ key: 'share-open' })).toBeUndefined()
    expect(ui.find({ type: 'Text', text: '生成分享卡' })?.props.dimColor).toBe(true)
    expect(texts).toContain('最近 7 天没有发出英文消息。')
  })

  test('所选的这段时间没发过：写这段时间没有，图照常显示', SLOW, async () => {
    const files = new Map([[`${DATA}/stats/2026-09-21/s1.json`, JSON.stringify(row(1, 0, 1))]])
    const { ui } = await opened(files)
    const texts = ui.texts()
    expect(texts).toContain('这段时间没有发出英文消息。')
    expect(texts).not.toContain('25 条')
    expect(texts).toContain('每天的英文消息（最近 12 周）')
    expect(ui.find({ key: 'share-open' })).toBeUndefined()
    expect(texts).toContain('最近 7 天没有发出英文消息。')
  })

  test('最近 7 天有消息、本周没有（周一）：本周写这段时间没有，按钮照样能点', SLOW, async () => {
    const fake = fakeHost(new Map([[`${DATA}/stats/2026-10-04/s1.json`, JSON.stringify(row(0, 1, 1))]]))
    const page = createStatsPage(fake.host)
    ;(fake.host.clock as { now: () => Promise<number> }).now = async () => Date.UTC(2026, 9, 5, 12)
    await page.load()
    const ui = drawing(page, fake)
    expect(ui.texts()).toContain('这段时间没有发出英文消息。')
    expect(ui.find({ key: 'share-open', type: 'Button' })).toBeDefined()
  })

  test('隐私说明默认画在最后；设置页要把它放到每周提醒下面时可以不画', SLOW, async () => {
    const { fake, page, ui } = await opened()
    expect(ui.texts().at(-1)).toBe('统计只存在本机，只记数字，不记消息内容。')
    const without = statsSlot(UI.terminal, { stats: fake.state.stats, range: 'week', privacy: false }, {
      setRange: range => page.setRange(range),
      openShare: () => page.openShare(),
    }) as unknown as Node
    expect(every(without).some(node => textOf(node) === '统计只存在本机，只记数字，不记消息内容。')).toBe(false)
  })

  test('读取中和读取失败', SLOW, async () => {
    const fake = fakeHost(new Map(), { failList: true })
    const page = createStatsPage(fake.host)
    const ui = drawing(page, fake)
    expect(ui.texts()).toContain('正在读取统计…')
    expect(ui.find({ key: 'range-week' })).toBeDefined()
    // Listing fails quietly: a folder that can't be listed reads as no days
    await page.load()
    expect(ui.texts()).toContain('还没有数据。发出第一条英文消息后开始统计。')

    const broken = fakeHost()
    ;(broken.host.env as { home: () => Promise<string | undefined> }).home = async () => undefined
    const failing = createStatsPage(broken.host)
    await failing.load()
    expect(broken.state.stats).toMatchObject({ status: 'failed', error: '读取统计失败：无法读取本机的统计文件' })
    expect(drawing(failing, broken).find({ type: 'Text', text: '读取统计失败：无法读取本机的统计文件' })?.props.color).toBe('red')
  })

  test('终端：两张图和比例条画成 Raster', SLOW, async () => {
    const { ui } = await opened()
    const rasters = ui.findAll({ type: 'Raster' })
    expect(rasters.map(raster => raster.props.key)).toEqual(['stats-ways', 'stats-trend', 'stats-heat', 'stats-heat-key'])
    expect(ui.find({ key: 'stats-heat' })?.props).toMatchObject({ columns: 35, rows: 7 })
    expect(ui.find({ key: 'stats-trend' })?.props).toMatchObject({ columns: 35, rows: 4 })
    expect(ui.findAll({ type: 'Svg' })).toEqual([])
  })

  test('桌面端：两张图和比例条是 Svg，带 <title> 和深色，不超过类型里的上限', SLOW, async () => {
    const { ui } = await opened(undefined, 'desktop')
    const svgs = ui.findAll({ type: 'Svg' })
    expect(svgs.map(svg => svg.props.alt)).toEqual([
      '用译文 24%，照着敲 36%，直接写 40%',
      '最近 12 周每周自己写的比例',
      '最近 12 周每天发出的英文消息',
    ])
    for (const svg of svgs) {
      const source = String(svg.props.source)
      expect(source.length).toBeLessThanOrEqual(SVG_MAX_LENGTH)
      expect(source).toContain('<title>')
      expect(source).toContain('@media (prefers-color-scheme: dark)')
    }
    // Hover titles need the interactive frame
    expect(svgs.slice(1).every(svg => svg.props.isInteractive === true)).toBe(true)
    expect(ui.findAll({ type: 'Raster' })).toEqual([])
    expect(ui.texts()).toContain('比上周高 8 个百分点')
  })

  test('生成分享卡：Pane 换成分享卡，卡片是最近 7 天', SLOW, async () => {
    const { fake, ui } = await opened()
    await ui.press('range-lastWeek')
    await ui.press('share-open')
    expect(fake.state.pane).toMatchObject({ view: 'share', tab: 'stats', statsRange: 'lastWeek' })
    expect(fake.state.stats?.share).toMatchObject({
      card: { from: '2026-10-03', to: '2026-10-09', sent: 32, ownPct: 75, delta: 15, streak: 18 },
      lang: 'en',
      busy: null,
      error: null,
    })
    expect(fake.state.stats?.share?.svg).toContain('How to Vibe Code')
    expect(fake.toasts).toEqual([])
  })

  test('最近 7 天没有消息时，即使调到也不打开分享卡', SLOW, async () => {
    const files = new Map([[`${DATA}/stats/2026-09-21/s1.json`, JSON.stringify(row(1, 0, 1))]])
    const { fake, page } = await opened(files)
    await page.openShare()
    expect(fake.state.pane.view).toBe('settings')
    expect(fake.state.stats?.share).toBeNull()
  })

  test('再次读取时旧数字留着，读完再换；先发起的读取晚到不覆盖', SLOW, async () => {
    const { fake, page } = await opened()
    fake.files.set(`${DATA}/stats/2026-10-09/s2.json`, JSON.stringify(row(0, 0, 4)))
    const first = page.load()
    expect(fake.state.stats?.status).toBe('done')
    await Promise.all([first, page.load()])
    expect(fake.state.stats?.days['2026-10-09']).toMatchObject({ direct: 7 })
    expect(fake.store.has(storeKeyOf('weeklyReminder'))).toBe(false)
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
    title: 'work-with-english 设置',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 36 },
    view: {},
  },
} as const

const plain = (tree: Node) => JSON.parse(JSON.stringify(tree)) as unknown

describe('统计页在两种 surface 上', () => {
  test('三个范围、空状态和读取中，终端和桌面端都能画', { plugins: [harness], timeoutMs: 240_000 }, async ($, on) => {
    let tree: unknown = null
    on('store.get', ($, e) => ({ value: e.key === TREE_KEY ? tree : undefined }))
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))

    for (const surface of ['terminal', 'desktop'] as const) {
      const states: [string, Node][] = []
      const { ui } = await opened(undefined, surface)
      for (const range of ['week', 'lastWeek', 'all']) {
        await ui.press(`range-${range}`)
        states.push([range, ui.tree()])
      }
      const none = await opened(new Map(), surface)
      states.push(['no data', none.ui.tree()])
      const quiet = await opened(new Map([[`${DATA}/stats/2026-09-21/s1.json`, JSON.stringify(row(1, 0, 1))]]), surface)
      states.push(['nothing this week', quiet.ui.tree()])
      const loading = fakeHost()
      states.push(['loading', drawing(createStatsPage(loading.host), loading, surface).tree()])

      for (const [name, drawn] of states) {
        tree = plain({ type: 'Box', props: { flexDirection: 'column' }, children: [drawn] })
        const mounted = await $.ui.mount({ ...PANE, surface }).catch((error: unknown) => {
          throw new Error(`${surface}, ${name}: ${String(error)}`)
        })
        expect(await mounted.find({ type: 'Text', text: '统计只存在本机，只记数字，不记消息内容。' })).toBeDefined()
        await mounted.unmount()
      }
    }
  })
})
