import { SOURCE_LABELS, THIS_SENTENCE, ZH_IS_TRANSLATION, type SentenceSource } from '../../core/copy/wordbook'
import { CLASS, SENTENCE_MODEL, WORD_MODEL, type SentenceField, type WordField } from './models'

// What goes into the fields of a word card and a sentence card, and the
// rules of F12 › 重复怎么处理: Anki's card wins, so a word met again only gets
// the new sentence added to 原句 and 原句译文, and nothing it already has is
// written over. AnkiConnect's calls are made elsewhere; these only shape data.

/** One sentence a word was added from */
export type WordSentence = {
  en: string
  zh: string
  /** The word as it stands there (blocks for block), set in bold */
  form: string
  /** Its meaning in this sentence (本句释义) */
  sense: string
}

export type WordEntry = {
  /** The base form; stored in lower case (normalizeLemma) */
  lemma: string
  ipa: string
  /** Every common meaning the word card listed */
  senses: readonly string[]
  /** Oldest first: the first one's meaning is the card's 本句释义 */
  sentences: readonly WordSentence[]
  example: { en: string; zh: string } | null
}

export type SentenceEntry = {
  en: string
  zh: string
  /** A sentence you sent whose Chinese was translated when it was added (中文为译文) */
  isZhTranslated: boolean
  source: SentenceSource
  /** 结构: each part and its role; a sentence you sent has none */
  parts: readonly { text: string; role: string }[]
  /** 要点; a sentence you sent has none */
  points: readonly string[]
}

export type WordNoteFields = Record<WordField, string>
export type SentenceNoteFields = Record<SentenceField, string>

/** The two fields a sentence added to a word's card changes */
export type WordNoteUpdate = Pick<WordNoteFields, '原句' | '原句译文'>

/**
 * Text as a field's HTML. Quotes stay as they are: Anki's editor writes a
 * field back the way innerHTML does, so a card edited there still matches
 * the value findNotes looks for.
 */
export const escapeHtml = (text: string) =>
  text.replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))

/** Cause and cause are one word (重复怎么处理 › 大小写不同) */
export const normalizeLemma = (word: string) => word.trim().replace(/\s+/g, ' ').toLowerCase()

/** A sentence as stored and compared: its whitespace runs made one space */
export const normalizeSentence = (en: string) => en.replace(/\s+/g, ' ').trim()

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The sentence as HTML, with the first whole-word `form` in it set in bold */
export function boldForm(sentence: string, form: string): string {
  const html = escapeHtml(normalizeSentence(sentence))
  const needle = escapeHtml(normalizeSentence(form))
  if (needle === '') {
    return html
  }
  const re = new RegExp(`(^|[^A-Za-z0-9&])(${escapeRegExp(needle)})(?![A-Za-z0-9])`, 'i')
  return html.replace(re, '$1<b>$2</b>')
}

const block = (inner: string) => `<div class="${CLASS.sentence}">${inner}</div>`

const senseAfter = (sense: string) =>
  sense.trim() === ''
    ? ''
    : `<div class="${CLASS.sense}"><span class="${CLASS.tag}">${THIS_SENTENCE}</span>${escapeHtml(sense)}</div>`

// Anki's editor writes a field back as innerHTML does, which in text spells
// out only these four
const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', nbsp: ' ' }

const decodeEntities = (html: string) => html.replace(/&(amp|lt|gt|nbsp);/g, (_, name: string) => ENTITIES[name] ?? '')

const SENSE_BLOCK = new RegExp(`<div class="${CLASS.sense}">[\\s\\S]*?</div>`, 'g')

/** The sentences a 原句 field holds as text, one per line, without the meanings written after them */
export const sentencesIn = (fieldHtml: string) =>
  decodeEntities(
    fieldHtml
      .replace(SENSE_BLOCK, '')
      .replace(/<br\s*\/?>|<\/?(?:div|p|li)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .split('\n')
    .map(normalizeSentence)
    .filter(line => line !== '')

/** Whether a word's card already has this sentence, so it is not added twice */
export const hasSentence = (fieldHtml: string, en: string) => sentencesIn(fieldHtml).includes(normalizeSentence(en))

/**
 * A word met in another sentence (补上这一句; also a word deleted here but
 * still in Anki): the new sentence goes after the card's 原句, with its own
 * 本句释义 after it, and its translation after 原句译文. Null when the card
 * has the sentence already.
 */
export function mergeWordNote(existing: Readonly<Record<string, string>>, sentence: WordSentence): WordNoteUpdate | null {
  const sentences = existing['原句'] ?? ''
  if (hasSentence(sentences, sentence.en)) {
    return null
  }
  return {
    原句: sentences + block(boldForm(sentence.en, sentence.form) + senseAfter(sentence.sense)),
    原句译文: (existing['原句译文'] ?? '') + block(escapeHtml(normalizeSentence(sentence.zh))),
  }
}

/**
 * A new word card. Every sentence after the first is merged in as
 * 补上这一句 would, so a card made again after Anki's was deleted carries all
 * of them the same way.
 */
export function wordNoteFields(entry: WordEntry): WordNoteFields {
  const [first, ...rest] = entry.sentences
  const sense = first?.sense ?? ''
  let fields: WordNoteFields = {
    单词: escapeHtml(normalizeLemma(entry.lemma)),
    音标: escapeHtml(entry.ipa),
    朗读: '',
    原句: first ? block(boldForm(first.en, first.form)) : '',
    本句释义: escapeHtml(sense),
    其他释义: entry.senses
      .filter(s => s !== sense)
      .map(s => `<div>${escapeHtml(s)}</div>`)
      .join(''),
    原句译文: first ? block(escapeHtml(normalizeSentence(first.zh))) : '',
    例句: escapeHtml(entry.example?.en ?? ''),
    例句译文: escapeHtml(entry.example?.zh ?? ''),
  }
  for (const sentence of rest) {
    const update = mergeWordNote(fields, sentence)
    if (update) {
      fields = { ...fields, ...update }
    }
  }
  return fields
}

/** The 句子 field of a sentence card, which Anki tells cards apart by */
export const sentenceFieldValue = (en: string) => escapeHtml(normalizeSentence(en))

export function sentenceNoteFields(entry: SentenceEntry): SentenceNoteFields {
  const isMine = entry.source === 'mine'
  const parts = isMine ? [] : entry.parts
  const points = isMine ? [] : entry.points
  return {
    句子: sentenceFieldValue(entry.en),
    朗读: '',
    译文:
      escapeHtml(normalizeSentence(entry.zh)) +
      (entry.isZhTranslated ? `<span class="${CLASS.note}">${ZH_IS_TRANSLATION}</span>` : ''),
    结构: parts
      .map(
        p =>
          `<span class="${CLASS.part}"><span class="${CLASS.partText}">${escapeHtml(p.text)}</span>` +
          `<span class="${CLASS.partRole}">${escapeHtml(p.role)}</span></span>`,
      )
      .join(' '),
    要点: points.length === 0 ? '' : `<ul>${points.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`,
    来源: SOURCE_LABELS[entry.source],
  }
}

/**
 * Text inside a quoted Anki search term: a backslash, a quote and the
 * wildcards * and _ are escaped, and so is a colon, so a value that starts
 * with re: or nc: is not read as a mode.
 * https://docs.ankiweb.net/searching.html › Matching special characters
 */
export const escapeSearch = (text: string) => text.replace(/[\\"*_:]/g, c => `\\${c}`)

/**
 * The cards of one type whose first field is exactly this value, in every
 * deck. The value is the field as stored: Anki's search matches & < > only
 * as &amp; &lt; &gt; (same section as above).
 */
export const findNotesQuery = (modelName: string, field: string, value: string) =>
  `"note:${escapeSearch(modelName)}" "${escapeSearch(field)}:${escapeSearch(value)}"`

/** findNotes for a word's card, in whatever deck it was made */
export const findWordQuery = (lemma: string) =>
  findNotesQuery(WORD_MODEL.modelName, '单词', escapeHtml(normalizeLemma(lemma)))

/** findNotes for a sentence's card, in whatever deck it was made */
export const findSentenceQuery = (en: string) =>
  findNotesQuery(SENTENCE_MODEL.modelName, '句子', sentenceFieldValue(en))

/** notesInfo's fields ({ 原句: { value, order } }) as the plain values mergeWordNote takes */
export const fieldValues = (fields: Readonly<Record<string, { value: string }>>): Record<string, string> =>
  Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.value]))
