import { CARD_HEADINGS, THIS_SENTENCE } from '../../core/copy/wordbook'

// The two card types the word book creates in Anki (F12 › 卡片), written as
// AnkiConnect's `createModel` params so they are sent as they are. Anki tells
// notes apart by their first field, so 单词 and 句子 come first.
// https://git.sr.ht/~foosoft/anki-connect/blob/master/README.md › createModel

export type AnkiCardTemplate = { Name: string; Front: string; Back: string }

export type AnkiModel = {
  modelName: string
  inOrderFields: readonly string[]
  css: string
  isCloze: false
  cardTemplates: readonly AnkiCardTemplate[]
}

export const WORD_FIELDS = ['单词', '音标', '朗读', '原句', '本句释义', '其他释义', '原句译文', '例句', '例句译文'] as const
export type WordField = (typeof WORD_FIELDS)[number]

export const SENTENCE_FIELDS = ['句子', '朗读', '译文', '结构', '要点', '来源'] as const
export type SentenceField = (typeof SENTENCE_FIELDS)[number]

/** The field `addNote`'s `audio` goes into, on both cards */
export const AUDIO_FIELD = '朗读'

/** The classes notes.ts writes into the fields, so the styles below reach them */
export const CLASS = {
  /** One sentence of 原句 or 原句译文 */
  sentence: 'wwe-s',
  /** A later sentence's own 本句释义, after it in 原句: shown on the back only */
  sense: 'wwe-sense',
  tag: 'wwe-tag',
  note: 'wwe-note',
  part: 'wwe-part',
  partText: 'wwe-part-t',
  partRole: 'wwe-part-l',
} as const

const heading = (text: string) => `<div class="wwe-h">${text}</div>`

// The back repeats the front through {{FrontSide}} inside .wwe-a, which is
// how the styles show each later sentence's 本句释义 on the back alone.
const back = (lines: readonly string[]) =>
  ['<div class="wwe-a">{{FrontSide}}</div>', '<hr id="answer">', '<div class="wwe">', ...lines, '</div>'].join('\n')

const WORD_FRONT = [
  '<div class="wwe wwe-q">',
  '<div class="wwe-word">{{单词}}</div>',
  '{{#音标}}<div class="wwe-ipa">{{音标}}</div>{{/音标}}',
  '{{朗读}}',
  '{{#原句}}<div class="wwe-ex">{{原句}}</div>{{/原句}}',
  '</div>',
].join('\n')

const WORD_BACK = back([
  `{{#本句释义}}<div class="wwe-sec"><span class="${CLASS.tag}">${THIS_SENTENCE}</span>{{本句释义}}</div>{{/本句释义}}`,
  `{{#其他释义}}<div class="wwe-sec">${heading(CARD_HEADINGS.others)}{{其他释义}}</div>{{/其他释义}}`,
  `{{#原句译文}}<div class="wwe-sec">${heading(CARD_HEADINGS.sentenceZh)}{{原句译文}}</div>{{/原句译文}}`,
  `{{#例句}}<div class="wwe-sec">${heading(CARD_HEADINGS.example)}<div>{{例句}}</div><div class="wwe-zh">{{例句译文}}</div></div>{{/例句}}`,
])

const SENTENCE_FRONT = ['<div class="wwe wwe-q">', '<div class="wwe-sent">{{句子}}</div>', '{{朗读}}', '</div>'].join('\n')

// A sentence you sent has no 结构 or 要点, so those two sit in conditionals
// and its back is left with the Chinese and the source.
const SENTENCE_BACK = back([
  '<div class="wwe-sec wwe-zh">{{译文}}</div>',
  `{{#结构}}<div class="wwe-sec">${heading(CARD_HEADINGS.structure)}{{结构}}</div>{{/结构}}`,
  `{{#要点}}<div class="wwe-sec">${heading(CARD_HEADINGS.points)}{{要点}}</div>{{/要点}}`,
  '<div class="wwe-src">{{来源}}</div>',
])

// Anki marks a card in night mode with the class nightMode (older versions
// and AnkiDroid with night_mode), on the same element as .card.
export const CARD_CSS = `.card {
  --wwe-ink: #1E1E1E;
  --wwe-muted: #6B6B66;
  --wwe-line: #D9D9D4;
  --wwe-accent: #94552A;
  --wwe-surface: #FFFFFF;
  font-family: system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif;
  font-size: 20px;
  line-height: 1.55;
  text-align: left;
  color: var(--wwe-ink);
  background-color: var(--wwe-surface);
}
.card.nightMode, .card.night_mode, .nightMode .card {
  --wwe-ink: #ECEBE6;
  --wwe-muted: #A3A29B;
  --wwe-line: #3A3A36;
  --wwe-accent: #E3AB82;
  --wwe-surface: #21211F;
}
.wwe { max-width: 640px; margin: 0 auto; }
.wwe-word { font-size: 32px; font-weight: 600; }
.wwe-ipa, .wwe-src, .wwe-note { color: var(--wwe-muted); }
.wwe-ex, .wwe-sent { margin-top: 12px; }
.wwe-sent { font-size: 22px; }
.wwe-s + .wwe-s { margin-top: 6px; }
.wwe b { color: var(--wwe-accent); }
.wwe-sec { margin-top: 14px; }
.wwe-h { font-size: 14px; font-weight: 600; color: var(--wwe-muted); }
.wwe-zh { color: var(--wwe-muted); }
.wwe-src { margin-top: 14px; font-size: 14px; }
.wwe-note { margin-left: 8px; font-size: 14px; }
.wwe-tag {
  display: inline-block;
  margin-right: 6px;
  padding: 0 5px;
  border-radius: 3px;
  background-color: var(--wwe-accent);
  color: var(--wwe-surface);
  font-size: 13px;
  font-weight: 600;
  vertical-align: 2px;
}
.wwe-sense { display: none; font-size: 16px; }
.wwe-a .wwe-q .wwe-sense { display: block; }
.wwe-part { display: inline-block; margin: 2px 8px 2px 0; text-align: center; }
.wwe-part-t { display: block; padding: 0 6px; border: 1px solid var(--wwe-line); border-radius: 4px; }
.wwe-part-l { display: block; font-size: 13px; color: var(--wwe-muted); }
hr#answer { border: none; border-top: 1px solid var(--wwe-line); }
`

export const WORD_MODEL: AnkiModel = {
  modelName: 'claude-with-english 单词',
  inOrderFields: WORD_FIELDS,
  css: CARD_CSS,
  isCloze: false,
  cardTemplates: [{ Name: '单词卡', Front: WORD_FRONT, Back: WORD_BACK }],
}

export const SENTENCE_MODEL: AnkiModel = {
  modelName: 'claude-with-english 句子',
  inOrderFields: SENTENCE_FIELDS,
  css: CARD_CSS,
  isCloze: false,
  cardTemplates: [{ Name: '句子卡', Front: SENTENCE_FRONT, Back: SENTENCE_BACK }],
}

export const MODELS: readonly AnkiModel[] = [WORD_MODEL, SENTENCE_MODEL]

/**
 * The fields of ours a card type in Anki has lost (`modelFieldNames`), which
 * is when syncing stops. Fields added, reordered or restyled there are the
 * user's own and change nothing.
 */
export const missingFields = (model: AnkiModel, fieldNames: readonly string[]) =>
  model.inOrderFields.filter(name => !fieldNames.includes(name))
