import { dataDirOf } from '../../services/datadir'
import { readJson, writeJson } from '../../services/files'
import type { Host } from '../../host'

// F13's numbers as this session counts them: one file a day for this
// session, which only this session writes, so sessions sending at the same
// time never overwrite each other; reading adds the files up per day
// (core/stats/aggregate.ts).

export type DayCounts = {
  /** English messages sent with F2's translation put in (用译文) */
  used: number
  /** ... typed along a translation (照着敲) */
  retyped: number
  /** ... written without one (直接写) */
  direct: number
  /** Words of Claude's replies in the target language */
  words: number
  /** Word book: words and sentences added */
  newWords: number
  newSents: number
}

export const NO_COUNTS: DayCounts = { used: 0, retyped: 0, direct: 0, words: 0, newWords: 0, newSents: 0 }

export const statsFileOf = (dataDir: string, date: string, sessionId: string) =>
  `${dataDir}/stats/${date}/${sessionId.replace(/[^A-Za-z0-9_-]/g, '-')}.json`

function countsOf(value: unknown): DayCounts {
  const counts = { ...NO_COUNTS }
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(NO_COUNTS) as (keyof DayCounts)[]) {
      const n = (value as Record<string, unknown>)[key]
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) {
        counts[key] = n
      }
    }
  }
  return counts
}

// One write at a time, so two quick increments of the same file both land
const queues = new WeakMap<Host, Promise<unknown>>()

/** Adds to today's counts of this session. */
export function addToDay(host: Host, date: string, add: Partial<DayCounts>): Promise<void> {
  const before = queues.get(host) ?? Promise.resolve()
  const job = before
    .catch(() => undefined)
    .then(async () => {
      const path = statsFileOf(await dataDirOf(host), date, await host.session.id())
      const counts = countsOf(await readJson(host, path))
      for (const [key, n] of Object.entries(add) as [keyof DayCounts, number][]) {
        counts[key] += n
      }
      await writeJson(host, path, counts)
    })
  queues.set(host, job)
  return job
}

/** An English message entered, written one of F13's three ways. */
export const recordSent = (host: Host, date: string, way: 'used' | 'retyped' | 'direct') =>
  addToDay(host, date, { [way]: 1 })
