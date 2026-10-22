// F16 任务: the pane that keeps the desktop app's task lists, each step with its translation.

export const TASKS_TITLE = '任务'

/** What follows /wwe to open the pane: the source language's word, or the target language's */
export const TASKS_ARGS: readonly string[] = ['任务', 'task', 'tasks']

/** Whether what follows /wwe asks for the pane */
export const isTasksArg = (args: string) => TASKS_ARGS.includes(args.trim().toLowerCase())

export const TASKS_EMPTY = 'Claude 还没有列出任务。'

/** /wwe 任务 arrived as a message (the desktop app before it knows the command): the reason it was not sent */
export const tasksOpenedFromMessage = () => '已打开任务，这条命令没有发给 Claude。'
