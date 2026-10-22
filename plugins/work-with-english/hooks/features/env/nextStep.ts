// 运行环境 › 桌面端: the desktop app ends a turn with a summary card when
// Claude calls its wrap_up tool, and while that card asks a question it draws
// no band above the prompt box until the next message is sent (2.1.304,
// 实测 10-22; anthropics/claude-code#102480). So Claude is told, in the tool's
// own description, to leave the question out of the card and end its reply
// with it, where the band stays and the question is translated with the rest.

/** The desktop app's tool that draws the summary card; no other host has it */
export const WRAP_UP_TOOL = 'mcp__ccd_turn__wrap_up'

const NOTE = [
  'claude-with-english: the person practises English with a band the claude-with-english plugin draws above the prompt box, and the desktop app hides that band while this tool shows a question.',
  'So pass `recap` alone: never `ask`, `actions` or `blocked`, even when a decision waits on the person.',
  'Ask that one question as the last paragraph of your closing message instead.',
].join(' ')

/** The tool's description as the model reads it, with the note after it */
export const withQuestionInReply = (description: string): string =>
  description.includes(NOTE) ? description : `${description}\n\n${NOTE}`
