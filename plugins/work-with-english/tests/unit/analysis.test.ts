import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_VIEW } from '../../hooks/core/settings/schema'
import { EMPTY_BOOK, INITIAL_PANE } from '../../hooks/core/state/defaults'
import { boldParts, formIn, wordAt } from '../../hooks/core/text/wordform'
import { createAnalyses } from '../../hooks/features/analysis/controller'
import { analysisView } from '../../hooks/features/analysis/view'
import type { AnalysisUi } from '../../hooks/features/analysis/view'
import { bookLists } from '../../hooks/features/wordbook/view'
import type { BookUi } from '../../hooks/features/wordbook/view'
import { parseWord, wordPrompt } from '../../hooks/services/translate/prompts'
import type { WweAnalysis, WweBook, WweLookup, WwePane, WweTextResult } from '../../types'
import { fakeHost } from '../support/anki'

// F10 and F11 in the pane: a hard word, listed in its base form, opened in
// the sentence and the form the paragraph wrote it in; 原句 with that word
// in bold, a whole word, on the word card and the 单词本 page; and the word
// card's own note on the form selected.

const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

/** The pane's analysis over the shared test Host, the model answering from a queue */
function world(analysis: WweAnalysis | null, answers: string[]) {
  const fake = fakeHost()
  let now = analysis
  let pane: WwePane = INITIAL_PANE
  const asked: { system?: string; prompt: string }[] = []
  const host = fake.host as unknown as Record<string, any>
  host.state = {
    analysis: {
      get: async () => now,
      update: async (fn: (value: WweAnalysis | null) => WweAnalysis | null) => (now = fn(now)),
    },
    pane: {
      get: async () => pane,
      update: async (fn: (value: WwePane) => WwePane) => (pane = fn(pane)),
    },
  }
  host.prompt = { read: async () => ({ text: '', cursor: 0 }) }
  host.ui.open = async () => undefined
  host.model.complete = async (request: { system?: string; prompt: string }) => {
    asked.push({ system: request.system, prompt: request.prompt })
    const text = answers.shift()
    return text === undefined
      ? { isAnswered: false, reason: 'api-error', status: 529, error: 'server_error', usage: USAGE }
      : { isAnswered: true, text, usage: USAGE }
  }
  const analyses = createAnalyses(fake.host, async () => undefined)
  return { analyses, asked, analysis: () => now }
}

const PARAGRAPH = 'The loader is retrieving the config before the env file is written. Then we load the env file.'

const ANALYSED: WweTextResult = {
  sentences: [
    { en: 'The loader is retrieving the config before the env file is written.', zh: '加载器在写入 env 文件之前读取配置。', parts: [], points: [] },
    { en: 'Then we load the env file.', zh: '然后我们加载 env 文件。', parts: [], points: [] },
  ],
  hard: ['retrieve', 'write', 'load'],
}

const textAnalysis = (text: WweTextResult, subject = PARAGRAPH): WweAnalysis => ({
  kind: 'text',
  status: 'done',
  subject,
  sentence: null,
  isSentence: false,
  text,
  word: null,
  error: null,
  back: null,
})

const lookupOf = (lemma: string, formNote = ''): string =>
  JSON.stringify({ lemma, ipa: '/x/', senses: ['v. 取回', 'n. 检索'], cur: 0, formNote })

const CARD = JSON.stringify({ formNote: '', inSentence: '这里指读取配置。', sentenceZh: '句子', usages: [], examples: [] })

// --- the drawings, as data (as tests/ui/wordbook.test.ts draws them) ---

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

const UI = { Box: element('Box'), Text: element('Text'), Button: element('Button') } as unknown as AnalysisUi & BookUi

const textOf = (node: unknown): string =>
  node === null || node === undefined ? '' : typeof node === 'string' ? node : (node as Node).children.map(textOf).join('')

function all(node: unknown, out: Node[] = []): Node[] {
  if (node && typeof node === 'object' && 'type' in (node as Node)) {
    out.push(node as Node)
    for (const child of (node as Node).children) {
      all(child, out)
    }
  }
  return out
}

/** The line of text that holds a word in bold: what stands before it, the word, and after */
function boldLine(tree: unknown): { before: string; word: string; after: string } | null {
  for (const node of all(tree).filter(node => node.type === 'Text')) {
    const at = node.children.findIndex(child => typeof child !== 'string' && child.props.bold === true && child.type === 'Text')
    const bold = node.children[at]
    if (at >= 0 && bold && typeof bold !== 'string') {
      return {
        before: node.children.slice(0, at).map(textOf).join(''),
        word: textOf(bold),
        after: node.children.slice(at + 1).map(textOf).join(''),
      }
    }
  }
  return null
}

const NO_ACTIONS = {
  speak: () => undefined,
  openWord: () => undefined,
  back: () => undefined,
  addSentence: () => undefined,
  addWord: () => undefined,
}

const wordCard = (subject: string, sentence: string): WweAnalysis => ({
  kind: 'word',
  status: 'done',
  subject,
  sentence,
  isSentence: false,
  text: null,
  word: {
    lemma: subject,
    ipa: '',
    senses: ['n. 原因'],
    cur: 0,
    formNote: null,
    inSentence: null,
    sentenceZh: null,
    usages: [],
    examples: [],
  },
  error: null,
  back: null,
})

describe('a word as it stands in a sentence', () => {
  test('a whole word only, any case: cause is not the one in because, port not the one in report', () => {
    expect(boldParts('It fails because the cause is the loader.', 'cause')).toEqual({
      before: 'It fails because the ',
      word: 'cause',
      after: ' is the loader.',
    })
    expect(boldParts('Check the report for the port number.', 'port')?.before).toBe('Check the report for the ')
    expect(boldParts('Because of this, we use a queue.', 'use')?.before).toBe('Because of this, we ')
    expect(boldParts('Cause first.', 'cause')?.word).toBe('Cause')
    expect(wordAt('Run it with --dry-run.', 'dry')).toBeNull()
    expect(wordAt('Use dry-run first.', 'dry-run')).toEqual({ start: 4, end: 11 })
    expect(boldParts('The user is set.', 'use')).toBeNull()
    expect(boldParts('Anything.', '')).toBeNull()
  })

  test('a hard word in its base form is found in the form the text wrote it in', () => {
    const sentence = 'The loader is retrieving the config before the env file is written.'
    expect(formIn(sentence, 'retrieve')).toBe('retrieving')
    expect(formIn(sentence, 'write')).toBe('written')
    expect(formIn('The old API is deprecated.', 'deprecate')).toBe('deprecated')
    expect(formIn('Update the dependencies first.', 'dependency')).toBe('dependencies')
    expect(formIn('It applies to every route.', 'apply')).toBe('applies')
    expect(formIn('We committed the fix.', 'commit')).toBe('committed')
    expect(formIn('The default is overridden here.', 'override')).toBe('overridden')
    expect(formIn('The analyses differ.', 'analysis')).toBe('analyses')
    expect(formIn('These criteria matter.', 'criterion')).toBe('criteria')
    expect(formIn('That warning stands out.', 'stand out')).toBe('stands out')
    // Not inside a longer word: load is not loader, nor an agent noun
    expect(formIn('The loader starts first.', 'load')).toBeNull()
    expect(formIn('Nothing of it here.', 'retrieve')).toBeNull()
  })
})

describe('F11 › 难词: opening a hard word (F10 › 从难词点进来时)', () => {
  test('retrieving in the paragraph: its sentence is the card’s 原句, the lookup is asked with it, the form written is bold', async () => {
    const w = world(textAnalysis(ANALYSED), [lookupOf('retrieve', '选中的是 retrieving'), CARD])
    await w.analyses.analyseHardWord('retrieve')
    const card = w.analysis()
    expect(card?.sentence).toBe('The loader is retrieving the config before the env file is written.')
    expect(card?.subject).toBe('retrieving')
    expect(card?.back?.text).toEqual(ANALYSED)
    expect(w.asked[0]?.prompt).toContain('Sentence: The loader is retrieving the config')
    expect(w.asked[0]?.prompt).toContain('Word: retrieving')
    expect(card?.status).toBe('done')
    const line = boldLine(card && analysisView(UI, card, null, NO_ACTIONS))
    expect(line).toEqual({
      before: 'The loader is ',
      word: 'retrieving',
      after: ' the config before the env file is written.',
    })
  })

  test('an irregular form: write in “is written”', async () => {
    const w = world(textAnalysis(ANALYSED), [lookupOf('write'), CARD])
    await w.analyses.analyseHardWord('write')
    expect(w.analysis()?.sentence).toBe('The loader is retrieving the config before the env file is written.')
    expect(w.analysis()?.subject).toBe('written')
  })

  test('load is the sentence that says load, not the one before it that says loader', async () => {
    const w = world(textAnalysis(ANALYSED), [lookupOf('load'), CARD])
    await w.analyses.analyseHardWord('load')
    expect(w.analysis()?.sentence).toBe('Then we load the env file.')
    expect(w.analysis()?.subject).toBe('load')
  })

  test('the analysis split the sentences differently: the paragraph’s own sentence that writes it', async () => {
    const split: WweTextResult = { sentences: [{ en: 'Something else entirely.', zh: '', parts: [], points: [] }], hard: ['retrieve'] }
    const w = world(textAnalysis(split), [lookupOf('retrieve'), CARD])
    await w.analyses.analyseHardWord('retrieve')
    expect(w.analysis()?.sentence).toBe('The loader is retrieving the config before the env file is written.')
    expect(w.analysis()?.subject).toBe('retrieving')
  })

  test('a word the paragraph does not hold: no sentence, the word as listed', async () => {
    const w = world(textAnalysis(ANALYSED), [lookupOf('mitigate'), CARD])
    await w.analyses.analyseHardWord('mitigate')
    expect(w.analysis()?.sentence).toBeNull()
    expect(w.analysis()?.subject).toBe('mitigate')
    expect(w.asked[0]?.prompt).not.toContain('Sentence:')
  })
})

describe('原句 in bold, a whole word (F10, F12 › 词加粗)', () => {
  test('the word card bolds cause, not the cause inside because', () => {
    const line = boldLine(analysisView(UI, wordCard('cause', 'It fails because the cause is the loader.'), null, NO_ACTIONS))
    expect(line).toEqual({ before: 'It fails because the ', word: 'cause', after: ' is the loader.' })
  })

  test('the 单词本 page bolds use, not the use inside Because, as the Anki card does', () => {
    const book: WweBook = {
      ...EMPTY_BOOK,
      status: 'done',
      words: [
        {
          lemma: 'use',
          ipa: '',
          isSynced: false,
          sentences: [{ en: 'Because of this, we use a queue.', zh: '因此我们用队列。', form: 'use', sense: '' }],
        },
      ],
    }
    const line = boldLine(bookLists(UI, { book, settings: DEFAULT_VIEW }, { remove: () => undefined }))
    expect(line).toEqual({ before: 'Because of this, we ', word: 'use', after: ' a queue.' })
  })
})

describe('F10 › 词形和短语: the word card says which form was selected', () => {
  const LOOKUP: WweLookup = { lemma: 'block', ipa: '/blɒk/', senses: ['v. 阻塞', 'n. 块'], cur: 0, formNote: '选中的是 blocks' }

  test('the card’s prompt asks for its own note on the form and on a phrasal verb', () => {
    const { system } = wordPrompt('blocks', 'This call blocks the event loop.', LOOKUP)
    expect(system).toContain('"formNote"')
    expect(system).toContain('第三人称单数')
    expect(system).toContain('phrasal verb')
  })

  test('the card’s note takes the selection line’s place; none given keeps it', () => {
    const note = 'blocks 是 block 的第三人称单数。'
    expect(parseWord(JSON.stringify({ formNote: note, inSentence: '', sentenceZh: '', usages: [], examples: [] }))?.formNote).toBe(note)
    expect(parseWord(JSON.stringify({ formNote: '', inSentence: '', sentenceZh: '', usages: [], examples: [] }))).not.toHaveProperty('formNote')
    expect(parseWord(JSON.stringify({ inSentence: '', usages: [] }))).not.toHaveProperty('formNote')
  })

  test('解析 on a selected blocks: the card shows which form it is', async () => {
    const note = 'blocks 是 block 的第三人称单数。'
    const w = world(null, [JSON.stringify({ formNote: note, inSentence: '阻塞事件循环。', sentenceZh: '这个调用会阻塞事件循环。', usages: [], examples: [] })])
    await w.analyses.analyseWord('blocks', 'This call blocks the event loop.', LOOKUP)
    expect(w.analysis()?.word?.formNote).toBe(note)
    expect(w.analysis()?.word?.senses).toEqual(LOOKUP.senses)
    const tree = analysisView(UI, w.analysis() as WweAnalysis, null, NO_ACTIONS)
    expect(all(tree).map(textOf)).toContain(note)
    expect(all(tree).map(textOf)).not.toContain('选中的是 blocks')
  })
})
