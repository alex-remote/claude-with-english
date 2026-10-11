import type { WweAnalysis, WweBook, WweBookSentence, WweBookWord, WweSaved, WweSentence } from '../../../types'
import { hashParts } from '../../core/hash'
import {
  addFailedToast,
  addedSentenceToast,
  addedToWordToast,
  addedWordToast,
  deletedSentenceToast,
  deletedWordToast,
  syncedToast,
} from '../../core/copy/wordbook'
import { coerceSetting, storeKeyOf } from '../../core/settings/schema'
import { isShellInput } from '../../core/text/command'
import { isEnglishMessage } from '../../core/text/lang'
import type { Host } from '../../host'
import { hasEverConnected } from '../../services/anki/client'
import { normalizeLemma, normalizeSentence } from '../../services/anki/notes'
import { connectionStatus, syncPending, syncSentence, syncWord } from '../../services/anki/sync'
import type { SyncResult } from '../../services/anki/sync'
import {
  addMySentence,
  addSentence,
  addWord,
  book,
  cleanMine,
  list,
  pendingCounts,
  remove,
  sentenceStatusOf,
  statusOf,
} from './repo'
import type { Book } from './repo'

// F12 单词本 as the person meets it: 加入单词本 on the word card, beside
// each sentence of an analysis and on a message they sent; the 单词本 page's
// lists and its line on Anki. What is kept is repo.ts's; Anki is sync.ts's.
// Each button's state is `$.state.saved`, by the hash of what it adds: a
// drawing notes the ones it has not seen, and a timer looks them up.

export type SavedStatus = WweSaved['status']

/** What a button adds, as the key of its `$.state.saved` member */
export const savedKeyOf = {
  word: (lemma: string, sentence: string | null) =>
    hashParts(['word', normalizeLemma(lemma), normalizeSentence(sentence ?? '')]),
  sentence: (en: string) => hashParts(['sentence', normalizeSentence(en)]),
  mine: (text: string) => hashParts(['mine', text]),
}

/**
 * Whether a message you sent gets 朗读 and 加入单词本: an English message
 * (F13), not a shell command, not a /command (a skill's or your own; the
 * name ends at a space, so /Users/alex/app.ts is a path and counts).
 */
export const hasMineButtons = (text: string) =>
  !isShellInput(text) && !/^\/[^\s/]+(?=\s|$)/.test(text) && isEnglishMessage(text)

type Lookup = () => Promise<Exclude<SavedStatus, 'unknown' | 'adding'>>

/** A write that failed on this machine, as the toast says it */
const WRITE_FAILED = '无法写入本机文件'

const wordRow = (word: Book['words'][number]): WweBookWord => ({
  lemma: word.lemma,
  ipa: word.ipa,
  isSynced: word.sync === 'synced',
  sentences: word.sentences.map(s => ({ en: s.en, zh: s.zh, form: s.form, sense: s.sense })),
})

const sentenceRow = (sentence: Book['sentences'][number]): WweBookSentence => ({
  en: sentence.en,
  zh: sentence.zh,
  zhIsTranslation: sentence.zhIsTranslation,
  source: sentence.source,
  isSynced: sentence.sync === 'synced',
})

/** ，已同步到 Anki goes after the toast once Anki has the card */
const isSynced = (sync: SyncResult | null) => sync !== null && sync.isSynced

export type Wordbook = ReturnType<typeof createWordbook>

export function createWordbook(host: Host) {
  /** How each button seen so far is looked up again: an add or a delete can change any of them */
  const lookups = new Map<string, Lookup>()
  /** Drawn without a state yet, to look up on the next tick */
  const noted = new Set<string>()
  /** The 单词本 page was shown in this session: its lists follow each change */
  let isPageLoaded = false
  /** Where Anki stood at the last check: once it answers again, what waited goes in */
  let lastLink: SyncResult['link'] | null = null

  const debug = (what: string) => (error: unknown) => host.ui.debug(`word book ${what}: ${String(error)}`)

  const wordLookup = (lemma: string, sentence: string | null): Lookup => () => statusOf(host, lemma, sentence)
  const sentenceLookup = (en: string): Lookup => () => sentenceStatusOf(host, en, 'reply')
  const mineLookup = (text: string): Lookup => () => sentenceStatusOf(host, text, 'mine')

  async function setStatus(key: string, status: SavedStatus) {
    await host.state.saved.update(key, () => ({ status }))
  }

  async function lookUp(key: string) {
    const lookup = lookups.get(key)
    if (!lookup) {
      return
    }
    const status = await lookup()
    // A press since the lookup began has the last word
    await host.state.saved.update(key, saved => (saved.status === 'adding' ? saved : { status }))
  }

  async function relist() {
    const kept = await list(host)
    const pending = pendingCounts(kept)
    await host.state.book.update(page => ({
      ...page,
      status: 'done',
      words: kept.words.map(wordRow),
      sentences: kept.sentences.map(sentenceRow),
      anki: { ...page.anki, pendingWords: pending.words, pendingSentences: pending.sentences },
    }))
  }

  /** After an add or a delete: every button seen, and the page's lists */
  async function afterChange() {
    for (const key of lookups.keys()) {
      await lookUp(key).catch(debug('status'))
    }
    if (isPageLoaded) {
      await relist().catch(debug('list'))
    }
  }

  /**
   * The page's line on Anki, from a check just made: 打开单词本页时，以及每次加入时.
   * Before the page was shown it is left to the page's own check.
   */
  async function showLink(link: SyncResult['link']) {
    if (!isPageLoaded || link === 'off') {
      return
    }
    const ever = await hasEverConnected(host)
    const anki: Pick<WweBook['anki'], 'link' | 'reason' | 'hasEverConnected'> =
      typeof link === 'object'
        ? { link: 'broken', reason: link.broken, hasEverConnected: ever }
        : { link, reason: null, hasEverConnected: ever }
    await host.state.book.update(page => ({ ...page, anki: { ...page.anki, ...anki } }))
  }

  /** What was waiting goes into Anki, with a toast that says how much */
  async function catchUp() {
    const done = await syncPending(host, book)
    if (done.words + done.sentences > 0) {
      host.ui.toast(syncedToast(done.words, done.sentences))
      if (isPageLoaded) {
        await relist()
      }
    }
    await showLink(done.link)
    return done
  }

  /** Whether Anki has just come back (下次连上后补上): its first answer in this session counts */
  function cameBack(link: SyncResult['link']) {
    const isBack = link === 'ok' && lastLink !== 'ok'
    lastLink = link
    return isBack
  }

  /** An add's card in Anki */
  async function synced(sync: () => Promise<SyncResult>): Promise<SyncResult | null> {
    try {
      return await sync()
    } catch (error) {
      debug('sync')(error)
      return null
    }
  }

  /**
   * Runs an add behind its button: 加入中… while it runs, its toast once it
   * is done, then, Anki back, what waited goes in with a toast of its own.
   */
  async function adding(key: string, lookup: Lookup, add: () => Promise<{ toast: string | null; sync: SyncResult | null }>) {
    if (!lookups.has(key)) {
      lookups.set(key, lookup)
    }
    const now = await host.state.saved.get(key)
    if (now.status === 'adding' || now.status === 'added') {
      return
    }
    await setStatus(key, 'adding')
    let sync: SyncResult | null = null
    try {
      const done = await add()
      sync = done.sync
      if (done.toast !== null) {
        host.ui.toast(done.toast)
      }
    } catch (error) {
      debug('add')(error)
      host.ui.toast(addFailedToast(WRITE_FAILED))
    }
    if ((await host.state.saved.get(key)).status === 'adding') {
      await setStatus(key, 'none')
    }
    await lookUp(key).catch(debug('status'))
    await afterChange()
    if (sync === null) {
      return
    }
    await showLink(sync.link).catch(debug('anki line'))
    if (cameBack(sync.link)) {
      await catchUp().catch(debug('catch up'))
    }
  }

  const nothing = { toast: null, sync: null }

  return {
    /** A drawing met a button whose state is not known: look it up on the next tick */
    noteWord(lemma: string, sentence: string | null) {
      const key = savedKeyOf.word(lemma, sentence)
      if (!lookups.has(key)) {
        lookups.set(key, wordLookup(lemma, sentence))
      }
      noted.add(key)
      return key
    },
    noteSentence(en: string) {
      const key = savedKeyOf.sentence(en)
      if (!lookups.has(key)) {
        lookups.set(key, sentenceLookup(en))
      }
      noted.add(key)
      return key
    },
    noteMine(text: string) {
      const key = savedKeyOf.mine(text)
      if (!lookups.has(key)) {
        lookups.set(key, mineLookup(text))
      }
      noted.add(key)
      return key
    },

    /** The timer's turn: the buttons drawn without a state */
    async loadNoted() {
      const keys = [...noted]
      noted.clear()
      for (const key of keys) {
        if ((await host.state.saved.get(key)).status === 'unknown') {
          await lookUp(key).catch(debug('status'))
        }
      }
    },

    /** 加入单词本 or 补上这一句 on the word card */
    addWord(analysis: WweAnalysis) {
      const word = analysis.word
      if (!word) {
        return Promise.resolve()
      }
      const key = savedKeyOf.word(word.lemma, analysis.sentence)
      return adding(key, wordLookup(word.lemma, analysis.sentence), async () => {
        const result = await addWord(host, {
          lemma: word.lemma,
          ipa: word.ipa,
          senses: word.senses,
          cur: word.cur,
          sentence: analysis.sentence,
          sentenceZh: word.sentenceZh,
          form: analysis.subject,
          examples: word.examples,
        })
        if (result === 'exists') {
          return nothing
        }
        const sync = await synced(() => syncWord(host, book, word.lemma))
        const lemma = normalizeLemma(word.lemma)
        const toast = result === 'added' ? addedWordToast(lemma, isSynced(sync)) : addedToWordToast(lemma, isSynced(sync))
        return { toast, sync }
      })
    },

    /** 加入单词本 beside a sentence of an analysis (Claude's reply) */
    addSentence(sentence: WweSentence) {
      return adding(savedKeyOf.sentence(sentence.en), sentenceLookup(sentence.en), async () => {
        const result = await addSentence(host, {
          en: sentence.en,
          zh: sentence.zh,
          parts: sentence.parts,
          points: sentence.points,
          source: 'reply',
        })
        if (result === 'exists') {
          return nothing
        }
        const en = normalizeSentence(sentence.en)
        const sync = await synced(() => syncSentence(host, book, en))
        return { toast: addedSentenceToast(en, isSynced(sync)), sync }
      })
    },

    /** 加入单词本 on a message you sent; its Chinese is translated when none was written */
    addMine(text: string) {
      return adding(savedKeyOf.mine(text), mineLookup(text), async () => {
        const result = await addMySentence(host, text)
        if (typeof result === 'object') {
          return { toast: addFailedToast(result.failed), sync: null }
        }
        if (result !== 'added') {
          return nothing
        }
        const en = cleanMine(text)
        const sync = await synced(() => syncSentence(host, book, en))
        return { toast: addedSentenceToast(en, isSynced(sync)), sync }
      })
    },

    /** ✕ on the page: this machine's entry goes, Anki's card stays */
    async remove(kind: 'word' | 'sentence', key: string) {
      try {
        await remove(host, kind, key)
        host.ui.toast(kind === 'word' ? deletedWordToast(key) : deletedSentenceToast(key))
      } catch (error) {
        debug('remove')(error)
      }
      await afterChange()
    },

    /** The 单词本 page came into view: its lists, then where Anki stands (打开单词本页时检查一次) */
    async loadPage() {
      isPageLoaded = true
      await relist()
      const isOn = coerceSetting('ankiSync', await host.store.get(storeKeyOf('ankiSync')))
      if (!isOn) {
        return
      }
      const link = await connectionStatus(host)
      await showLink(link)
      lastLink = link
      if (link === 'ok') {
        await catchUp()
      }
    },

    /** 同步到 Anki turned back on: what waits goes in */
    catchUp: () => catchUp().then(() => undefined),
  }
}
