import { mergeDay, toDayFile, toRow, hasUnmerged } from '../../core/stats/aggregate'
import type { DayMap, StatsRow } from '../../core/stats/aggregate'
import { dataDirOf } from '../../services/datadir'
import { readJson, writeJson } from '../../services/files'
import type { Host } from '../../host'

// F13's numbers, read back per day: a day's day.json (the days merged so
// far) plus every session file it has not merged yet, so a session open
// across midnight, or two sessions at once, are both counted. Merging the
// days before today into day.json keeps reading cheap; the session files
// stay as they are.

const DAY_FILE = 'day.json'

async function sessionsOf(host: Host, dir: string): Promise<Record<string, StatsRow>> {
  const sessions: Record<string, StatsRow> = {}
  for (const entry of await host.fs.list(dir).catch(() => [])) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json') || entry.name === DAY_FILE) {
      continue
    }
    const row = toRow(await readJson(host, `${dir}/${entry.name}`))
    if (row) {
      sessions[entry.name.slice(0, -'.json'.length)] = row
    }
  }
  return sessions
}

/** Every day with numbers, by date (YYYY-MM-DD). */
export async function loadDays(host: Host): Promise<DayMap> {
  const root = `${await dataDirOf(host)}/stats`
  const days: Record<string, StatsRow> = {}
  for (const entry of await host.fs.list(root).catch(() => [])) {
    if (entry.kind !== 'dir' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) {
      continue
    }
    const dir = `${root}/${entry.name}`
    days[entry.name] = mergeDay(toDayFile(await readJson(host, `${dir}/${DAY_FILE}`)), await sessionsOf(host, dir))
  }
  return days
}

/** The days before today: their session files merged into day.json, once. */
export async function mergePastDays(host: Host, today: string): Promise<void> {
  const root = `${await dataDirOf(host)}/stats`
  for (const entry of await host.fs.list(root).catch(() => [])) {
    if (entry.kind !== 'dir' || entry.name >= today || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) {
      continue
    }
    const dir = `${root}/${entry.name}`
    const dayFile = toDayFile(await readJson(host, `${dir}/${DAY_FILE}`))
    const sessions = await sessionsOf(host, dir)
    if (hasUnmerged(dayFile, sessions)) {
      await writeJson(host, `${dir}/${DAY_FILE}`, mergeDay(dayFile, sessions))
    }
  }
}
