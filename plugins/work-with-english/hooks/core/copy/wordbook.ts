// Every word of the word book (F12): the buttons that add to it, its toasts,
// the 单词本 page and the line about Anki, and the labels on the two Anki
// cards. The feature map's own sentences first, then the prototype; the line
// for a broken card type is the dev plan's draft (要新拟的文案). The setting
// names and descriptions of the page are in copy/settings.ts.

/** A sentence's head in a toast: the prototype's 28 characters, the last one an ellipsis, no blank before it */
const TOAST_HEAD = 28

/** The buttons on the word card, beside each analysed sentence and on a message you sent */
export const ADD = '加入单词本'
export const ADDED = '已加入单词本'
/** The word card's button when the word is in the book from another sentence */
export const ADD_SENTENCE = '补上这一句'
/** A message of yours whose Chinese is still being translated */
export const ADDING = '加入中…'

/** Appended to an add's toast when the card reached Anki */
const SYNCED_SUFFIX = '，已同步到 Anki'

const synced = (isSynced: boolean) => (isSynced ? SYNCED_SUFFIX : '')

/** The start of a long sentence, as a toast names it */
export const sentenceHead = (en: string) =>
  en.length > TOAST_HEAD ? `${en.slice(0, TOAST_HEAD - 1).trimEnd()}…` : en

/** 已加入单词本：cause, and ，已同步到 Anki when the card reached Anki */
export const addedWordToast = (word: string, isSynced: boolean) =>
  `已加入单词本：${word}${synced(isSynced)}`

/** 已加入单词本：<句子开头> */
export const addedSentenceToast = (en: string, isSynced: boolean) =>
  `已加入单词本：${sentenceHead(en)}${synced(isSynced)}`

/** 补上这一句: cause 已在单词本里，补上了这一句。 */
export const addedToWordToast = (word: string, isSynced: boolean) =>
  `${word} 已在单词本里，补上了这一句${synced(isSynced)}。`

/** ✕ on the page: 已从单词本删除：cause */
export const deletedWordToast = (word: string) => `已从单词本删除：${word}`

export const deletedSentenceToast = (en: string) => `已从单词本删除：${sentenceHead(en)}`

/** How many, as the status line and the toasts put it: 2 个词、1 个句子; a kind with none is left out */
export const bookCount = (words: number, sentences: number) =>
  [words > 0 ? `${words} 个词` : '', sentences > 0 ? `${sentences} 个句子` : '']
    .filter(part => part !== '')
    .join('、')

/** What was waiting went into Anki: 已同步 2 个词、1 个句子到 Anki。 */
export const syncedToast = (words: number, sentences: number) =>
  `已同步 ${bookCount(words, sentences)}到 Anki。`

/**
 * After 同步到 Anki was turned back on, what follows the save toast's
 * 已保存：同步到 Anki 开: ，已同步 2 个词、1 个句子到 Anki; nothing when none went.
 */
export const syncedOnSaveSuffix = (words: number, sentences: number) =>
  words + sentences > 0 ? `，已同步 ${bookCount(words, sentences)}到 Anki` : ''

/** The page's two groups: 单词（2）, 句子（2） */
export const wordsHeading = (n: number) => `单词（${n}）`
export const sentencesHeading = (n: number) => `句子（${n}）`

/** Where a sentence came from, on the page and on its Anki card */
export type SentenceSource = 'mine' | 'reply'

export const SOURCE_LABELS: Readonly<Record<SentenceSource, string>> = {
  mine: '我发出的',
  reply: 'Claude 的回复',
}

/** A sentence you sent whose Chinese was translated when it was added */
export const ZH_IS_TRANSLATION = '中文为译文'

/** The tag before the meaning a word has in its sentence */
export const THIS_SENTENCE = '本句'

export const SYNCED = '已同步'
export const PENDING = '待同步'

/**
 * A row's sync state: nothing with syncing off, and nothing for a row
 * waiting while Anki has never answered, where the status line says it once.
 */
export const rowSyncState = (row: { isSynced: boolean }, anki: { isSyncOn: boolean; hasEverConnected: boolean }) =>
  !anki.isSyncOn ? '' : row.isSynced ? SYNCED : anki.hasEverConnected ? PENDING : ''

export const EMPTY_WORDS = '还没有单词。在单词卡上点“加入单词本”。'
export const EMPTY_SENTENCES = '还没有句子。在语法分析里每句旁边，或在你发出的消息上点“加入单词本”。'

/** The ✕ of a row, for screen readers */
export const deleteLabel = (name: string) => `从单词本删除 ${name}`

/** Connected: ✓ 已连接 Anki，新加的单词和句子会自动建卡到牌组 claude-with-english。 */
export const ankiConnected = (deck: string) => `✓ 已连接 Anki，新加的单词和句子会自动建卡到牌组 ${deck}。`

/**
 * Not connected, also the page's one line for someone who has never had
 * Anki: 未连接 Anki。打开 Anki 并装好 AnkiConnect 插件后，会自动同步，现在有
 * 1 个词、1 个句子等待同步。
 */
export const ankiOffline = (pendingWords: number, pendingSentences: number) => {
  const pending = bookCount(pendingWords, pendingSentences)
  return `未连接 Anki。打开 Anki 并装好 AnkiConnect 插件后，会自动同步${pending === '' ? '' : `，现在有 ${pending}等待同步`}。`
}

/** One of our card types was renamed, lost a field of ours (models.ts › missingFields) or was deleted: syncing stops */
export const ankiModelBroken = (modelName: string) =>
  `Anki 里的卡片类型“${modelName}”被修改，已停止同步。删除这个卡片类型后会自动重建。`

// M7 drafts: the two ways a card type breaks, each with a way back that
// keeps the cards and their reviews (deleting a card type deletes its cards).

/** Our card type now goes by another name in Anki */
export const ankiModelRenamed = (modelName: string, newName: string) =>
  `Anki 里的卡片类型“${modelName}”被改名为“${newName}”，已停止同步。改回原名后会继续同步。`

/** Our card type lost fields of ours: “原句”“原句译文” */
export const ankiModelFieldsMissing = (modelName: string, fields: readonly string[]) =>
  `Anki 里的卡片类型“${modelName}”缺少字段${fields.map(f => `“${f}”`).join('')}，已停止同步。把字段加回去后会继续同步。`

/** AnkiConnect turned the request down: it asks for an API Key, or does not trust this program */
export const ANKI_REFUSED = 'AnkiConnect 拒绝了连接，已停止同步。在 AnkiConnect 的设置里去掉 API Key 后会继续同步。'

/** A message of yours whose Chinese could not be translated: 加入单词本失败：<原因> */
export const addFailedToast = (reason: string) => `${ADD}失败：${reason}`

export type AnkiLink = 'unknown' | 'ok' | 'offline' | 'broken'

/**
 * The status line under 同步到 Anki: none with syncing off, nor before the
 * first check of this page has answered, so it never flips from 未连接 to 已连接.
 */
export function ankiStatus(state: {
  isSyncOn: boolean
  link: AnkiLink
  deck: string
  pendingWords: number
  pendingSentences: number
  /** The card type that broke, with link 'broken' */
  brokenModel?: string
  /** With link 'broken', the reason the sync gave (services/anki/client.ts › ensureSetup); it wins over brokenModel */
  brokenReason?: string
}): string | null {
  if (!state.isSyncOn || state.link === 'unknown') {
    return null
  }
  if (state.link === 'ok') {
    return ankiConnected(state.deck)
  }
  if (state.link === 'broken') {
    return state.brokenReason ?? ankiModelBroken(state.brokenModel ?? '')
  }
  return ankiOffline(state.pendingWords, state.pendingSentences)
}

/** The headings on the back of the two Anki cards, named as in the feature map */
export const CARD_HEADINGS = {
  others: '其他释义',
  sentenceZh: '原句译文',
  example: '例句',
  structure: '结构',
  points: '要点',
} as const
