import type { WweTaskList } from '../../../types'
import { TASKS_TITLE } from '../../core/copy/tasks'
import type { Block } from '../../core/text/segment'
import type { Host } from '../../host'
import { applyPlan, stepBlock } from './plan'

// F16 任务: keeps the task lists as Claude sets them, opens the pane by
// itself the first time a list comes in a session, and has every step
// translated, as the reply pipeline translates a paragraph (cached by its text).

/** The 任务 pane's id, beside the settings pane's */
export const TASKS_PANE = 'wwe-tasks'

export type Tasks = ReturnType<typeof createTasks>

export function createTasks(host: Host, deps: { translate: (blocks: readonly Block[]) => Promise<void> }) {
  /** Opens the pane: by itself once a session, or when /wwe 任务 asks */
  async function open(isAsked: boolean) {
    const placed = await host.ui.open({ id: TASKS_PANE, title: TASKS_TITLE })
    // Opened by itself where nothing could draw it (a narrow terminal, no window on the session): next list, again
    if (placed.isPlaced || isAsked) {
      await host.state.tasks.update(tasks => ({ ...tasks, isShown: true }))
    }
  }

  return {
    open,

    /** A call of the desktop app's update_plan in the main conversation */
    async onPlanCall(call: Record<string, unknown>) {
      const at = await host.clock.now()
      const changed: { lists: WweTaskList[] | null } = { lists: null }
      const tasks = await host.state.tasks.update(now => {
        changed.lists = applyPlan(now.lists, call, at, now.turn)
        return changed.lists ? { ...now, lists: changed.lists } : now
      })
      const top = changed.lists?.[0]
      if (!top) {
        return
      }
      if (!tasks.isShown) {
        await open(false)
      }
      await deps.translate(top.steps.map(step => stepBlock(step.text)))
    },

    /** The main conversation's turn ended: a list made after it is a new one */
    async onTurnEnd() {
      await host.state.tasks.update(tasks => ({ ...tasks, turn: tasks.turn + 1 }))
    },
  }
}
