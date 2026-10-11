import type { EngineInterface, Timer } from 'claude-code'

import type { WweAnalysis, WweBand, WweEnv, WwePane, WwePara, WwePick, WweSettingsView, WweSpeaking } from '../types'

type E = EngineInterface

/** One `$.state` value as the features reach it: read now, or change it and get the new value. */
export type Cell<T> = {
  get: () => Promise<T>
  update: (fn: (value: T) => T) => Promise<T>
}

/** One member per id of a `$.state` family (a reply block, a tool call). */
export type FamilyCell<T> = {
  get: (id: string) => Promise<T>
  update: (id: string, fn: (value: T) => T) => Promise<T>
}

/**
 * The engine as `session.start` bound it from its `$`, each member spelled
 * `$.noun.method(...)` in register.tsx so `claude plugin validate` sees every
 * call; the other files reach the engine through it and never touch `$`.
 * Members are added as the milestones in docs/dev-plan.md need them.
 */
export type Host = {
  clock: {
    now: () => Promise<number>
    after: (ms: number, fn: () => void) => Timer
    every: (ms: number, fn: () => void) => Timer
  }
  model: {
    complete: E['model']['complete']
  }
  http: {
    fetch: E['http']['fetch']
  }
  proc: {
    run: E['process']['run']
    spawn: E['process']['spawn']
  }
  fs: {
    read: (path: string) => Promise<string>
    /** `$.fs.read(path, { as: 'bytes' })`: `{ base64 }` */
    readBytes: (path: string) => Promise<{ base64: string }>
    write: (path: string, text: string) => Promise<void>
    list: E['fs']['list']
    exists: (path: string) => Promise<boolean>
  }
  store: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<void>
    keys: () => Promise<string[]>
  }
  env: {
    /** `$.env.get('HOME')` */
    home: () => Promise<string | undefined>
    /** `$.env.get('CLAUDE_CONFIG_DIR')` */
    configDir: () => Promise<string | undefined>
    /** `$.env.get('CLAUDE_CODE_PLUGIN_CACHE_DIR')` */
    pluginCacheDir: () => Promise<string | undefined>
    /** Whether `SSH_CONNECTION` or `SSH_TTY` is set */
    isSsh: () => Promise<boolean>
    /** Whether the Claude desktop app runs this session (it sets `CLAUDE_CODE_DESKTOP_APP_VERSION`) */
    isDesktopApp: () => Promise<boolean>
  }
  ui: {
    toast: (text: string) => void
    /** `$.ui.log` to the debug log alone, under the plugin's name */
    debug: (text: string) => void
    open: E['ui']['open']
    close: E['ui']['close']
    copy: E['ui']['copy']
    selection: E['ui']['selection']
    invalidate: () => void
  }
  prompt: {
    read: E['prompt']['read']
    fill: E['prompt']['fill']
    submit: E['prompt']['submit']
  }
  command: {
    register: E['command']['register']
    list: E['command']['list']
  }
  settings: {
    read: E['settings']['read']
  }
  config: {
    set: E['config']['set']
    list: E['config']['list']
  }
  audio: {
    speak: E['audio']['speak']
    play: E['audio']['play']
  }
  session: {
    id: E['session']['id']
    surfaces: E['session']['surfaces']
    version: E['session']['version']
  }
  plugin: {
    name: string
    root: string
  }
  /** The `$.state` values, as register.tsx binds them (its atoms must live there) */
  state: {
    settings: Cell<WweSettingsView>
    env: Cell<WweEnv>
    band: Cell<WweBand>
    speaking: Cell<WweSpeaking>
    pane: Cell<WwePane>
    /** F6: a paragraph of Claude's replies, by the hash of its text */
    para: FamilyCell<WwePara>
    /** F10, F11: what the pane's analysis view shows */
    analysis: Cell<WweAnalysis | null>
    /** F9: the selection line */
    pick: Cell<WwePick | null>
  }
}
