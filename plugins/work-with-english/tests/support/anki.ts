import type { Host } from '../../hooks/host'
import { findNotesQuery } from '../../hooks/services/anki/notes'

// A Host for the word book's tests: its files are a Map, and its AnkiConnect
// is a stand-in that keeps decks, card types and notes as Anki 26.9.3
// answered them (2026-10-06).

export const DATA = '/Users/alex/.claude/plugins/data/work-with-english-inline'
export const T0 = Date.UTC(2026, 9, 11, 2, 0, 0)

export type Loose = Record<string, any>
export type Note = { id: number; modelName: string; deckName: string; fields: Record<string, string> }

/** AnkiConnect as the stand-in answers it: { result, error } for each action the sync uses */
export function fakeAnki() {
  const state = {
    isOpen: true,
    /** Anki open but asleep: the request never answers */
    isHung: false,
    permission: { permission: 'granted', requireApiKey: false, version: 6 } as Loose,
    decks: ['Default'],
    models: new Map<string, { id: number; fields: string[] }>(),
    notes: new Map<number, Note>(),
    /** Notes open in Anki's browser: updateNoteFields leaves them as they are */
    editing: new Set<number>(),
    calls: [] as { action: string; params: Loose; version: unknown; url: string; method: string | undefined }[],
    nextId: 1000,
  }
  const firstField = (modelName: string) => state.models.get(modelName)?.fields[0] ?? ''

  function handle(action: string, params: Loose): unknown {
    switch (action) {
      case 'requestPermission':
        return state.permission
      case 'deckNames':
        return [...state.decks]
      case 'createDeck':
        state.decks.push(params.deck)
        return ++state.nextId
      case 'modelNamesAndIds':
        return Object.fromEntries([...state.models].map(([name, m]) => [name, m.id]))
      case 'modelFieldNames': {
        const model = state.models.get(params.modelName)
        if (!model) {
          throw new Error(`model was not found: ${params.modelName}`)
        }
        return [...model.fields]
      }
      case 'createModel': {
        if (state.models.has(params.modelName)) {
          throw new Error('Model name already exists')
        }
        const id = ++state.nextId
        state.models.set(params.modelName, { id, fields: [...params.inOrderFields] })
        return { id, name: params.modelName }
      }
      case 'findNotes':
        return [...state.notes.values()]
          .filter(n => {
            const field = firstField(n.modelName)
            return findNotesQuery(n.modelName, field, n.fields[field] ?? '') === params.query
          })
          .map(n => n.id)
      case 'notesInfo':
        return (params.notes as number[]).map(id => {
          const n = state.notes.get(id)
          return n
            ? {
                noteId: n.id,
                modelName: n.modelName,
                tags: [],
                fields: Object.fromEntries(Object.entries(n.fields).map(([name, value], order) => [name, { value, order }])),
                cards: [],
              }
            : {}
        })
      case 'updateNoteFields': {
        const n = state.notes.get(params.note.id)
        if (!n) {
          throw new Error('Note was not found')
        }
        if (!state.editing.has(n.id)) {
          Object.assign(n.fields, params.note.fields)
        }
        return null
      }
      case 'addNote': {
        const { deckName, modelName, fields, audio } = params.note
        const model = state.models.get(modelName)
        if (!model) {
          throw new Error(`model was not found: ${modelName}`)
        }
        if (!state.decks.includes(deckName)) {
          throw new Error(`deck was not found: ${deckName}`)
        }
        const first = firstField(modelName)
        if ([...state.notes.values()].some(n => n.modelName === modelName && n.fields[first] === fields[first])) {
          throw new Error('cannot create note because it is a duplicate')
        }
        const own: Record<string, string> = { ...fields }
        for (const clip of (audio ?? []) as Loose[]) {
          for (const field of clip.fields as string[]) {
            own[field] = `${own[field] ?? ''}[sound:${clip.filename}]`
          }
        }
        const id = ++state.nextId
        state.notes.set(id, { id, modelName, deckName, fields: own })
        return id
      }
      default:
        throw new Error('unsupported action')
    }
  }

  const reply = (body: unknown) => ({ status: 200, ok: true, headers: {}, text: JSON.stringify(body) })

  const fetch = async (url: string, init?: { method?: string; body?: string }) => {
    if (!state.isOpen) {
      throw new Error('connect ECONNREFUSED 127.0.0.1:8765')
    }
    if (state.isHung) {
      return new Promise(() => {})
    }
    const { action, version, params } = JSON.parse(init?.body ?? '{}') as Loose
    state.calls.push({ action, params: params ?? {}, version, url, method: init?.method })
    try {
      return reply({ result: handle(action, params ?? {}), error: null })
    } catch (error) {
      return reply({ result: null, error: (error as Error).message })
    }
  }

  const actions = () => state.calls.map(c => c.action)
  const notesOf = (modelName: string) => [...state.notes.values()].filter(n => n.modelName === modelName)
  return { state, fetch, actions, notesOf }
}

export type FakeAnki = ReturnType<typeof fakeAnki>

export type FakeOptions = {
  anki?: FakeAnki
  store?: Record<string, unknown>
  sayFails?: boolean
  /** What the model answers a translation with; null or absent, it fails */
  translation?: string | null
}

export function fakeHost(options: FakeOptions = {}) {
  const anki = options.anki ?? fakeAnki()
  const files = new Map<string, string>()
  const store = new Map(Object.entries(options.store ?? {}))
  const runs: string[][] = []
  const timers: number[] = []
  const asked: string[] = []
  const debug: string[] = []
  const clock = { ms: T0 }
  const ok = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
  const host = {
    clock: {
      now: async () => clock.ms,
      after: (ms: number, fn: () => void) => {
        timers.push(ms)
        let isCancelled = false
        // An Anki that does not answer: the time runs out at once
        if (anki.state.isHung) {
          void Promise.resolve().then(() => {
            if (!isCancelled) {
              fn()
            }
          })
        }
        return {
          cancel: () => {
            isCancelled = true
          },
        }
      },
    },
    http: { fetch: anki.fetch },
    proc: {
      run: async (argv: readonly string[]) => {
        runs.push([...argv])
        if (argv[0] === 'rm') {
          files.delete(argv[argv.length - 1] ?? '')
        }
        if (argv[0] === 'say') {
          if (options.sayFails) {
            return { ...ok, exitCode: 1, stderr: 'Opening output file failed\n' }
          }
          files.set(argv[argv.indexOf('-o') + 1] ?? '', 'm4a')
        }
        return ok
      },
    },
    fs: {
      read: async (path: string) => {
        const text = files.get(path)
        if (text === undefined) {
          throw new Error(`ENOENT: ${path}`)
        }
        return text
      },
      write: async (path: string, text: string) => {
        files.set(path, text)
      },
      exists: async (path: string) => files.has(path),
      list: async (dir: string) => {
        const prefix = `${dir}/`
        const names = [...files.keys()]
          .filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
          .map(path => path.slice(prefix.length))
        if (names.length === 0) {
          throw new Error(`ENOENT: ${dir}`)
        }
        return names.map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false }))
      },
    },
    store: {
      get: async (key: string) => store.get(key),
      set: async (key: string, value: unknown) => {
        store.set(key, value)
      },
    },
    env: {
      home: async () => '/Users/alex',
      configDir: async () => undefined,
      pluginCacheDir: async () => undefined,
    },
    plugin: { name: 'work-with-english', root: '/Users/alex/Projects/claude-with-english/plugins/work-with-english' },
    session: { id: async () => 'sess-1' },
    ui: { debug: (text: string) => debug.push(text) },
    model: {
      complete: async (request: { prompt: string }) => {
        asked.push(request.prompt)
        const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
        return options.translation === null || options.translation === undefined
          ? { isAnswered: false, reason: 'api-error', status: 500, error: 'overloaded', usage }
          : { isAnswered: true, text: options.translation, usage }
      },
    },
  }
  /** F13's counts of this session, summed over the days */
  const counts = () => {
    const sum = { newWords: 0, newSents: 0 }
    for (const [path, text] of files) {
      if (path.startsWith(`${DATA}/stats/`) && path.endsWith('/sess-1.json')) {
        const day = JSON.parse(text) as Loose
        sum.newWords += day.newWords
        sum.newSents += day.newSents
      }
    }
    return sum
  }
  return { host: host as unknown as Host, anki, files, store, runs, timers, asked, debug, clock, counts }
}
