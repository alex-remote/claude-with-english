// A request slot: one place on screen (the band's rows, a paragraph's
// translation, the selection row) shows only its newest request's result
// (通用状态 › 被取代). Beginning a request aborts the one before it.
// `$.model.complete` answers `aborted` both when its timeoutMs runs out and
// when its signal is aborted (docs/references/claude-code-docs.md, 调模型),
// so a result is told apart by whether its ticket is still current.

/** 通用状态 › 失败: a request with no result in 30 seconds has failed */
export const REQUEST_TIMEOUT_MS = 30_000

/** One request begun in a slot. */
export type Ticket = {
  /** Counts up with each request the slot begins */
  readonly gen: number
  /** Aborted when a newer request begins, the slot is cancelled, or `abort` is called */
  readonly signal: AbortSignal
  /** Still the slot's newest request: its result may be shown */
  isCurrent: () => boolean
  /** Stops this request alone (it timed out), leaving it current so its failure is shown */
  abort: () => void
}

export type Slot = {
  begin: () => Ticket
  /** Aborts the request in flight; nothing is current until the next `begin` */
  cancel: () => void
}

export function createSlot(): Slot {
  let gen = 0
  let controller: AbortController | null = null

  return {
    begin() {
      controller?.abort('superseded')
      const own = new AbortController()
      controller = own
      const mine = ++gen
      return {
        gen: mine,
        signal: own.signal,
        isCurrent: () => mine === gen,
        abort: () => own.abort('timeout'),
      }
    },
    cancel() {
      controller?.abort('cancelled')
      controller = null
      gen++
    },
  }
}

/** `Host.clock.after`'s shape, so a test can drive the timeout by hand. */
export type After = (ms: number, fn: () => void) => { cancel: () => void }

export type Raced<T> = { timedOut: false; value: T } | { timedOut: true }

/**
 * The promise's value, or `{ timedOut: true }` when `ms` passes first; for
 * `$.http.fetch`, which has no timeout and can't be cancelled. A rejection
 * before the timeout rejects; anything the promise does after it is dropped.
 */
export function raceTimeout<T>(promise: Promise<T>, ms: number, after: After): Promise<Raced<T>> {
  return new Promise<Raced<T>>((resolve, reject) => {
    let isSettled = false
    const timer = after(ms, () => {
      if (!isSettled) {
        isSettled = true
        resolve({ timedOut: true })
      }
    })
    promise.then(
      value => {
        if (!isSettled) {
          isSettled = true
          timer.cancel()
          resolve({ timedOut: false, value })
        }
      },
      (error: unknown) => {
        if (!isSettled) {
          isSettled = true
          timer.cancel()
          reject(error)
        }
      },
    )
  })
}
