import type { CommandSpec, Timer } from 'claude-code'

/**
 * The engine as `session.start` bound it from its `$`, each member spelled
 * `$.noun.method(...)` in register.tsx so `claude plugin validate` sees every
 * call; the other files reach the engine through it and never touch `$`.
 * Members are added as the milestones in docs/dev-plan.md need them.
 */
export type Host = {
  /** `$.clock.now` */
  now: () => Promise<number>
  /** `$.clock.after` */
  after: (ms: number, fn: () => void) => Timer
  /** `$.clock.every` */
  every: (ms: number, fn: () => void) => Timer
  /** `$.store.get` */
  storeGet: (key: string) => Promise<unknown>
  /** `$.store.set` */
  storeSet: (key: string, value: unknown) => Promise<void>
  /** `$.ui.toast` */
  toast: (text: string) => void
  /** `$.ui.log` to the debug log alone, under the plugin's name */
  debug: (text: string) => void
  /** `$.command.register` */
  registerCommand: (spec: CommandSpec) => Promise<unknown>
}
