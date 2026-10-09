import { describe, expect, test } from 'claude-code/testing'

import { isShellInput, judgedText, parseLeadingCommand } from '../../hooks/core/text/command'
import {
  bandMode,
  countEnWords,
  countHan,
  hasHan,
  isCodeLikeWord,
  isEnglishMessage,
  mainLang,
  shouldBlock,
} from '../../hooks/core/text/lang'
import { maskSpans, visibleText } from '../../hooks/core/text/mask'

// The examples of docs/feature-map.md, 语言判断, one case each, and the rules around them.

const masked = (text: string) => maskSpans(text).map(s => [s.kind, text.slice(s.start, s.end)])

describe('maskSpans: what is left out', () => {
  test('a code block, closed or still being typed', () => {
    const text = '帮我看看这段\n```ts\nconst a = 1\n```\n为什么报错'
    expect(masked(text)).toEqual([['codeBlock', '```ts\nconst a = 1\n```']])
    expect(masked('看看 ```\nconst 中文 = 1')).toEqual([['codeBlock', '```\nconst 中文 = 1']])
  })

  test('backticks, and a pair of · as the Chinese IME types them', () => {
    expect(masked('Please fix `登录失败` error')).toEqual([['inlineCode', '`登录失败`']])
    expect(masked('Please fix ``a ` b`` error')).toEqual([['inlineCode', '``a ` b``']])
    expect(masked('Please fix ·登录失败· error')).toEqual([['inlineCode', '·登录失败·']])
  })

  test('an unpaired backtick or ·, or a · with spaces as a separator, is text', () => {
    expect(masked('看看 `useEff')).toEqual([])
    expect(masked('马丁·路德')).toEqual([])
    expect(masked('早餐 · 午餐 · 晚餐')).toEqual([])
  })

  test('a long paste, as submitted and as the Prompt shows it, and an image', () => {
    const sent = '\n\n<pasted_content id="bb60">\n第一行\n第二行\n</pasted_content id="bb60">\n\n summarize'
    expect(masked(sent)).toEqual([['pasted', '<pasted_content id="bb60">\n第一行\n第二行\n</pasted_content id="bb60">']])
    expect(masked('[Pasted text #1 +11 lines] 总结一下')).toEqual([['pastedText', '[Pasted text #1 +11 lines]']])
    expect(masked('[Image #2] 这是什么颜色')).toEqual([['image', '[Image #2]']])
  })

  test('URLs, paths, file names, @ mentions, slash commands and flags', () => {
    expect(masked('打开 https://example.com/docs?q=1 看看')).toEqual([['url', 'https://example.com/docs?q=1']])
    expect(masked('发到 me@example.com')).toEqual([['url', 'me@example.com']])
    expect(masked('看看 ~/.claude/settings.json')).toEqual([['path', '~/.claude/settings.json']])
    expect(masked('改一下 package.json 和 .env')).toEqual([
      ['file', 'package.json'],
      ['file', '.env'],
    ])
    expect(masked('看看 app.ts:42 的报错')).toEqual([['file', 'app.ts:42']])
    expect(masked('@src/app.ts 看看')).toEqual([['mention', '@src/app.ts']])
    expect(masked('先跑一下 /review')).toEqual([['command', '/review']])
    expect(masked('加上 --force 和 -rf')).toEqual([
      ['flag', '--force'],
      ['flag', '-rf'],
    ])
  })

  test('a name ends at the first character outside ASCII', () => {
    const text = '看看src/app.ts的问题'
    expect(masked(text)).toEqual([['path', 'src/app.ts']])
    expect(visibleText(text)).toBe('看看 的问题')
    expect(masked('打开https://example.com，然后')).toEqual([['url', 'https://example.com']])
  })

  test('the punctuation of the sentence around a name is not the name', () => {
    expect(masked('Open src/app.ts.')).toEqual([['path', 'src/app.ts']])
    expect(masked('(see src/app.ts)')).toEqual([['path', 'src/app.ts']])
    expect(masked('**src/app.ts**')).toEqual([['path', 'src/app.ts']])
    expect(masked('[docs](https://example.com)')).toEqual([['url', 'https://example.com']])
  })

  test('words, versions, numbers and abbreviations are not names', () => {
    expect(masked('fix the bug in v1.2.3, then ship 3.14')).toEqual([])
    expect(masked('Use a hook, e.g. useMemo, i.e. one that caches.')).toEqual([])
  })
})

describe('counting', () => {
  test('Chinese punctuation and full-width forms are not Han', () => {
    expect(countHan('，。！？“”（）')).toBe(0)
    expect(countHan('ＡＢＣ１２３')).toBe(0)
    expect(hasHan('Please check the config。')).toBe(false)
    expect(countHan('看看src/app.ts的问题')).toBe(5)
  })

  test('Han inside the left-out parts does not count', () => {
    expect(hasHan('Please fix `登录失败` error')).toBe(false)
    expect(hasHan('<pasted_content id="a">\n登录失败\n</pasted_content id="a">\nexplain')).toBe(false)
    expect(hasHan('[Image #1] what color')).toBe(false)
  })

  test('an English word may hold an apostrophe or a hyphen', () => {
    expect(countEnWords("don't skip the follow-up")).toBe(4)
    expect(countEnWords('it’s done.')).toBe(2)
  })

  test('code-like words are not English words', () => {
    for (const word of ['useEffect', 'TypeScript', 'v2', 'max_attempts', 'node.js']) {
      expect(isCodeLikeWord(word), word).toBe(true)
    }
    for (const word of ['hello', 'Hello', 'API', "don't", 'follow-up']) {
      expect(isCodeLikeWord(word), word).toBe(false)
    }
    expect(countEnWords('fix the useEffect hook in v2')).toBe(4)
  })
})

describe('mainLang: the examples', () => {
  test('帮我看看 useEffect 为什么执行两次 is mostly Chinese', () => {
    expect(mainLang('帮我看看 useEffect 为什么执行两次')).toBe('zh')
  })

  test('Run the tests 然后 deploy is mostly English', () => {
    expect(mainLang('Run the tests 然后 deploy')).toBe('en')
  })

  test('a tie goes to Chinese: fix 一下 bug', () => {
    expect(countEnWords('fix 一下 bug')).toBe(2)
    expect(countHan('fix 一下 bug')).toBe(2)
    expect(mainLang('fix 一下 bug')).toBe('zh')
  })

  test('numbers, symbols or code alone cannot be told', () => {
    for (const text of ['', '   ', '123 + 456', '!!!', '`npm test`', 'useEffect', 'src/app.ts', '[Image #1]']) {
      expect(mainLang(text), text).toBeNull()
    }
  })
})

describe('the questions per purpose', () => {
  test('F4: one Han character outside the left-out parts blocks', () => {
    expect(shouldBlock('Please check the config 吧')).toBe(true)
    expect(shouldBlock('帮我看看 useEffect 为什么执行两次')).toBe(true)
    expect(shouldBlock('看看src/app.ts的问题')).toBe(true)
    expect(shouldBlock('Please check the config')).toBe(false)
  })

  test('F4: Chinese in quotes counts; in backticks or a pair of · it does not', () => {
    expect(shouldBlock('Please fix the "登录失败" error')).toBe(true)
    expect(shouldBlock('Please fix the “登录失败” error')).toBe(true)
    expect(shouldBlock('Please fix the `登录失败` error')).toBe(false)
    expect(shouldBlock('Please fix the ·登录失败· error')).toBe(false)
  })

  test('F4: what cannot be told is not blocked', () => {
    expect(shouldBlock('123')).toBe(false)
    expect(shouldBlock('`中文`')).toBe(false)
  })

  test('F12, F13: an English message has no Han and some English words', () => {
    expect(isEnglishMessage('Please check the config')).toBe(true)
    expect(isEnglishMessage('Run `npm test` and fix 中文 later')).toBe(false)
    expect(isEnglishMessage('Please check the config 吧')).toBe(false)
    expect(isEnglishMessage('Explain `登录失败` please')).toBe(true)
    expect(isEnglishMessage('123')).toBe(false)
    expect(isEnglishMessage('`npm test`')).toBe(false)
  })

  test('F1, F15: mostly Chinese translates, otherwise corrects', () => {
    expect(bandMode('帮我看看 useEffect 为什么执行两次')).toBe('translate')
    expect(bandMode('fix 一下 bug')).toBe('translate')
    expect(bandMode('Run the tests 然后 deploy')).toBe('correct')
    expect(bandMode('I have fixed the bug yesterday.')).toBe('correct')
    expect(bandMode('123')).toBeNull()
  })

  test('F6: whichever is more', () => {
    expect(mainLang('这个函数在 `useEffect` 里执行了两次，因为 React 18 的严格模式。')).toBe('zh')
    expect(mainLang('The effect runs twice because of Strict Mode.\n\n```ts\nconst 中文 = 1\n```')).toBe('en')
  })
})

describe('commands', () => {
  const names = ['review', 'model', 'wwe', 'work-with-english:wwe']

  test('a skill or custom command: the text after it is judged, the name is not language', () => {
    expect(parseLeadingCommand('/review 帮我看看', names)).toEqual({ name: 'review', rest: '帮我看看' })
    expect(shouldBlock(judgedText('/review 帮我看看', names) ?? '')).toBe(true)
    expect(isEnglishMessage(judgedText('/review check the auth flow', names) ?? '')).toBe(true)
    expect(judgedText('/review', names)).toBe('')
    expect(mainLang(judgedText('/review', names) ?? '')).toBeNull()
  })

  test('only the names Claude Code lists are commands', () => {
    expect(parseLeadingCommand('/model haiku', names)).toEqual({ name: 'model', rest: 'haiku' })
    expect(parseLeadingCommand('/wwe', names)).toEqual({ name: 'wwe', rest: '' })
    expect(parseLeadingCommand('/work-with-english:wwe', names)).toEqual({ name: 'work-with-english:wwe', rest: '' })
    expect(parseLeadingCommand('/reveiw 帮我看看', names)).toBeNull()
    expect(shouldBlock(judgedText('/reveiw 帮我看看', names) ?? '')).toBe(true)
  })

  test('a message that starts with a path is judged as any', () => {
    const text = '/Users/alex/app.ts 为什么报错'
    expect(parseLeadingCommand(text, [...names, 'Users'])).toBeNull()
    expect(judgedText(text, names)).toBe(text)
    expect(mainLang(text)).toBe('zh')
  })

  test('a command only leads; one in a sentence, or followed by Chinese punctuation, is not', () => {
    expect(parseLeadingCommand('先跑一下 /review', names)).toBeNull()
    expect(parseLeadingCommand('/review，帮我看看', names)).toBeNull()
  })

  test('shell input on the desktop is neither blocked nor counted', () => {
    expect(isShellInput('<bash-input>ls 中文目录</bash-input>')).toBe(true)
    expect(judgedText('<bash-input>ls 中文目录</bash-input>', names)).toBeNull()
    expect(isShellInput('ls')).toBe(false)
  })
})

describe('known cases', () => {
  test('a short paste without a marker counts as typed', () => {
    expect(shouldBlock('Why does this fail: 登录失败')).toBe(true)
  })

  test("the terminal's ! mode drafts without the !, so the band translates it", () => {
    expect(bandMode('echo 你好')).toBe('translate')
  })
})
