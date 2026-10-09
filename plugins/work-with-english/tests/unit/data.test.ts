import { describe, expect, test } from 'claude-code/testing'

import type { Host } from '../../hooks/host'
import { dataDirFrom, dataDirOf, dirNameOfId, pluginIdOf } from '../../hooks/services/datadir'
import { isInside, readJson, remove, removeDir, sizeOfKb, sumDuKb, writeJson } from '../../hooks/services/files'
import { backupOrRestore, backupPathOf, writeNow } from '../../hooks/services/storeBackup'

type RunResult = { exitCode: number; stdout: string; stderr: string }

type FakeOptions = {
  root?: string
  home?: string
  configDir?: string
  pluginCacheDir?: string
  files?: Record<string, string>
  store?: Record<string, unknown>
  run?: (argv: readonly string[]) => RunResult
}

const HOME = '/Users/alex'
const DEV_ROOT = '/Users/alex/Projects/claude-with-english/plugins/work-with-english'
const DEV_DATA = '/Users/alex/.claude/plugins/data/work-with-english-inline'

/** The members the data layer uses, over a Map of files and a Map store. */
function fakeHost(options: FakeOptions = {}) {
  const files = new Map(Object.entries(options.files ?? {}))
  const store = new Map(Object.entries(options.store ?? {}))
  const runs: string[][] = []
  let envReads = 0
  const env = (value: string | undefined) => async () => {
    envReads += 1
    return value
  }
  const host = {
    fs: {
      read: async (path: string) => {
        const text = files.get(path)
        if (text === undefined) {
          throw new Error(`no such file: ${path}`)
        }
        return text
      },
      write: async (path: string, text: string) => {
        files.set(path, text)
      },
    },
    store: {
      get: async (key: string) => store.get(key),
      set: async (key: string, value: unknown) => {
        store.set(key, value)
      },
      delete: async (key: string) => {
        store.delete(key)
      },
      keys: async () => [...store.keys()],
    },
    proc: {
      run: async (argv: readonly string[]) => {
        runs.push([...argv])
        const result = options.run?.(argv) ?? { exitCode: 0, stdout: '', stderr: '' }
        return { ...result, isStdoutTruncated: false, isStderrTruncated: false }
      },
    },
    env: {
      home: env(options.home ?? HOME),
      configDir: env(options.configDir),
      pluginCacheDir: env(options.pluginCacheDir),
    },
    plugin: { name: 'work-with-english', root: options.root ?? DEV_ROOT },
  }
  return { host: host as unknown as Host, files, store, runs, envReads: () => envReads }
}

describe('data directory', () => {
  test('a plugin loaded from a directory is <name>@inline under ~/.claude/plugins/data', async () => {
    const { host } = fakeHost()
    expect(await dataDirOf(host)).toBe(DEV_DATA)
  })

  test('an installed plugin is <name>@<marketplace>', async () => {
    const { host } = fakeHost({
      root: '/Users/alex/.claude/plugins/cache/work-with-english/work-with-english/0.1.0',
    })
    expect(await dataDirOf(host)).toBe('/Users/alex/.claude/plugins/data/work-with-english-work-with-english')
  })

  test('CLAUDE_CONFIG_DIR moves the plugins root', async () => {
    const dev = fakeHost({ configDir: '/opt/claude/' })
    expect(await dataDirOf(dev.host)).toBe('/opt/claude/plugins/data/work-with-english-inline')

    const installed = fakeHost({
      configDir: '/opt/claude',
      root: '/opt/claude/plugins/cache/team-tools/work-with-english/1.2.0/',
    })
    expect(await dataDirOf(installed.host)).toBe('/opt/claude/plugins/data/work-with-english-team-tools')
  })

  test('CLAUDE_CODE_PLUGIN_CACHE_DIR is the plugins root itself, over CLAUDE_CONFIG_DIR', async () => {
    const dev = fakeHost({ configDir: '/opt/claude', pluginCacheDir: '/var/plugins' })
    expect(await dataDirOf(dev.host)).toBe('/var/plugins/data/work-with-english-inline')

    const installed = fakeHost({
      pluginCacheDir: '/var/plugins',
      root: '/var/plugins/cache/work-with-english/work-with-english/0.1.0',
    })
    expect(await dataDirOf(installed.host)).toBe('/var/plugins/data/work-with-english-work-with-english')
  })

  test('a cache outside the plugins root in use is not the install cache', () => {
    const inputs = {
      pluginRoot: '/Users/alex/.claude/plugins/cache/work-with-english/work-with-english/0.1.0',
      pluginName: 'work-with-english',
      home: HOME,
      configDir: undefined,
      pluginCacheDir: '/var/plugins',
    }
    expect(dataDirFrom(inputs)).toBe('/var/plugins/data/work-with-english-inline')
  })

  test('the cache directory itself, without a version, is not an install', () => {
    expect(pluginIdOf('/p', '/p/cache/market/work-with-english', 'work-with-english')).toBe('work-with-english@inline')
  })

  test('characters other than letters, digits, _ and - become -', () => {
    expect(dirNameOfId('work-with-english@inline')).toBe('work-with-english-inline')
    expect(dirNameOfId('my.plugin@some market')).toBe('my-plugin-some-market')
    expect(dirNameOfId('a_b-C9@x')).toBe('a_b-C9-x')
  })

  test('the path is worked out once per Host', async () => {
    const fake = fakeHost()
    await dataDirOf(fake.host)
    const reads = fake.envReads()
    expect(await dataDirOf(fake.host)).toBe(DEV_DATA)
    expect(fake.envReads()).toBe(reads)
  })
})

describe('files', () => {
  test('readJson: a missing file and a cut-short one are both a miss', async () => {
    const { host } = fakeHost({
      files: { [`${DEV_DATA}/half.json`]: '{"v":1,"paras":{"a":"译', [`${DEV_DATA}/ok.json`]: '{"v":1}' },
    })
    expect(await readJson(host, `${DEV_DATA}/none.json`)).toBeUndefined()
    expect(await readJson(host, `${DEV_DATA}/half.json`)).toBeUndefined()
    expect(await readJson(host, `${DEV_DATA}/ok.json`)).toEqual({ v: 1 })
  })

  test('writeJson writes what readJson reads back', async () => {
    const { host, files } = fakeHost()
    await writeJson(host, `${DEV_DATA}/drafts/ab/x.json`, { zh: '帮我看看', sawTr: true })
    expect(files.get(`${DEV_DATA}/drafts/ab/x.json`)).toBe('{"zh":"帮我看看","sawTr":true}')
    expect(await readJson(host, `${DEV_DATA}/drafts/ab/x.json`)).toEqual({ zh: '帮我看看', sawTr: true })
  })

  test('isInside: only paths strictly under the directory', () => {
    expect(isInside(DEV_DATA, `${DEV_DATA}/replies/ab/c.json`)).toBe(true)
    expect(isInside(DEV_DATA, DEV_DATA)).toBe(false)
    expect(isInside(DEV_DATA, `${DEV_DATA}/`)).toBe(false)
    expect(isInside(DEV_DATA, `${DEV_DATA}-evil/x`)).toBe(false)
    expect(isInside(DEV_DATA, `${DEV_DATA}/../../settings.json`)).toBe(false)
    expect(isInside(DEV_DATA, `${DEV_DATA}/replies/./x`)).toBe(false)
    expect(isInside(DEV_DATA, `${DEV_DATA}//x`)).toBe(false)
    expect(isInside(DEV_DATA, '/Users/alex/.claude/settings.json')).toBe(false)
    expect(isInside('relative', 'relative/x')).toBe(false)
  })

  test('remove runs rm -f on a file inside the data directory', async () => {
    const { host, runs } = fakeHost()
    await remove(host, `${DEV_DATA}/tts/ab/c.mp3`)
    expect(runs).toEqual([['rm', '-f', `${DEV_DATA}/tts/ab/c.mp3`]])
  })

  test('removeDir runs rm -rf, as 清除缓存 does for replies and tts', async () => {
    const { host, runs } = fakeHost()
    await removeDir(host, `${DEV_DATA}/replies`)
    await removeDir(host, `${DEV_DATA}/tts`)
    expect(runs).toEqual([
      ['rm', '-rf', `${DEV_DATA}/replies`],
      ['rm', '-rf', `${DEV_DATA}/tts`],
    ])
  })

  test('a path outside the data directory is refused before anything runs', async () => {
    const { host, runs } = fakeHost()
    await expect(remove(host, '/Users/alex/.claude/settings.json')).rejects.toThrow('not inside the data directory')
    await expect(removeDir(host, `${DEV_DATA}/../..`)).rejects.toThrow('not inside the data directory')
    await expect(removeDir(host, DEV_DATA)).rejects.toThrow('not inside the data directory')
    await expect(removeDir(host, '/')).rejects.toThrow('not inside the data directory')
    expect(runs).toEqual([])
  })

  test('a failed rm rejects with its stderr', async () => {
    const { host } = fakeHost({ run: () => ({ exitCode: 1, stdout: '', stderr: 'Permission denied\n' }) })
    await expect(remove(host, `${DEV_DATA}/x.json`)).rejects.toThrow('Permission denied')
  })

  test('sizeOfKb sums du -sk, a missing directory counting 0', async () => {
    const { host, runs } = fakeHost({
      run: () => ({
        exitCode: 1,
        stdout: `128\t${DEV_DATA}/replies\n`,
        stderr: `du: ${DEV_DATA}/tts: No such file or directory\n`,
      }),
    })
    expect(await sizeOfKb(host, [`${DEV_DATA}/replies`, `${DEV_DATA}/tts`])).toBe(128)
    expect(runs).toEqual([['du', '-sk', `${DEV_DATA}/replies`, `${DEV_DATA}/tts`]])
  })

  test('sumDuKb reads each line', () => {
    expect(sumDuKb('12\t/a\n30\t/b c\n')).toBe(42)
    expect(sumDuKb('')).toBe(0)
  })

  test('sizeOfKb of no paths runs nothing', async () => {
    const { host, runs } = fakeHost()
    expect(await sizeOfKb(host, [])).toBe(0)
    expect(runs).toEqual([])
  })
})

describe('store backup', () => {
  const BACKUP = backupPathOf(DEV_DATA)
  const STORE = { 'settings/delayMs': 1500, 'settings/openaiKey': 'sk-test-1234', 'flag/tipDate': '2026-10-08' }

  test('the backup sits in the data directory', () => {
    expect(BACKUP).toBe(`${DEV_DATA}/backup/store.json`)
  })

  test('the day’s first start writes every key with the date', async () => {
    const { host, files } = fakeHost({ store: STORE })
    expect(await backupOrRestore(host, '2026-10-09')).toBe('written')
    expect(JSON.parse(files.get(BACKUP) ?? '')).toEqual({ v: 1, date: '2026-10-09', entries: STORE })
  })

  test('a later start the same day leaves it; the next day writes it again', async () => {
    const { host, files, store } = fakeHost({ store: STORE })
    await backupOrRestore(host, '2026-10-09')
    store.set('settings/strict', false)
    expect(await backupOrRestore(host, '2026-10-09')).toBe('fresh')
    expect(JSON.parse(files.get(BACKUP) ?? '').entries).toEqual(STORE)

    expect(await backupOrRestore(host, '2026-10-10')).toBe('written')
    expect(JSON.parse(files.get(BACKUP) ?? '')).toEqual({
      v: 1,
      date: '2026-10-10',
      entries: { ...STORE, 'settings/strict': false },
    })
  })

  test('an empty store comes back from the backup', async () => {
    const backup = { v: 1, date: '2026-09-01', entries: STORE }
    const { host, store, files } = fakeHost({ files: { [BACKUP]: JSON.stringify(backup) } })
    expect(await backupOrRestore(host, '2026-10-09')).toBe('restored')
    expect(Object.fromEntries(store)).toEqual(STORE)
    expect(files.get(BACKUP)).toBe(JSON.stringify(backup))
  })

  test('an empty store and no backup: nothing to do', async () => {
    const { host, files } = fakeHost()
    expect(await backupOrRestore(host, '2026-10-09')).toBe('nothing')
    expect(files.size).toBe(0)
  })

  test('a backup cut short is no backup', async () => {
    const { host, store } = fakeHost({ files: { [BACKUP]: '{"v":1,"date":"2026-10-08","entries":{"settings/de' } })
    expect(await backupOrRestore(host, '2026-10-09')).toBe('nothing')
    expect(store.size).toBe(0)
  })

  test('writeNow after a deleted key leaves no copy of it', async () => {
    const { host, files, store } = fakeHost({ store: STORE })
    await backupOrRestore(host, '2026-10-09')
    store.delete('settings/openaiKey')
    await writeNow(host, '2026-10-09')
    const written = files.get(BACKUP) ?? ''
    expect(written).not.toContain('sk-test-1234')
    expect(JSON.parse(written).entries).toEqual({ 'settings/delayMs': 1500, 'flag/tipDate': '2026-10-08' })
  })
})
