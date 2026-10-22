import { describe, expect, test } from 'claude-code/testing'

import { NO_PARA } from '../../hooks/core/state/defaults'
import { applyPlan, timeOf } from '../../hooks/features/tasks/plan'
import { tasksView } from '../../hooks/features/tasks/view'
import type { TasksUi } from '../../hooks/features/tasks/view'
import type { WwePara, WweTaskList } from '../../types'

// F16 任务: the lists rebuilt from Claude's update_plan calls, and the pane as data.

const items = (...texts: string[]) => texts.map((content, i) => ({ content, status: i === 0 ? 'in_progress' : 'pending' }))
const statuses = (lists: readonly WweTaskList[] | null, at = 0) => lists?.[at]?.steps.map(step => step.status)

describe('task lists (F16)', () => {
  test('a whole list goes on top; made again in the same turn it replaces that turn’s; a new turn’s goes above it', () => {
    const first = applyPlan([], { items: items('Read the code', 'Fix it') }, 1000, 0)
    expect(first?.map(list => list.steps.map(step => step.text))).toEqual([['Read the code', 'Fix it']])
    const replaced = applyPlan(first ?? [], { items: items('Read the code', 'Fix it', 'Test it') }, 2000, 0)
    expect(replaced?.length).toBe(1)
    expect(replaced?.[0]?.at).toBe(1000)
    const next = applyPlan(replaced ?? [], { items: items('Release it') }, 3000, 1)
    expect(next?.map(list => list.steps[0]?.text)).toEqual(['Release it', 'Read the code'])
  })

  test('advance finishes the step in progress and starts the next; done and start name steps from 1', () => {
    const lists = applyPlan([], { items: items('One', 'Two', 'Three', 'Four') }, 0, 0)
    const advanced = applyPlan(lists ?? [], { advance: true }, 0, 0)
    expect(statuses(advanced)).toEqual(['completed', 'in_progress', 'pending', 'pending'])
    const moved = applyPlan(advanced ?? [], { done: [2], start: 4 }, 0, 0)
    expect(statuses(moved)).toEqual(['completed', 'completed', 'pending', 'in_progress'])
  })

  test('a call that changes nothing, or a move with no list yet, leaves the lists as they are', () => {
    expect(applyPlan([], { advance: true }, 0, 0)).toBeNull()
    expect(applyPlan([], { items: [] }, 0, 0)).toBeNull()
    const lists = applyPlan([], { items: items('One') }, 0, 0) ?? []
    expect(applyPlan(lists, { scope: 'continuation' }, 0, 0)).toBeNull()
  })

  test('the time a list is headed by: HH:MM, local', () => {
    const at = new Date(2026, 9, 22, 15, 4).getTime()
    expect(timeOf(at)).toBe('15:04')
  })
})

// The drawing as data
type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] }
const flat = (children: unknown): (Node | string)[] =>
  children === undefined || children === null || typeof children === 'boolean'
    ? []
    : Array.isArray(children)
      ? children.flatMap(flat)
      : typeof children === 'string' || typeof children === 'number'
        ? [String(children)]
        : [children as Node]
const element = (type: string) => (props: Record<string, unknown>) => {
  const { children, ...rest } = props
  return { type, props: rest, children: flat(children) }
}
const UI = { Box: element('Box'), Text: element('Text') } as unknown as TasksUi
const texts = (node: Node | string): string[] =>
  typeof node === 'string' ? [] : node.type === 'Text' ? [node.children.join('')] : node.children.flatMap(texts)

describe('the 任务 pane (F16)', () => {
  test('the newest list first, headed by its time; each step with its mark and its translation under it', () => {
    const lists: WweTaskList[] = [
      { at: new Date(2026, 9, 22, 15, 10).getTime(), turn: 1, steps: [{ text: 'Release it', status: 'in_progress' }] },
      {
        at: new Date(2026, 9, 22, 14, 30).getTime(),
        turn: 0,
        steps: [
          { text: 'Read the code', status: 'completed' },
          { text: '修复它', status: 'pending' },
        ],
      },
    ]
    const zh: Record<string, WwePara> = {
      'Release it': { status: 'pending', zh: null, error: null, shown: true },
      'Read the code': { status: 'done', zh: '阅读代码', error: null, shown: true },
    }
    const tree = tasksView(UI, { lists, turn: 1, isShown: true }, text => zh[text] ?? NO_PARA) as unknown as Node
    expect(texts(tree)).toEqual(['15:10', '▸', 'Release it', '翻译中…', '14:30', '✓', 'Read the code', '阅读代码', '○', '修复它'])
  })

  test('before any list: one line that says so', () => {
    const tree = tasksView(UI, { lists: [], turn: 0, isShown: false }, () => NO_PARA) as unknown as Node
    expect(texts(tree)).toEqual(['Claude 还没有列出任务。'])
  })
})
