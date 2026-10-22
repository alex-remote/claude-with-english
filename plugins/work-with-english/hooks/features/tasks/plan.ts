import type { WweTaskList, WweTaskStep } from '../../../types'
import { hash } from '../../core/hash'
import type { Block } from '../../core/text/segment'

// F16 任务: the task lists, rebuilt from Claude's calls to the desktop app's
// update_plan tool, which the app draws under Claude's latest message. A call
// carries the whole list (`items`), or moves its steps: `advance` finishes the
// step in progress and starts the next, `done` and `start` name steps from 1.

/** The desktop app's task list tool; no other host has it */
export const PLAN_TOOL = 'mcp__ccd_turn__update_plan'

/** The lists kept, the newest first */
const MAX_LISTS = 30

const STATUSES: readonly WweTaskStep['status'][] = ['pending', 'in_progress', 'completed']

function stepsOf(items: unknown): WweTaskStep[] | null {
  if (!Array.isArray(items)) {
    return null
  }
  const steps = items.flatMap(item => {
    const { content, status } = (typeof item === 'object' && item !== null ? item : {}) as { content?: unknown; status?: unknown }
    return typeof content === 'string' && content.trim() !== ''
      ? [{ text: content.trim(), status: STATUSES.includes(status as WweTaskStep['status']) ? (status as WweTaskStep['status']) : 'pending' }]
      : []
  })
  return steps.length > 0 ? steps : null
}

/** The steps after `advance`, `done` and `start` */
function moved(steps: readonly WweTaskStep[], call: Record<string, unknown>): WweTaskStep[] {
  let next = [...steps]
  const set = (index: number, status: WweTaskStep['status']) => {
    next = next.map((step, i) => (i === index ? { ...step, status } : step))
  }
  if (call.advance === true) {
    const at = next.findIndex(step => step.status === 'in_progress')
    if (at >= 0) {
      set(at, 'completed')
    }
    const pending = next.findIndex((step, i) => i > at && step.status === 'pending')
    if (pending >= 0) {
      set(pending, 'in_progress')
    }
  }
  if (Array.isArray(call.done)) {
    for (const n of call.done) {
      if (typeof n === 'number') {
        set(n - 1, 'completed')
      }
    }
  }
  if (typeof call.start === 'number') {
    set(call.start - 1, 'in_progress')
  }
  return next
}

/**
 * The lists after one update_plan call made at `at` in turn `turn`: a whole
 * list goes on top, or replaces the top one when made in the same turn; a
 * move changes the top list. Null when the call changes nothing.
 */
export function applyPlan(lists: readonly WweTaskList[], call: Record<string, unknown>, at: number, turn: number): WweTaskList[] | null {
  const steps = stepsOf(call.items)
  if (steps) {
    const top = lists[0]
    const rest = top && top.turn === turn ? lists.slice(1) : lists
    return [{ at: top && top.turn === turn ? top.at : at, turn, steps: moved(steps, call) }, ...rest].slice(0, MAX_LISTS)
  }
  const top = lists[0]
  if (!top || (call.advance !== true && !Array.isArray(call.done) && typeof call.start !== 'number')) {
    return null
  }
  return [{ ...top, steps: moved(top.steps, call) }, ...lists.slice(1)]
}

/** A list's time as the pane heads it: HH:MM, local */
export function timeOf(at: number): string {
  const date = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** A step as the translation pipeline takes it: one paragraph, keyed by its text */
export const stepBlock = (text: string): Block => ({ kind: 'para', text, hash: hash(text) })
