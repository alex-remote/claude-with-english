import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { start, world } from '../support/engine'

// F1 to F4 through the mod's own hooks: an edit of the Prompt, the pause,
// the translation coming back, Control+A, the band's buttons and Enter.

const BAND = {
  plugin: 'work-with-english',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 110, rows: 40, isFullscreen: true },
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 105, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

// The test kit's $ has prompt.edit at run time, not in its types (docs/references › 测试)
type Edit = (e: {
  origin: { kind: 'composer' }
  key?: { key: string; ctrl?: true }
  text: string
  cursor: number
  start: number
  end: number
  inputText: string
}) => Promise<{ text: string; cursor: number }>
const editOf = ($: Engine) => ($.prompt as unknown as { edit: Edit }).edit

/** Types `text` into an empty Prompt as one edit */
const type = ($: Engine, before: string, text: string) =>
  editOf($)({ origin: { kind: 'composer' }, text: before, cursor: before.length, start: before.length, end: before.length, inputText: text })

const ctrlA = ($: Engine, text: string) =>
  editOf($)({ origin: { kind: 'composer' }, key: { key: 'a', ctrl: true }, text, cursor: text.length, start: 0, end: 0, inputText: '' })

const enter = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

// Each test loads the whole mod; on a busy machine that alone takes seconds
const LOADS_THE_MOD = { timeoutMs: 60_000 }

describe('band', () => {
  test('a pause translates the Chinese typed, and the band shows it with the day tip', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('prompt.edit', ($, e) => ({ text: e.text + e.inputText, cursor: (e.text + e.inputText).length }))
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push("Can you help me figure out what's causing this error?")
    await start($, w)

    await type($, '', '帮我看看这个报错是怎么回事')
    await w.clock.advance(700)
    await w.clock.settle()

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ type: 'Text', text: "Can you help me figure out what's causing this error?" })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '帮我看看这个报错是怎么回事' })).toBeDefined()
      expect(await ui.find({ key: 'replace' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^小技巧/ })).toBeDefined()
      await ui.unmount()
    }
    // The draft went masked, inside <source>
    expect(w.asked[0]?.prompt).toContain('<source>')
  })

  test('Control+A replaces with the translation, a second Control+A empties the Prompt', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('prompt.edit', ($, e) => ({ text: e.text + e.inputText, cursor: (e.text + e.inputText).length }))
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push('Please run the tests.')
    await start($, w)

    await type($, '', '请运行测试')
    await w.clock.advance(700)
    await w.clock.settle()

    const first = await ctrlA($, '请运行测试')
    expect(first).toEqual({ text: 'Please run the tests.', cursor: 21 })
    const second = await ctrlA($, 'Please run the tests.')
    expect(second).toEqual({ text: '', cursor: 0 })
  })

  test('Control+A before the band caught up holds the key, then puts the translation in', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('prompt.edit', ($, e) => ({ text: e.text + e.inputText, cursor: (e.text + e.inputText).length }))
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push('Fix the build.')
    await start($, w)

    await type($, '', '修复构建')
    w.prompt = { text: '修复构建', cursor: 4 }
    const held = await ctrlA($, '修复构建')
    expect(held).toEqual({ text: '修复构建', cursor: 4 })
    await w.clock.settle()
    expect(w.filled).toEqual(['Fix the build.'])
  })

  test('strict mode holds back Enter on a Han character, once the band was drawn', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('prompt.edit', ($, e) => ({ text: e.text + e.inputText, cursor: (e.text + e.inputText).length }))
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push('Please check the config.')
    await start($, w)
    // Drawn once: the hint can show
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    w.prompt = { text: 'Please check the config 吧', cursor: 26 }
    const held = await enter($, 'Please check the config 吧')
    expect(held.drop).toBe('您输入了简体中文，严格模式下仅接受英语。')
    await w.clock.settle()
    expect(await ui.find({ type: 'Text', text: '您输入了简体中文，严格模式下仅接受英语。' })).toBeDefined()
    expect(await ui.find({ key: 'send-anyway' })).toBeDefined()

    // English goes through; the band showed a translation, so it was typed along (F13 › 照着敲)
    const sent = await enter($, 'Please check the config.')
    expect(sent.drop).toBeUndefined()
    await w.clock.settle()
    const statsOf = () => [...w.files.entries()].find(([path]) => path.includes('/stats/'))?.[1]
    expect(JSON.parse(statsOf() ?? '{}')).toMatchObject({ retyped: 1, direct: 0 })

    // The next message, English from the start, is written directly
    expect((await enter($, 'Now run the tests.')).drop).toBeUndefined()
    await w.clock.settle()
    expect(JSON.parse(statsOf() ?? '{}')).toMatchObject({ retyped: 1, direct: 1 })
  })

  test('strict mode off, or a message from elsewhere, goes through untouched', LOADS_THE_MOD, async ($, on) => {
    const w = world(on, { store: { 'settings/strict': false } })
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    await start($, w)
    await $.ui.mount({ ...BAND, surface: 'terminal' })

    expect((await enter($, '帮我看看')).drop).toBeUndefined()
    const fromTask = await $.prompt.submit({ text: '任务完成', wait: false, origin: { kind: 'task-notification' } })
    expect(fromTask.drop).toBeUndefined()
  })

  test('仍然发送 lets the next Enter through when the Prompt kept the text', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push('Look at this.')
    await start($, w)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    w.prompt = { text: '看看这个', cursor: 4 }
    expect((await enter($, '看看这个')).drop).toBeDefined()
    await w.clock.settle()
    await ui.press({ key: 'send-anyway' })
    expect(await ui.find({ type: 'Text', text: '已放行这一条，按回车发送。' })).toBeDefined()
    expect((await enter($, '看看这个')).drop).toBeUndefined()
  })

  test('F15: direct English is corrected at a pause, the changed word marked, and Control+A puts it in', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('prompt.edit', ($, e) => ({ text: e.text + e.inputText, cursor: (e.text + e.inputText).length }))
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push(JSON.stringify({ corrected: 'I fixed the bug yesterday.', zh: '我昨天已经修好了这个 bug。', ok: false }))
    await start($, w)

    await type($, '', 'I have fixed the bug yesterday.')
    await w.clock.advance(700)
    await w.clock.settle()

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ type: 'Text', text: 'fixed' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '我昨天已经修好了这个 bug。' })).toBeDefined()
      expect(await ui.find({ key: 'replace' })).toBeDefined()
      // No tip under a correction
      expect(await ui.find({ type: 'Text', text: /^小技巧/ })).toBeUndefined()
      await ui.unmount()
    }
    expect(await ctrlA($, 'I have fixed the bug yesterday.')).toEqual({ text: 'I fixed the bug yesterday.', cursor: 26 })
  })

  test("F15: nothing to fix shows ✓, no 替换为纠错, and Control+A stays the editor's own", LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('prompt.edit', ($, e) => (e.key ? { text: e.text, cursor: 0 } : { text: e.text + e.inputText, cursor: (e.text + e.inputText).length }))
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push(JSON.stringify({ corrected: 'Run the tests.', zh: '运行测试。', ok: true }))
    await start($, w)

    await type($, '', 'Run the tests.')
    await w.clock.advance(700)
    await w.clock.settle()

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ key: 'replace' })).toBeUndefined()
    expect(await ui.find({ key: 'clear' })).toBeDefined()
    // Passed on: the caret goes to the start, as Claude Code does it
    expect(await ctrlA($, 'Run the tests.')).toEqual({ text: 'Run the tests.', cursor: 0 })
  })

  test('F4 + F15: English with Chinese in it, held back, turns into the corrected sentence', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('prompt.edit', ($, e) => ({ text: e.text + e.inputText, cursor: (e.text + e.inputText).length }))
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push(JSON.stringify({ corrected: 'Run the tests and then deploy.', zh: '运行测试然后部署。', ok: false }))
    await start($, w)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    await type($, '', 'Run the tests 然后 deploy')
    w.prompt = { text: 'Run the tests 然后 deploy', cursor: 23 }
    expect((await enter($, 'Run the tests 然后 deploy')).drop).toBeDefined()
    await w.clock.settle()
    expect(await ui.find({ type: 'Text', text: 'and then' })).toBeDefined()
    expect(w.asked.at(-1)?.system).toContain('correct')
  })
})
