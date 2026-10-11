import { describe, expect, test } from 'claude-code/testing'

import {
  classifySelection,
  findSentenceInReplies,
  looksLikeCode,
  sentenceCount,
  sentenceOf,
  shouldShow,
} from '../../hooks/core/text/selection'

// The prototype's replies (原型的示例对话)
const CAUSE_REPLY =
  'I found the cause. The config loader reads `PORT` before `.env` is loaded, so it gets `undefined`.'
const STAND_OUT_REPLY = [
  'Two things stand out:',
  '',
  '- Every request waits for the cache lock, so one slow write blocks all reads.',
  '- Entries never expire, so memory grows until the process restarts.',
].join('\n')
const PLAN_REPLY = [
  "Here's the plan. I won't touch any files until you say go.",
  '',
  '1. Add a `--dry-run` flag to the CLI.',
  '2. Print the changes instead of writing them.',
  '3. Add a test that runs the dry run on a sample project.',
].join('\n')

describe('classifySelection', () => {
  test('a word is looked up', () => {
    expect(classifySelection('cause')).toEqual({ kind: 'word', word: 'cause' })
  })

  test('a word form is looked up as selected; the lookup finds block', () => {
    expect(classifySelection('blocks')).toEqual({ kind: 'word', word: 'blocks' })
  })

  test('a phrase of up to 4 words is looked up', () => {
    expect(classifySelection('stand out')).toEqual({ kind: 'word', word: 'stand out' })
    expect(classifySelection('one slow write blocks')).toEqual({ kind: 'word', word: 'one slow write blocks' })
  })

  test('five words are a passage', () => {
    expect(classifySelection('one slow write blocks all')).toEqual({ kind: 'text', text: 'one slow write blocks all' })
  })

  test('a double-clicked config. loses its full stop', () => {
    expect(classifySelection('config.')).toEqual({ kind: 'word', word: 'config' })
  })

  test('one word with end punctuation is still a word', () => {
    expect(classifySelection('Done!')).toEqual({ kind: 'word', word: 'Done' })
    expect(classifySelection('cause:')).toEqual({ kind: 'word', word: 'cause' })
  })

  test('several words ending in . ? ! or : are a whole sentence, a passage', () => {
    expect(classifySelection('I found the cause.')).toEqual({ kind: 'text', text: 'I found the cause.' })
    expect(classifySelection('Is it loaded?')).toEqual({ kind: 'text', text: 'Is it loaded?' })
    expect(classifySelection('It works!')).toEqual({ kind: 'text', text: 'It works!' })
    expect(classifySelection('Two things stand out:')).toEqual({ kind: 'text', text: 'Two things stand out:' })
    expect(classifySelection('"I found the cause."')).toEqual({ kind: 'text', text: '"I found the cause."' })
  })

  test('a phrase without end punctuation stays a phrase even with a comma after it', () => {
    expect(classifySelection('the cause,')).toEqual({ kind: 'word', word: 'the cause' })
  })

  test('PORT is looked up in code as in prose', () => {
    expect(classifySelection('PORT')).toEqual({ kind: 'word', word: 'PORT' })
    expect(classifySelection('`PORT`')).toEqual({ kind: 'word', word: 'PORT' })
  })

  test('apostrophes and hyphens stay in a word', () => {
    expect(classifySelection("don't")).toEqual({ kind: 'word', word: "don't" })
    expect(classifySelection('won’t')).toEqual({ kind: 'word', word: 'won’t' })
    expect(classifySelection('follow-up')).toEqual({ kind: 'word', word: 'follow-up' })
    expect(classifySelection('--dry-run')).toEqual({ kind: 'word', word: 'dry-run' })
  })

  test('a selection across a line break is judged as one line', () => {
    expect(classifySelection('stand\nout')).toEqual({ kind: 'word', word: 'stand out' })
  })

  test('other punctuation inside makes a passage', () => {
    expect(classifySelection('src/config.ts')).toEqual({ kind: 'text', text: 'src/config.ts' })
    expect(classifySelection('max_attempts')).toEqual({ kind: 'text', text: 'max_attempts' })
    expect(classifySelection('loader, reads')).toEqual({ kind: 'text', text: 'loader, reads' })
  })

  test('a passage keeps its own punctuation and line breaks', () => {
    const raw = '  The config loader reads PORT before .env is loaded,\nso it gets undefined.  '
    expect(classifySelection(raw)).toEqual({
      kind: 'text',
      text: 'The config loader reads PORT before .env is loaded,\nso it gets undefined.',
    })
  })

  test('past 600 characters a passage is too long', () => {
    const sentence = 'The config loader reads PORT before the env file is loaded. '
    const long = sentence.repeat(11)
    expect(long.trim().length).toBeGreaterThan(600)
    expect(classifySelection(long)).toEqual({ kind: 'long', text: long.trim() })
  })

  test('600 characters are not too long yet', () => {
    const exact = `${'a'.repeat(299)}, ${'b'.repeat(299)}`
    expect(exact.length).toBe(600)
    expect(classifySelection(exact).kind).toBe('text')
    expect(classifySelection(`${exact}c`).kind).toBe('long')
  })

  test('a selected Chinese translation gets no row', () => {
    expect(classifySelection('配置加载器在 .env 加载之前就读取了 PORT，所以拿到的是 undefined。')).toEqual({ kind: 'none' })
    expect(classifySelection('我找到原因了。')).toEqual({ kind: 'none' })
    expect(classifySelection('fix 一下 bug')).toEqual({ kind: 'none' })
  })

  test('nothing English gets no row', () => {
    expect(classifySelection('')).toEqual({ kind: 'none' })
    expect(classifySelection('   ')).toEqual({ kind: 'none' })
    expect(classifySelection('...')).toEqual({ kind: 'none' })
    expect(classifySelection('42')).toEqual({ kind: 'none' })
  })
})

describe('shouldShow', () => {
  test('段落模式 shows a word or phrase only', () => {
    expect(shouldShow('word', 'paragraph')).toBe(true)
    expect(shouldShow('text', 'paragraph')).toBe(false)
    expect(shouldShow('long', 'paragraph')).toBe(false)
    expect(shouldShow('none', 'paragraph')).toBe(false)
  })

  test('划选模式 shows any English, and the too-long row', () => {
    expect(shouldShow('word', 'select')).toBe(true)
    expect(shouldShow('text', 'select')).toBe(true)
    expect(shouldShow('long', 'select')).toBe(true)
    expect(shouldShow('none', 'select')).toBe(false)
  })

  test('a word in code is looked up; a passage all in code gets no row', () => {
    expect(shouldShow('word', 'paragraph', true)).toBe(true)
    expect(shouldShow('word', 'select', true)).toBe(true)
    expect(shouldShow('text', 'select', true)).toBe(false)
    expect(shouldShow('long', 'select', true)).toBe(false)
  })

  test('on the desktop, copied code gets no row and a sentence with a path does', () => {
    const show = (copied: string) =>
      shouldShow(classifySelection(copied).kind, 'select', looksLikeCode(copied))
    expect(show('npx fix-config --dry-run ./examples/basic')).toBe(false)
    expect(show("if (!port) { throw new Error('PORT is missing') }")).toBe(false)
    expect(show('Can you move it to the top of server.ts?')).toBe(true)
    expect(show('PORT')).toBe(true)
  })

  test('copying a path in 段落模式 brings nothing up', () => {
    expect(shouldShow(classifySelection('src/config.ts').kind, 'paragraph')).toBe(false)
  })

  test('back from 划选模式 to 段落模式, a selected passage goes and a selected word stays', () => {
    const passage = classifySelection('The config loader reads PORT before .env is loaded, so it gets undefined.')
    expect(shouldShow(passage.kind, 'select')).toBe(true)
    expect(shouldShow(passage.kind, 'paragraph')).toBe(false)
    expect(shouldShow(classifySelection('cause').kind, 'paragraph')).toBe(true)
  })
})

describe('looksLikeCode', () => {
  test('an npx command is code', () => {
    expect(looksLikeCode('npx vitest run')).toBe(true)
    expect(looksLikeCode('$ npm install --save-dev typescript')).toBe(true)
    expect(looksLikeCode('git commit -m "Load .env first"')).toBe(true)
  })

  test('a snippet with { is code', () => {
    expect(looksLikeCode("app.get('/', (req, res) => {\n  res.send('ok')\n})")).toBe(true)
    expect(looksLikeCode("if (!port) { throw new Error('PORT is missing') }")).toBe(true)
  })

  test('code without braces is code', () => {
    expect(looksLikeCode('const port = process.env.PORT ?? 3000\napp.listen(port)')).toBe(true)
    expect(looksLikeCode("import path from 'node:path'")).toBe(true)
    expect(looksLikeCode('loadEnv();')).toBe(true)
    expect(looksLikeCode('// read PORT after loading the env file\nconst port = env.PORT')).toBe(true)
  })

  test('an address or a path alone is code', () => {
    expect(looksLikeCode('https://openrouter.ai/api/v1')).toBe(true)
    expect(looksLikeCode('src/config.ts')).toBe(true)
    expect(looksLikeCode('PORT=3000')).toBe(true)
  })

  test('a sentence with a path in it is prose', () => {
    expect(looksLikeCode('Can you move it to the top of server.ts?')).toBe(false)
    expect(looksLikeCode('Move the check to the top of src/server.ts.')).toBe(false)
    expect(looksLikeCode('The config loader reads PORT before .env is loaded, so it gets undefined.')).toBe(false)
  })

  test('a sentence with brackets is prose', () => {
    expect(looksLikeCode('Call loadEnv() (in src/env.ts) before reading PORT.')).toBe(false)
    expect(looksLikeCode('All 42 tests passed. The slowest is auth.spec.ts at 1.2 s, which is fine for now.')).toBe(false)
  })

  test('prose with a command under it is not all code', () => {
    expect(looksLikeCode('Run the tests again:\n\nnpx vitest run')).toBe(false)
  })

  test('a list is prose', () => {
    expect(looksLikeCode('1. Add a --dry-run flag to the CLI.\n2. Print the changes instead of writing them.')).toBe(false)
  })

  test('nothing is not code', () => {
    expect(looksLikeCode('')).toBe(false)
    expect(looksLikeCode('\n  \n')).toBe(false)
  })
})

describe('sentenceOf', () => {
  test('the sentence a word sits in', () => {
    expect(sentenceOf(CAUSE_REPLY, 'cause')).toBe('I found the cause.')
  })

  test('inline code is matched without its backticks, as the terminal shows it', () => {
    expect(sentenceOf(CAUSE_REPLY, 'PORT')).toBe(
      'The config loader reads PORT before .env is loaded, so it gets undefined.',
    )
  })

  test('a list item is its own sentence', () => {
    expect(sentenceOf(STAND_OUT_REPLY, 'blocks')).toBe(
      'Every request waits for the cache lock, so one slow write blocks all reads.',
    )
    expect(sentenceOf(STAND_OUT_REPLY, 'stand out')).toBe('Two things stand out:')
    expect(sentenceOf(STAND_OUT_REPLY, 'stand')).toBe('Two things stand out:')
  })

  test("the prototype's replies split into its preset sentences", () => {
    const replies: Array<[string, string[]]> = [
      ['Let me check how the config is loaded.', ['Let me check how the config is loaded.']],
      [CAUSE_REPLY, ['I found the cause.', 'The config loader reads PORT before .env is loaded, so it gets undefined.']],
      [
        "I'd move the `dotenv` call to the top of `server.ts`. Want me to do that?",
        ["I'd move the dotenv call to the top of server.ts.", 'Want me to do that?'],
      ],
      ["I'll run the test suite.", ["I'll run the test suite."]],
      [
        'All 42 tests passed. The slowest is `auth.spec.ts` at 1.2 s, which is fine for now.',
        ['All 42 tests passed.', 'The slowest is auth.spec.ts at 1.2 s, which is fine for now.'],
      ],
      [
        "It's a small retry helper. It calls `fn`, and if that throws, it waits and tries again, up to `maxAttempts` times.",
        ["It's a small retry helper.", 'It calls fn, and if that throws, it waits and tries again, up to maxAttempts times.'],
      ],
      [
        'The wait doubles after each failure, so the delays go 100 ms, 200 ms, 400 ms, and so on.',
        ['The wait doubles after each failure, so the delays go 100 ms, 200 ms, 400 ms, and so on.'],
      ],
      [
        STAND_OUT_REPLY,
        [
          'Two things stand out:',
          'Every request waits for the cache lock, so one slow write blocks all reads.',
          'Entries never expire, so memory grows until the process restarts.',
        ],
      ],
      ['If either matters here, I can sketch an alternative.', ['If either matters here, I can sketch an alternative.']],
      [
        PLAN_REPLY,
        [
          "Here's the plan.",
          "I won't touch any files until you say go.",
          'Add a --dry-run flag to the CLI.',
          'Print the changes instead of writing them.',
          'Add a test that runs the dry run on a sample project.',
        ],
      ],
      ['Thanks. One question before I add the test:', ['Thanks.', 'One question before I add the test:']],
      [
        'Sure. Can you paste the file or the full error message, so I can see what is going on?',
        ['Sure.', 'Can you paste the file or the full error message, so I can see what is going on?'],
      ],
    ]
    for (const [md, sentences] of replies) {
      for (const sentence of sentences) {
        expect(sentenceOf(md, sentence)).toBe(sentence)
      }
    }
  })

  test('dry does not count inside --dry-run', () => {
    expect(sentenceOf(PLAN_REPLY, 'dry')).toBe('Add a test that runs the dry run on a sample project.')
    expect(sentenceOf(PLAN_REPLY, 'dry-run')).toBe('Add a --dry-run flag to the CLI.')
  })

  test('a word inside another word does not count', () => {
    expect(sentenceOf('It fails because of the cache. The cause is the loader.', 'cause')).toBe(
      'The cause is the loader.',
    )
  })

  test('the first appearance wins', () => {
    expect(sentenceOf("Here's the plan. I won't touch any files until you say go.", 'the')).toBe("Here's the plan.")
  })

  test('the match ignores case, edge punctuation and the kind of apostrophe', () => {
    expect(sentenceOf(CAUSE_REPLY, 'Cause.')).toBe('I found the cause.')
    expect(sentenceOf(PLAN_REPLY, 'won’t')).toBe("I won't touch any files until you say go.")
  })

  test('e.g. and file names do not end a sentence', () => {
    const md = 'Some files, e.g. the config, load late. Others load at once.'
    expect(sentenceOf(md, 'config')).toBe('Some files, e.g. the config, load late.')
    expect(sentenceOf('All 42 tests passed. The slowest is `auth.spec.ts` at 1.2 s, which is fine.', 'slowest')).toBe(
      'The slowest is auth.spec.ts at 1.2 s, which is fine.',
    )
  })

  test('a selection across sentences gives the sentences it covers', () => {
    expect(sentenceOf(CAUSE_REPLY, 'cause. The config')).toBe(
      'I found the cause. The config loader reads PORT before .env is loaded, so it gets undefined.',
    )
  })

  test('a selection wrapped across lines still matches', () => {
    expect(sentenceOf(CAUSE_REPLY, 'loader\nreads')).toBe(
      'The config loader reads PORT before .env is loaded, so it gets undefined.',
    )
  })

  test('code blocks are not prose', () => {
    const md = ['```ts', 'const port = process.env.PORT', '```', '', 'The server reads PORT at startup.'].join('\n')
    expect(sentenceOf(md, 'PORT')).toBe('The server reads PORT at startup.')
    expect(sentenceOf(md, 'process')).toBeNull()
  })

  test('Markdown marks are left out of the sentence', () => {
    const md = '## Cause\nThe **loader** reads [the env file](https://example.com/env) too *early*.'
    expect(sentenceOf(md, 'loader')).toBe('The loader reads the env file too early.')
    expect(sentenceOf(md, 'Cause')).toBe('Cause')
    expect(sentenceOf('> Quoted text says the cause.', 'cause')).toBe('Quoted text says the cause.')
  })

  test('a table cell is its own block', () => {
    const md = '| Setting | Meaning |\n|---|---|\n| PORT | The port the server listens on. |'
    expect(sentenceOf(md, 'listens')).toBe('The port the server listens on.')
  })

  test('nothing found gives null', () => {
    expect(sentenceOf(CAUSE_REPLY, 'expire')).toBeNull()
    expect(sentenceOf(CAUSE_REPLY, '...')).toBeNull()
  })
})

describe('findSentenceInReplies', () => {
  const OLDER = 'I found the cause. It was the loader.'
  const NEWER = 'The cause turned out to be the cache.'

  test('the newest reply with the word gives the sentence', () => {
    expect(findSentenceInReplies([OLDER, NEWER], 'cause')).toBe('The cause turned out to be the cache.')
  })

  test('older replies are searched when the newer ones lack the word', () => {
    expect(findSentenceInReplies([OLDER, NEWER, STAND_OUT_REPLY], 'loader')).toBe('It was the loader.')
  })

  test('a word only in a newer reply\'s code is skipped', () => {
    const codeOnly = '```sh\nnpx vitest run --cause\n```'
    expect(findSentenceInReplies([OLDER, codeOnly], 'cause')).toBe('I found the cause.')
  })

  test('no reply has it: no 本句', () => {
    expect(findSentenceInReplies([OLDER, NEWER], 'expire')).toBeNull()
    expect(findSentenceInReplies([], 'cause')).toBeNull()
  })
})

describe('sentenceCount', () => {
  test('one sentence, or a part of one, is one: 这句的难词', () => {
    expect(sentenceCount('I found the cause.')).toBe(1)
    expect(sentenceCount('The config loader reads PORT before')).toBe(1)
    expect(sentenceCount('Some files, e.g. the config, load late.')).toBe(1)
  })

  test('several sentences, or lines, are a passage: 这段的难词', () => {
    expect(sentenceCount('I found the cause. It was the loader.')).toBe(2)
    expect(sentenceCount('found the cause. The config')).toBe(2)
    expect(sentenceCount('Two things stand out:\n\nEvery request waits for the cache lock, so one slow write blocks all reads.')).toBe(2)
  })

  test('nothing is no sentence', () => {
    expect(sentenceCount('  \n ')).toBe(0)
  })
})
