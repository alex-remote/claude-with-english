import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { segment } from '../../hooks/core/text/segment'
import { start, world } from '../support/engine'

// F6 through the mod's hooks: reply blocks appended, the turn's end, the
// translations under each paragraph, the reading settings, the cache.

const REPLY_1 = 'Let me check how the config is loaded.'
const REPLY_2 =
  "I found the cause. The config loader reads `PORT` before `.env` is loaded, so it gets `undefined`.\n\nI'd move the `dotenv` call to the top of `server.ts`. Want me to do that?"

const append = ($: Engine, text: string, uuid: string) =>
  $.session.append({
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
    door: 'response',
    origin: { kind: 'model', model: 'claude-test' },
    uuid,
  })

const turnEnd = ($: Engine) =>
  $.turn.complete({ turnId: 't1', answer: '', durationMs: 1000, isAborted: false, reason: 'answer' })

const message = (text: string) =>
  ({
    plugin: 'work-with-english',
    component: 'AssistantMessage',
    requestId: 'msg-1',
    viewport: { columns: 110, rows: 40, isFullscreen: true },
    props: { text, isFirstOfReply: true },
  }) as const

// Each test loads the whole mod; on a busy machine that alone takes seconds
const LOADS_THE_MOD = { timeoutMs: 60_000 }

describe('reply', () => {
  test('全部: each reply is translated as soon as it is written, each paragraph under itself', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('session.append', ($, e, next) => next(e))
    on('turn.complete', () => ({ text: '' }))
    on('ui.render', ($, e) => ({ type: 'Text', props: {}, children: [String((e.props as { text?: string }).text ?? '')] }))
    await start($, w)

    // Written, then asked at once, while the turn goes on
    w.replies.push(JSON.stringify(['我来看看配置是怎么加载的。']))
    await append($, REPLY_1, 'u1')
    await w.clock.settle()
    expect(w.asked.length).toBe(1)
    w.replies.push(
      JSON.stringify([
        '我找到原因了。配置加载器在 ⟦1⟧ 加载之前就读取了 ⟦0⟧，所以拿到的是 ⟦2⟧。',
        '我建议把 ⟦0⟧ 调用移到 ⟦1⟧ 顶部。要我改吗？',
      ]),
    )
    await append($, REPLY_2, 'u2')
    await w.clock.settle()
    expect(w.asked.length).toBe(2)
    // The turn's end asks for nothing twice
    await turnEnd($)
    await w.clock.settle()
    expect(w.asked.length).toBe(2)
    // Code went as placeholders and came back unchanged
    expect(w.asked[1]?.prompt).toContain('⟦0⟧')
    const terminal = await $.ui.mount({ ...message(REPLY_2), surface: 'terminal' })
    expect(
      await terminal.find({ type: 'Markdown', text: '我找到原因了。配置加载器在 `.env` 加载之前就读取了 `PORT`，所以拿到的是 `undefined`。' }),
    ).toBeDefined()
    expect(await terminal.find({ type: 'Markdown', text: '我建议把 `dotenv` 调用移到 `server.ts` 顶部。要我改吗？' })).toBeDefined()
    await terminal.unmount()
    // The desktop draws the block once, each translation quoted after its paragraph
    const desktop = await $.ui.mount({ ...message(REPLY_2), surface: 'desktop' })
    const [first, second] = REPLY_2.split('\n\n')
    expect(
      await desktop.find({
        type: 'Text',
        text: `${first}\n\n> 我找到原因了。配置加载器在 \`.env\` 加载之前就读取了 \`PORT\`，所以拿到的是 \`undefined\`。\n\n${second}\n\n> 我建议把 \`dotenv\` 调用移到 \`server.ts\` 顶部。要我改吗？`,
      }),
    ).toBeDefined()
    await desktop.unmount()
    // Kept on disk for /resume
    expect([...w.files.keys()].filter(path => path.includes('/replies/')).length).toBe(3)
    // F13: the English words of the replies
    const stats = [...w.files.entries()].find(([path]) => path.includes('/stats/'))?.[1]
    expect(JSON.parse(stats ?? '{}').words).toBeGreaterThan(20)
  })

  test('每轮最后 1 条 translates only the last reply; the others wait for 翻译', LOADS_THE_MOD, async ($, on) => {
    const w = world(on, { store: { 'settings/autoReply': 'last', 'settings/autoReplyCount': 1 } })
    on('session.append', ($, e, next) => next(e))
    on('turn.complete', () => ({ text: '' }))
    on('ui.render', ($, e) => ({ type: 'Text', props: {}, children: [String((e.props as { text?: string }).text ?? '')] }))
    w.replies.push(JSON.stringify(['一', '二']), '我来看看配置是怎么加载的。')
    await start($, w)

    await append($, REPLY_1, 'u1')
    await append($, REPLY_2, 'u2')
    await turnEnd($)
    await w.clock.settle()
    expect(w.asked.length).toBe(1)

    const ui = await $.ui.mount({ ...message(REPLY_1), surface: 'terminal' })
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    await ui.press({ key: 'toggle-0' })
    expect(await ui.find({ type: 'Markdown', text: '我来看看配置是怎么加载的。' })).toBeDefined()
    // 收起译文 hides it without asking again
    await ui.press({ key: 'toggle-0' })
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    await ui.press({ key: 'toggle-0' })
    expect(w.asked.length).toBe(2)
  })

  test('the desktop: one drawing of the block; its 翻译 asks for every paragraph, 收起译文 hides them all', LOADS_THE_MOD, async ($, on) => {
    const w = world(on, { store: { 'settings/autoReply': 'off' } })
    const drawings: string[] = []
    on('ui.render', ($, e) => {
      const text = String((e.props as { text?: string }).text ?? '')
      drawings.push(text)
      return { type: 'Text', props: {}, children: [text] }
    })
    w.replies.push('我找到原因了。', '我建议把调用移到顶部。')
    await start($, w, 'desktop')

    const ui = await $.ui.mount({ ...message(REPLY_2), surface: 'desktop' })
    expect(drawings).toEqual([REPLY_2])
    await ui.press({ key: 'toggle-all' })
    await w.clock.settle()
    expect(w.asked.length).toBe(2)
    expect(await ui.find({ type: 'Text', text: /> 我找到原因了。[\s\S]*> 我建议把调用移到顶部。$/ })).toBeDefined()
    expect(await ui.find({ key: 'toggle-all' })).toMatchObject({ props: { label: '收起译文' } })

    await ui.press({ key: 'toggle-all' })
    await w.clock.settle()
    expect(await ui.find({ type: 'Text', text: REPLY_2 })).toBeDefined()
    expect(w.asked.length).toBe(2)
  })

  test('划选模式 and 关闭 translate nothing on their own', LOADS_THE_MOD, async ($, on) => {
    const w = world(on, { store: { 'settings/readingMode': 'select' } })
    on('session.append', ($, e, next) => next(e))
    on('turn.complete', () => ({ text: '' }))
    await start($, w)
    await append($, REPLY_2, 'u2')
    await turnEnd($)
    await w.clock.settle()
    expect(w.asked.length).toBe(0)
  })

  test('a failure shows 译文暂不可用 under the paragraph', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('session.append', ($, e, next) => next(e))
    on('turn.complete', () => ({ text: '' }))
    on('ui.render', ($, e) => ({ type: 'Text', props: {}, children: [String((e.props as { text?: string }).text ?? '')] }))
    await start($, w)
    await append($, REPLY_1, 'u1')
    await turnEnd($)
    await w.clock.settle()
    const ui = await $.ui.mount({ ...message(REPLY_1), surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: /^译文暂不可用：/ })).toBeDefined()
  })

  test('a paragraph kept on disk shows again after /resume, without asking', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('ui.render', ($, e) => ({ type: 'Text', props: {}, children: [String((e.props as { text?: string }).text ?? '')] }))
    const block = segment(REPLY_1)[0]
    if (!block) {
      throw new Error('no block')
    }
    w.files.set(
      `/Users/test/.claude/plugins/data/work-with-english-inline/replies/${block.hash.slice(0, 2)}/${block.hash}.json`,
      JSON.stringify({ v: 1, zh: '我来看看配置是怎么加载的。' }),
    )
    await start($, w)
    const ui = await $.ui.mount({ ...message(REPLY_1), surface: 'terminal' })
    await w.clock.advance(400)
    expect(await ui.find({ type: 'Markdown', text: '我来看看配置是怎么加载的。' })).toBeDefined()
    expect(w.asked.length).toBe(0)
  })

  test('an approved plan translated before /resume shows its translation again under it, without asking', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['Plan'] }))
    on('classic.SessionStart', () => ({}))
    const plan = '## Plan\n\nMove the `dotenv` call to the top of `server.ts`.\n\n1. Read the config.\n2. Add a test.'
    const kept = ['## 计划', '把 `dotenv` 调用移到 `server.ts` 顶部。', '1. 读取配置。\n2. 加一个测试。']
    for (const [i, block] of segment(plan).entries()) {
      w.files.set(
        `/Users/test/.claude/plugins/data/work-with-english-inline/replies/${block.hash.slice(0, 2)}/${block.hash}.json`,
        JSON.stringify({ v: 1, zh: kept[i] }),
      )
    }
    await start($, w)
    // /resume: $.state is back to its defaults (P13); Claude Code draws the result again from the transcript
    await $.classic.SessionStart({ source: 'resume' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'work-with-english',
        component: 'ToolResult',
        requestId: `toolu-${surface}`,
        surface,
        viewport: { columns: 110, rows: 40, isFullscreen: true },
        props: {
          tool_use_id: `toolu-${surface}`,
          tool: 'ExitPlanMode',
          output: { plan, isAgent: false },
          isErrored: false,
        },
      })
      await w.clock.advance(400)
      for (const zh of kept) {
        expect(await ui.find({ type: 'Markdown', text: zh })).toBeDefined()
      }
      await ui.unmount()
    }
    expect(w.asked.length).toBe(0)
  })
})
