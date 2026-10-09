import type { Host } from '../host'
import { dataDirOf } from './datadir'
import { readJson, writeJson } from './files'

// `$.store` is cleared after `cleanupPeriodDays` without a session reading or
// writing it, settings and all, so a copy of every key goes to the data
// directory once a day and comes back when a start finds the store empty
// (docs/dev-plan.md › 状态和存储).

export type StoreBackup = {
  v: 1
  /** The local date it was written, YYYY-MM-DD */
  date: string
  entries: Record<string, unknown>
}

/** What a start did: restored the store, wrote today's copy, found it already written, or had nothing either way. */
export type BackupOutcome = 'restored' | 'written' | 'fresh' | 'nothing'

export const backupPathOf = (dataDir: string) => `${dataDir}/backup/store.json`

export function isBackup(value: unknown): value is StoreBackup {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const { v, date, entries } = value as Record<string, unknown>
  return v === 1 && typeof date === 'string' && typeof entries === 'object' && entries !== null && !Array.isArray(entries)
}

async function readBackup(host: Host): Promise<StoreBackup | undefined> {
  const found = await readJson(host, backupPathOf(await dataDirOf(host)))
  return isBackup(found) ? found : undefined
}

async function writeBackup(host: Host, keys: readonly string[], today: string): Promise<void> {
  const entries: Record<string, unknown> = {}
  for (const key of keys) {
    entries[key] = await host.store.get(key)
  }
  const backup: StoreBackup = { v: 1, date: today, entries }
  await writeJson(host, backupPathOf(await dataDirOf(host)), backup)
}

/**
 * At start: an empty store with a backup is restored from it (the caller
 * then reloads the settings); otherwise the day's first start writes every
 * key. `today` is the local date, YYYY-MM-DD.
 */
export async function backupOrRestore(host: Host, today: string): Promise<BackupOutcome> {
  const keys = await host.store.keys()
  const backup = await readBackup(host)
  if (keys.length === 0) {
    if (!backup || Object.keys(backup.entries).length === 0) {
      return 'nothing'
    }
    for (const [key, value] of Object.entries(backup.entries)) {
      await host.store.set(key, value)
    }
    return 'restored'
  }
  if (backup?.date === today) {
    return 'fresh'
  }
  await writeBackup(host, keys, today)
  return 'written'
}

/** Rewrites the backup from the store now, so a deleted API key leaves no copy behind. */
export async function writeNow(host: Host, today: string): Promise<void> {
  await writeBackup(host, await host.store.keys(), today)
}
