import { describe, expect, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import { PLAN_TOOL } from '../../hooks/features/tasks/plan'
import { start, world } from '../support/engine'

// F16 任务 through the mod's hooks: Claude's update_plan calls on the
// desktop, the pane opening by itself once, /wwe 任务, the translations.

/** The test's `on`, which the kit types but does not export by name */
type On = Parameters<TestBody>[1]

// Each test loads the whole mod; on a busy machine that alone takes seconds
const LOADS_THE_MOD = { timeoutMs: 60_000 }

const PANE = {
  plugin: 'work-with-english',
  component: 'Pane',
  requestId: 'wwe-tasks',
  viewport: { columns: 120, rows: 40, isFullscreen: true },
  props: { title: '任务', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 36 }, view: {} },
  surface: 'desktop',
} as const

/** The panes opened, each answered as placed */
function panes(on: On) {
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  return opened
}

const plan = ($: Engine, args: Record<string, unknown>) =>
  $.tool.call({ tool: PLAN_TOOL, ...args } as unknown as Parameters<Engine['tool']['call']>[0])

const turnEnd = ($: Engine) =>
  $.turn.complete({ turnId: 't1', answer: '', durationMs: 1000, isAborted: false, reason: 'answer' })

describe('the 任务 pane', () => {
  test('the first list opens the pane by itself and is translated; a new turn’s list goes on top; the pane does not open again', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    const opened = panes(on)
    on('tool.call', () => ({ result: 'Plan shown.' }))
    on('turn.complete', () => ({ text: '' }))
    await start($, w, 'desktop')

    w.replies.push(JSON.stringify(['阅读代码', '修复它']))
    await plan($, { items: [{ content: 'Read the code', status: 'in_progress' }, { content: 'Fix it', status: 'pending' }], scope: 'first_task' })
    await w.clock.settle()
    expect(opened).toEqual(['wwe-tasks'])
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ type: 'Text', text: 'Read the code' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '阅读代码' })).toBeDefined()

    await turnEnd($)
    w.replies.push(JSON.stringify(['发布']))
    await plan($, { items: [{ content: 'Release it', status: 'in_progress' }], scope: 'continuation' })
    await plan($, { advance: true })
    await w.clock.settle()
    expect(opened).toEqual(['wwe-tasks'])
    const lines = (await ui.findAll({ type: 'Text' })).map(node => node.children.join(''))
    expect(lines.indexOf('Release it')).toBeLessThan(lines.indexOf('Read the code'))
    expect(await ui.find({ type: 'Text', text: '发布' })).toBeDefined()
    // One request per list; the steps translated before are not asked again
    expect(w.asked.length).toBe(2)
  })

  test('/wwe 任务 opens the pane; /wwe still opens the settings', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    const opened = panes(on)
    on('settings.read', () => ({ value: {} }))
    on('config.list', () => ({ value: [] }))
    await start($, w, 'desktop')
    const run = (args: string) =>
      $.command.run({ command: 'wwe', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
    await run('任务')
    await run('')
    expect(opened).toEqual(['wwe-tasks', 'wwe'])
  })
})
