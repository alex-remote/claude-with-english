import { describe, expect, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import { start, world } from '../support/engine'
import type { World } from '../support/engine'

// F9 划词翻译 through the mod's hooks: the terminal's selection, read on a
// timer as Claude Code answers $.ui.selection(); the desktop's ⌘C, as the
// clipboard watcher prints it; the selection line at the bottom of the band,
// and its 解析 into the pane.

/** The test's `on`, which the kit types but does not export by name */
type On = Parameters<TestBody>[1]

const BAND = {
  plugin: 'work-with-english',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 110, rows: 40, isFullscreen: true },
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 105, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const PANE = {
  plugin: 'work-with-english',
  component: 'Pane',
  requestId: 'wwe',
  viewport: { columns: 120, rows: 40, isFullscreen: true },
  props: {
    title: 'claude-with-english',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 36 },
    view: {},
  },
} as const

const message = (text: string, requestId: string) =>
  ({
    plugin: 'work-with-english',
    component: 'AssistantMessage',
    requestId,
    viewport: { columns: 110, rows: 40, isFullscreen: true },
    props: { text, isFirstOfReply: true },
  }) as const

const CAUSE_REPLY = 'I found the cause. The config loader reads `PORT` before `.env` is loaded, so it gets `undefined`.'
const STAND_OUT_REPLY = [
  'Two things stand out:',
  '',
  '- Every request waits for the cache lock, so one slow write blocks all reads.',
  '- Entries never expire, so memory grows until the process restarts.',
].join('\n')

const CAUSE = JSON.stringify({ lemma: 'cause', ipa: '/kɔːz/', senses: ['n. 原因；起因', 'v. 导致；引起'], cur: 0, formNote: '' })
const CARD = JSON.stringify({
  inSentence: '原因。the cause 指这个报错的根源。',
  sentenceZh: '我找到原因了。',
  usages: [{ en: 'find the cause of sth', zh: '找到某事的原因' }],
  examples: [{ en: "We still don't know the cause of the crash.", zh: '我们还不知道崩溃的原因。' }],
})

/** Thirty lines of code, past the 600 characters a passage may have */
const LONG_CODE = Array.from({ length: 30 }, (_, i) => `const value${i} = await loadConfig({ port: ${3000 + i} });`).join('\n')

const enter = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

/** What the lookup (F9) asks with; the word card's system prompt speaks of a dictionary entry */
const isLookup = (asked: { system?: string }) => asked.system?.includes('dictionary for a developer') === true

/** The fullscreen terminal's selection, as $.ui.selection() answers it: the last one, until a prompt or command has run */
function terminalSelection(on: On) {
  const selected: { now: { text: string; requestId?: string } | undefined } = { now: undefined }
  on('ui.selection', () => ({ value: selected.now }))
  return selected
}

type Hook = ($: unknown, e: { name?: string; system?: string }, next: unknown) => unknown

/**
 * The test's `on` for world(), the hook it registers on `event` wrapped: the
 * kit takes one hook per event, and world() already answers these.
 */
function wrapping(on: On, event: string, wrap: (answer: Hook) => Hook): On {
  const register = on as unknown as (name: string, ...rest: unknown[]) => unknown
  return ((name: string, ...rest: unknown[]) =>
    name === event ? register(name, ...rest.slice(0, -1), wrap(rest.at(-1) as Hook)) : register(name, ...rest)) as unknown as On
}

/** The desktop app runs the session: it sets CLAUDE_CODE_DESKTOP_APP_VERSION */
const onDesktop = (on: On) =>
  wrapping(on, 'env.get', answer => ($, e, next) =>
    e.name === 'CLAUDE_CODE_DESKTOP_APP_VERSION' ? { value: '1.0.0' } : answer($, e, next),
  )

/** On the desktop, assets/clipwatch.jxa prints one line each time the clipboard changes */
function desktopClipboard(on: On) {
  const lines: string[] = []
  let wake: (() => void) | null = null
  let isEnded = false
  on('process.spawn', async function* () {
    while (!isEnded) {
      const line = lines.shift()
      if (line === undefined) {
        await new Promise<void>(resolve => {
          wake = resolve
        })
        continue
      }
      yield { stream: 'stdout' as const, text: `${line}\n` }
    }
  })
  const poke = () => {
    const waiting = wake
    wake = null
    waiting?.()
  }
  return {
    /** ⌘C with Claude in front */
    copy(text: string) {
      lines.push(JSON.stringify({ front: true, concealed: false, text }))
      poke()
    },
    end() {
      isEnded = true
      poke()
    },
  }
}

/** Lets the timers and what they started run: the selection poll is every 400 ms */
const poll = async (w: World) => {
  await w.clock.advance(400)
  await w.clock.settle()
}

/** The band as it draws now, on the surface */
async function bandOn($: Engine, surface: 'terminal' | 'desktop') {
  return $.ui.mount({ ...BAND, surface })
}

// Each test loads the whole mod; on a busy machine that alone takes seconds
const LOADS_THE_MOD = { timeoutMs: 60_000 }

describe('pick', () => {
  test('the terminal: a word selected again after the line went comes up again', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    const selected = terminalSelection(on)
    await start($, w)
    await (await $.ui.mount({ ...message(CAUSE_REPLY, 'msg-1'), surface: 'terminal' })).unmount()

    w.replies.push(CAUSE)
    selected.now = { text: 'cause', requestId: 'msg-1' }
    await poll(w)
    const band = await bandOn($, 'terminal')
    expect(await band.find({ key: 'pick-close' })).toBeDefined()

    // ✕: the engine still answers the same selection, which does not come back, nor while its
    // row is scrolled out of the drawn rows and the answer has no reply id
    await band.press({ key: 'pick-close' })
    await poll(w)
    selected.now = { text: 'cause' }
    await poll(w)
    selected.now = { text: 'cause', requestId: 'msg-1' }
    await poll(w)
    expect(await band.find({ key: 'pick-close' })).toBeUndefined()

    // A message sent: the engine's selection is gone once it has run
    await enter($, 'Thanks.')
    selected.now = undefined
    await poll(w)

    // The same word double-clicked again in the same reply
    w.replies.push(CAUSE)
    selected.now = { text: 'cause', requestId: 'msg-1' }
    await poll(w)
    expect(await band.find({ key: 'pick-close' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: 'n. 原因；起因' })).toBeDefined()
  })

  test('the terminal: the same word in another reply comes up for that reply, with its own sentence', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    const selected = terminalSelection(on)
    await start($, w)
    await (await $.ui.mount({ ...message(CAUSE_REPLY, 'msg-1'), surface: 'terminal' })).unmount()
    await (await $.ui.mount({ ...message('The cause turned out to be the cache.', 'msg-2'), surface: 'terminal' })).unmount()

    w.replies.push(CAUSE)
    selected.now = { text: 'cause', requestId: 'msg-1' }
    await poll(w)
    // Double-clicked again in the other reply before a poll saw the selection empty
    w.replies.push(CAUSE)
    selected.now = { text: 'cause', requestId: 'msg-2' }
    await poll(w)

    const lookups = w.asked.filter(isLookup)
    expect(lookups.length).toBe(2)
    expect(lookups[1]?.prompt).toContain('The cause turned out to be the cache.')
  })

  test('the desktop: the same word copied again after ✕, or to try a failed lookup again, comes up', LOADS_THE_MOD, async ($, on) => {
    const w = world(onDesktop(on))
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    const clipboard = desktopClipboard(on)
    await start($, w, 'desktop')
    await (await $.ui.mount({ ...message(CAUSE_REPLY, 'msg-1'), surface: 'desktop' })).unmount()

    // The model is busy: 查询失败
    clipboard.copy('cause')
    await w.clock.settle()
    const band = await bandOn($, 'desktop')
    expect(await band.find({ type: 'Text', text: /^查询失败/ })).toBeDefined()

    // Copied again: asked again
    w.replies.push(CAUSE)
    clipboard.copy('cause')
    await w.clock.settle()
    expect(await band.find({ type: 'Text', text: 'n. 原因；起因' })).toBeDefined()

    // ✕, then copied again
    await band.press({ key: 'pick-close' })
    expect(await band.find({ key: 'pick-close' })).toBeUndefined()
    w.replies.push(CAUSE)
    clipboard.copy('cause')
    await w.clock.settle()
    expect(await band.find({ key: 'pick-close' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: '已复制' })).toBeDefined()
    clipboard.end()
  })

  test('the desktop: a session not on screen leaves a copy alone; shown again, it looks the next one up', LOADS_THE_MOD, async ($, on) => {
    const w = world(onDesktop(on))
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    const clipboard = desktopClipboard(on)
    await start($, w, 'desktop')

    // Another session in front: the app detached this one
    w.surfaces = []
    clipboard.copy('cause')
    await w.clock.settle()
    expect(w.asked.filter(isLookup)).toEqual([])

    w.surfaces = ['desktop']
    w.replies.push(CAUSE)
    clipboard.copy('cause')
    await w.clock.settle()
    expect(w.asked.filter(isLookup).length).toBe(1)
    const band = await bandOn($, 'desktop')
    expect(await band.find({ type: 'Text', text: 'n. 原因；起因' })).toBeDefined()
    clipboard.end()
  })

  test('划选模式: a code block past 600 characters gets no line, and the line before stays', LOADS_THE_MOD, async ($, on) => {
    const w = world(on, { store: { 'settings/readingMode': 'select' } })
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    const selected = terminalSelection(on)
    await start($, w)
    const reply = `Here is the loader:\n\n\`\`\`ts\n${LONG_CODE}\n\`\`\`\n\nI found the cause.`
    await (await $.ui.mount({ ...message(reply, 'msg-1'), surface: 'terminal' })).unmount()

    w.replies.push(CAUSE)
    selected.now = { text: 'cause', requestId: 'msg-1' }
    await poll(w)
    selected.now = { text: LONG_CODE, requestId: 'msg-1' }
    await poll(w)

    const band = await bandOn($, 'terminal')
    expect(await band.find({ type: 'Text', text: '选中的文字太长' })).toBeUndefined()
    expect(await band.find({ type: 'Text', text: 'n. 原因；起因' })).toBeDefined()
  })

  test('划选模式 on the desktop: long code copied gets no line', LOADS_THE_MOD, async ($, on) => {
    const w = world(onDesktop(on), { store: { 'settings/readingMode': 'select' } })
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    const clipboard = desktopClipboard(on)
    await start($, w, 'desktop')

    clipboard.copy(LONG_CODE)
    await w.clock.settle()
    const band = await bandOn($, 'desktop')
    expect(await band.find({ type: 'Text', text: '选中的文字太长' })).toBeUndefined()

    // Prose that long still gets the line
    const prose = 'The config loader reads PORT before the env file is loaded. '.repeat(11)
    clipboard.copy(prose)
    await w.clock.settle()
    expect(await band.find({ type: 'Text', text: '选中的文字太长' })).toBeDefined()
    clipboard.end()
  })

  test('解析 while the line still looks the word up waits for that lookup: one lookup, the same senses', LOADS_THE_MOD, async ($, on) => {
    // A lookup takes the model a while (P02: 2.3 s in the middle)
    const w: World = world(
      wrapping(on, 'model.complete', answer => async ($, e, next) => {
        if (isLookup(e)) {
          await w.clock.sleep(2300)
        }
        return answer($, e, next)
      }),
    )
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    const selected = terminalSelection(on)
    await start($, w)
    await (await $.ui.mount({ ...message(CAUSE_REPLY, 'msg-1'), surface: 'terminal' })).unmount()

    w.replies.push(CAUSE, CARD)
    selected.now = { text: 'cause', requestId: 'msg-1' }
    await poll(w)
    const band = await bandOn($, 'terminal')
    expect(await band.find({ type: 'Text', text: '查询中…' })).toBeDefined()

    await band.press({ key: 'pick-analyse' })
    await w.clock.advance(2300)
    await w.clock.settle()

    expect(w.asked.filter(isLookup).length).toBe(1)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await pane.find({ type: 'Text', text: '原因。the cause 指这个报错的根源。' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'n. 原因；起因' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: 'n. 原因；起因' })).toBeDefined()
  })

  test('a word that is part of a phrase shows the phrase once looked up', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    const selected = terminalSelection(on)
    await start($, w)
    await (await $.ui.mount({ ...message(STAND_OUT_REPLY, 'msg-1'), surface: 'terminal' })).unmount()

    w.replies.push(
      JSON.stringify({ lemma: 'stand out', ipa: '/stænd aʊt/', senses: ['v. 突出；显眼'], cur: 0, formNote: '选中的是 stand' }),
    )
    selected.now = { text: 'stand', requestId: 'msg-1' }
    await poll(w)

    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await bandOn($, surface)
      expect(await band.find({ type: 'Text', text: 'stand out' })).toBeDefined()
      expect(await band.find({ type: 'Text', text: '选中的是 stand' })).toBeDefined()
      await band.unmount()
    }
  })

  test('back to 段落模式, a selected passage goes from the band at once', LOADS_THE_MOD, async ($, on) => {
    const w = world(on, { store: { 'settings/readingMode': 'select' } })
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    on('settings.read', () => ({ value: {} }))
    on('config.list', () => ({ value: [] }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    const selected = terminalSelection(on)
    await start($, w)
    await (await $.ui.mount({ ...message(CAUSE_REPLY, 'msg-1'), surface: 'terminal' })).unmount()

    selected.now = { text: 'I found the cause.', requestId: 'msg-1' }
    await poll(w)
    const band = await bandOn($, 'terminal')
    expect(await band.find({ key: 'pick-translate' })).toBeDefined()

    await $.command.run({ command: 'wwe', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
    selected.now = undefined
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'tab-reading' })
    await pane.press({ key: 'reading-paragraph' })
    await w.clock.settle()
    expect(w.toasts).toContain('已保存：阅读方式 段落模式')
    expect(await band.find({ key: 'pick-translate' })).toBeUndefined()
  })

  test('解析 on several sentences titles the hard words 这段的难词; on one sentence 这句的难词', LOADS_THE_MOD, async ($, on) => {
    const w = world(on, { store: { 'settings/readingMode': 'select' } })
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    const selected = terminalSelection(on)
    await start($, w)
    const reply = 'I found the cause. It was the loader.'
    await (await $.ui.mount({ ...message(reply, 'msg-1'), surface: 'terminal' })).unmount()
    const sentence = (en: string) => ({ en, zh: '……', parts: [], points: [] })

    w.replies.push(JSON.stringify({ sentences: [sentence('I found the cause.'), sentence('It was the loader.')], hard: ['cause'] }))
    selected.now = { text: reply, requestId: 'msg-1' }
    await poll(w)
    const band = await bandOn($, 'terminal')
    await band.press({ key: 'pick-analyse' })
    await w.clock.settle()
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await pane.find({ type: 'Text', text: '这段的难词' })).toBeDefined()

    w.replies.push(JSON.stringify({ sentences: [sentence('I found the cause.')], hard: ['cause'] }))
    selected.now = { text: 'I found the cause.', requestId: 'msg-1' }
    await poll(w)
    await band.press({ key: 'pick-analyse' })
    await w.clock.settle()
    expect(await pane.find({ type: 'Text', text: '这句的难词' })).toBeDefined()
  })

  test('another selection while the line before reads aloud: its 朗读 is not the one reading', LOADS_THE_MOD, async ($, on) => {
    const w = world(on, { store: { 'settings/readingMode': 'select' } })
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    // The system voice takes a while to read and can't be stopped
    on('audio.speak', async () => {
      await w.clock.sleep(5000)
      return { value: { via: 'system' as const } }
    })
    const selected = terminalSelection(on)
    await start($, w)
    await (await $.ui.mount({ ...message(CAUSE_REPLY, 'msg-1'), surface: 'terminal' })).unmount()

    selected.now = { text: 'I found the cause.', requestId: 'msg-1' }
    await poll(w)
    const band = await bandOn($, 'terminal')
    await band.press({ key: 'pick-speak' })
    expect((await band.find({ key: 'pick-speak' }))?.props.label).toBe('朗读中…')

    w.replies.push(CAUSE)
    selected.now = { text: 'cause', requestId: 'msg-1' }
    await poll(w)
    const speak = await band.find({ key: 'pick-speak' })
    expect(speak?.props.label).toBe('朗读')
    expect(speak?.props.dimColor).toBe(true)
    await w.clock.advance(5000)
  })

  test('a passage across paragraphs shows on one line', LOADS_THE_MOD, async ($, on) => {
    const w = world(on, { store: { 'settings/readingMode': 'select' } })
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    const selected = terminalSelection(on)
    await start($, w)
    await (await $.ui.mount({ ...message(STAND_OUT_REPLY, 'msg-1'), surface: 'terminal' })).unmount()

    selected.now = { text: 'Two things stand out:\n\nEvery request waits for the cache lock, so one slow write blocks all reads.' }
    await poll(w)
    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await bandOn($, surface)
      expect(await band.find({ type: 'Text', text: 'Two things stand out: Every request waits for the cache lock…' })).toBeDefined()
      expect(await band.find({ type: 'Text', text: /\n/ })).toBeUndefined()
      await band.unmount()
    }
  })

  test("what another mod draws above the prompt stays under the band's lines", LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
    const selected = terminalSelection(on)
    await start($, w)
    await (await $.ui.mount({ ...message(CAUSE_REPLY, 'msg-1'), surface: 'terminal' })).unmount()

    w.replies.push(CAUSE)
    selected.now = { text: 'cause', requestId: 'msg-1' }
    await poll(w)
    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await bandOn($, surface)
      expect(await band.find({ key: 'pick-close' })).toBeDefined()
      expect(await band.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
      await band.unmount()
    }
  })
})
