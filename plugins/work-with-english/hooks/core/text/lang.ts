import { visibleText } from './mask'

// Language judging (docs/feature-map.md, 语言判断): Han characters are Chinese,
// Latin words are English, counted only outside the parts mask.ts leaves out.
// Every function here takes the text as typed or sent; for a sent message,
// pass command.ts's judgedText so a leading command name and shell input stay out.

export type Lang = 'zh' | 'en'

// Script=Han leaves out Chinese punctuation and full-width forms
const HAN = /\p{Script=Han}/gu
// Whole words, so don't and follow-up count once each; a trailing period is not part of one
const WORD = /[A-Za-z0-9_]+(?:['’.-][A-Za-z0-9_]+)*/g

const hanIn = (visible: string) => visible.match(HAN)?.length ?? 0
const wordsIn = (visible: string) => (visible.match(WORD) ?? []).filter(w => !isCodeLikeWord(w)).length

/**
 * A word that reads as code rather than English: with a digit, an underscore
 * or a dot, or a capital right after a lowercase letter (useEffect,
 * TypeScript). All capitals (API, OK) still count as English.
 */
export const isCodeLikeWord = (word: string): boolean => /[\d_.]/.test(word) || /[a-z][A-Z]/.test(word)

/** Han characters outside the left-out parts. */
export const countHan = (text: string): number => hanIn(visibleText(text))

/** One Han character outside the left-out parts. */
export const hasHan = (text: string): boolean => countHan(text) > 0

/** English words outside the left-out parts, code-like words not counted. */
export const countEnWords = (text: string): number => wordsIn(visibleText(text))

/**
 * Which language the text is mostly in: Chinese by characters against English
 * by words, a tie going to Chinese (fix 一下 bug); null with neither, as for
 * numbers, symbols or code alone.
 */
export function mainLang(text: string): Lang | null {
  const visible = visibleText(text)
  const zh = hanIn(visible)
  const en = wordsIn(visible)
  if (zh === 0 && en === 0) {
    return null
  }
  return zh >= en ? 'zh' : 'en'
}

/** F12, F13: an English message has no Han character and at least one English word. */
export function isEnglishMessage(text: string): boolean {
  const visible = visibleText(text)
  return hanIn(visible) === 0 && wordsIn(visible) > 0
}

/** F4: strict mode blocks a message with one Han character outside the left-out parts. */
export const shouldBlock = (text: string): boolean => hasHan(text)

/**
 * F1, F15: what the band does with the text. Mostly Chinese is translated;
 * mostly English, Chinese or not, is corrected with the Chinese put into
 * English; null when neither can be told and the band shows nothing new.
 */
export function bandMode(text: string): 'translate' | 'correct' | null {
  const lang = mainLang(text)
  return lang === null ? null : lang === 'zh' ? 'translate' : 'correct'
}
