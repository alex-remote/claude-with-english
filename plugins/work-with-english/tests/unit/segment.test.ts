import { describe, expect, test } from 'claude-code/testing'

import { hash } from '../../hooks/core/hash'
import { needsTranslation, segment } from '../../hooks/core/text/segment'
import type { Block } from '../../hooks/core/text/segment'

const shape = (markdown: string) => segment(markdown).map(({ kind, text }) => [kind, text])

describe('segment: 按空行分段', () => {
  test('the reply in F6: two paragraphs, each its own block', () => {
    const one = 'I found the cause. The config loader reads `PORT` before `.env` is loaded, so it gets `undefined`.'
    const two = "I'd move the `dotenv` call to the top of `server.ts`. Want me to do that?"
    expect(shape(`${one}\n\n${two}`)).toEqual([
      ['para', one],
      ['para', two],
    ])
  })

  test('a one-line reply is one block', () => {
    expect(shape('Let me check how the config is loaded.')).toEqual([['para', 'Let me check how the config is loaded.']])
  })

  test('lines of one paragraph stay together, and extra blank lines do not add blocks', () => {
    expect(shape('\n\nFirst line\nsecond line\n\n\n\nNext paragraph\n\n')).toEqual([
      ['para', 'First line\nsecond line'],
      ['para', 'Next paragraph'],
    ])
  })

  test('Windows line ends are read as plain ones', () => {
    expect(shape('One.\r\n\r\nTwo.')).toEqual([
      ['para', 'One.'],
      ['para', 'Two.'],
    ])
  })

  test('nothing but blank lines gives no blocks', () => {
    expect(segment('')).toEqual([])
    expect(segment(' \n\t\n')).toEqual([])
  })
})

describe('segment: 一个列表算一段', () => {
  test('the downsides reply of the prototype: a paragraph, the list, a paragraph', () => {
    const list =
      '- Every request waits for the cache lock, so one slow write blocks all reads.\n- Entries never expire, so memory grows until the process restarts.'
    expect(shape(`Two things stand out:\n\n${list}\n\nIf either matters here, I can sketch an alternative.`)).toEqual([
      ['para', 'Two things stand out:'],
      ['list', list],
      ['para', 'If either matters here, I can sketch an alternative.'],
    ])
  })

  test('the plan of the prototype: the numbered list, then its code block', () => {
    const list =
      '1. Add a `--dry-run` flag to the CLI.\n2. Print the changes instead of writing them.\n3. Add a test that runs the dry run on a sample project.'
    const code = '```bash\nnpx fix-config --dry-run ./examples/basic\n```'
    expect(shape(`${list}\n\n${code}`)).toEqual([
      ['list', list],
      ['code', code],
    ])
  })

  test('nested items and items over several lines are one list', () => {
    const list = [
      '1. Read the config',
      '   before anything else.',
      '   - check `PORT`',
      '   - check `HOST`',
      '     and its default',
      '2. Start the server.',
    ].join('\n')
    expect(shape(list)).toEqual([['list', list]])
  })

  test('blank lines between items keep one list', () => {
    const list = '- First item.\n\n- Second item.\n\n  More about the second item.\n\n- Third item.'
    expect(shape(`${list}\n\nAfter the list.`)).toEqual([
      ['list', list],
      ['para', 'After the list.'],
    ])
  })

  test('a line right under an item continues it', () => {
    expect(shape('- The loader reads the file\nbefore it checks the cache.')).toEqual([
      ['list', '- The loader reads the file\nbefore it checks the cache.'],
    ])
  })

  test('a code block inside an item stays in the list', () => {
    const list = '1. Install:\n   ```bash\n   npm install\n\n   # then\n   ```\n2. Run the tests.'
    expect(shape(list)).toEqual([['list', list]])
  })

  test('a line of code in an item that looks like a rule does not end the list', () => {
    const list = '1. Create the file:\n   ```yaml\n   ---\n   title: Notes\n   ```\n2. Commit it.'
    expect(shape(`${list}\n\nDone.`)).toEqual([
      ['list', list],
      ['para', 'Done.'],
    ])
  })

  test('a bullet list or "1." right under a paragraph line starts the list there', () => {
    expect(shape('Two things stand out:\n- one\n- two')).toEqual([
      ['para', 'Two things stand out:'],
      ['list', '- one\n- two'],
    ])
    expect(shape('The steps:\n1. Build.\n2. Ship.')).toEqual([
      ['para', 'The steps:'],
      ['list', '1. Build.\n2. Ship.'],
    ])
  })

  test('a line starting "2." inside a paragraph is not a list', () => {
    expect(shape('This landed in version\n2. It was a big release.')).toEqual([
      ['para', 'This landed in version\n2. It was a big release.'],
    ])
  })

  test('the other markers: *, +, 1)', () => {
    expect(shape('* a\n* b')).toEqual([['list', '* a\n* b']])
    expect(shape('+ a\n+ b')).toEqual([['list', '+ a\n+ b']])
    expect(shape('1) a\n2) b')).toEqual([['list', '1) a\n2) b']])
  })

  test('a code block or a heading right after a list ends it', () => {
    expect(shape('- one\n```\ncode\n```')).toEqual([
      ['list', '- one'],
      ['code', '```\ncode\n```'],
    ])
    expect(shape('- one\n## Next')).toEqual([
      ['list', '- one'],
      ['heading', '## Next'],
    ])
  })
})

describe('segment: 标题单独算一段', () => {
  test('a heading is its own block, even with no blank line after it', () => {
    expect(shape('## Summary\nThe fix moves the call.\n### Next steps\n- Ship it.')).toEqual([
      ['heading', '## Summary'],
      ['para', 'The fix moves the call.'],
      ['heading', '### Next steps'],
      ['list', '- Ship it.'],
    ])
  })

  test('a heading under a paragraph line ends the paragraph', () => {
    expect(shape('Done.\n# Notes')).toEqual([
      ['para', 'Done.'],
      ['heading', '# Notes'],
    ])
  })

  test('a line underlined with = or - is a heading', () => {
    expect(shape('Summary\n=======\n\nDetails\n---\nText.')).toEqual([
      ['heading', 'Summary\n======='],
      ['heading', 'Details\n---'],
      ['para', 'Text.'],
    ])
  })

  test('"#tag" without a space is not a heading', () => {
    expect(shape('#tag is a word here')).toEqual([['para', '#tag is a word here']])
  })

  test('a rule on its own line is its own block', () => {
    expect(shape('Above.\n\n---\n\nBelow.')).toEqual([
      ['para', 'Above.'],
      ['para', '---'],
      ['para', 'Below.'],
    ])
  })
})

describe('segment: 整张表格算一段', () => {
  const table = '| Option | Speed |\n| :--- | ---: |\n| A | fast |\n| B | slow |'

  test('the whole table is one block', () => {
    expect(shape(`Here is the comparison:\n\n${table}\n\nPick A.`)).toEqual([
      ['para', 'Here is the comparison:'],
      ['table', table],
      ['para', 'Pick A.'],
    ])
  })

  test('a table right under a paragraph line is still its own block', () => {
    expect(shape(`Here is the comparison:\n${table}`)).toEqual([
      ['para', 'Here is the comparison:'],
      ['table', table],
    ])
  })

  test('a table without the outer pipes', () => {
    const bare = 'Option | Speed\n--- | ---\nA | fast'
    expect(shape(bare)).toEqual([['table', bare]])
  })

  test('a pipe in a sentence does not make a table', () => {
    expect(shape('Pipe it with `a | b` and go.')).toEqual([['para', 'Pipe it with `a | b` and go.']])
  })
})

describe('segment: 引用块按普通段落处理', () => {
  test('a quote is one block of kind quote, and is translated', () => {
    const quote = '> Note: the cache is shared.\n>\n> It is cleared on restart.'
    const blocks = segment(`${quote}\n\nAfter the quote.`)
    expect(blocks.map(({ kind, text }) => [kind, text])).toEqual([
      ['quote', quote],
      ['para', 'After the quote.'],
    ])
    expect(needsTranslation(blocks[0] as Block)).toBe(true)
  })

  test('a line right under a quote line continues the quote', () => {
    expect(shape('> The loader reads the file\nbefore the cache.')).toEqual([
      ['quote', '> The loader reads the file\nbefore the cache.'],
    ])
  })

  test('a quote right under a paragraph line starts there', () => {
    expect(shape('The docs say:\n> Keep it short.')).toEqual([
      ['para', 'The docs say:'],
      ['quote', '> Keep it short.'],
    ])
  })
})

describe('segment: 代码块不翻', () => {
  test('``` and ~~~ blocks are their own blocks of kind code, blank lines inside included', () => {
    const backticks = '```bash\nnpm test\n\nnpm run lint\n```'
    const tildes = '~~~\nconst a = 1\n\nconst b = 2\n~~~'
    expect(shape(`Run this:\n${backticks}\nThen this:\n\n${tildes}\nDone.`)).toEqual([
      ['para', 'Run this:'],
      ['code', backticks],
      ['para', 'Then this:'],
      ['code', tildes],
      ['para', 'Done.'],
    ])
  })

  test('a block closes only on a fence of its own kind, at least as long', () => {
    const code = '````md\n```\ninner\n```\n~~~\n````'
    expect(shape(`${code}\nAfter.`)).toEqual([
      ['code', code],
      ['para', 'After.'],
    ])
  })

  test('a block that never closes runs to the end', () => {
    expect(shape('Look:\n\n```\nnot closed\n\nstill code')).toEqual([
      ['para', 'Look:'],
      ['code', '```\nnot closed\n\nstill code'],
    ])
  })

  test('lines that look like Markdown inside code stay code', () => {
    const code = '```\n# comment\n- item\n| a | b |\n|---|---|\n> quote\n```'
    expect(shape(code)).toEqual([['code', code]])
  })
})

describe('segment: hash', () => {
  test('each block carries the hash of its text', () => {
    for (const block of segment('# Title\n\nSome text.\n\n- a\n- b\n\n```\ncode\n```')) {
      expect(block.hash).toBe(hash(block.text))
    }
  })

  test('the same paragraph gets the same hash in another reply; a different one does not', () => {
    const [a] = segment('Shared paragraph.\n\nFirst reply.')
    const [b] = segment('Shared paragraph.\n\nSecond reply.')
    const [c] = segment('Another paragraph.')
    expect(a?.hash).toBe(b?.hash as string)
    expect(a?.hash).not.toBe(c?.hash as string)
  })
})

describe('needsTranslation', () => {
  const only = (markdown: string) => segment(markdown)[0] as Block

  test('paragraphs, lists, headings, tables and quotes with words are translated', () => {
    for (const markdown of ['I found the cause.', '- one\n- two', '## Summary', '| A | B |\n|---|---|\n| x | y |', '> quoted']) {
      expect(needsTranslation(only(markdown))).toBe(true)
    }
  })

  test('code blocks are not translated', () => {
    expect(needsTranslation(only('```\nexplain this code\n```'))).toBe(false)
  })

  test('symbols, digits or blank space alone are not translated', () => {
    expect(needsTranslation(only('---'))).toBe(false)
    expect(needsTranslation(only('***'))).toBe(false)
    expect(needsTranslation(only('42 / 7 = 6'))).toBe(false)
    expect(needsTranslation({ kind: 'para', text: '  ', hash: hash('  ') })).toBe(false)
  })

  test('inline code alone is not translated, words around it are', () => {
    expect(needsTranslation(only('- `src/config.ts`\n- `src/server.ts`'))).toBe(false)
    expect(needsTranslation(only('`npm test`'))).toBe(false)
    expect(needsTranslation(only('Run `npm test`.'))).toBe(true)
  })

  test('Chinese text counts as words', () => {
    expect(needsTranslation(only('我找到原因了。'))).toBe(true)
  })
})
