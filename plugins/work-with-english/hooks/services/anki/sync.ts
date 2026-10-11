import { hashParts } from '../../core/hash'
import { coerceSetting, storeKeyOf, type SettingKey } from '../../core/settings/schema'
import type { SentenceSource } from '../../core/copy/wordbook'
import type { Host } from '../../host'
import type { WweSettings } from '../../../types'
import { dataDirOf } from '../datadir'
import { AnkiCallError, AnkiOfflineError, ankiCall, ensureSetup, type AnkiConnection } from './client'
import { AUDIO_FIELD, SENTENCE_MODEL, WORD_MODEL, type AnkiModel } from './models'
import {
  fieldValues,
  findSentenceQuery,
  findWordQuery,
  hasSentence,
  mergeWordNote,
  sentenceNoteFields,
  wordNoteFields,
  type WordSentence,
} from './notes'

// The word book into Anki, by F12 › 重复怎么处理: a card already in Anki, in
// any deck, is found by its card type and first field and only gets the new
// sentences added; none is made twice. An entry Anki could not take stays
// pending for syncPending.

/** A word as the book keeps it, with what Anki has of it */
export type SyncWord = {
  lemma: string
  ipa: string
  senses: readonly string[]
  example: { en: string; zh: string } | null
  sentences: readonly (WordSentence & { synced: boolean })[]
  sync: 'synced' | 'pending'
  noteId: number | null
}

export type SyncSentence = {
  en: string
  zh: string
  zhIsTranslation: boolean
  source: SentenceSource
  parts: readonly { text: string; role: string }[]
  points: readonly string[]
  sync: 'synced' | 'pending'
  noteId: number | null
}

/**
 * The word book as a sync reads and marks it: features/wordbook/repo.ts ›
 * book, passed in so this service does not reach into a feature.
 */
export type BookPort = {
  list: (host: Host) => Promise<{ words: readonly SyncWord[]; sentences: readonly SyncSentence[] }>
  readWord: (host: Host, lemma: string) => Promise<SyncWord | null>
  readSentence: (host: Host, en: string) => Promise<SyncSentence | null>
  /** These sentences of the word are on its card `noteId` now */
  markWordSynced: (host: Host, lemma: string, noteId: number, sentences: readonly string[]) => Promise<void>
  markSentenceSynced: (host: Host, en: string, noteId: number) => Promise<void>
}

/** One add's sync: whether the card is in Anki now, and where syncing stands ('off' with 同步到 Anki off). */
export type SyncResult = { isSynced: boolean; link: AnkiConnection | 'off' }

/** What syncPending put into Anki, for 已同步 2 个词、1 个句子到 Anki。 */
export type PendingResult = { words: number; sentences: number; link: AnkiConnection | 'off' }

type Outcome = 'synced' | 'pending' | 'offline'

type SyncSettings = { isOn: boolean; deck: string; voice: string }

/** Read now: a change in another session applies at the next sync */
async function setting<K extends SettingKey>(host: Host, key: K): Promise<WweSettings[K]> {
  return coerceSetting(key, await host.store.get(storeKeyOf(key)))
}

async function syncSettings(host: Host): Promise<SyncSettings> {
  const [isOn, deck, service, voice] = await Promise.all([
    setting(host, 'ankiSync'),
    setting(host, 'ankiDeck'),
    setting(host, 'speechService'),
    setting(host, 'voiceSystem'),
  ])
  // An online voice's audio is not kept per word yet, so its cards use the system's default voice
  return { isOn, deck, voice: service === 'system' ? voice : '' }
}

// One sync at a time, so an add and syncPending never both make the same card
const queues = new WeakMap<Host, Promise<unknown>>()

function serial<T>(host: Host, job: () => Promise<T>): Promise<T> {
  const next = (queues.get(host) ?? Promise.resolve()).catch(() => undefined).then(job)
  queues.set(host, next)
  return next
}

export const audioFileOf = (dataDir: string, key: string) => `${dataDir}/anki/${key}.m4a`

type Audio = { path: string; filename: string; fields: string[] }

/**
 * The card's 朗读: `say` into anki/<hash>.m4a, made once per voice and text.
 * Null when it cannot be made; the card is made without it.
 */
async function cardAudio(host: Host, speech: string, voice: string): Promise<Audio | null> {
  const key = hashParts(['say', voice, speech])
  const dataDir = await dataDirOf(host)
  const dir = `${dataDir}/anki`
  const path = audioFileOf(dataDir, key)
  try {
    if (!(await host.fs.exists(path))) {
      // say writes into a directory that is there already
      await host.proc.run(['mkdir', '-p', dir])
      // `--` so a sentence that starts with a dash is not read as an option
      const voiceArgs = voice === '' ? [] : ['-v', voice]
      const argv = ['say', ...voiceArgs, '-o', path, '--file-format=m4af', '--data-format=aac', '--', speech]
      const { exitCode, stderr } = await host.proc.run(argv)
      if (exitCode !== 0 || !(await host.fs.exists(path))) {
        host.ui.debug(`anki audio: say exited ${exitCode}: ${stderr.trim()}`)
        return null
      }
    }
  } catch (error) {
    host.ui.debug(`anki audio: ${String(error)}`)
    return null
  }
  return { path, filename: `wwe-${key}.m4a`, fields: [AUDIO_FIELD] }
}

type NoteInfo = { noteId: number; modelName: string; fields: Record<string, string> }

async function noteInfo(host: Host, id: number): Promise<NoteInfo | null> {
  const [info] = await ankiCall<unknown[]>(host, 'notesInfo', { notes: [id] })
  if (typeof info !== 'object' || info === null) {
    return null
  }
  const { noteId, modelName, fields } = info as { noteId?: unknown; modelName?: unknown; fields?: unknown }
  if (typeof noteId !== 'number' || typeof modelName !== 'string' || typeof fields !== 'object' || fields === null) {
    return null
  }
  return { noteId, modelName, fields: fieldValues(fields as Record<string, { value: string }>) }
}

/**
 * The card of this entry: found by its card type and first field in any
 * deck (a renamed deck too), else the note it was synced to, if that still
 * is one of ours (its first field edited in Anki). Null when Anki has none.
 */
async function findNote(host: Host, model: AnkiModel, query: string, noteId: number | null): Promise<NoteInfo | null> {
  const found = await ankiCall<number[]>(host, 'findNotes', { query })
  const id = found.length > 0 ? Math.min(...found) : noteId
  if (id === null) {
    return null
  }
  const info = await noteInfo(host, id)
  return info?.modelName === model.modelName ? info : null
}

async function addNote(host: Host, deck: string, model: AnkiModel, fields: Record<string, string>, audio: Audio | null) {
  const note = {
    deckName: deck,
    modelName: model.modelName,
    fields,
    options: { allowDuplicate: false },
    ...(audio ? { audio: [audio] } : {}),
  }
  return ankiCall<number>(host, 'addNote', { note })
}

const isDuplicate = (error: unknown) => error instanceof AnkiCallError && error.message.includes('duplicate')

async function pushWord(
  host: Host,
  book: BookPort,
  word: SyncWord,
  settings: SyncSettings,
  isRetry = false,
): Promise<Outcome> {
  const unsynced = word.sentences.filter(s => !s.synced)
  const note = await findNote(host, WORD_MODEL, findWordQuery(word.lemma), word.noteId)
  if (note) {
    // 补上这一句: only 原句 and 原句译文 change; a sentence the card has already is left as it is
    let fields = note.fields
    for (const sentence of unsynced) {
      const update = mergeWordNote(fields, sentence)
      if (update) {
        fields = { ...fields, ...update }
      }
    }
    if (fields['原句'] !== note.fields['原句']) {
      const change = { 原句: fields['原句'] ?? '', 原句译文: fields['原句译文'] ?? '' }
      await ankiCall(host, 'updateNoteFields', { note: { id: note.noteId, fields: change } })
      // A card open in Anki's browser may keep its own fields (README › updateNoteFields)
      const after = await noteInfo(host, note.noteId)
      if (!after || !unsynced.every(s => hasSentence(after.fields['原句'] ?? '', s.en))) {
        host.ui.debug(`anki: the card of ${word.lemma} did not take the new sentence; it waits`)
        return 'pending'
      }
    }
    await book.markWordSynced(host, word.lemma, note.noteId, unsynced.map(s => s.en))
    return 'synced'
  }
  // No card, or Anki's was deleted: a new one with every sentence kept here
  const entry = { lemma: word.lemma, ipa: word.ipa, senses: word.senses, sentences: word.sentences, example: word.example }
  try {
    const audio = await cardAudio(host, word.lemma, settings.voice)
    const id = await addNote(host, settings.deck, WORD_MODEL, wordNoteFields(entry), audio)
    await book.markWordSynced(host, word.lemma, id, word.sentences.map(s => s.en))
    return 'synced'
  } catch (error) {
    // Made meanwhile, or a card Anki counts as the same: merge into it instead
    if (isDuplicate(error) && !isRetry) {
      return pushWord(host, book, word, settings, true)
    }
    throw error
  }
}

async function pushSentence(
  host: Host,
  book: BookPort,
  sentence: SyncSentence,
  settings: SyncSettings,
  isRetry = false,
): Promise<Outcome> {
  // 同一句再加: a card Anki has already is the one
  const note = await findNote(host, SENTENCE_MODEL, findSentenceQuery(sentence.en), sentence.noteId)
  if (note) {
    await book.markSentenceSynced(host, sentence.en, note.noteId)
    return 'synced'
  }
  const fields = sentenceNoteFields({
    en: sentence.en,
    zh: sentence.zh,
    isZhTranslated: sentence.zhIsTranslation,
    source: sentence.source,
    parts: sentence.parts,
    points: sentence.points,
  })
  try {
    const audio = await cardAudio(host, sentence.en, settings.voice)
    const id = await addNote(host, settings.deck, SENTENCE_MODEL, fields, audio)
    await book.markSentenceSynced(host, sentence.en, id)
    return 'synced'
  } catch (error) {
    if (isDuplicate(error) && !isRetry) {
      return pushSentence(host, book, sentence, settings, true)
    }
    throw error
  }
}

/** One entry into Anki; Anki gone midway is 'offline', any other failure leaves it pending. */
async function attempt(host: Host, what: string, push: () => Promise<Outcome>): Promise<Outcome> {
  try {
    return await push()
  } catch (error) {
    if (error instanceof AnkiOfflineError) {
      return 'offline'
    }
    host.ui.debug(`anki sync ${what}: ${error instanceof Error ? error.message : String(error)}`)
    return 'pending'
  }
}

async function syncOne(host: Host, what: string, push: (settings: SyncSettings) => Promise<Outcome | null>): Promise<SyncResult> {
  return serial(host, async () => {
    const settings = await syncSettings(host)
    if (!settings.isOn) {
      return { isSynced: false, link: 'off' }
    }
    const link = await ensureSetup(host, settings.deck)
    if (link !== 'ok') {
      return { isSynced: false, link }
    }
    const outcome = await attempt(host, what, async () => (await push(settings)) ?? 'pending')
    return { isSynced: outcome === 'synced', link: outcome === 'offline' ? 'offline' : 'ok' }
  })
}

/** After an add or 补上这一句: the word's card in Anki, made or added to. */
export function syncWord(host: Host, book: BookPort, lemma: string): Promise<SyncResult> {
  return syncOne(host, lemma, async settings => {
    const word = await book.readWord(host, lemma)
    return word && pushWord(host, book, word, settings)
  })
}

/** After a sentence was added: its card in Anki. */
export function syncSentence(host: Host, book: BookPort, en: string): Promise<SyncResult> {
  return syncOne(host, en, async settings => {
    const sentence = await book.readSentence(host, en)
    return sentence && pushSentence(host, book, sentence, settings)
  })
}

/** Everything waiting goes into Anki (Anki opened again, 同步到 Anki turned back on). */
export function syncPending(host: Host, book: BookPort): Promise<PendingResult> {
  return serial(host, async () => {
    const settings = await syncSettings(host)
    if (!settings.isOn) {
      return { words: 0, sentences: 0, link: 'off' }
    }
    const link = await ensureSetup(host, settings.deck)
    if (link !== 'ok') {
      return { words: 0, sentences: 0, link }
    }
    const { words, sentences } = await book.list(host)
    const done = { words: 0, sentences: 0 }
    const jobs = [
      ...words.filter(w => w.sync === 'pending').map(w => ['words', w.lemma, () => pushWord(host, book, w, settings)] as const),
      ...sentences
        .filter(s => s.sync === 'pending')
        .map(s => ['sentences', s.en, () => pushSentence(host, book, s, settings)] as const),
    ]
    for (const [kind, what, push] of jobs) {
      const outcome = await attempt(host, what, push)
      if (outcome === 'offline') {
        return { ...done, link: 'offline' }
      }
      if (outcome === 'synced') {
        done[kind] += 1
      }
    }
    return { ...done, link: 'ok' }
  })
}

/**
 * Where syncing stands, for the 单词本 page and each add: readies Anki as a
 * sync would, and marks that Anki has answered (flag/ankiEver).
 */
export function connectionStatus(host: Host): Promise<AnkiConnection> {
  return serial(host, async () => ensureSetup(host, await setting(host, 'ankiDeck')))
}
