import { describe, expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { firstRunToast } from '../../hooks/core/copy/common'
import { settingsOpenedFromMessage } from '../../hooks/core/copy/settings'
import { WRAP_UP_TOOL } from '../../hooks/features/env/nextStep'
import { start, world } from '../support/engine'

// The desktop app as 3.1623.0 (Claude Code 2.1.304) runs a mod, measured on
// 10-22: it keeps several sessions running (split view, the sidebar, the
// sessions Claude starts beside one) and attaches only the one on screen;
// its prompt box may send a mod's command on as a message (#99691).

/** The test's `on`, which the kit types but does not export by name */
type On = Parameters<TestBody>[1]

// Each test loads the whole mod; on a busy machine that alone takes seconds
const LOADS_THE_MOD = { timeoutMs: 60_000 }

/** What /wwe reads before it opens the pane, and the panes opened */
function settingsPane(on: On) {
  const opened: { id: string }[] = []
  on('settings.read', () => ({ value: {} }))
  on('config.list', () => ({ value: [] }))
  on('ui.open', ($, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  return opened
}

describe('the desktop app', () => {
  test('a session nobody has open keeps its start-up toast until a window shows it', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
    await w.clock.settle()
    expect(w.toasts).toEqual([])

    w.surfaces = ['desktop']
    await $.session.attach({ surface: 'desktop', clientId: 'desktop-1' })
    await w.clock.settle()
    expect(w.toasts).toEqual([firstRunToast()])
  })

  test('a session on screen at its start shows the toast at once', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    await start($, w, 'desktop')
    expect(w.toasts).toEqual([firstRunToast()])
  })

  test('/wwe sent on as a message opens the settings, goes no further and leaves the prompt box', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    const opened = settingsPane(on)
    await start($, w, 'desktop')
    w.prompt = { text: '/wwe', cursor: 4 }

    const result = await $.prompt.submit({ text: '/wwe', wait: false, origin: { kind: 'composer' } })
    await w.clock.settle()

    expect(result).toEqual({ drop: settingsOpenedFromMessage() })
    expect(opened).toMatchObject([{ id: 'wwe' }])
    expect(w.submitted).toEqual([])
    expect(w.prompt.text).toBe('')
  })

  test('the summary card’s tool reads to Claude as the app wrote it: the plugin adds nothing', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('tool.describe', ($, e) => ({ description: e.description }))
    await start($, w, 'desktop')
    const card = await $.tool.describe({
      tool: WRAP_UP_TOOL,
      description: 'Fill the "next step" box.',
      provider: { plugin: 'mcp:ccd_turn', tier: 'user' },
    })
    expect(card.description).toBe('Fill the "next step" box.')
  })

  test('the card’s recap, question and buttons are translated at the end of the turn’s last reply', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('session.append', ($, e, next) => next(e))
    on('turn.complete', () => ({ text: '' }))
    on('tool.call', () => ({ result: 'Shown in the next-step box.' }))
    on('ui.render', ($, e) => ({ type: 'Text', props: {}, children: [String((e.props as { text?: string }).text ?? '')] }))
    await start($, w, 'desktop')
    const reply = 'The probe is removed.'
    w.replies.push('探针已删除。')
    await $.session.append({
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: reply }] },
      door: 'response',
      origin: { kind: 'model', model: 'claude-test' },
      uuid: 'u1',
    })
    w.replies.push(JSON.stringify(['插件没有改动。', '要发布吗？', '发布', '发布 0.1.5。', '先不发']))
    await $.tool.call({
      tool: WRAP_UP_TOOL,
      recap: 'Nothing in the plugin changed.',
      ask: 'Shall I release it?',
      actions: [{ label: 'Release', message: 'Release 0.1.5.' }, { label: 'Not yet' }, { action: 'commit' }],
    } as unknown as Parameters<typeof $.tool.call>[0])
    await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1000, isAborted: false, reason: 'answer' })
    await w.clock.settle()

    const ui = await $.ui.mount({
      plugin: 'work-with-english',
      component: 'AssistantMessage',
      requestId: 'msg-1',
      viewport: { columns: 110, rows: 40, isFullscreen: true },
      props: { text: reply, isFirstOfReply: true },
      surface: 'desktop',
    })
    expect(
      await ui.find({
        type: 'Text',
        text: `${reply}\n\n> 探针已删除。\n\n---\n\n> 插件没有改动。\n>\n> 问题：要发布吗？\n>\n> - 发布，点击后发送：发布 0.1.5。\n> - 先不发`,
      }),
    ).toBeDefined()

    // A click on 发布 sends its message: let through as it is, drawn with its translation under it
    const sent = await $.prompt.submit({ text: 'Release 0.1.5.', wait: false, origin: { kind: 'composer' } })
    expect(sent).toEqual({ text: 'Release 0.1.5.' })
    expect(w.submitted).toEqual(['Release 0.1.5.'])
    const bubble = await $.ui.mount({
      plugin: 'work-with-english',
      component: 'UserMessage',
      requestId: 'user-2',
      viewport: { columns: 110, rows: 40, isFullscreen: true },
      props: { text: 'Release 0.1.5.', origin: { kind: 'composer' }, isExpanded: false },
      surface: 'desktop',
    } as unknown as Parameters<typeof $.ui.mount>[0])
    expect(await bubble.find({ type: 'Text', text: '发布 0.1.5。' })).toBeDefined()
  })

  test('a card button’s message in Chinese goes on even in strict mode, and is not counted as English written', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: 'Shown in the next-step box.' }))
    on('ui.render', ($, e) => ({ type: 'Text', props: {}, children: [String((e.props as { text?: string }).text ?? '')] }))
    await start($, w, 'desktop')
    await $.ui.mount({ ...{ plugin: 'work-with-english', component: 'AbovePrompt', requestId: 'above-prompt', viewport: { columns: 110, rows: 40, isFullscreen: true }, props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 105, scroll: { offset: 0, bodyRows: 10 }, view: {} } }, surface: 'desktop' } as unknown as Parameters<typeof $.ui.mount>[0])
    await $.tool.call({
      tool: WRAP_UP_TOOL,
      recap: 'Done.',
      ask: 'Archive it?',
      actions: [{ label: '归档', message: '归档这个会话。' }],
    } as unknown as Parameters<typeof $.tool.call>[0])
    await w.clock.settle()
    const sent = await $.prompt.submit({ text: '归档这个会话。', wait: false, origin: { kind: 'composer' } })
    expect(sent).toEqual({ text: '归档这个会话。' })
    // Typed by hand, the same Chinese is held back
    const typed = await $.prompt.submit({ text: '这是我自己写的。', wait: false, origin: { kind: 'composer' } })
    expect(typed).toHaveProperty('drop')
    await w.clock.settle()
    expect([...w.files.keys()].filter(path => path.includes('/stats/'))).toEqual([])
  })

  test('a call’s description is translated under its row on the desktop; not in the terminal, nor with 自动翻译回复 off', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: 'done' }))
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['Verified the workflow'] }))
    await start($, w, 'desktop')
    w.replies.push(JSON.stringify(['核对工作流']))
    await $.tool.call({ tool: 'Bash', command: 'gh run view', description: 'Verify the workflow' } as unknown as Parameters<typeof $.tool.call>[0])
    await w.clock.settle()
    expect(w.asked.length).toBe(1)

    const row = (surface: 'desktop' | 'terminal') =>
      $.ui.mount({
        plugin: 'work-with-english',
        component: 'ToolUse',
        requestId: 'toolu_1',
        viewport: { columns: 110, rows: 40, isFullscreen: true },
        props: { tool_use_id: 'toolu_1', tool: 'Bash', input: { command: 'gh run view', description: 'Verify the workflow' }, isRunning: false, isErrored: false, isInterrupted: false },
        surface,
      } as unknown as Parameters<typeof $.ui.mount>[0])
    expect(await (await row('desktop')).find({ type: 'Text', text: '核对工作流' })).toBeDefined()
    expect(await (await row('terminal')).find({ type: 'Text', text: '核对工作流' })).toBeUndefined()

    // A call with no description, or one in Chinese, asks nothing
    await $.tool.call({ tool: 'Read', file_path: '/tmp/a.ts' } as unknown as Parameters<typeof $.tool.call>[0])
    await $.tool.call({ tool: 'Bash', command: 'ls', description: '列出文件' } as unknown as Parameters<typeof $.tool.call>[0])
    await w.clock.settle()
    expect(w.asked.length).toBe(1)
  })

  test('自动翻译回复 off: a call’s description is not asked for', LOADS_THE_MOD, async ($, on) => {
    const w = world(on, { store: { 'settings/autoReply': 'off' } })
    on('tool.call', () => ({ result: 'done' }))
    await start($, w, 'desktop')
    await $.tool.call({ tool: 'Bash', command: 'gh run view', description: 'Verify the workflow' } as unknown as Parameters<typeof $.tool.call>[0])
    await w.clock.settle()
    expect(w.asked.length).toBe(0)
  })

  test('a message that only starts with the letters goes on as any other', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    const opened = settingsPane(on)
    await start($, w, 'desktop')

    await $.prompt.submit({ text: '/wwexyz is not ours', wait: false, origin: { kind: 'composer' } })

    expect(opened).toEqual([])
    expect(w.submitted).toEqual(['/wwexyz is not ours'])
  })
})
