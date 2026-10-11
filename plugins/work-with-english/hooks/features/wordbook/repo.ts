import { hash } from '../../core/hash'
import type { SentenceSource } from '../../core/copy/wordbook'
import { isEnglishMessage } from '../../core/text/lang'
import { maskSpans, type MaskKind } from '../../core/text/mask'
import { localDate } from '../../core/time'
import type { Host } from '../../host'
import { normalizeLemma, normalizeSentence, type WordSentence } from '../../services/anki/notes'
import type { BookPort } from '../../services/anki/sync'
import { dataDirOf } from '../../services/datadir'
import { readJson, remove as removeFile, writeJson } from '../../services/files'
import { run } from '../../services/translate/index'
import { addToDay, type DayCounts } from '../stats/record'
import { keptDraftOf } from './drafts'

// The word book on this machine (F12): one file a word, book/words/<base
// form>.json, and one a sentence, book/sentences/<hash of the English>.json,
// in the data directory. Anki is services/anki/sync.ts's; this file only
// keeps what was added and whether Anki has it yet.

export type SyncState = 'synced' | 'pending'

/** One sentence a word was added from, as kept */
export type BookWordSentence = WordSentence & {
  addedAt: number
  /** Anki's card has it */
  synced: boolean
}

export type BookWord = {
  v: 1
  /** The base form in lower case */
  lemma: string
  ipa: string
  senses: string[]
  example: { en: string; zh: string } | null
  /** Oldest first, as on the Anki card */
  sentences: BookWordSentence[]
  addedAt: number
  /** pending while any sentence is not in Anki */
  sync: SyncState
  noteId: number | null
}

export type BookSentence = {
  v: 1
  en: string
  zh: string
  /** A sentence you sent whose Chinese was translated when it was added (中文为译文) */
  zhIsTranslation: boolean
  source: SentenceSource
  parts: { text: string; role: string }[]
  points: string[]
  addedAt: number
  sync: SyncState
  noteId: number | null
}

export type Book = { words: BookWord[]; sentences: BookSentence[] }

/** What the word card's button says (加入单词本, 已加入单词本, 补上这一句) */
export type WordStatus = 'none' | 'added' | 'sentenceMissing'

export type AddWordInput = {
  lemma: string
  ipa: string
  senses: readonly string[]
  /** The sense the sentence uses, an index into `senses` */
  cur: number | null
  /** The sentence the word was selected in, when known */
  sentence: string | null
  sentenceZh: string | null
  /** The word as selected (blocks for block), set in bold in the sentence */
  form: string
  examples: readonly { en: string; zh: string }[]
}

export type AddSentenceInput = {
  en: string
  zh: string
  zhIsTranslation?: boolean
  parts?: readonly { text: string; role: string }[]
  points?: readonly string[]
  source: SentenceSource
}

/** merged: 补上这一句, the sentence went under the word already kept */
export type AddWordResult = 'added' | 'merged' | 'exists'
export type AddSentenceResult = 'added' | 'exists'
/** notEnglish: not a message the button is on; failed: its Chinese could not be translated */
export type AddMineResult = AddSentenceResult | 'notEnglish' | { failed: string }

// 代码块和贴进来的日志不存进句子: the parts of a message that are not its words
const LEFT_OUT: ReadonlySet<MaskKind> = new Set(['codeBlock', 'pasted', 'pastedText', 'image'])

/** A message you sent, as the word book keeps it: no code blocks, pasted logs or image marks, on one line */
export function cleanMine(text: string): string {
  let out = ''
  let at = 0
  for (const span of maskSpans(text)) {
    if (LEFT_OUT.has(span.kind)) {
      out += `${text.slice(at, span.start)} `
      at = span.end
    }
  }
  return normalizeSentence(out + text.slice(at))
}

const sameSentence = (a: string, b: string) => normalizeSentence(a) === normalizeSentence(b)

/** A word's file name: its base form, escaped so a phrase or a slash stays one name */
export function wordFileName(lemma: string): string {
  const name = encodeURIComponent(normalizeLemma(lemma))
  return name.length <= 120 ? name : `${name.slice(0, 80)}-${hash(name)}`
}

/** A sentence's key: the hash of its English, so the same sentence is kept once */
export const sentenceKeyOf = (en: string) => hash(normalizeSentence(en))

export const wordFileOf = (dataDir: string, lemma: string) => `${dataDir}/book/words/${wordFileName(lemma)}.json`

export const sentenceFileOf = (dataDir: string, en: string) => `${dataDir}/book/sentences/${sentenceKeyOf(en)}.json`

// --- reading a file back; anything that does not read is no entry ---

type Loose = Record<string, unknown>

const isLoose = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown) => (typeof value === 'string' ? value : '')
const time = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
const noteIdOf = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const texts = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])
const pairOf = (value: unknown) => (isLoose(value) ? { en: text(value.en), zh: text(value.zh) } : null)

function wordSentenceOf(value: unknown): BookWordSentence[] {
  if (!isLoose(value) || text(value.en) === '') {
    return []
  }
  return [
    {
      en: text(value.en),
      zh: text(value.zh),
      form: text(value.form),
      sense: text(value.sense),
      addedAt: time(value.addedAt),
      synced: value.synced === true,
    },
  ]
}

function wordOf(value: unknown): BookWord | null {
  if (!isLoose(value) || text(value.lemma) === '') {
    return null
  }
  const sentences = Array.isArray(value.sentences) ? value.sentences.flatMap(wordSentenceOf) : []
  return {
    v: 1,
    lemma: text(value.lemma),
    ipa: text(value.ipa),
    senses: texts(value.senses),
    example: pairOf(value.example),
    sentences,
    addedAt: time(value.addedAt),
    sync: value.sync === 'synced' && sentences.every(s => s.synced) ? 'synced' : 'pending',
    noteId: noteIdOf(value.noteId),
  }
}

function sentenceOf(value: unknown): BookSentence | null {
  if (!isLoose(value) || text(value.en) === '') {
    return null
  }
  const parts = Array.isArray(value.parts) ? value.parts.filter(isLoose).map(p => ({ text: text(p.text), role: text(p.role) })) : []
  return {
    v: 1,
    en: text(value.en),
    zh: text(value.zh),
    zhIsTranslation: value.zhIsTranslation === true,
    source: value.source === 'mine' ? 'mine' : 'reply',
    parts,
    points: texts(value.points),
    addedAt: time(value.addedAt),
    sync: value.sync === 'synced' ? 'synced' : 'pending',
    noteId: noteIdOf(value.noteId),
  }
}

// --- one change at a time, so two quick adds of the same word both land ---

const queues = new WeakMap<Host, Promise<unknown>>()

function exclusive<T>(host: Host, job: () => Promise<T>): Promise<T> {
  const next = (queues.get(host) ?? Promise.resolve()).catch(() => undefined).then(job)
  queues.set(host, next)
  return next
}

async function today(host: Host): Promise<string> {
  const ms = await host.clock.now()
  return localDate(ms, -new Date(ms).getTimezoneOffset())
}

/** F13 › 单词本新增; a count that fails to write never fails the add */
async function countNew(host: Host, add: Partial<DayCounts>): Promise<void> {
  try {
    await addToDay(host, await today(host), add)
  } catch (error) {
    host.ui.debug(`word book count: ${String(error)}`)
  }
}

export async function readWord(host: Host, lemma: string): Promise<BookWord | null> {
  return wordOf(await readJson(host, wordFileOf(await dataDirOf(host), lemma)))
}

export async function readSentence(host: Host, en: string): Promise<BookSentence | null> {
  return sentenceOf(await readJson(host, sentenceFileOf(await dataDirOf(host), en)))
}

/** Adds a word, or 补上这一句: a sentence it was not kept with goes under it, with its own 本句释义. */
export function addWord(host: Host, input: AddWordInput): Promise<AddWordResult> {
  return exclusive(host, async () => {
    const lemma = normalizeLemma(input.lemma)
    if (lemma === '') {
      throw new Error('a word with no base form cannot be added')
    }
    const path = wordFileOf(await dataDirOf(host), lemma)
    const kept = wordOf(await readJson(host, path))
    const now = await host.clock.now()
    const en = normalizeSentence(input.sentence ?? '')
    const sentence: BookWordSentence | null =
      en === ''
        ? null
        : {
            en,
            zh: normalizeSentence(input.sentenceZh ?? ''),
            form: input.form.trim() || lemma,
            sense: input.cur === null ? '' : (input.senses[input.cur] ?? ''),
            addedAt: now,
            synced: false,
          }
    if (!kept) {
      const word: BookWord = {
        v: 1,
        lemma,
        ipa: input.ipa,
        senses: [...input.senses],
        example: input.examples[0] ? { en: input.examples[0].en, zh: input.examples[0].zh } : null,
        sentences: sentence ? [sentence] : [],
        addedAt: now,
        sync: 'pending',
        noteId: null,
      }
      await writeJson(host, path, word)
      await countNew(host, { newWords: 1 })
      return 'added'
    }
    if (!sentence || kept.sentences.some(s => sameSentence(s.en, sentence.en))) {
      return 'exists'
    }
    await writeJson(host, path, { ...kept, sentences: [...kept.sentences, sentence], sync: 'pending' })
    return 'merged'
  })
}

/** Adds a sentence, kept once by its English. A sentence you sent loses its code blocks and pasted logs first. */
export function addSentence(host: Host, input: AddSentenceInput): Promise<AddSentenceResult> {
  return exclusive(host, async () => {
    const isMine = input.source === 'mine'
    const en = isMine ? cleanMine(input.en) : normalizeSentence(input.en)
    if (en === '') {
      throw new Error('a sentence with no words cannot be added')
    }
    const path = sentenceFileOf(await dataDirOf(host), en)
    if (sentenceOf(await readJson(host, path))) {
      return 'exists'
    }
    const sentence: BookSentence = {
      v: 1,
      en,
      zh: isMine ? cleanMine(input.zh) : normalizeSentence(input.zh),
      zhIsTranslation: input.zhIsTranslation === true,
      source: input.source,
      parts: isMine ? [] : (input.parts ?? []).map(p => ({ text: p.text, role: p.role })),
      points: isMine ? [] : [...(input.points ?? [])],
      addedAt: await host.clock.now(),
      sync: 'pending',
      noteId: null,
    }
    await writeJson(host, path, sentence)
    await countNew(host, { newSents: 1 })
    return 'added'
  })
}

/**
 * F12 › 你发出的句子: a message you sent, with the Chinese you wrote it from
 * (the band's last F1 source); when the band never showed a translation or
 * the Chinese is gone, the English is translated and marked 中文为译文.
 */
export async function addMySentence(host: Host, en: string): Promise<AddMineResult> {
  if (!isEnglishMessage(en)) {
    return 'notEnglish'
  }
  const cleaned = cleanMine(en)
  if (await readSentence(host, cleaned)) {
    return 'exists'
  }
  const draft = await keptDraftOf(host, en)
  const written = draft?.sawTranslation ? cleanMine(draft.zh) : ''
  if (written !== '') {
    return addSentence(host, { en: cleaned, zh: written, source: 'mine' })
  }
  const translated = await run(host, { kind: 'myZh', text: cleaned })
  if (!translated.ok) {
    return { failed: translated.reason }
  }
  return addSentence(host, { en: cleaned, zh: translated.value, zhIsTranslation: true, source: 'mine' })
}

/**
 * Deletes a word (by its base form) or a sentence (by its English, as
 * kept) from this machine only: Anki's card stays, with its reviews.
 */
export function remove(host: Host, kind: 'word' | 'sentence', key: string): Promise<void> {
  return exclusive(host, async () => {
    const dataDir = await dataDirOf(host)
    await removeFile(host, kind === 'word' ? wordFileOf(dataDir, key) : sentenceFileOf(dataDir, key))
  })
}

async function readAll<T>(host: Host, dir: string, read: (value: unknown) => T | null): Promise<T[]> {
  const entries = await host.fs.list(dir).catch(() => [])
  const names = entries.filter(e => e.kind === 'file' && e.name.endsWith('.json')).map(e => e.name)
  const values = await Promise.all(names.map(name => readJson(host, `${dir}/${name}`)))
  return values.map(read).filter((v): v is T => v !== null)
}

const newestFirst = (a: { addedAt: number }, b: { addedAt: number }) => b.addedAt - a.addedAt

/** The whole book, newest first in each group; each word with all its sentences, oldest first. */
export async function list(host: Host): Promise<Book> {
  const dataDir = await dataDirOf(host)
  const [words, sentences] = await Promise.all([
    readAll(host, `${dataDir}/book/words`, wordOf),
    readAll(host, `${dataDir}/book/sentences`, sentenceOf),
  ])
  return { words: words.sort(newestFirst), sentences: sentences.sort(newestFirst) }
}

/** How many wait for Anki, for the status line */
export const pendingCounts = (kept: Book) => ({
  words: kept.words.filter(w => w.sync === 'pending').length,
  sentences: kept.sentences.filter(s => s.sync === 'pending').length,
})

/** The word card's button: 加入单词本, 已加入单词本, or 补上这一句 for a sentence the word was not kept with. */
export async function statusOf(host: Host, word: string, sentence: string | null): Promise<WordStatus> {
  const kept = await readWord(host, word)
  if (!kept) {
    return 'none'
  }
  const en = normalizeSentence(sentence ?? '')
  return en === '' || kept.sentences.some(s => sameSentence(s.en, en)) ? 'added' : 'sentenceMissing'
}

/** Whether a sentence is kept; a message you sent is looked up as it would be kept. */
export async function sentenceStatusOf(host: Host, en: string, source: SentenceSource): Promise<'none' | 'added'> {
  const key = source === 'mine' ? cleanMine(en) : en
  return key !== '' && (await readSentence(host, key)) ? 'added' : 'none'
}

/** After Anki took them: these sentences of the word are on its card `noteId`. */
export function markWordSynced(host: Host, lemma: string, noteId: number, sentences: readonly string[]): Promise<void> {
  return exclusive(host, async () => {
    const path = wordFileOf(await dataDirOf(host), lemma)
    const kept = wordOf(await readJson(host, path))
    if (!kept) {
      return
    }
    const done = kept.sentences.map(s => (s.synced || sentences.some(en => sameSentence(en, s.en)) ? { ...s, synced: true } : s))
    const sync: SyncState = done.every(s => s.synced) ? 'synced' : 'pending'
    await writeJson(host, path, { ...kept, sentences: done, sync, noteId })
  })
}

export function markSentenceSynced(host: Host, en: string, noteId: number): Promise<void> {
  return exclusive(host, async () => {
    const path = sentenceFileOf(await dataDirOf(host), en)
    const kept = sentenceOf(await readJson(host, path))
    if (kept) {
      await writeJson(host, path, { ...kept, sync: 'synced', noteId })
    }
  })
}

/** The book as services/anki/sync.ts reads and marks it: syncWord(host, book, lemma) */
export const book: BookPort = { list, readWord, readSentence, markWordSynced, markSentenceSynced }
