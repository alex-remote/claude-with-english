import { describe, expect, test } from 'claude-code/testing'

import * as wb from '../../hooks/core/copy/wordbook'
import { DEFAULT_VIEW } from '../../hooks/core/settings/schema'
import { EMPTY_BOOK, UNKNOWN_SAVED } from '../../hooks/core/state/defaults'
import { createWordbook, hasMineButtons, savedKeyOf } from '../../hooks/features/wordbook/controller'
import { keepDraft } from '../../hooks/features/wordbook/drafts'
import { addControl, ankiLine, bookLists, mineView } from '../../hooks/features/wordbook/view'
import type { BookUi } from '../../hooks/features/wordbook/view'
import type { WweAnalysis, WweBook, WweSaved, WweSentence } from '../../types'
import { fakeAnki, fakeHost } from '../support/anki'
import type { FakeOptions } from '../support/anki'

// F12 as the person meets it: 加入单词本 on the word card, beside a sentence
// of an analysis and on a message you sent, and the 单词本 page, over the
// word book's Host (tests/support/anki.ts) with its two `$.state` values and
// toasts added. The drawings are checked as data, by an element table that
// keeps the props.

function world(options: FakeOptions = {}) {
  const fake = fakeHost(options)
  const saved = new Map<string, WweSaved>()
  let book: WweBook = EMPTY_BOOK
  const toasts: string[] = []
  const host = fake.host as unknown as Record<string, any>
  host.state = {
    saved: {
      get: async (id: string) => saved.get(id) ?? UNKNOWN_SAVED,
      update: async (id: string, fn: (value: WweSaved) => WweSaved) => {
        const value = fn(saved.get(id) ?? UNKNOWN_SAVED)
        saved.set(id, value)
        return value
      },
    },
    book: {
      get: async () => book,
      update: async (fn: (value: WweBook) => WweBook) => (book = fn(book)),
    },
  }
  host.ui.toast = (text: string) => toasts.push(text)
  const wordbook = createWordbook(fake.host)
  return { ...fake, wordbook, saved, toasts, book: () => book, status: (key: string) => saved.get(key)?.status }
}

const CAUSE_CARD: WweAnalysis = {
  kind: 'word',
  status: 'done',
  subject: 'cause',
  sentence: 'I found the cause.',
  isSentence: false,
  text: null,
  word: {
    lemma: 'cause',
    ipa: '/kɔːz/',
    senses: ['n. 原因；起因', 'v. 导致；引起'],
    cur: 0,
    formNote: null,
    inSentence: '原因',
    sentenceZh: '我找到原因了。',
    usages: [],
    examples: [{ en: "We still don't know the cause of the crash.", zh: '我们还不知道崩溃的原因。' }],
  },
  error: null,
  back: null,
}

const otherSentence = (sentence: string): WweAnalysis => ({ ...CAUSE_CARD, sentence })

const MOVE: WweSentence = {
  en: "I'd move the dotenv call to the top of server.ts.",
  zh: '我建议把 dotenv 调用移到 server.ts 顶部。',
  parts: [{ text: "I'd move", role: '谓语' }],
  points: ["I'd 是 I would 的缩写"],
}

describe('单词本：加入', () => {
  test('单词卡：先查状态，加入后变成“已加入单词本”，Toast 带上已同步到 Anki', async () => {
    const w = world()
    const key = w.wordbook.noteWord('cause', CAUSE_CARD.sentence)
    expect(key).toBe(savedKeyOf.word('Cause', 'I found  the cause.'))
    await w.wordbook.loadNoted()
    expect(w.status(key)).toBe('none')
    await w.wordbook.addWord(CAUSE_CARD)
    expect(w.status(key)).toBe('added')
    expect(w.toasts).toEqual([wb.addedWordToast('cause', true)])
    expect(w.anki.notesOf('work-with-english 单词').length).toBe(1)
  })

  test('同一个词从另一句再加：按钮是“补上这一句”，点了补进这个词，不新建', async () => {
    const w = world()
    await w.wordbook.addWord(CAUSE_CARD)
    const other = otherSentence('What is the cause of this error?')
    const key = w.wordbook.noteWord('cause', other.sentence)
    await w.wordbook.loadNoted()
    expect(w.status(key)).toBe('sentenceMissing')
    await w.wordbook.addWord(other)
    expect(w.status(key)).toBe('added')
    expect(w.toasts[1]).toBe(wb.addedToWordToast('cause', true))
    expect(w.anki.notesOf('work-with-english 单词').length).toBe(1)
  })

  test('Anki 没开：照样加入，Toast 不提 Anki；打开单词本页时写明未连接和等待同步的数量', async () => {
    const anki = fakeAnki()
    anki.state.isOpen = false
    const w = world({ anki })
    await w.wordbook.addWord(CAUSE_CARD)
    expect(w.toasts).toEqual([wb.addedWordToast('cause', false)])
    await w.wordbook.loadPage()
    expect(w.book().anki.link).toBe('offline')
    expect(w.book().anki.pendingWords).toBe(1)
    expect(w.book().words.map(word => word.lemma)).toEqual(['cause'])
  })

  test('Anki 打开后再进单词本页：补上等待的，Toast 写明数量，状态行变成已连接', async () => {
    const anki = fakeAnki()
    anki.state.isOpen = false
    const w = world({ anki, translation: '帮我看看这个报错。' })
    await w.wordbook.addWord(CAUSE_CARD)
    await w.wordbook.addSentence(MOVE)
    anki.state.isOpen = true
    await w.wordbook.loadPage()
    expect(w.book().anki.link).toBe('ok')
    expect(w.toasts).toContain(wb.syncedToast(1, 1))
    expect(w.book().anki.pendingWords).toBe(0)
    expect(w.book().words[0]?.isSynced).toBe(true)
  })

  test('语法分析里的一句：存英文、译文、结构和要点；再看时是“已加入单词本”', async () => {
    const w = world()
    const key = w.wordbook.noteSentence(MOVE.en)
    await w.wordbook.loadNoted()
    expect(w.status(key)).toBe('none')
    await w.wordbook.addSentence(MOVE)
    expect(w.status(key)).toBe('added')
    expect(w.toasts).toEqual([wb.addedSentenceToast(MOVE.en, true)])
    await w.wordbook.loadPage()
    expect(w.book().sentences).toEqual([{ en: MOVE.en, zh: MOVE.zh, zhIsTranslation: false, source: 'reply', isSynced: true }])
  })

  test('你发出的消息：中文用当时横条上的原文', async () => {
    const w = world()
    const text = 'Can you help me figure out what is causing this error?'
    await keepDraft(w.host, text, { zh: '帮我看看这个报错是怎么回事', sawTranslation: true })
    await w.wordbook.addMine(text)
    expect(w.status(savedKeyOf.mine(text))).toBe('added')
    expect(w.asked).toEqual([])
    await w.wordbook.loadPage()
    expect(w.book().sentences[0]).toEqual({
      en: text,
      zh: '帮我看看这个报错是怎么回事',
      zhIsTranslation: false,
      source: 'mine',
      isSynced: true,
    })
  })

  test('你发出的消息：找不到当时的中文就补译，标“中文为译文”；补译失败时说明原因，按钮恢复', async () => {
    const ok = world({ translation: '你能帮我看看吗？' })
    await ok.wordbook.addMine('Could you take a look?')
    await ok.wordbook.loadPage()
    expect(ok.book().sentences[0]?.zhIsTranslation).toBe(true)

    const down = world({ translation: null })
    await down.wordbook.addMine('Could you take a look?')
    expect(down.status(savedKeyOf.mine('Could you take a look?'))).toBe('none')
    expect(down.toasts[0]?.startsWith(`${wb.ADD}失败：`)).toBe(true)
  })

  test('点得快：加入中再点一下不会加两次', async () => {
    const w = world()
    await Promise.all([w.wordbook.addSentence(MOVE), w.wordbook.addSentence(MOVE)])
    expect(w.toasts.length).toBe(1)
    expect(w.anki.notesOf('work-with-english 句子').length).toBe(1)
  })
})

describe('单词本页', () => {
  test('✕ 只删本机：Toast 写明，列表跟着变，Anki 里的卡片还在', async () => {
    const w = world()
    await w.wordbook.addWord(CAUSE_CARD)
    await w.wordbook.loadPage()
    await w.wordbook.remove('word', 'cause')
    expect(w.toasts).toContain(wb.deletedWordToast('cause'))
    expect(w.book().words).toEqual([])
    expect(w.anki.notesOf('work-with-english 单词').length).toBe(1)
    expect(w.status(savedKeyOf.word('cause', CAUSE_CARD.sentence))).toBe('none')
  })

  test('同步关着：不连 Anki，状态行不显示', async () => {
    const w = world({ store: { 'settings/ankiSync': false } })
    await w.wordbook.addWord(CAUSE_CARD)
    expect(w.anki.state.calls).toEqual([])
    await w.wordbook.loadPage()
    expect(w.book().anki.link).toBe('unknown')
    expect(ankiLine(UI, { book: w.book(), settings: { ...DEFAULT_VIEW, ankiSync: false } })).toBe(null)
  })

  test('重新打开同步：把等待的补进 Anki', async () => {
    const w = world({ store: { 'settings/ankiSync': false } })
    await w.wordbook.addWord(CAUSE_CARD)
    w.store.set('settings/ankiSync', true)
    await w.wordbook.catchUp()
    expect(w.toasts).toContain(wb.syncedToast(1, 0))
  })
})

describe('消息上的按钮', () => {
  test('只在英文消息上出现：命令、shell、含中文的、只有代码或数字的都不出现', () => {
    expect(hasMineButtons('Can you help me figure out this error?')).toBe(true)
    expect(hasMineButtons('/Users/alex/app.ts fails to build')).toBe(true)
    expect(hasMineButtons('/review the last commit')).toBe(false)
    expect(hasMineButtons('<bash-input>ls</bash-input>')).toBe(false)
    expect(hasMineButtons('帮我看看 this error')).toBe(false)
    expect(hasMineButtons('`npm test`')).toBe(false)
    expect(hasMineButtons('12345')).toBe(false)
  })
})

// --- the drawings, as data ---

type Node = { type: string; props: Record<string, unknown>; children: Child[] }
type Child = Node | string

function flat(children: unknown): Child[] {
  if (children === undefined || children === null || typeof children === 'boolean') {
    return []
  }
  if (Array.isArray(children)) {
    return children.flatMap(flat)
  }
  return typeof children === 'string' || typeof children === 'number' ? [String(children)] : [children as Node]
}

const element = (type: string) => (props: Record<string, unknown>) => {
  const { children, ...rest } = props
  return { type, props: rest, children: flat(children) }
}

const UI = { Box: element('Box'), Text: element('Text'), Button: element('Button') } as unknown as BookUi

const textOf = (node: unknown): string =>
  node === null || node === undefined
    ? ''
    : typeof node === 'string'
      ? node
      : (node as Node).children.map(textOf).join('')

function all(node: unknown, out: Node[] = []): Node[] {
  if (node && typeof node === 'object' && 'type' in (node as Node)) {
    out.push(node as Node)
    for (const child of (node as Node).children) {
      all(child, out)
    }
  }
  return out
}

describe('单词本的画法', () => {
  test('加入单词本的四种样子：能点的两种是按钮，加入中和已加入是灰字，不知道时不画', () => {
    const press = () => undefined
    expect((addControl(UI, 'a', 'none', press) as unknown as Node).props.label).toBe(wb.ADD)
    expect((addControl(UI, 'a', 'sentenceMissing', press) as unknown as Node).props.label).toBe(wb.ADD_SENTENCE)
    expect(textOf(addControl(UI, 'a', 'adding', press))).toBe(wb.ADDING)
    expect((addControl(UI, 'a', 'added', press) as unknown as Node).type).toBe('Text')
    expect(addControl(UI, 'a', 'unknown', press)).toBe(null)
  })

  test('消息上的按钮：悬停才出现，在线语音读这条时写“停止”', () => {
    const drawn = { type: 'Text', props: {}, children: ['Can you help me?'] } as unknown as Parameters<typeof mineView>[1]
    const tree = mineView(
      UI,
      drawn,
      { key: 'k', status: 'none', speaking: { key: 'mine-k', via: 'online' } },
      { speak: () => undefined, add: () => undefined },
    ) as unknown as Node
    const hover = all(tree).find(node => node.props.position === 'absolute')
    expect(hover?.props.display).toBe('none')
    expect(all(hover).map(node => node.props.label).filter(Boolean)).toEqual(['停止', wb.ADD])
  })

  test('列表：单词带音标、同步状态、本句释义和原句（词加粗）；句子带来源和中文为译文；空的一组写怎么加', async () => {
    const w = world({ translation: '你能帮我看看吗？' })
    await w.wordbook.addWord(CAUSE_CARD)
    await w.wordbook.addMine('Could you take a look?')
    await w.wordbook.loadPage()
    const tree = bookLists(UI, { book: w.book(), settings: DEFAULT_VIEW }, { remove: () => undefined }) as unknown as Node
    const text = all(tree).map(textOf)
    expect(text).toContain(wb.wordsHeading(1))
    expect(text).toContain('/kɔːz/')
    expect(text).toContain(` ${wb.THIS_SENTENCE} `)
    expect(all(tree).some(node => node.props.bold === true && textOf(node) === 'cause')).toBe(true)
    expect(text).toContain(wb.SOURCE_LABELS.mine)
    expect(text.some(t => t.includes(wb.ZH_IS_TRANSLATION))).toBe(true)
    expect(text.filter(t => t === wb.SYNCED).length).toBe(2)

    const empty = bookLists(UI, { book: { ...EMPTY_BOOK, status: 'done' }, settings: DEFAULT_VIEW }, { remove: () => undefined })
    expect(all(empty).map(textOf)).toContain(wb.EMPTY_WORDS)
  })

  test('状态行：已连接写牌组，没连上写等待数量，卡片类型改坏时写原因', () => {
    const line = (anki: Partial<WweBook['anki']>) =>
      textOf(ankiLine(UI, { book: { ...EMPTY_BOOK, anki: { ...EMPTY_BOOK.anki, ...anki } }, settings: DEFAULT_VIEW }))
    expect(line({ link: 'ok' })).toBe(wb.ankiConnected('work-with-english'))
    expect(line({ link: 'offline', pendingWords: 1, pendingSentences: 1 })).toBe(wb.ankiOffline(1, 1))
    expect(line({ link: 'broken', reason: wb.ANKI_REFUSED })).toBe(wb.ANKI_REFUSED)
    expect(line({ link: 'unknown' })).toBe('')
  })
})
