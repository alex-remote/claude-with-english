import { describe, expect, test } from 'claude-code/testing'

import * as wb from '../../hooks/core/copy/wordbook'
import {
  AUDIO_FIELD,
  CARD_CSS,
  MODELS,
  SENTENCE_FIELDS,
  SENTENCE_MODEL,
  WORD_FIELDS,
  WORD_MODEL,
  missingFields,
} from '../../hooks/services/anki/models'
import {
  boldForm,
  escapeHtml,
  escapeSearch,
  fieldValues,
  findNotesQuery,
  findSentenceQuery,
  findWordQuery,
  hasSentence,
  mergeWordNote,
  normalizeLemma,
  sentenceNoteFields,
  sentencesIn,
  wordNoteFields,
  type SentenceEntry,
  type WordEntry,
  type WordSentence,
} from '../../hooks/services/anki/notes'

// The word card, the analysis and the 单词本 page of docs/feature-map.md
// (F10, F11, F12) and the prototype's preset words.

const CAUSE_SENTENCE: WordSentence = {
  en: 'I found the cause.',
  zh: '我找到原因了。',
  form: 'cause',
  sense: 'n. 原因；起因',
}

const CAUSE: WordEntry = {
  lemma: 'cause',
  ipa: '/kɔːz/',
  senses: ['n. 原因；起因', 'v. 导致；引起'],
  sentences: [CAUSE_SENTENCE],
  example: { en: "We still don't know the cause of the crash.", zh: '我们还不知道崩溃的原因。' },
}

const BLOCK_STALL: WordSentence = {
  en: 'One slow write blocks all reads.',
  zh: '一次慢写入会卡住所有读取。',
  form: 'blocks',
  sense: 'v. 阻塞；挡住',
}

const BLOCK_CODE: WordSentence = {
  en: 'Wrap the config in a code block.',
  zh: '把配置放进一个代码块。',
  form: 'block',
  sense: 'n. 块；代码块',
}

const BLOCK: WordEntry = {
  lemma: 'block',
  ipa: '/blɑːk/',
  senses: ['v. 阻塞；挡住', 'n. 块；代码块', 'n. 街区'],
  sentences: [BLOCK_STALL],
  example: { en: 'A synchronous read blocks the event loop.', zh: '同步读取会阻塞事件循环。' },
}

const SENSE_TAG = '<span class="wwe-tag">本句</span>'

describe('models', () => {
  test('the two card types are named as in Anki and keep their fields in order', () => {
    expect(WORD_MODEL.modelName).toBe('claude-with-english 单词')
    expect(SENTENCE_MODEL.modelName).toBe('claude-with-english 句子')
    expect([...WORD_MODEL.inOrderFields]).toEqual([
      '单词',
      '音标',
      '朗读',
      '原句',
      '本句释义',
      '其他释义',
      '原句译文',
      '例句',
      '例句译文',
    ])
    expect([...SENTENCE_MODEL.inOrderFields]).toEqual(['句子', '朗读', '译文', '结构', '要点', '来源'])
    expect(AUDIO_FIELD).toBe('朗读')
  })

  test('Anki tells notes apart by the first field: 单词 and 句子', () => {
    expect(WORD_FIELDS[0]).toBe('单词')
    expect(SENTENCE_FIELDS[0]).toBe('句子')
  })

  test('each is one card template, not a cloze, with createModel params', () => {
    for (const model of MODELS) {
      expect(model.isCloze).toBe(false)
      expect(model.cardTemplates).toHaveLength(1)
      expect(model.css).toBe(CARD_CSS)
    }
  })

  test('the templates name only fields the card type has', () => {
    for (const model of MODELS) {
      const [template] = model.cardTemplates
      const names = [...`${template?.Front}${template?.Back}`.matchAll(/\{\{[#/^]?([^}]+)\}\}/g)].map(m => m[1])
      for (const name of names) {
        if (name !== 'FrontSide') {
          expect(model.inOrderFields).toContain(name)
        }
      }
    }
  })

  test('word card: the front has 单词, 音标, 朗读 and 原句; the back the meanings, translation and example', () => {
    const [card] = WORD_MODEL.cardTemplates
    for (const field of ['单词', '音标', '朗读', '原句']) {
      expect(card?.Front).toContain(`{{${field}}}`)
    }
    for (const field of ['本句释义', '其他释义', '原句译文', '例句', '例句译文']) {
      expect(card?.Front).not.toContain(`{{${field}}}`)
      expect(card?.Back).toContain(`{{${field}}}`)
    }
    expect(card?.Back).toContain(`${SENSE_TAG}{{本句释义}}`)
  })

  test('sentence card: the front has the English and 朗读; the back 译文, 结构, 要点 and 来源', () => {
    const [card] = SENTENCE_MODEL.cardTemplates
    expect(card?.Front).toContain('{{句子}}')
    expect(card?.Front).toContain('{{朗读}}')
    for (const field of ['译文', '结构', '要点', '来源']) {
      expect(card?.Front).not.toContain(`{{${field}}}`)
      expect(card?.Back).toContain(`{{${field}}}`)
    }
    // A sentence you sent has no 结构 or 要点: their headings go with them
    expect(card?.Back).toContain('{{#结构}}')
    expect(card?.Back).toContain('{{#要点}}')
  })

  test('the styles have a night-mode set of colours', () => {
    expect(CARD_CSS).toContain('.card.nightMode')
  })

  test('a later sentence’s 本句释义 is hidden on the front and shown on the back', () => {
    expect(CARD_CSS).toContain('.wwe-sense { display: none;')
    expect(CARD_CSS).toContain('.wwe-a .wwe-q .wwe-sense { display: block; }')
    expect(WORD_MODEL.cardTemplates[0]?.Front).toContain('wwe-q')
    expect(WORD_MODEL.cardTemplates[0]?.Back).toContain('<div class="wwe-a">{{FrontSide}}</div>')
  })

  test('a card type that lost a field of ours is broken; one with more fields is not', () => {
    expect(missingFields(WORD_MODEL, [...WORD_FIELDS])).toEqual([])
    expect(missingFields(WORD_MODEL, [...WORD_FIELDS, '笔记'])).toEqual([])
    expect(missingFields(WORD_MODEL, [...WORD_FIELDS].reverse())).toEqual([])
    expect(missingFields(WORD_MODEL, WORD_FIELDS.filter(f => f !== '原句'))).toEqual(['原句'])
    expect(missingFields(SENTENCE_MODEL, ['Front', 'Back'])).toEqual([...SENTENCE_FIELDS])
  })
})

describe('word card fields', () => {
  test('cause from “I found the cause.”', () => {
    expect(wordNoteFields(CAUSE)).toEqual({
      单词: 'cause',
      音标: '/kɔːz/',
      朗读: '',
      原句: '<div class="wwe-s">I found the <b>cause</b>.</div>',
      本句释义: 'n. 原因；起因',
      其他释义: '<div>v. 导致；引起</div>',
      原句译文: '<div class="wwe-s">我找到原因了。</div>',
      例句: "We still don't know the cause of the crash.",
      例句译文: '我们还不知道崩溃的原因。',
    })
  })

  test('kept by its base form; the form in the sentence is the bold one (blocks for block)', () => {
    const fields = wordNoteFields(BLOCK)
    expect(fields.单词).toBe('block')
    expect(fields.原句).toBe('<div class="wwe-s">One slow write <b>blocks</b> all reads.</div>')
    expect(fields.其他释义).toBe('<div>n. 块；代码块</div><div>n. 街区</div>')
  })

  test('a phrase is bolded whole: stand out', () => {
    expect(boldForm('Two things stand out in the logs.', 'stand out')).toBe('Two things <b>stand out</b> in the logs.')
    expect(boldForm('Two things stand\n  out in the logs.', ' stand  out')).toBe('Two things <b>stand out</b> in the logs.')
  })

  test('本句释义 is the meaning this sentence uses, not always the first one (retry)', () => {
    const fields = wordNoteFields({
      lemma: 'retry',
      ipa: '/ˌriːˈtraɪ/',
      senses: ['v. 重试', 'n. 重试'],
      sentences: [{ en: 'Add a retry helper.', zh: '加一个重试的辅助函数。', form: 'retry', sense: 'n. 重试' }],
      example: { en: 'The client will retry the request three times.', zh: '客户端会把请求重试三次。' },
    })
    expect(fields.本句释义).toBe('n. 重试')
    expect(fields.其他释义).toBe('<div>v. 重试</div>')
  })

  test('only the first whole-word form is bolded, whatever its case', () => {
    expect(boldForm('Cause and effect: the cause is clear.', 'cause')).toBe('<b>Cause</b> and effect: the cause is clear.')
    expect(boldForm('Because of the cause.', 'cause')).toBe('Because of the <b>cause</b>.')
    expect(boldForm('The reader reads .env first.', '.env')).toBe('The reader reads <b>.env</b> first.')
  })

  test('a form the sentence does not have leaves it as it is', () => {
    expect(boldForm('Nothing here.', 'cause')).toBe('Nothing here.')
  })

  test('the words are escaped as HTML, quotes as they are', () => {
    const fields = wordNoteFields({
      ...CAUSE,
      sentences: [{ ...CAUSE_SENTENCE, en: 'If a < b && "cause" fails, log <cause>.', zh: '如果 a < b' }],
    })
    expect(fields.原句).toBe('<div class="wwe-s">If a &lt; b &amp;&amp; "<b>cause</b>" fails, log &lt;cause&gt;.</div>')
    expect(fields.原句译文).toBe('<div class="wwe-s">如果 a &lt; b</div>')
    expect(escapeHtml('<b>"x" & \'y\'</b>')).toBe('&lt;b&gt;"x" &amp; \'y\'&lt;/b&gt;')
  })

  test('a word from an entity name is not bolded inside the entity', () => {
    expect(boldForm('a < b is lt', 'lt')).toBe('a &lt; b is <b>lt</b>')
  })

  test('no example leaves 例句 and 例句译文 empty', () => {
    const fields = wordNoteFields({ ...CAUSE, example: null })
    expect(fields.例句).toBe('')
    expect(fields.例句译文).toBe('')
  })
})

describe('重复怎么处理', () => {
  test('同一个词从另一句再加: the new sentence goes into 原句 and 原句译文 only', () => {
    const card = wordNoteFields(CAUSE)
    const again = { en: 'The cause was a typo.', zh: '原因是一个拼写错误。', form: 'cause', sense: 'n. 原因；起因' }
    expect(mergeWordNote(card, again)).toEqual({
      原句:
        '<div class="wwe-s">I found the <b>cause</b>.</div>' +
        `<div class="wwe-s">The <b>cause</b> was a typo.<div class="wwe-sense">${SENSE_TAG}n. 原因；起因</div></div>`,
      原句译文: '<div class="wwe-s">我找到原因了。</div><div class="wwe-s">原因是一个拼写错误。</div>',
    })
  })

  test('同一个词、不同意思: each sentence keeps its own 本句释义, written after that sentence', () => {
    const update = mergeWordNote(wordNoteFields(BLOCK), BLOCK_CODE)
    expect(update?.原句).toBe(
      '<div class="wwe-s">One slow write <b>blocks</b> all reads.</div>' +
        `<div class="wwe-s">Wrap the config in a code <b>block</b>.<div class="wwe-sense">${SENSE_TAG}n. 块；代码块</div></div>`,
    )
    // The card's 本句释义 stays the first sentence's
    expect(update).not.toHaveProperty('本句释义')
  })

  test('nothing the user changed in Anki is written over', () => {
    const edited = { ...wordNoteFields(CAUSE), 本句释义: '我改过的释义', 例句: '我自己的例句' }
    const update = mergeWordNote(edited, BLOCK_CODE)
    expect(Object.keys(update ?? {})).toEqual(['原句', '原句译文'])
  })

  test('本机单词本删了，Anki 里还在，之后又加这个词: the same, into the old card', () => {
    const inAnki = fieldValues({
      单词: { value: 'cause' },
      原句: { value: '<div class="wwe-s">I found the <b>cause</b>.</div>' },
      原句译文: { value: '<div class="wwe-s">我找到原因了。</div>' },
    })
    expect(mergeWordNote(inAnki, CAUSE_SENTENCE)).toBeNull()
    expect(mergeWordNote(inAnki, { ...CAUSE_SENTENCE, en: 'What is the cause?' })?.原句).toContain(
      'What is the <b>cause</b>?',
    )
  })

  test('改过牌组名: the card is looked for in every deck, by card type and first field', () => {
    expect(findWordQuery('cause')).toBe('"note:claude-with-english 单词" "单词:cause"')
    expect(findWordQuery('cause')).not.toContain('deck:')
    expect(findSentenceQuery('I found the cause.')).not.toContain('deck:')
  })

  test('大小写不同: Cause and cause are one word, stored in lower case', () => {
    expect(normalizeLemma('Cause')).toBe('cause')
    expect(normalizeLemma('  Stand   Out ')).toBe('stand out')
    expect(wordNoteFields({ ...CAUSE, lemma: 'Cause' }).单词).toBe('cause')
    expect(findWordQuery('Cause')).toBe(findWordQuery('cause'))
  })

  test('同一句再加: a sentence the card has is not added again', () => {
    const card = wordNoteFields(CAUSE)
    expect(mergeWordNote(card, CAUSE_SENTENCE)).toBeNull()
    expect(mergeWordNote(card, { ...CAUSE_SENTENCE, en: '  I found  the cause. ' })).toBeNull()
  })

  test('Anki 里的原卡被删了: a new card carries every sentence kept here', () => {
    const fields = wordNoteFields({ ...BLOCK, sentences: [BLOCK_STALL, BLOCK_CODE] })
    expect(sentencesIn(fields.原句)).toEqual(['One slow write blocks all reads.', 'Wrap the config in a code block.'])
    expect(fields.原句).toContain(`<div class="wwe-sense">${SENSE_TAG}n. 块；代码块</div>`)
    expect(fields.本句释义).toBe('v. 阻塞；挡住')
    expect(sentencesIn(fields.原句译文)).toEqual(['一次慢写入会卡住所有读取。', '把配置放进一个代码块。'])
  })

  test('the same sentence twice in what is kept here goes on the card once', () => {
    const fields = wordNoteFields({ ...CAUSE, sentences: [CAUSE_SENTENCE, CAUSE_SENTENCE] })
    expect(sentencesIn(fields.原句)).toEqual(['I found the cause.'])
  })
})

describe('whether a card has a sentence', () => {
  test('bold, entities, line breaks and the meanings after a sentence are looked past', () => {
    const field =
      '<div class="wwe-s">If a &lt; b &amp;&amp; c, the <b>cause</b> is clear.</div>' +
      `<div class="wwe-s">Wrap it in a code <b>block</b>.<div class="wwe-sense">${SENSE_TAG}n. 块</div></div>`
    expect(hasSentence(field, 'If a < b && c, the cause is clear.')).toBe(true)
    expect(hasSentence(field, 'Wrap it in a code block.')).toBe(true)
    expect(hasSentence(field, 'n. 块')).toBe(false)
  })

  test('a card edited in Anki with <br> and &nbsp; still matches', () => {
    expect(hasSentence('I found the&nbsp;<b>cause</b>.<br>The cause was a typo.', 'I found the cause.')).toBe(true)
    expect(hasSentence('I found the&nbsp;<b>cause</b>.<br>The cause was a typo.', 'The cause was a typo.')).toBe(true)
  })

  test('a sentence inside a longer one is not the same sentence', () => {
    expect(hasSentence('<div class="wwe-s">Then fix it.</div>', 'fix it.')).toBe(false)
    expect(hasSentence('', 'fix it.')).toBe(false)
  })
})

describe('sentence card fields', () => {
  const reply: SentenceEntry = {
    en: 'I found the cause.',
    zh: '我找到原因了。',
    isZhTranslated: false,
    source: 'reply',
    parts: [
      { text: 'I', role: '主语' },
      { text: 'found', role: '谓语' },
      { text: 'the cause', role: '宾语' },
    ],
    points: ['found 是 find 的过去式，说的是刚刚查到的结果。'],
  }

  test('a sentence from Claude’s reply keeps its English, translation, structure and points', () => {
    const part = (t: string, l: string) =>
      `<span class="wwe-part"><span class="wwe-part-t">${t}</span><span class="wwe-part-l">${l}</span></span>`
    expect(sentenceNoteFields(reply)).toEqual({
      句子: 'I found the cause.',
      朗读: '',
      译文: '我找到原因了。',
      结构: [part('I', '主语'), part('found', '谓语'), part('the cause', '宾语')].join(' '),
      要点: '<ul><li>found 是 find 的过去式，说的是刚刚查到的结果。</li></ul>',
      来源: 'Claude 的回复',
    })
  })

  test('a sentence you sent has no structure or points: the back is the Chinese and the source', () => {
    const fields = sentenceNoteFields({
      en: "Can you help me figure out what's causing this error?",
      zh: '帮我看看这个报错是怎么回事',
      isZhTranslated: false,
      source: 'mine',
      parts: reply.parts,
      points: reply.points,
    })
    expect(fields).toEqual({
      句子: "Can you help me figure out what's causing this error?",
      朗读: '',
      译文: '帮我看看这个报错是怎么回事',
      结构: '',
      要点: '',
      来源: '我发出的',
    })
  })

  test('a Chinese translated when it was added says 中文为译文', () => {
    const fields = sentenceNoteFields({
      en: "I'd move the dotenv call to the top of server.ts.",
      zh: '我建议把 dotenv 调用移到 server.ts 顶部。',
      isZhTranslated: true,
      source: 'mine',
      parts: [],
      points: [],
    })
    expect(fields.译文).toBe('我建议把 dotenv 调用移到 server.ts 顶部。<span class="wwe-note">中文为译文</span>')
  })

  test('the English is escaped and its whitespace made single spaces', () => {
    const fields = sentenceNoteFields({ ...reply, en: 'Use <T>\n  when  a & b.' })
    expect(fields.句子).toBe('Use &lt;T&gt; when a &amp; b.')
  })
})

describe('findNotes queries', () => {
  test('by card type and the first field, in every deck', () => {
    expect(findWordQuery('cause')).toBe('"note:claude-with-english 单词" "单词:cause"')
    expect(findSentenceQuery('I found the cause.')).toBe('"note:claude-with-english 句子" "句子:I found the cause."')
    expect(findWordQuery('cause')).not.toContain('deck:')
  })

  test('quotes, colons, backslashes and wildcards are escaped', () => {
    expect(escapeSearch('say "hi"')).toBe('say \\"hi\\"')
    expect(escapeSearch('3:30')).toBe('3\\:30')
    expect(escapeSearch('C:\\tmp')).toBe('C\\:\\\\tmp')
    expect(escapeSearch('__init__ *')).toBe('\\_\\_init\\_\\_ \\*')
    expect(findSentenceQuery('Note: run "npm test" in __dirname.')).toBe(
      '"note:claude-with-english 句子" "句子:Note\\: run \\"npm test\\" in \\_\\_dirname."',
    )
  })

  test('a sentence starting re: is a value, not a regular expression', () => {
    expect(findSentenceQuery('re: the build')).toBe('"note:claude-with-english 句子" "句子:re\\: the build"')
  })

  test('the value searched is the field as stored, so HTML-escaped', () => {
    expect(findSentenceQuery('a < b && c')).toBe('"note:claude-with-english 句子" "句子:a &lt; b &amp;&amp; c"')
    expect(findSentenceQuery('  a   b ')).toBe(findSentenceQuery('a b'))
  })

  test('findNotesQuery escapes the card type and field names too', () => {
    expect(findNotesQuery('my "type"', 'f:1', 'x')).toBe('"note:my \\"type\\"" "f\\:1:x"')
  })
})

describe('word book copy', () => {
  test('the buttons', () => {
    expect(wb.ADD).toBe('加入单词本')
    expect(wb.ADDED).toBe('已加入单词本')
    expect(wb.ADD_SENTENCE).toBe('补上这一句')
    expect(wb.ADDING).toBe('加入中…')
  })

  test('adding a word: 已加入单词本：cause, and ，已同步到 Anki when it reached Anki', () => {
    expect(wb.addedWordToast('cause', false)).toBe('已加入单词本：cause')
    expect(wb.addedWordToast('cause', true)).toBe('已加入单词本：cause，已同步到 Anki')
  })

  test('补上这一句: cause 已在单词本里，补上了这一句。', () => {
    expect(wb.addedToWordToast('cause', false)).toBe('cause 已在单词本里，补上了这一句。')
    expect(wb.addedToWordToast('cause', true)).toBe('cause 已在单词本里，补上了这一句，已同步到 Anki。')
  })

  test('adding a sentence names its start', () => {
    expect(wb.addedSentenceToast('I found the cause.', false)).toBe('已加入单词本：I found the cause.')
    expect(wb.addedSentenceToast("Can you help me figure out what's causing this error?", true)).toBe(
      '已加入单词本：Can you help me figure out…，已同步到 Anki',
    )
    expect(wb.sentenceHead('x'.repeat(28))).toBe('x'.repeat(28))
    expect(wb.sentenceHead('x'.repeat(29))).toBe(`${'x'.repeat(27)}…`)
  })

  test('deleting: 已从单词本删除：cause', () => {
    expect(wb.deletedWordToast('cause')).toBe('已从单词本删除：cause')
    expect(wb.deletedSentenceToast("I'd move the dotenv call to the top of server.ts.")).toBe(
      "已从单词本删除：I'd move the dotenv call to…",
    )
  })

  test('what was waiting went in: 已同步 2 个词、1 个句子到 Anki。', () => {
    expect(wb.syncedToast(2, 1)).toBe('已同步 2 个词、1 个句子到 Anki。')
    expect(wb.syncedToast(0, 1)).toBe('已同步 1 个句子到 Anki。')
    expect(wb.syncedToast(3, 0)).toBe('已同步 3 个词到 Anki。')
    expect(wb.bookCount(1, 1)).toBe('1 个词、1 个句子')
  })

  test('turning syncing back on adds how many went to the save toast', () => {
    expect(wb.syncedOnSaveSuffix(2, 1)).toBe('，已同步 2 个词、1 个句子到 Anki')
    expect(wb.syncedOnSaveSuffix(0, 0)).toBe('')
  })

  test('the page: its two groups, the sources and the states', () => {
    expect(wb.wordsHeading(2)).toBe('单词（2）')
    expect(wb.sentencesHeading(2)).toBe('句子（2）')
    expect(wb.SOURCE_LABELS.mine).toBe('我发出的')
    expect(wb.SOURCE_LABELS.reply).toBe('Claude 的回复')
    expect(wb.SYNCED).toBe('已同步')
    expect(wb.PENDING).toBe('待同步')
    expect(wb.ZH_IS_TRANSLATION).toBe('中文为译文')
    expect(wb.THIS_SENTENCE).toBe('本句')
    expect(wb.EMPTY_WORDS).toBe('还没有单词。在单词卡上点“加入单词本”。')
    expect(wb.EMPTY_SENTENCES).toBe('还没有句子。在语法分析里每句旁边，或在你发出的消息上点“加入单词本”。')
    expect(wb.deleteLabel('cause')).toBe('从单词本删除 cause')
  })

  test('a row’s state: none with syncing off, and no 待同步 before Anki has ever answered', () => {
    const on = { isSyncOn: true, hasEverConnected: true }
    expect(wb.rowSyncState({ isSynced: true }, on)).toBe('已同步')
    expect(wb.rowSyncState({ isSynced: false }, on)).toBe('待同步')
    expect(wb.rowSyncState({ isSynced: false }, { ...on, hasEverConnected: false })).toBe('')
    expect(wb.rowSyncState({ isSynced: true }, { ...on, isSyncOn: false })).toBe('')
  })

  test('the status line, connected and not', () => {
    const base = { isSyncOn: true, deck: 'claude-with-english', pendingWords: 1, pendingSentences: 1 }
    expect(wb.ankiStatus({ ...base, link: 'ok' })).toBe(
      '✓ 已连接 Anki，新加的单词和句子会自动建卡到牌组 claude-with-english。',
    )
    expect(wb.ankiStatus({ ...base, link: 'offline' })).toBe(
      '未连接 Anki。打开 Anki 并装好 AnkiConnect 插件后，会自动同步，现在有 1 个词、1 个句子等待同步。',
    )
    expect(wb.ankiOffline(0, 0)).toBe('未连接 Anki。打开 Anki 并装好 AnkiConnect 插件后，会自动同步。')
  })

  test('no status line with syncing off, nor before the page’s check has answered', () => {
    const base = { deck: 'claude-with-english', pendingWords: 0, pendingSentences: 0 }
    expect(wb.ankiStatus({ ...base, isSyncOn: false, link: 'ok' })).toBeNull()
    expect(wb.ankiStatus({ ...base, isSyncOn: true, link: 'unknown' })).toBeNull()
  })

  test('a broken card type stops syncing and says how to recover', () => {
    expect(
      wb.ankiStatus({
        isSyncOn: true,
        link: 'broken',
        deck: 'claude-with-english',
        pendingWords: 0,
        pendingSentences: 0,
        brokenModel: WORD_MODEL.modelName,
      }),
    ).toBe('Anki 里的卡片类型“claude-with-english 单词”被修改，已停止同步。删除这个卡片类型后会自动重建。')
  })

  test('no sentence of the word book is split with “·”', () => {
    const texts = [
      wb.addedWordToast('cause', true),
      wb.addedToWordToast('cause', true),
      wb.syncedToast(2, 1),
      wb.ankiOffline(1, 1),
      wb.ankiConnected('claude-with-english'),
      wb.ankiModelBroken('claude-with-english 句子'),
    ]
    for (const text of texts) {
      expect(text).not.toContain('·')
    }
  })
})
