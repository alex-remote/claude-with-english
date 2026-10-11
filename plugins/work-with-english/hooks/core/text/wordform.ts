// A word as it stands in a sentence: found whole, never inside a longer word
// (cause isn't in because, use isn't in user), for the bold of 原句 on the
// word card and the 单词本 page (F10, F12 › 词加粗); and a hard word, listed
// in its base form, found in the form the text wrote it in (F11 › 难词:
// retrieve in "is retrieving", write in "is written").

/** A span of a text: where a word starts and where it ends */
export type Span = { start: number; end: number }

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’]/g, "['’]")

// As core/text/selection.ts finds a selected word's sentence: not part of a
// longer word or of a hyphenated one, but dry-run is a word of its own
const BEFORE = '(?<![\\p{L}\\p{N}_]|[\\p{L}\\p{N}]-)'
const AFTER = '(?![\\p{L}\\p{N}_]|-[\\p{L}\\p{N}])'

/** The first place `pattern` matches a whole word or phrase of `text`, any case */
function firstAt(text: string, pattern: string): Span | null {
  const m = new RegExp(`${BEFORE}(?:${pattern})${AFTER}`, 'iu').exec(text)
  return m ? { start: m.index, end: m.index + m[0].length } : null
}

const wordsOf = (text: string) => text.trim().split(/\s+/).filter(word => word !== '')

/** Where `form` first stands in `text` as a whole word (a phrase: its words with any spacing), or null */
export function wordAt(text: string, form: string): Span | null {
  const words = wordsOf(form)
  return words.length === 0 ? null : firstAt(text, words.map(escape).join('\\s+'))
}

/** The text cut around the first whole `form` in it, for drawing that word in bold; null when it is not there */
export function boldParts(text: string, form: string): { before: string; word: string; after: string } | null {
  const at = wordAt(text, form)
  return at && { before: text.slice(0, at.start), word: text.slice(at.start, at.end), after: text.slice(at.end) }
}

// The irregular forms a base form can take, the base first. A word ending in
// one of these bases takes its forms too: override, overrode, overridden.
const IRREGULAR = [
  'arise arose arisen', 'bear bore borne', 'beat beaten', 'become became', 'begin began begun', 'bend bent',
  'bind bound', 'bite bit bitten', 'blow blew blown', 'break broke broken', 'breed bred', 'bring brought',
  'build built', 'burn burnt', 'buy bought', 'catch caught', 'choose chose chosen', 'cling clung', 'come came',
  'creep crept', 'deal dealt', 'dig dug', 'do did done', 'draw drew drawn', 'drive drove driven', 'eat ate eaten',
  'fall fell fallen', 'feed fed', 'feel felt', 'fight fought', 'find found', 'flee fled', 'fling flung',
  'fly flew flown', 'forbid forbade forbidden', 'forsake forsook forsaken', 'freeze froze frozen', 'get got gotten',
  'give gave given', 'go went gone', 'grind ground', 'grow grew grown', 'hang hung', 'hear heard', 'hide hid hidden',
  'hold held', 'keep kept', 'know knew known', 'lay laid', 'lead led', 'leap leapt', 'leave left', 'lend lent',
  'light lit', 'lose lost', 'make made', 'mean meant', 'meet met', 'pay paid', 'ride rode ridden', 'ring rang rung',
  'rise rose risen', 'run ran', 'say said', 'see saw seen', 'seek sought', 'sell sold', 'send sent',
  'shake shook shaken', 'shine shone', 'shoot shot', 'show shown', 'shrink shrank shrunk', 'sing sang sung',
  'sink sank sunk', 'sit sat', 'slay slew slain', 'slide slid', 'sling slung', 'speak spoke spoken', 'spend spent',
  'spin spun', 'spring sprang sprung', 'stand stood', 'steal stole stolen', 'stick stuck', 'sting stung',
  'stink stank stunk', 'strike struck stricken', 'string strung', 'strive strove striven', 'swear swore sworn',
  'sweep swept', 'swell swollen', 'swim swam swum', 'swing swung', 'take took taken', 'teach taught', 'tear tore torn',
  'tell told', 'think thought', 'throw threw thrown', 'tread trod trodden', 'wake woke woken', 'wear wore worn',
  'weave wove woven', 'weep wept', 'win won', 'wind wound', 'wring wrung', 'write wrote written',
  'child children', 'person people', 'mouse mice',
].map(entry => entry.split(' '))

/**
 * The forms a word in its base form may take in a text: plurals, verb forms
 * and the irregular ones. More than the language has does no harm, as only
 * a whole word of the text is matched; comparatives are left out, as load
 * would find loader.
 */
function formsOf(base: string): string[] {
  const w = base.toLowerCase()
  const forms = new Set([w, `${w}s`, `${w}es`, `${w}d`, `${w}ed`, `${w}ing`])
  const stem = (cut: number) => w.slice(0, w.length - cut)
  if (w.endsWith('e')) {
    forms.add(`${stem(1)}ing`) // retrieve: retrieving
  }
  if (w.endsWith('ie')) {
    forms.add(`${stem(2)}ying`) // tie: tying
  }
  if (/[^aeiou]y$/.test(w)) {
    forms.add(`${stem(1)}ies`).add(`${stem(1)}ied`) // dependency: dependencies; apply: applied
  }
  if (/[^aeiou][aeiou][bcdfgklmnprstvz]$/.test(w)) {
    forms.add(`${w}${w.slice(-1)}ed`).add(`${w}${w.slice(-1)}ing`) // commit: committed, committing
  }
  if (w.endsWith('c')) {
    forms.add(`${w}ked`).add(`${w}king`) // panic: panicked
  }
  if (w.endsWith('is')) {
    forms.add(`${stem(2)}es`) // analysis: analyses
  }
  if (w.endsWith('us')) {
    forms.add(`${stem(2)}i`) // radius: radii
  }
  if (/(?:um|on)$/.test(w)) {
    forms.add(`${stem(2)}a`) // datum: data; criterion: criteria
  }
  if (/(?:ex|ix)$/.test(w)) {
    forms.add(`${stem(2)}ices`) // index: indices
  }
  if (w.endsWith('fe')) {
    forms.add(`${stem(2)}ves`) // knife: knives
  } else if (w.endsWith('f')) {
    forms.add(`${stem(1)}ves`) // half: halves
  }
  for (const [head, ...irregular] of IRREGULAR) {
    if (head && w.endsWith(head)) {
      for (const form of irregular) {
        forms.add(`${stem(head.length)}${form}`)
      }
    }
  }
  return [...forms]
}

/**
 * The word as the text first writes it, `base` or one of its forms, a whole
 * word, any case; a phrase (stand out) by the forms of its first word. Null
 * when the text has none of them.
 */
export function formIn(text: string, base: string): string | null {
  const [head, ...rest] = wordsOf(base)
  if (!head) {
    return null
  }
  const pattern = [`(?:${formsOf(head).map(escape).join('|')})`, ...rest.map(escape)].join('\\s+')
  const at = firstAt(text, pattern)
  return at && text.slice(at.start, at.end)
}
