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
    w.replies.push(JSON.stringify(['插件没有改动。', '要发布吗？', '发布', '先不发']))
    await $.tool.call({
      tool: WRAP_UP_TOOL,
      recap: 'Nothing in the plugin changed.',
      ask: 'Shall I release it?',
      actions: [{ label: 'Release' }, { label: 'Not yet' }, { action: 'commit' }],
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
      await ui.find({ type: 'Text', text: `${reply}\n\n> 探针已删除。\n\n> 卡片：插件没有改动。\n>\n> 问题：要发布吗？（发布 / 先不发）` }),
    ).toBeDefined()
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
