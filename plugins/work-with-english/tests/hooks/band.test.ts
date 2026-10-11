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

/** An edit of `text` that puts `inputText` over `start` to `end`, `key` pressed for it when given */
const edit = ($: Engine, text: string, start: number, end: number, inputText: string, key?: { key: string; ctrl?: true }) =>
  editOf($)({ origin: { kind: 'composer' }, ...(key ? { key } : {}), text, cursor: end, start, end, inputText })

/** Control+U: the whole line deleted */
const killLine = ($: Engine, text: string) => edit($, text, 0, text.length, '', { key: 'u', ctrl: true })

/** Claude Code's own editing beneath the mod: the splice, the caret after it (Control+A: to the start) */
const editor = (on: Parameters<typeof world>[0]) =>
  on('prompt.edit', ($, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length }
  })

/** This session's F13 counts for today, as the stats file holds them */
const countsOf = (w: ReturnType<typeof world>) => {
  const file = [...w.files.entries()].find(([path]) => path.includes('/stats/'))?.[1]
  return file === undefined ? undefined : (JSON.parse(file) as Record<string, number>)
}

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

    // Enter with no edit before it (a message ↑ brought back): the band translates what was sent
    w.prompt = { text: '帮我检查一下配置', cursor: 8 }
    const held = await enter($, '帮我检查一下配置')
    expect(held.drop).toBe('您输入了简体中文，严格模式下仅接受英语。')
    await w.clock.settle()
    expect(await ui.find({ type: 'Text', text: '您输入了简体中文，严格模式下仅接受英语。' })).toBeDefined()
    expect(await ui.find({ key: 'send-anyway' })).toBeDefined()
    expect(w.asked[0]?.prompt).toContain('帮我检查一下配置')

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

  // F4: Enter held back again on a text no edit brought in (↑, Control+_ and Ctrl+R raise none, P09)

  test('F4: Enter on the text ↑ brought back to an emptied Prompt keeps the band on that text', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push('Take a look at this.')
    await start($, w)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    await type($, '', '看看这个')
    await w.clock.advance(700)
    // Held back, and the Prompt comes back empty (the desktop, the terminal before 2.1.295)
    w.prompt = { text: '', cursor: 0 }
    expect((await enter($, '看看这个')).drop).toBeDefined()
    await w.clock.settle()
    // ↑ brings it back with no edit; Enter, held back and emptied again
    expect((await enter($, '看看这个')).drop).toBeDefined()
    await w.clock.settle()

    expect(w.asked).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: 'Take a look at this.' })).toBeDefined()
    expect(await ui.find({ key: 'replace', text: '替换为译文' })).toBeDefined()
  })

  test('F4 + F15: the same for English with Chinese in it: the correction stays', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push(JSON.stringify({ corrected: 'Run the tests and then deploy.', zh: '运行测试然后部署。', ok: false }))
    await start($, w)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    await type($, '', 'Run the tests 然后 deploy')
    w.prompt = { text: '', cursor: 0 }
    expect((await enter($, 'Run the tests 然后 deploy')).drop).toBeDefined()
    await w.clock.settle()
    expect((await enter($, 'Run the tests 然后 deploy')).drop).toBeDefined()
    await w.clock.settle()

    expect(w.asked).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: 'and then' })).toBeDefined()
    expect(await ui.find({ key: 'replace', text: '替换为纠错' })).toBeDefined()
  })

  test('F4: Enter after Control+_ took a replace back holds the Chinese, its translation kept', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push('Please run the tests.')
    await start($, w)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    await type($, '', '请运行测试')
    await w.clock.advance(700)
    expect(await ctrlA($, '请运行测试')).toEqual({ text: 'Please run the tests.', cursor: 21 })
    // Control+_ puts the Chinese back with no edit; the terminal keeps it at Enter (P11)
    w.prompt = { text: '请运行测试', cursor: 5 }
    expect((await enter($, '请运行测试')).drop).toBeDefined()
    await w.clock.settle()

    expect(w.asked).toHaveLength(1)
    expect(await ui.find({ key: 'replace', text: '替换为译文' })).toBeDefined()
  })

  test('F4: ↑ brings the text back to an emptied Prompt, and moving the caret keeps the hint', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push('Look at this.')
    await start($, w)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    await type($, '', '看看这个')
    await w.clock.advance(700)
    w.prompt = { text: '', cursor: 0 }
    expect((await enter($, '看看这个')).drop).toBeDefined()
    await w.clock.settle()
    expect(await ui.find({ type: 'Text', text: /按 ↑ 找回原文/ })).toBeDefined()

    // ↑: no edit. ←: an edit that changes no text
    w.prompt = { text: '看看这个', cursor: 4 }
    await edit($, '看看这个', 3, 3, '', { key: 'left' })
    expect(await ui.find({ type: 'Text', text: /严格模式下仅接受英语/ })).toBeDefined()
    expect(await ui.find({ key: 'send-anyway' })).toBeDefined()
  })

  // F4 › 仍然发送

  test('仍然发送 on an emptied Prompt while Claude works: the band empties at once, the prompt waits for the turn', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push('Look at this.', 'Check the logs again.')
    await start($, w)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    await type($, '', '看看这个')
    await w.clock.advance(700)
    w.prompt = { text: '', cursor: 0 }
    expect((await enter($, '看看这个')).drop).toBeDefined()
    await w.clock.settle()

    w.turnEndsAt = w.clock.now() + 30_000
    await ui.press({ key: 'send-anyway' })
    expect(w.submitted).toEqual([])
    // Nothing left to press a second time
    expect(await ui.find({ key: 'send-anyway' })).toBeUndefined()

    // The next message, written while the turn runs: its Chinese is held back as usual
    await type($, '', '再检查一下日志')
    w.prompt = { text: '再检查一下日志', cursor: 7 }
    await w.clock.advance(700)
    expect(await ui.find({ type: 'Text', text: 'Check the logs again.' })).toBeDefined()
    expect((await enter($, '再检查一下日志')).drop).toBeDefined()
    await w.clock.settle()

    // The turn ends: the prompt goes in, and the band stays on the message being written
    await w.clock.advance(30_000)
    expect(w.submitted).toEqual(['看看这个'])
    expect(await ui.find({ type: 'Text', text: 'Check the logs again.' })).toBeDefined()
    expect(await ui.find({ key: 'send-anyway' })).toBeDefined()
  })

  test('仍然发送 on an emptied Prompt also closes the selection line, and the day tip is spent', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    // F9: a word selected in a reply (whether its senses come is no matter here)
    on('ui.selection', () => ({ value: { text: 'cause' } }))
    await start($, w)
    await w.clock.advance(400)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ key: 'pick-close' })).toBeDefined()

    w.replies.push('Look at this.')
    await type($, '', '看看这个')
    await w.clock.advance(700)
    expect(await ui.find({ type: 'Text', text: /^小技巧/ })).toBeDefined()
    w.prompt = { text: '', cursor: 0 }
    expect((await enter($, '看看这个')).drop).toBeDefined()
    await w.clock.settle()
    await ui.press({ key: 'send-anyway' })
    await w.clock.settle()

    expect(w.submitted).toEqual(['看看这个'])
    expect(await ui.find({ key: 'pick-close' })).toBeUndefined()
    expect(w.store.get('flag/tipDate')).toBeDefined()
  })

  test('仍然发送, then a replace: the English sent is counted; then 清空输入框: the next Chinese is held back', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push('Look at this.', 'Take a look for me.', 'Check it.')
    await start($, w)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    // The terminal keeps the text (P11): 仍然发送 lets the next Enter through
    w.prompt = { text: '看看这个', cursor: 4 }
    expect((await enter($, '看看这个')).drop).toBeDefined()
    await w.clock.settle()
    await ui.press({ key: 'send-anyway' })
    // ... but the translation goes in instead and is sent: F13 counts it
    expect(await ctrlA($, '看看这个')).toEqual({ text: 'Look at this.', cursor: 13 })
    w.prompt = { text: 'Look at this.', cursor: 13 }
    expect((await enter($, 'Look at this.')).drop).toBeUndefined()
    await w.clock.settle()
    expect(countsOf(w)).toMatchObject({ used: 1 })

    // The same with 替换为译文
    w.prompt = { text: '帮我看看', cursor: 4 }
    expect((await enter($, '帮我看看')).drop).toBeDefined()
    await w.clock.settle()
    await ui.press({ key: 'send-anyway' })
    await ui.press({ key: 'replace' })
    expect((await enter($, 'Take a look for me.')).drop).toBeUndefined()
    await w.clock.settle()
    expect(countsOf(w)).toMatchObject({ used: 2 })

    w.prompt = { text: '检查一下', cursor: 4 }
    expect((await enter($, '检查一下')).drop).toBeDefined()
    await w.clock.settle()
    await ui.press({ key: 'send-anyway' })
    await ui.press({ key: 'clear' })
    // Written again with Chinese in it: held back, as no hint says it would go through
    await type($, '', '另一个中文')
    w.prompt = { text: '另一个中文', cursor: 5 }
    expect((await enter($, '另一个中文')).drop).toBeDefined()
  })

  // F1 to F3, F15: typing along the band

  test('F13: replaced, emptied with a second Control+A and typed along, the message counts as 照着敲', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push('Please run the tests.', 'Take a look for me.')
    await start($, w)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    await type($, '', '请运行测试')
    await w.clock.advance(700)
    expect(await ctrlA($, '请运行测试')).toEqual({ text: 'Please run the tests.', cursor: 21 })
    expect(await ctrlA($, 'Please run the tests.')).toEqual({ text: '', cursor: 0 })
    await type($, '', 'Please run the tests.')
    await w.clock.advance(700)
    expect((await enter($, 'Please run the tests.')).drop).toBeUndefined()
    await w.clock.settle()
    expect(w.asked).toHaveLength(1)
    expect(countsOf(w)).toMatchObject({ used: 0, retyped: 1 })

    // The same with 替换为译文, then 清空输入框
    await type($, '', '帮我看看')
    w.prompt = { text: '帮我看看', cursor: 4 }
    await w.clock.advance(700)
    await ui.press({ key: 'replace' })
    await ui.press({ key: 'clear' })
    await type($, '', 'Take a look for me.')
    expect((await enter($, 'Take a look for me.')).drop).toBeUndefined()
    await w.clock.settle()
    expect(countsOf(w)).toMatchObject({ used: 0, retyped: 2 })
  })

  test('F2: new Chinese written after 清空输入框, 替换为译文 before the pause translates it first', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push('Help me look at this error.', 'Install the dependencies with pnpm instead.')
    await start($, w)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    await type($, '', '帮我看看这个报错')
    w.prompt = { text: '帮我看看这个报错', cursor: 8 }
    await w.clock.advance(700)
    await ui.press({ key: 'clear' })
    await type($, '', '改成用 pnpm 安装依赖')
    w.prompt = { text: '改成用 pnpm 安装依赖', cursor: 13 }
    await ui.press({ key: 'replace' })
    await w.clock.settle()

    expect(w.filled).toEqual(['', 'Install the dependencies with pnpm instead.'])
  })

  test('F1: English typed along a correction after Enter emptied the Prompt: the band holds, and its sentence goes in', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push(JSON.stringify({ corrected: 'Run the tests and then deploy.', zh: '运行测试然后部署。', ok: false }))
    await start($, w)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    await type($, '', 'Run the tests 然后 deploy')
    w.prompt = { text: '', cursor: 0 }
    expect((await enter($, 'Run the tests 然后 deploy')).drop).toBeDefined()
    await w.clock.settle()
    await type($, '', 'Run the tests and')
    w.prompt = { text: 'Run the tests and', cursor: 17 }
    await w.clock.advance(700)

    expect(w.asked).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: 'and then' })).toBeDefined()
    await ui.press({ key: 'replace' })
    expect(w.filled).toEqual(['Run the tests and then deploy.'])
  })

  test('F1: the same while the correction is still on its way', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push(JSON.stringify({ corrected: 'Run the tests and then deploy.', zh: '运行测试然后部署。', ok: false }))
    await start($, w)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    w.replyMs = 2000

    await type($, '', 'Run the tests 然后 deploy')
    w.prompt = { text: '', cursor: 0 }
    expect((await enter($, 'Run the tests 然后 deploy')).drop).toBeDefined()
    await w.clock.settle()
    await type($, '', 'Run the')
    w.prompt = { text: 'Run the', cursor: 7 }
    await w.clock.advance(2000)

    expect(w.asked).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: 'and then' })).toBeDefined()
  })

  test('F15: ↑ brings the held-back text back to the emptied Prompt; changed, it is corrected anew', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push(
      JSON.stringify({ corrected: 'Run the tests and then deploy.', zh: '运行测试然后部署。', ok: false }),
      JSON.stringify({ corrected: 'Run the tests and deploy.', zh: '运行测试并部署。', ok: true }),
    )
    await start($, w)
    await $.ui.mount({ ...BAND, surface: 'terminal' })

    await type($, '', 'Run the tests 然后 deploy')
    w.prompt = { text: '', cursor: 0 }
    expect((await enter($, 'Run the tests 然后 deploy')).drop).toBeDefined()
    await w.clock.settle()
    // ↑, then 然后 written as and: not typed along, so the next pause corrects it (F15 › 改了以后)
    w.prompt = { text: 'Run the tests 然后 deploy', cursor: 23 }
    await edit($, 'Run the tests 然后 deploy', 14, 16, 'and')
    await w.clock.advance(700)

    expect(w.asked).toHaveLength(2)
  })

  test('F2: Control+A on English typed along a translation, a Chinese word in it, puts the translation in', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push('Help me look at this error.')
    await start($, w)

    await type($, '', '帮我看看这个报错')
    await w.clock.advance(700)
    expect(await ctrlA($, '帮我看看这个报错')).toEqual({ text: 'Help me look at this error.', cursor: 27 })
    expect(await ctrlA($, 'Help me look at this error.')).toEqual({ text: '', cursor: 0 })
    await type($, '', 'Help me check this 报错')

    expect(await ctrlA($, 'Help me check this 报错')).toEqual({ text: 'Help me look at this error.', cursor: 27 })
    expect(w.asked).toHaveLength(1)
  })

  test('F2: English typed over the Chinese along its translation: 替换为译文 puts the translation in', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push('Please run the tests.')
    await start($, w)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    await type($, '', '请运行测试')
    await w.clock.advance(700)
    // The Chinese selected and typed over in one go: the Prompt is never empty
    await edit($, '请运行测试', 0, 5, 'Please run the test')
    w.prompt = { text: 'Please run the test', cursor: 19 }
    await w.clock.advance(700)
    await ui.press({ key: 'replace' })

    expect(w.asked).toHaveLength(1)
    expect(w.filled).toEqual(['Please run the tests.'])
  })

  test('F15: emptied by hand, English typed along the correction leaves the band as it was', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push(JSON.stringify({ corrected: 'I fixed the bug yesterday.', zh: '我昨天已经修好了这个 bug。', ok: false }))
    await start($, w)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    await type($, '', 'I have fixed the bug yesterday.')
    await w.clock.advance(700)
    await killLine($, 'I have fixed the bug yesterday.')
    await type($, '', 'I fixed the')
    await w.clock.advance(700)

    expect(w.asked).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: '我昨天已经修好了这个 bug。' })).toBeDefined()
  })

  test('F13: a translation put in, emptied by hand and typed along, counts as 照着敲', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push('Please run the tests.')
    await start($, w)

    await type($, '', '请运行测试')
    await w.clock.advance(700)
    expect(await ctrlA($, '请运行测试')).toEqual({ text: 'Please run the tests.', cursor: 21 })
    await killLine($, 'Please run the tests.')
    await type($, '', 'Please run the tests.')
    expect((await enter($, 'Please run the tests.')).drop).toBeUndefined()
    await w.clock.settle()

    expect(countsOf(w)).toMatchObject({ used: 0, retyped: 1 })
  })

  test("F15: a correction put in and then changed: Control+A is the editor's own again, twice", LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push(
      JSON.stringify({ corrected: 'I fixed the bug yesterday.', zh: '我昨天已经修好了这个 bug。', ok: false }),
      JSON.stringify({ corrected: 'I fixed the bugs yesterday.', zh: '我昨天修好了这些 bug。', ok: false }),
    )
    await start($, w)

    await type($, '', 'I have fixed the bug yesterday.')
    await w.clock.advance(700)
    expect(await ctrlA($, 'I have fixed the bug yesterday.')).toEqual({ text: 'I fixed the bug yesterday.', cursor: 26 })
    // bug → bugz; the next pause corrects the new text (F15 › 改了以后)
    await edit($, 'I fixed the bug yesterday.', 15, 15, 'z')
    await w.clock.advance(700)
    expect(w.asked).toHaveLength(2)

    expect(await ctrlA($, 'I fixed the bugz yesterday.')).toEqual({ text: 'I fixed the bugz yesterday.', cursor: 0 })
    expect(await ctrlA($, 'I fixed the bugz yesterday.')).toEqual({ text: 'I fixed the bugz yesterday.', cursor: 0 })
    await w.clock.settle()
    expect(w.filled).toEqual([])
  })

  test('F15: Control+A on direct English before its correction is in: the caret goes to the start, and ✓ empties nothing', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push(JSON.stringify({ corrected: 'Run the tests.', zh: '运行测试。', ok: true }))
    await start($, w)
    w.replyMs = 2000

    await type($, '', 'Run the tests.')
    w.prompt = { text: 'Run the tests.', cursor: 14 }
    expect(await ctrlA($, 'Run the tests.')).toEqual({ text: 'Run the tests.', cursor: 0 })
    // Pressed again while the correction is on its way
    expect(await ctrlA($, 'Run the tests.')).toEqual({ text: 'Run the tests.', cursor: 0 })
    await w.clock.advance(2000)

    expect(w.asked).toHaveLength(1)
    expect(w.filled).toEqual([])
  })

  test('F15: Control+A on direct English before its correction is in: a sentence with something to fix goes in', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push(JSON.stringify({ corrected: 'I fixed the bug yesterday.', zh: '我昨天已经修好了这个 bug。', ok: false }))
    await start($, w)
    w.replyMs = 2000

    await type($, '', 'I have fixed the bug yesterday.')
    w.prompt = { text: 'I have fixed the bug yesterday.', cursor: 31 }
    expect(await ctrlA($, 'I have fixed the bug yesterday.')).toEqual({ text: 'I have fixed the bug yesterday.', cursor: 0 })
    await w.clock.advance(2000)

    expect(w.filled).toEqual(['I fixed the bug yesterday.'])
  })

  test('F15: pressed twice before a correction with something to fix is in, the Prompt is emptied (F3)', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push(JSON.stringify({ corrected: 'I fixed the bug yesterday.', zh: '我昨天已经修好了这个 bug。', ok: false }))
    await start($, w)
    w.replyMs = 2000

    await type($, '', 'I have fixed the bug yesterday.')
    w.prompt = { text: 'I have fixed the bug yesterday.', cursor: 31 }
    await ctrlA($, 'I have fixed the bug yesterday.')
    await ctrlA($, 'I have fixed the bug yesterday.')
    await w.clock.advance(2000)

    expect(w.asked).toHaveLength(1)
    expect(w.filled).toEqual([''])
  })

  test("F1: the day's tip, once shown, is spent with its message even when the last translation failed", LOADS_THE_MOD, async ($, on) => {
    const w = world(on, { store: { 'settings/strict': false } })
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    w.replies.push('Look at this.')
    await start($, w)

    await type($, '', '看看这个')
    await w.clock.advance(700)
    // One more character, and its translation fails (nothing queued)
    await type($, '看看这个', '吧')
    await w.clock.advance(700)
    expect((await enter($, '看看这个吧')).drop).toBeUndefined()
    await w.clock.settle()
    expect(w.store.get('flag/tipDate')).toBeDefined()

    // The next message's translation comes without it
    w.replies.push('Run the tests.')
    await type($, '', '运行测试')
    await w.clock.advance(700)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'Run the tests.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^小技巧/ })).toBeUndefined()
  })

  test('/clear: the band forgets the message it was on, as Claude Code empties what it draws', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    editor(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    on('classic.SessionStart', () => ({}))
    w.replies.push('Help me look at this error.', 'Help me look at this error.')
    await start($, w)

    await type($, '', '帮我看看这个报错')
    await w.clock.advance(700)
    // Control+U, then /clear (a local command: no prompt.submit), then Control+Y puts the same text back
    await killLine($, '帮我看看这个报错')
    await $.classic.SessionStart({ source: 'clear' })
    await type($, '', '帮我看看这个报错')
    await w.clock.advance(700)

    expect(w.asked).toHaveLength(2)
  })
})
