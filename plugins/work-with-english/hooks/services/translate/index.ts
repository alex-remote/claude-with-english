import { coerceSetting, storeKeyOf } from '../../core/settings/schema'
import type { SettingKey } from '../../core/settings/schema'
import type { Host } from '../../host'
import type { WweSettings } from '../../../types'
import { completeWithClaude } from './claude'
import { badFormat, cancelled, describe, generic, notImplemented, timedOut } from './errors'
import type { Described } from './errors'
import { draftPrompt, parseDraft } from './prompts'
import type { Failed, Prompt, Task, TaskKind, TranslateResult, ValueOf } from './types'

// The one way features reach a model: pick the transport the settings name,
// queue behind the two requests already out, retry a reply that does not
// read once, and put any failure in words.

/** At most this many requests out at once; the rest wait their turn. */
export const MAX_CONCURRENT = 2

// What a turn's end translates on its own (F6: replies, plans, questions)
// can come many at once; a request the user started and waits on (the
// band, a button, a lookup) goes ahead of them in the queue.
const AUTOMATIC: ReadonlySet<TaskKind> = new Set(['replyBlock', 'plan', 'ask'])

export type Limiter = {
  /**
   * True once a slot is held; false when the signal aborts first, and no slot
   * is taken. An urgent waiter goes ahead of every waiter that is not.
   */
  acquire: (signal?: AbortSignal, isUrgent?: boolean) => Promise<boolean>
  release: () => void
  readonly running: number
  readonly waiting: number
}

type Waiter = { grant: () => void; isUrgent: boolean }

export function createLimiter(max: number): Limiter {
  let running = 0
  const queue: Waiter[] = []
  return {
    get running() {
      return running
    },
    get waiting() {
      return queue.length
    },
    acquire(signal, isUrgent = false) {
      if (signal?.aborted) {
        return Promise.resolve(false)
      }
      if (running < max) {
        running += 1
        return Promise.resolve(true)
      }
      return new Promise<boolean>(resolve => {
        const waiter: Waiter = {
          isUrgent,
          grant: () => {
            signal?.removeEventListener('abort', leave)
            running += 1
            resolve(true)
          },
        }
        const leave = () => {
          const at = queue.indexOf(waiter)
          if (at >= 0) {
            queue.splice(at, 1)
          }
          resolve(false)
        }
        const behind = isUrgent ? queue.findIndex(other => !other.isUrgent) : -1
        if (behind < 0) {
          queue.push(waiter)
        } else {
          queue.splice(behind, 0, waiter)
        }
        signal?.addEventListener('abort', leave, { once: true })
      })
    },
    release() {
      running -= 1
      queue.shift()?.grant()
    },
  }
}

// One per Host, as the engine that sends the requests is one per session
const limiters = new WeakMap<Host, Limiter>()

function limiterOf(host: Host): Limiter {
  let limiter = limiters.get(host)
  if (!limiter) {
    limiter = createLimiter(MAX_CONCURRENT)
    limiters.set(host, limiter)
  }
  return limiter
}

/** Read now, not from the mirror: a change in another session applies at the next request. */
async function readSetting<K extends SettingKey>(host: Host, key: K): Promise<WweSettings[K]> {
  return coerceSetting(key, await host.store.get(storeKeyOf(key)))
}

type Job = {
  prompt: Prompt
  /** The text whose length sets the reply's token cap */
  source: string
  /** The value, or undefined when the reply does not read as one */
  parse: (reply: string) => unknown
}

function jobOf(task: Task): Job | null {
  switch (task.kind) {
    case 'draft':
      return { prompt: draftPrompt(task.text), source: task.text, parse: parseDraft }
    default:
      return null
  }
}

const failed = (described: Described): Failed => ({ ok: false, ...described })

/**
 * Whether the caller's signal says the request is no longer wanted. A
 * ticket of core/async/slot.ts aborted for its own timeout stays current,
 * so its failure must read as the timeout, not as cancelled.
 */
const isCancelledBy = (signal: AbortSignal | undefined) => signal?.aborted === true && signal.reason !== 'timeout'

const abortedBy = (signal: AbortSignal | undefined): Described => (isCancelledBy(signal) ? cancelled : timedOut)

export type RunOptions = {
  /**
   * Aborted when a newer request takes this one's place: the result is then
   * `cancelled`. Aborted with the reason 'timeout', as a slot ticket's own
   * `abort` does, it is the timeout.
   */
  signal?: AbortSignal
}

export async function run<T extends Task>(
  host: Host,
  task: T,
  options: RunOptions = {},
): Promise<TranslateResult<ValueOf[T['kind']]>> {
  const { signal } = options
  if (signal?.aborted) {
    return failed(abortedBy(signal))
  }
  const job = jobOf(task)
  let service: WweSettings['translateService']
  let model: string
  try {
    service = await readSetting(host, 'translateService')
    model = await readSetting(host, 'claudeModel')
  } catch (error) {
    host.ui.debug(`translate ${task.kind}: the settings could not be read: ${String(error)}`)
    return failed(generic)
  }
  // The OpenAI-compatible transport arrives in M6
  if (!job || service !== 'claude') {
    return failed(notImplemented)
  }

  const limiter = limiterOf(host)
  if (!(await limiter.acquire(signal, !AUTOMATIC.has(task.kind)))) {
    return failed(abortedBy(signal))
  }
  try {
    // A reply that is empty or does not parse gets one more try
    for (let attempt = 1; ; attempt += 1) {
      const outcome = await completeWithClaude(host, job.prompt, { model, source: job.source, signal })
      if (outcome.ok) {
        const value = job.parse(outcome.text)
        if (value !== undefined) {
          return { ok: true, value: value as ValueOf[T['kind']] }
        }
        if (attempt < 2) {
          continue
        }
        host.ui.debug(`translate ${task.kind}: the reply did not parse twice`)
        return failed(badFormat)
      }
      if (outcome.reason === 'empty-reply' && attempt < 2) {
        continue
      }
      const described = describe(outcome, service, isCancelledBy(signal))
      if (outcome.reason === 'reject') {
        host.ui.debug(`translate ${task.kind}: the engine refused the request (${outcome.cause}): ${outcome.message}`)
      } else if (outcome.reason === 'api-error') {
        host.ui.debug(`translate ${task.kind}: api-error ${outcome.status ?? 'no status'} ${outcome.error}`)
      }
      return failed(described)
    }
  } finally {
    limiter.release()
  }
}
