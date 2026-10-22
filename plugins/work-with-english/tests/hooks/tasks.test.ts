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

  test('/wwe 任务, /wwe task and /wwe tasks open the pane; /wwe still opens the settings', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    const opened = panes(on)
    on('settings.read', () => ({ value: {} }))
    on('config.list', () => ({ value: [] }))
    await start($, w, 'desktop')
    const run = (args: string) =>
      $.command.run({ command: 'wwe', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
    await run('任务')
    await run('')
    await run('task')
    await run(' Tasks ')
    expect(opened).toEqual(['wwe-tasks', 'wwe', 'wwe-tasks', 'wwe-tasks'])
  })
})

describe('a question dialog of several questions on the desktop', () => {
  const DIALOG = {
    plugin: 'work-with-english',
    component: 'AskUserQuestion',
    requestId: 'toolu-ask-1',
    viewport: { columns: 120, rows: 40, isFullscreen: true },
    surface: 'desktop',
  } as const
  const QUESTIONS = [
    { question: 'Which budget?', header: 'Budget', options: [{ label: 'large', description: 'Matches the defaults' }, { label: 'small', description: 'Fewer agents' }], multiSelect: false },
    { question: 'Accept task?', header: 'Task', options: [{ label: 'yes', description: 'Opens the pane' }, { label: 'no', description: 'Only by command' }], multiSelect: false },
  ]

  test('a tab for each question above the dialog; a press shows that question’s translation alone', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: 'Answered.' }))
    // Claude Code's own dialog, which the tree holds once
    on('ui.render', () => ({ type: 'engine', ref: 0 }))
    await start($, w, 'desktop')

    w.replies.push(JSON.stringify(['用哪种预算？', '大', '与默认设置一致', '小', '少用代理', '接受 task 吗？', '接受', '打开 Pane', '不接受', '只用命令']))
    await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS } as unknown as Parameters<Engine['tool']['call']>[0])
    await w.clock.settle()
    const ui = await $.ui.mount({ ...DIALOG, props: { tool: 'AskUserQuestion', questions: QUESTIONS } })
    expect(await ui.find({ type: 'Markdown', text: '> 用哪种预算？\n>\n> 1. 大：与默认设置一致\n> 2. 小：少用代理' })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: /接受 task/ })).toBeUndefined()

    await ui.press({ key: 'ask-tab-1' })
    expect(await ui.find({ type: 'Markdown', text: '> 接受 task 吗？\n>\n> 1. 接受：打开 Pane\n> 2. 不接受：只用命令' })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: /用哪种预算/ })).toBeUndefined()
    await ui.unmount()
  })

  test('多个问题的译文 set to 展示全部: every question at once, numbered, and no tabs', LOADS_THE_MOD, async ($, on) => {
    const w = world(on, { store: { 'settings/askLayout': 'all' } })
    on('tool.call', () => ({ result: 'Answered.' }))
    on('ui.render', () => ({ type: 'engine', ref: 0 }))
    await start($, w, 'desktop')

    w.replies.push(JSON.stringify(['用哪种预算？', '大', '与默认设置一致', '小', '少用代理', '接受 task 吗？', '接受', '打开 Pane', '不接受', '只用命令']))
    await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS } as unknown as Parameters<Engine['tool']['call']>[0])
    await w.clock.settle()
    const ui = await $.ui.mount({ ...DIALOG, props: { tool: 'AskUserQuestion', questions: QUESTIONS } })
    expect(
      await ui.find({
        type: 'Markdown',
        text: '---\n\n> 问题 1/2：用哪种预算？\n>\n> 1. 大：与默认设置一致\n> 2. 小：少用代理\n>\n> 问题 2/2：接受 task 吗？\n>\n> 1. 接受：打开 Pane\n> 2. 不接受：只用命令',
      }),
    ).toBeDefined()
    expect(await ui.findAll({ type: 'Button' })).toEqual([])
    await ui.unmount()
  })
})
