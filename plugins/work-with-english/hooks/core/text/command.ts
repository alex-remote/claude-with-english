// Commands and shell input (docs/feature-map.md, 语言判断 › 命令). Local
// commands such as /model only reach command.run, never prompt.submit
// (docs/references/claude-code-docs.md, 开发约定 › 命令), so a /name that
// arrives at submit is a skill or custom command: its name is not language,
// the text after it is judged as any message.

export type LeadingCommand = {
  /** As listed, without the slash */
  name: string
  /** What follows the name, leading spaces dropped; '' when nothing does */
  rest: string
}

// The name ends at a space or the end, so /Users/alex/app.ts is a path, not a command
const LEADING = /^\/([^\s/]+)(?=\s|$)/

/**
 * The command the text starts with, when its name is one of `commandNames`
 * (`$.command.list()` and the aliases): only names Claude Code knows are
 * commands, so a misspelt one is plain text, as the desktop sends it.
 */
export function parseLeadingCommand(text: string, commandNames: readonly string[]): LeadingCommand | null {
  const m = LEADING.exec(text)
  const name = m?.[1]
  if (m === null || name === undefined || !commandNames.includes(name)) {
    return null
  }
  return { name, rest: text.slice(m[0].length).replace(/^\s+/, '') }
}

/**
 * Our own /wwe, arrived as a message: the desktop app's prompt box sends a
 * mod's command on as text before it has learnt the name (#99691).
 */
export const isWweCommand = (text: string): boolean => /^\/wwe(?:\s|$)/.test(text.trim())

/** A `!` shell command on the desktop, which arrives as a message; the terminal never submits one. */
export const isShellInput = (text: string): boolean => text.trimStart().startsWith('<bash-input>')

/**
 * What of a sent message strict mode and the statistics judge: null for shell
 * input, which is neither blocked nor counted; the text after a leading
 * command's name; otherwise the whole text.
 */
export function judgedText(text: string, commandNames: readonly string[]): string | null {
  if (isShellInput(text)) {
    return null
  }
  return parseLeadingCommand(text, commandNames)?.rest ?? text
}
