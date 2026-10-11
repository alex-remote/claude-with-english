import { mock } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

/** The test's `on`, which the kit types but does not export by name */
type On = Parameters<TestBody>[1]

// What Claude Code answers beneath the mod in the hook tests: a store in a
// Map, files in a Map, a clock the test moves, and a model whose replies
// the test queues. Register before the test's first call on `$`.

export type World = {
  store: Map<string, unknown>
  files: Map<string, string>
  replies: string[]
  /** What each model request asked, in order */
  asked: { system?: string; prompt: string }[]
  toasts: string[]
  prompt: { text: string; cursor: number }
  filled: string[]
  submitted: string[]
  clock: ReturnType<typeof mock.clock>
}

export function world(on: On, seed: { store?: Record<string, unknown> } = {}): World {
  const w: World = {
    store: new Map(Object.entries(seed.store ?? {})),
    files: new Map(),
    replies: [],
    asked: [],
    toasts: [],
    prompt: { text: '', cursor: 0 },
    filled: [],
    submitted: [],
    clock: mock.clock(on, { now: Date.UTC(2026, 9, 12, 2, 0, 0) }),
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [{ name: 'wwe', description: '', source: 'plugin', plugin: 'work-with-english' }] }))
  on('store.get', ($, e) => ({ value: w.store.get(e.key) }))
  on('store.set', ($, e) => {
    w.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    w.store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...w.store.keys()] }))
  on('fs.read', ($, e) => {
    const text = w.files.get(e.path)
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.write', ($, e) => {
    w.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.exists', ($, e) => ({ value: w.files.has(e.path) }))
  on('process.run', ($, e) => {
    const out = e.argv[0] === 'uname' ? 'Darwin\n' : ''
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  mock.env(on, { HOME: '/Users/test' })
  on('session.id', () => ({ value: 'session-1' }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  // An empty queue answers as an overloaded API: the feature's failure path
  on('model.complete', ($, e) => {
    w.asked.push({ system: e.system, prompt: e.prompt })
    const text = w.replies.shift()
    return text === undefined
      ? { value: { isAnswered: false, reason: 'api-error', status: 529, error: 'server_error', usage } }
      : { value: { isAnswered: true, text, usage } }
  })
  on('prompt.read', () => ({ value: { ...w.prompt } }))
  on('prompt.fill', ($, e) => {
    w.filled.push(e.text)
    w.prompt = { text: e.text, cursor: e.text.length }
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('prompt.submit', ($, e) => {
    w.submitted.push(e.text)
    return { text: e.text }
  })
  return w
}

/** Starts the session as Claude Code does, then lets the start-up timers run. */
export async function start($: Engine, w: World, surface: 'terminal' | 'desktop' = 'terminal') {
  await $.session.start({ surface, isInteractive: true, cwd: '/work' })
  await w.clock.settle()
}
