import { describe, expect, test } from 'claude-code/testing'

import * as wb from '../../hooks/core/copy/wordbook'
import { hashParts } from '../../hooks/core/hash'
import {
  addMySentence,
  addSentence,
  addWord,
  book,
  cleanMine,
  list,
  pendingCounts,
  readSentence,
  readWord,
  remove,
  sentenceFileOf,
  sentenceStatusOf,
  statusOf,
  wordFileName,
} from '../../hooks/features/wordbook/repo'
import type { AddWordInput } from '../../hooks/features/wordbook/repo'
import { keepDraft } from '../../hooks/features/wordbook/drafts'
import type { Host } from '../../hooks/host'
import { ANKI_TIMEOUT_MS, ANKI_URL, EVER_KEY, MODEL_IDS_KEY } from '../../hooks/services/anki/client'
import { SENTENCE_FIELDS, SENTENCE_MODEL, WORD_FIELDS, WORD_MODEL } from '../../hooks/services/anki/models'
import { findNotesQuery, sentenceNoteFields, wordNoteFields } from '../../hooks/services/anki/notes'
import { connectionStatus, syncPending, syncSentence, syncWord } from '../../hooks/services/anki/sync'

// F12 › 加入单词, 加入句子, 单词本页, 同步到 Anki and every row of 重复怎么处理,
// over a Host whose files are a Map and whose AnkiConnect is a stand-in that
// keeps decks, card types and notes as Anki 26.9.3 answered them (2026-10-06).

const DATA = '/Users/alex/.claude/plugins/data/work-with-english-inline'
const T0 = Date.UTC(2026, 9, 11, 2, 0, 0)

type Loose = Record<string, any>
type Note = { id: number; modelName: string; deckName: string; fields: Record<string, string> }

/** AnkiConnect as the stand-in answers it: { result, error } for each action the sync uses */
function fakeAnki() {
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

type FakeAnki = ReturnType<typeof fakeAnki>

type FakeOptions = {
  anki?: FakeAnki
  store?: Record<string, unknown>
  sayFails?: boolean
  /** What the model answers a translation with; null or absent, it fails */
  translation?: string | null
}

function fakeHost(options: FakeOptions = {}) {
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

const CAUSE: AddWordInput = {
  lemma: 'cause',
  ipa: '/kɔːz/',
  senses: ['n. 原因；起因', 'v. 导致；引起'],
  cur: 0,
  sentence: 'I found the cause.',
  sentenceZh: '我找到原因了。',
  form: 'cause',
  examples: [{ en: "We still don't know the cause of the crash.", zh: '我们还不知道崩溃的原因。' }],
}

const CAUSE_AGAIN: AddWordInput = {
  ...CAUSE,
  cur: 1,
  sentence: 'What caused the outage?',
  sentenceZh: '是什么导致了这次故障？',
  form: 'caused',
}

const BLOCK_STALL: AddWordInput = {
  lemma: 'block',
  ipa: '/blɒk/',
  senses: ['v. 阻塞；挡住', 'n. 代码块'],
  cur: 0,
  sentence: 'One slow write blocks all reads.',
  sentenceZh: '一次慢写入会卡住所有读取。',
  form: 'blocks',
  examples: [],
}

const BLOCK_CODE: AddWordInput = {
  ...BLOCK_STALL,
  cur: 1,
  sentence: 'Wrap the config in a code block.',
  sentenceZh: '把配置放进一个代码块。',
  form: 'block',
}

const REPLY_SENTENCE = {
  en: "I'd move the dotenv call to the top of server.ts.",
  zh: '我建议把 dotenv 调用移到 server.ts 顶部。',
  parts: [
    { text: "I'd move", role: '谓语' },
    { text: 'the dotenv call', role: '宾语' },
  ],
  points: ["I'd = I would，语气委婉"],
  source: 'reply',
} as const

const MESSAGE = "Can you help me figure out what's causing this error?"

const wordFile = (lemma: string) => `${DATA}/book/words/${wordFileName(lemma)}.json`

const audioOf = (text: string) => hashParts(['say', '', text])

describe('word book: words', () => {
  test('a word is kept under its base form, with the sentence and the meaning it has there', async () => {
    const fake = fakeHost()
    expect(await addWord(fake.host, CAUSE)).toBe('added')
    const kept = JSON.parse(fake.files.get(`${DATA}/book/words/cause.json`) ?? '{}') as Loose
    expect(kept).toMatchObject({ v: 1, lemma: 'cause', ipa: '/kɔːz/', addedAt: T0, sync: 'pending', noteId: null })
    expect(kept.sentences).toEqual([
      { en: 'I found the cause.', zh: '我找到原因了。', form: 'cause', sense: 'n. 原因；起因', addedAt: T0, synced: false },
    ])
    expect(kept.example).toEqual(CAUSE.examples[0])
    expect(fake.counts()).toEqual({ newWords: 1, newSents: 0 })
  })

  test('补上这一句: another sentence goes under the word with its own meaning, and is not a new word', async () => {
    const fake = fakeHost()
    await addWord(fake.host, CAUSE)
    expect(await statusOf(fake.host, 'cause', CAUSE_AGAIN.sentence)).toBe('sentenceMissing')
    fake.clock.ms += 60_000
    expect(await addWord(fake.host, CAUSE_AGAIN)).toBe('merged')
    const word = await readWord(fake.host, 'cause')
    expect(word?.sentences.map(s => [s.en, s.sense, s.form])).toEqual([
      ['I found the cause.', 'n. 原因；起因', 'cause'],
      ['What caused the outage?', 'v. 导致；引起', 'caused'],
    ])
    expect(word?.addedAt).toBe(T0)
    expect(fake.counts()).toEqual({ newWords: 1, newSents: 0 })
    expect(await statusOf(fake.host, 'cause', CAUSE_AGAIN.sentence)).toBe('added')
  })

  test('the same word in the same sentence is kept once', async () => {
    const fake = fakeHost()
    await addWord(fake.host, CAUSE)
    expect(await addWord(fake.host, { ...CAUSE, sentence: '  I found   the cause. ' })).toBe('exists')
    expect((await readWord(fake.host, 'cause'))?.sentences).toHaveLength(1)
    expect(fake.counts().newWords).toBe(1)
  })

  test('Cause and cause are one word, kept in lower case', async () => {
    const fake = fakeHost()
    expect(await addWord(fake.host, { ...CAUSE, lemma: 'Cause' })).toBe('added')
    expect(fake.files.has(`${DATA}/book/words/cause.json`)).toBe(true)
    expect(await addWord(fake.host, CAUSE)).toBe('exists')
    expect(await statusOf(fake.host, 'CAUSE', CAUSE.sentence)).toBe('added')
  })

  test('the button: 加入单词本 for a word not kept, 已加入单词本 for one kept without a sentence', async () => {
    const fake = fakeHost()
    expect(await statusOf(fake.host, 'cause', CAUSE.sentence)).toBe('none')
    await addWord(fake.host, { ...CAUSE, sentence: null, sentenceZh: null })
    expect(await statusOf(fake.host, 'cause', null)).toBe('added')
    expect(await statusOf(fake.host, 'cause', CAUSE.sentence)).toBe('sentenceMissing')
  })

  test('deleting removes the file with rm -f and leaves Anki alone; adding it again counts as new', async () => {
    const fake = fakeHost()
    await addWord(fake.host, CAUSE)
    await remove(fake.host, 'word', 'Cause')
    expect(fake.runs).toContainEqual(['rm', '-f', `${DATA}/book/words/cause.json`])
    expect(fake.anki.state.calls).toHaveLength(0)
    expect(await statusOf(fake.host, 'cause', CAUSE.sentence)).toBe('none')
    expect(await addWord(fake.host, CAUSE)).toBe('added')
    expect(fake.counts().newWords).toBe(2)
  })

  test('a phrase or a slash stays one file name', () => {
    expect(wordFileName('Stand  Out')).toBe('stand%20out')
    expect(wordFileName('and/or')).toBe('and%2For')
    expect(wordFile('cause')).toBe(`${DATA}/book/words/cause.json`)
  })
})

describe('word book: sentences', () => {
  test('a sentence from Claude’s reply is kept once by its English, with its structure and points', async () => {
    const fake = fakeHost()
    expect(await addSentence(fake.host, REPLY_SENTENCE)).toBe('added')
    expect(await addSentence(fake.host, { ...REPLY_SENTENCE, en: ` ${REPLY_SENTENCE.en}\n` })).toBe('exists')
    const kept = await readSentence(fake.host, REPLY_SENTENCE.en)
    expect(kept).toMatchObject({ source: 'reply', zhIsTranslation: false, sync: 'pending', noteId: null })
    expect(kept?.parts).toEqual(REPLY_SENTENCE.parts)
    expect(kept?.points).toEqual(REPLY_SENTENCE.points)
    expect(fake.files.has(sentenceFileOf(DATA, REPLY_SENTENCE.en))).toBe(true)
    expect(fake.counts()).toEqual({ newWords: 0, newSents: 1 })
  })

  test('a message you sent keeps no code block or pasted log, and keeps the Chinese you wrote', async () => {
    const fake = fakeHost()
    const sent = `${MESSAGE}\n\`\`\`\nTypeError: x is undefined\n    at server.ts:12\n\`\`\`\n<pasted_content id="1">npm ERR! code 1</pasted_content id="1">`
    await keepDraft(fake.host, sent, { zh: '帮我看看这个报错是怎么回事', sawTranslation: true })
    expect(await addMySentence(fake.host, sent)).toBe('added')
    const kept = await readSentence(fake.host, MESSAGE)
    expect(kept).toMatchObject({ en: MESSAGE, zh: '帮我看看这个报错是怎么回事', zhIsTranslation: false, source: 'mine', parts: [], points: [] })
    expect(JSON.stringify(kept)).not.toContain('TypeError')
    expect(JSON.stringify(kept)).not.toContain('npm ERR')
    expect(fake.asked).toHaveLength(0)
    expect(await sentenceStatusOf(fake.host, sent, 'mine')).toBe('added')
    expect(await addMySentence(fake.host, sent)).toBe('exists')
  })

  test('inline code stays: it is part of the sentence', () => {
    expect(cleanMine('Why does `npm ci` fail here?\n```sh\nnpm ci\n```')).toBe('Why does `npm ci` fail here?')
  })

  test('no Chinese kept for it: the English is translated and marked 中文为译文', async () => {
    const fake = fakeHost({ translation: '你能帮我看看是什么导致了这个错误吗？' })
    expect(await addMySentence(fake.host, MESSAGE)).toBe('added')
    expect(fake.asked).toHaveLength(1)
    expect(fake.asked[0]).toContain(MESSAGE)
    expect(await readSentence(fake.host, MESSAGE)).toMatchObject({
      zh: '你能帮我看看是什么导致了这个错误吗？',
      zhIsTranslation: true,
    })
    expect(fake.counts().newSents).toBe(1)
  })

  test('a translation that fails adds nothing and says why', async () => {
    const fake = fakeHost({ translation: null })
    const result = await addMySentence(fake.host, MESSAGE)
    expect(typeof result === 'object' && result.failed !== '').toBe(true)
    expect(await readSentence(fake.host, MESSAGE)).toBeNull()
    expect(wb.addFailedToast('网络连接失败')).toBe('加入单词本失败：网络连接失败')
  })

  test('a message with Chinese in it is not one to add', async () => {
    const fake = fakeHost()
    expect(await addMySentence(fake.host, '帮我看看 this error')).toBe('notEnglish')
    expect(fake.files.size).toBe(0)
  })
})

describe('word book: the page’s list', () => {
  test('newest first in each group; a word lists every sentence, oldest first', async () => {
    const fake = fakeHost()
    await addWord(fake.host, CAUSE)
    fake.clock.ms += 1000
    await addWord(fake.host, BLOCK_STALL)
    fake.clock.ms += 1000
    await addWord(fake.host, CAUSE_AGAIN)
    await addSentence(fake.host, REPLY_SENTENCE)
    const kept = await list(fake.host)
    expect(kept.words.map(w => w.lemma)).toEqual(['block', 'cause'])
    expect(kept.words[1]?.sentences.map(s => s.en)).toEqual(['I found the cause.', 'What caused the outage?'])
    expect(kept.sentences.map(s => s.en)).toEqual([REPLY_SENTENCE.en])
    expect(pendingCounts(kept)).toEqual({ words: 2, sentences: 1 })
  })

  test('an empty book is two empty lists', async () => {
    expect(await list(fakeHost().host)).toEqual({ words: [], sentences: [] })
  })
})

describe('Anki: setup and connection', () => {
  test('permission, then the deck and both card types where missing; the ids are remembered', async () => {
    const fake = fakeHost()
    expect(await connectionStatus(fake.host)).toBe('ok')
    expect(fake.anki.actions().slice(0, 4)).toEqual(['requestPermission', 'deckNames', 'createDeck', 'modelNamesAndIds'])
    expect(fake.anki.state.calls.every(c => c.url === ANKI_URL && c.method === 'POST' && c.version === 6)).toBe(true)
    expect(fake.anki.state.decks).toContain('work-with-english')
    expect(fake.anki.state.models.get(WORD_MODEL.modelName)?.fields).toEqual([...WORD_FIELDS])
    expect(fake.anki.state.models.get(SENTENCE_MODEL.modelName)?.fields).toEqual([...SENTENCE_FIELDS])
    expect(fake.store.get(EVER_KEY)).toBe(true)
    expect(fake.store.get(MODEL_IDS_KEY)).toEqual({
      [WORD_MODEL.modelName]: fake.anki.state.models.get(WORD_MODEL.modelName)?.id,
      [SENTENCE_MODEL.modelName]: fake.anki.state.models.get(SENTENCE_MODEL.modelName)?.id,
    })
    expect(await connectionStatus(fake.host)).toBe('ok')
    expect(fake.anki.actions().filter(a => a === 'createModel' || a === 'createDeck')).toHaveLength(3)
  })

  test('Anki not open: offline, and never marked as having answered', async () => {
    const fake = fakeHost()
    fake.anki.state.isOpen = false
    expect(await connectionStatus(fake.host)).toBe('offline')
    expect(fake.store.get(EVER_KEY)).toBeUndefined()
  })

  test('an Anki that does not answer is given up on after 3 seconds', async () => {
    const fake = fakeHost()
    fake.anki.state.isHung = true
    expect(await connectionStatus(fake.host)).toBe('offline')
    expect(fake.timers).toEqual([ANKI_TIMEOUT_MS])
    expect(ANKI_TIMEOUT_MS).toBe(3000)
  })

  test('AnkiConnect asking for an API Key stops syncing, with the reason', async () => {
    const fake = fakeHost()
    fake.anki.state.permission = { permission: 'granted', requireApiKey: true, version: 6 }
    expect(await connectionStatus(fake.host)).toEqual({ broken: wb.ANKI_REFUSED })
  })

  test('syncing off: nothing reaches Anki and the entries wait', async () => {
    const fake = fakeHost({ store: { 'settings/ankiSync': false } })
    await addWord(fake.host, CAUSE)
    expect(await syncWord(fake.host, book, 'cause')).toEqual({ isSynced: false, link: 'off' })
    expect(await syncPending(fake.host, book)).toEqual({ words: 0, sentences: 0, link: 'off' })
    expect(fake.anki.state.calls).toHaveLength(0)
    expect((await readWord(fake.host, 'cause'))?.sync).toBe('pending')
  })
})

describe('Anki: cards', () => {
  test('a word becomes a card in the deck, with its audio from say', async () => {
    const fake = fakeHost()
    await addWord(fake.host, CAUSE)
    expect(await syncWord(fake.host, book, 'cause')).toEqual({ isSynced: true, link: 'ok' })
    const [note] = fake.anki.notesOf(WORD_MODEL.modelName)
    const audio = `${DATA}/anki/${audioOf('cause')}.m4a`
    expect(fake.runs).toContainEqual(['mkdir', '-p', `${DATA}/anki`])
    expect(fake.runs).toContainEqual(['say', '-o', audio, '--file-format=m4af', '--data-format=aac', '--', 'cause'])
    const add = fake.anki.state.calls.find(c => c.action === 'addNote')?.params.note
    expect(add?.deckName).toBe('work-with-english')
    expect(add?.audio).toEqual([{ path: audio, filename: `wwe-${audioOf('cause')}.m4a`, fields: ['朗读'] }])
    expect(note?.fields['单词']).toBe('cause')
    expect(note?.fields['原句']).toContain('<b>cause</b>')
    expect(note?.fields['朗读']).toBe(`[sound:wwe-${audioOf('cause')}.m4a]`)
    expect(await readWord(fake.host, 'cause')).toMatchObject({ sync: 'synced', noteId: note?.id })
    expect(wb.addedWordToast('cause', true)).toBe('已加入单词本：cause，已同步到 Anki')
  })

  test('the audio that cannot be made leaves the card without it', async () => {
    const fake = fakeHost({ sayFails: true })
    await addWord(fake.host, CAUSE)
    expect(await syncWord(fake.host, book, 'cause')).toEqual({ isSynced: true, link: 'ok' })
    const add = fake.anki.state.calls.find(c => c.action === 'addNote')?.params.note
    expect(add?.audio).toBeUndefined()
    expect(fake.anki.notesOf(WORD_MODEL.modelName)[0]?.fields['朗读']).toBe('')
  })

  test('the system voice chosen on the 阅读 page reads the card', async () => {
    const fake = fakeHost({ store: { 'settings/voiceSystem': 'Samantha' } })
    await addSentence(fake.host, REPLY_SENTENCE)
    await syncSentence(fake.host, book, REPLY_SENTENCE.en)
    expect(fake.runs.find(argv => argv[0] === 'say')?.slice(0, 3)).toEqual(['say', '-v', 'Samantha'])
  })

  test('a sentence becomes a sentence card; yours has no structure or points', async () => {
    const fake = fakeHost({ translation: '你能帮我看看是什么导致了这个错误吗？' })
    await addSentence(fake.host, REPLY_SENTENCE)
    await addMySentence(fake.host, MESSAGE)
    expect(await syncSentence(fake.host, book, REPLY_SENTENCE.en)).toEqual({ isSynced: true, link: 'ok' })
    expect(await syncSentence(fake.host, book, MESSAGE)).toEqual({ isSynced: true, link: 'ok' })
    const [reply, mine] = fake.anki.notesOf(SENTENCE_MODEL.modelName)
    expect(reply?.fields['结构']).toContain('the dotenv call')
    expect(reply?.fields['来源']).toBe('Claude 的回复')
    expect(mine?.fields['结构']).toBe('')
    expect(mine?.fields['译文']).toContain('中文为译文')
    expect(mine?.fields['来源']).toBe('我发出的')
    expect((await readSentence(fake.host, MESSAGE))?.sync).toBe('synced')
  })
})

describe('Anki: 重复怎么处理', () => {
  test('同一个词从另一句再加: the sentence goes into 原句 and 原句译文; nothing else is touched', async () => {
    const fake = fakeHost()
    await addWord(fake.host, CAUSE)
    await syncWord(fake.host, book, 'cause')
    const [note] = fake.anki.notesOf(WORD_MODEL.modelName)
    if (note) {
      note.fields['其他释义'] = '<div>我在 Anki 里改过</div>'
    }
    expect(await addWord(fake.host, CAUSE_AGAIN)).toBe('merged')
    expect(await syncWord(fake.host, book, 'cause')).toEqual({ isSynced: true, link: 'ok' })
    const update = fake.anki.state.calls.find(c => c.action === 'updateNoteFields')?.params.note
    expect(Object.keys(update?.fields ?? {})).toEqual(['原句', '原句译文'])
    expect(fake.anki.notesOf(WORD_MODEL.modelName)).toHaveLength(1)
    expect(note?.fields['其他释义']).toBe('<div>我在 Anki 里改过</div>')
    expect(note?.fields['原句']).toContain('<b>caused</b>')
    expect(note?.fields['原句译文']).toContain('是什么导致了这次故障？')
    expect(wb.addedToWordToast('cause', true)).toBe('cause 已在单词本里，补上了这一句，已同步到 Anki。')
  })

  test('同一个词、不同意思: one card, each sentence with its own 本句释义', async () => {
    const fake = fakeHost()
    await addWord(fake.host, BLOCK_STALL)
    await syncWord(fake.host, book, 'block')
    await addWord(fake.host, BLOCK_CODE)
    await syncWord(fake.host, book, 'block')
    const notes = fake.anki.notesOf(WORD_MODEL.modelName)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.fields['本句释义']).toBe('v. 阻塞；挡住')
    expect(notes[0]?.fields['原句']).toContain('代码块')
  })

  test('本机删了、Anki 里还在，之后又加这个词: added to the card already there', async () => {
    const fake = fakeHost()
    await addWord(fake.host, CAUSE)
    await syncWord(fake.host, book, 'cause')
    await remove(fake.host, 'word', 'cause')
    expect(fake.anki.notesOf(WORD_MODEL.modelName)).toHaveLength(1)
    expect(await addWord(fake.host, CAUSE_AGAIN)).toBe('added')
    expect(await syncWord(fake.host, book, 'cause')).toEqual({ isSynced: true, link: 'ok' })
    const notes = fake.anki.notesOf(WORD_MODEL.modelName)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.fields['原句']).toContain('I found the')
    expect(notes[0]?.fields['原句']).toContain('<b>caused</b>')
  })

  test('改过牌组名: the card is found in any deck, and no second one is made in the new deck', async () => {
    const fake = fakeHost()
    await addWord(fake.host, CAUSE)
    await syncWord(fake.host, book, 'cause')
    fake.store.set('settings/ankiDeck', 'english')
    await addWord(fake.host, CAUSE_AGAIN)
    expect(await syncWord(fake.host, book, 'cause')).toEqual({ isSynced: true, link: 'ok' })
    const notes = fake.anki.notesOf(WORD_MODEL.modelName)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.deckName).toBe('work-with-english')
    expect(notes[0]?.fields['原句']).toContain('<b>caused</b>')
    expect(fake.anki.state.decks).toContain('english')
  })

  test('大小写不同: Cause and cause are one card', async () => {
    const fake = fakeHost()
    await connectionStatus(fake.host)
    // A cause card made in an earlier session, before this book had the word
    const fields = wordNoteFields({ lemma: 'cause', ipa: '', senses: [], sentences: [], example: null })
    fake.anki.state.notes.set(1, { id: 1, modelName: WORD_MODEL.modelName, deckName: 'Default', fields })
    await addWord(fake.host, { ...CAUSE, lemma: 'Cause' })
    expect(await syncWord(fake.host, book, 'Cause')).toEqual({ isSynced: true, link: 'ok' })
    expect(fake.anki.notesOf(WORD_MODEL.modelName)).toHaveLength(1)
    expect(fake.anki.state.notes.get(1)?.fields['原句']).toContain('<b>cause</b>')
    expect((await readWord(fake.host, 'cause'))?.noteId).toBe(1)
  })

  test('同一句再加: kept once here, and Anki makes no second card', async () => {
    const fake = fakeHost()
    await addSentence(fake.host, REPLY_SENTENCE)
    await syncSentence(fake.host, book, REPLY_SENTENCE.en)
    expect(await addSentence(fake.host, REPLY_SENTENCE)).toBe('exists')
    // Deleted here but still in Anki, then added again: Anki's card is the one
    await remove(fake.host, 'sentence', REPLY_SENTENCE.en)
    expect(await addSentence(fake.host, REPLY_SENTENCE)).toBe('added')
    expect(await syncSentence(fake.host, book, REPLY_SENTENCE.en)).toEqual({ isSynced: true, link: 'ok' })
    expect(fake.anki.notesOf(SENTENCE_MODEL.modelName)).toHaveLength(1)
    expect(fake.anki.actions().filter(a => a === 'addNote')).toHaveLength(1)
  })

  test('Anki 里的原卡被删了: a new card with every sentence kept here', async () => {
    const fake = fakeHost()
    await addWord(fake.host, CAUSE)
    await addWord(fake.host, CAUSE_AGAIN)
    await syncWord(fake.host, book, 'cause')
    fake.anki.state.notes.clear()
    await addWord(fake.host, { ...CAUSE, sentence: 'Find the root cause first.', sentenceZh: '先找到根本原因。' })
    expect(await syncWord(fake.host, book, 'cause')).toEqual({ isSynced: true, link: 'ok' })
    const [note] = fake.anki.notesOf(WORD_MODEL.modelName)
    expect(note?.fields['原句']).toContain('I found the')
    expect(note?.fields['原句']).toContain('<b>caused</b>')
    expect(note?.fields['原句']).toContain('root <b>cause</b>')
  })

  test('a card type of ours missing a field stops syncing, with the reason', async () => {
    const fake = fakeHost()
    fake.anki.state.models.set(WORD_MODEL.modelName, { id: 7, fields: WORD_FIELDS.filter(f => f !== '原句') })
    await addWord(fake.host, CAUSE)
    const broken = { broken: wb.ankiModelFieldsMissing(WORD_MODEL.modelName, ['原句']) }
    expect(await connectionStatus(fake.host)).toEqual(broken)
    expect(await syncWord(fake.host, book, 'cause')).toEqual({ isSynced: false, link: broken })
    expect(fake.anki.actions()).not.toContain('addNote')
    expect(fake.anki.actions()).not.toContain('createModel')
    expect((await readWord(fake.host, 'cause'))?.sync).toBe('pending')
    expect(broken.broken).toBe('Anki 里的卡片类型“work-with-english 单词”缺少字段“原句”，已停止同步。把字段加回去后会继续同步。')
  })

  test('a card type of ours renamed stops syncing; one deleted is made again', async () => {
    const fake = fakeHost()
    await connectionStatus(fake.host)
    const word = fake.anki.state.models.get(WORD_MODEL.modelName)
    fake.anki.state.models.delete(WORD_MODEL.modelName)
    if (word) {
      fake.anki.state.models.set('我的单词', word)
    }
    expect(await connectionStatus(fake.host)).toEqual({ broken: wb.ankiModelRenamed(WORD_MODEL.modelName, '我的单词') })
    fake.anki.state.models.delete('我的单词')
    expect(await connectionStatus(fake.host)).toBe('ok')
    expect(fake.anki.state.models.has(WORD_MODEL.modelName)).toBe(true)
    expect(fake.anki.actions().filter(a => a === 'createModel')).toHaveLength(3)
  })

  test('a card open in Anki’s browser that does not take the sentence waits, and syncPending adds it', async () => {
    const fake = fakeHost()
    await addWord(fake.host, CAUSE)
    await syncWord(fake.host, book, 'cause')
    const [note] = fake.anki.notesOf(WORD_MODEL.modelName)
    fake.anki.state.editing.add(note?.id ?? 0)
    await addWord(fake.host, CAUSE_AGAIN)
    expect(await syncWord(fake.host, book, 'cause')).toEqual({ isSynced: false, link: 'ok' })
    expect((await readWord(fake.host, 'cause'))?.sync).toBe('pending')
    fake.anki.state.editing.clear()
    expect(await syncPending(fake.host, book)).toEqual({ words: 1, sentences: 0, link: 'ok' })
    expect(note?.fields['原句']).toContain('<b>caused</b>')
    expect((await readWord(fake.host, 'cause'))?.sentences.every(s => s.synced)).toBe(true)
  })
})

describe('Anki: waiting and catching up', () => {
  test('Anki not open: the adds wait; once it is, syncPending puts them all in and counts them', async () => {
    const fake = fakeHost()
    fake.anki.state.isOpen = false
    await addWord(fake.host, CAUSE)
    await addSentence(fake.host, REPLY_SENTENCE)
    expect(await syncWord(fake.host, book, 'cause')).toEqual({ isSynced: false, link: 'offline' })
    expect(await syncSentence(fake.host, book, REPLY_SENTENCE.en)).toEqual({ isSynced: false, link: 'offline' })
    expect(pendingCounts(await list(fake.host))).toEqual({ words: 1, sentences: 1 })
    fake.anki.state.isOpen = true
    const done = await syncPending(fake.host, book)
    expect(done).toEqual({ words: 1, sentences: 1, link: 'ok' })
    expect(wb.syncedToast(done.words, done.sentences)).toBe('已同步 1 个词、1 个句子到 Anki。')
    expect(pendingCounts(await list(fake.host))).toEqual({ words: 0, sentences: 0 })
    expect(await syncPending(fake.host, book)).toEqual({ words: 0, sentences: 0, link: 'ok' })
    expect(fake.anki.actions().filter(a => a === 'addNote')).toHaveLength(2)
  })

  test('Anki closing midway stops the catching up; what was not reached still waits', async () => {
    const fake = fakeHost()
    fake.anki.state.isOpen = false
    await addWord(fake.host, CAUSE)
    await addWord(fake.host, BLOCK_STALL)
    fake.anki.state.isOpen = true
    const fetch = fake.anki.fetch
    let finds = 0
    ;(fake.host.http as { fetch: unknown }).fetch = async (url: string, init?: { body?: string }) => {
      // Anki quits after the first word's card, as the second word is looked for
      if ((JSON.parse(init?.body ?? '{}') as Loose).action === 'findNotes' && ++finds > 1) {
        throw new Error('connect ECONNREFUSED 127.0.0.1:8765')
      }
      return fetch(url, init)
    }
    const done = await syncPending(fake.host, book)
    expect(done.link).toBe('offline')
    expect(done.words).toBe(1)
    expect(pendingCounts(await list(fake.host))).toEqual({ words: 1, sentences: 0 })
  })

  test('a sentence card already in Anki is taken as this sentence’s', async () => {
    const fake = fakeHost()
    await connectionStatus(fake.host)
    const fields = sentenceNoteFields({ ...REPLY_SENTENCE, isZhTranslated: false })
    fake.anki.state.notes.set(5, { id: 5, modelName: SENTENCE_MODEL.modelName, deckName: 'Default', fields })
    await addSentence(fake.host, REPLY_SENTENCE)
    expect(await syncSentence(fake.host, book, REPLY_SENTENCE.en)).toEqual({ isSynced: true, link: 'ok' })
    expect(fake.anki.actions()).not.toContain('addNote')
    expect((await readSentence(fake.host, REPLY_SENTENCE.en))?.noteId).toBe(5)
  })
})
