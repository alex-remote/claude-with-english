import type { Host } from '../host'
import { dataDirOf } from './datadir'

// The data directory's files. `$.fs` has no delete, so removal runs `rm`;
// it is held to paths inside the data directory, so a wrong path built from
// a hash or a setting can never reach the user's own files.

/**
 * A file's JSON, or undefined when there is none or it does not parse: a
 * write another session had not finished counts as a miss, never an error.
 */
export async function readJson(host: Host, path: string): Promise<unknown> {
  let text: string
  try {
    text = await host.fs.read(path)
  } catch {
    return undefined
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** `$.fs.write` makes the parent directories. */
export async function writeJson(host: Host, path: string, value: unknown): Promise<void> {
  await host.fs.write(path, JSON.stringify(value))
}

/**
 * Whether `path` names something strictly inside `dir`: absolute, with no
 * `.`, `..` or empty segment that could lead back out of it.
 */
export function isInside(dir: string, path: string): boolean {
  if (!dir.startsWith('/') || !path.startsWith(`${dir}/`)) {
    return false
  }
  const rest = path.slice(dir.length + 1).split('/')
  return rest.every(part => part !== '' && part !== '.' && part !== '..')
}

async function rm(host: Host, flags: string, path: string): Promise<void> {
  const dataDir = await dataDirOf(host)
  if (!isInside(dataDir, path)) {
    throw new Error(`refused to remove ${path}: it is not inside the data directory ${dataDir}`)
  }
  const { exitCode, stderr } = await host.proc.run(['rm', flags, path])
  if (exitCode !== 0) {
    throw new Error(`rm ${flags} ${path} exited ${exitCode}: ${stderr.trim()}`)
  }
}

/** Deletes one file of the data directory; a file already gone is fine. */
export const remove = (host: Host, path: string) => rm(host, '-f', path)

/** Deletes a directory of the data directory and everything in it. */
export const removeDir = (host: Host, path: string) => rm(host, '-rf', path)

/** The KB each line of `du -sk` starts with, summed; a line `du` could not size has none. */
export function sumDuKb(stdout: string): number {
  let total = 0
  for (const line of stdout.split('\n')) {
    const match = /^(\d+)\s/.exec(line)
    if (match?.[1]) {
      total += Number(match[1])
    }
  }
  return total
}

/**
 * The disk space the paths take, in KB (`du -sk`). A path that does not
 * exist counts as 0: `du` names it on stderr and still sizes the others.
 */
export async function sizeOfKb(host: Host, paths: string | readonly string[]): Promise<number> {
  const list = typeof paths === 'string' ? [paths] : [...paths]
  if (list.length === 0) {
    return 0
  }
  const { stdout } = await host.proc.run(['du', '-sk', ...list])
  return sumDuKb(stdout)
}
