import type { Elements } from 'claude-code'

import type { WwePara, WweTasks } from '../../../types'
import { progressInline } from '../../core/copy/common'
import { TASKS_EMPTY } from '../../core/copy/tasks'
import { timeOf } from './plan'

// F16 任务: the task lists the newest first, each headed by its time; each
// step with its mark and, under it in grey, its translation.

export type TasksUi = Pick<Elements['terminal'] | Elements['desktop'], 'Box' | 'Text'>

const MARKS = { completed: '✓', in_progress: '▸', pending: '○' } as const

/** Under a step: its translation, 翻译中…, why there is none, or nothing (a step not in English) */
const underOf = (para: WwePara) =>
  para.status === 'pending' ? progressInline('翻译') : para.status === 'failed' ? para.error : para.status === 'done' ? para.zh : null

export function tasksView(ui: TasksUi, tasks: WweTasks, paraOf: (text: string) => WwePara) {
  const { Box, Text } = ui
  if (tasks.lists.length === 0) {
    return <Text dimColor>{TASKS_EMPTY}</Text>
  }
  return (
    <Box flexDirection="column" rowGap={1}>
      {tasks.lists.map((list, i) => (
        <Box key={`list-${list.at}-${i}`} flexDirection="column">
          <Text dimColor>{timeOf(list.at)}</Text>
          {list.steps.map((step, j) => {
            const under = underOf(paraOf(step.text))
            return (
              <Box key={`step-${i}-${j}`} flexDirection="row" columnGap={1}>
                <Text dimColor={step.status === 'pending'}>{MARKS[step.status]}</Text>
                <Box flexDirection="column" flexShrink={1}>
                  <Text dimColor={step.status === 'completed'}>{step.text}</Text>
                  {under && <Text dimColor>{under}</Text>}
                </Box>
              </Box>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}
