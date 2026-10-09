import { describe, expect, test } from 'claude-code/testing'

import { SPEAK_MAX_CHARS, speakable } from '../../hooks/core/text/speakable'

describe('speakable: 不读的', () => {
  test('code blocks are not read, ``` or ~~~', () => {
    expect(speakable('Run this:\n\n```bash\nnpm test\n```\n\nThen check the output.')).toEqual(['Run this:\n\nThen check the output.'])
    expect(speakable('Before.\n~~~\nconst a = 1\n~~~\nAfter.')).toEqual(['Before.\nAfter.'])
  })

  test("inline code's backticks are not read, its words are", () => {
    expect(
      speakable('I found the cause. The config loader reads `PORT` before `.env` is loaded, so it gets `undefined`.'),
    ).toEqual(['I found the cause. The config loader reads PORT before .env is loaded, so it gets undefined.'])
    expect(speakable("I'd move the `dotenv` call to the top of `server.ts`. Want me to do that?")).toEqual([
      "I'd move the dotenv call to the top of server.ts. Want me to do that?",
    ])
  })

  test('list markers and numbers are not read', () => {
    expect(
      speakable(
        '- Every request waits for the cache lock, so one slow write blocks all reads.\n- Entries never expire, so memory grows until the process restarts.',
      ),
    ).toEqual([
      'Every request waits for the cache lock, so one slow write blocks all reads.\nEntries never expire, so memory grows until the process restarts.',
    ])
    expect(
      speakable(
        '1. Add a `--dry-run` flag to the CLI.\n2. Print the changes instead of writing them.\n3. Add a test that runs the dry run on a sample project.',
      ),
    ).toEqual([
      'Add a --dry-run flag to the CLI.\nPrint the changes instead of writing them.\nAdd a test that runs the dry run on a sample project.',
    ])
  })

  test('nested items, other markers and task boxes lose their markers too', () => {
    expect(speakable('* Read it.\n  + Check the port.\n    1) Fix it.\n- [ ] Ship it.\n- [x] Test it.')).toEqual([
      'Read it.\nCheck the port.\nFix it.\nShip it.\nTest it.',
    ])
  })

  test("table pipes are not read, and the separator row isn't either", () => {
    expect(speakable('| Option | Speed |\n| :--- | ---: |\n| A | fast |\n| B | slow |')).toEqual([
      'Option, Speed\nA, fast\nB, slow',
    ])
    expect(speakable('Option | Speed\n--- | ---\nA | fast')).toEqual(['Option, Speed\nA, fast'])
  })

  test('a pipe outside a table is left alone', () => {
    expect(speakable('Use a | b here.')).toEqual(['Use a | b here.'])
  })

  test("a heading's # is not read", () => {
    expect(speakable('## Summary')).toEqual(['Summary'])
    expect(speakable('### Next steps ###\nShip it.')).toEqual(['Next steps\nShip it.'])
    expect(speakable('#tag stays')).toEqual(['#tag stays'])
  })

  test("a quote's > is not read", () => {
    expect(speakable('> Note: the cache is shared.\n> > Nested here.')).toEqual(['Note: the cache is shared.\nNested here.'])
  })

  test('a code block inside a quote or a list is not read either', () => {
    expect(speakable('> Run:\n> ```\n> npm test\n> ```\n> Done.')).toEqual(['Run:\nDone.'])
    expect(speakable('1. Install:\n   ```bash\n   npm install\n   ```\n2. Run the tests.')).toEqual(['Install:\nRun the tests.'])
  })

  test('nothing left to read gives no pieces', () => {
    expect(speakable('```\nonly code\n```')).toEqual([])
    expect(speakable('')).toEqual([])
    expect(speakable('---')).toEqual([])
  })

  test('plain text, a translation or a selection, is read as it is', () => {
    expect(speakable('I fixed the bug yesterday.')).toEqual(['I fixed the bug yesterday.'])
    expect(speakable('  Sure.  ')).toEqual(['Sure.'])
  })
})

describe('speakable: 每段不超过 4096 字符', () => {
  const sentence = 'The wait doubles after each failure, so the delays go up quickly. '

  test('the limit is 4096', () => {
    expect(SPEAK_MAX_CHARS).toBe(4096)
  })

  test('exactly 4096 characters is one piece', () => {
    const text = 'a'.repeat(4095) + '.'
    expect(speakable(text)).toEqual([text])
  })

  test('longer text is cut between sentences, every piece within the limit', () => {
    const text = sentence.repeat(200).trim()
    const pieces = speakable(text)
    expect(pieces.length).toBeGreaterThan(1)
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(SPEAK_MAX_CHARS)
      expect(piece).toStartWith('The wait')
      expect(piece).toEndWith('quickly.')
    }
    expect(pieces.join(' ')).toBe(text)
  })

  test('Chinese sentences are cut after 。 with no space', () => {
    const text = '每失败一次，等待时间翻倍。'.repeat(400)
    const pieces = speakable(text)
    expect(pieces.length).toBeGreaterThan(1)
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(SPEAK_MAX_CHARS)
      expect(piece).toEndWith('。')
    }
    expect(pieces.join('')).toBe(text)
  })

  test('one sentence too long is cut between words', () => {
    const text = Array.from({ length: 1000 }, (_, i) => `word${i}`).join(' ')
    const pieces = speakable(text)
    expect(pieces.length).toBeGreaterThan(1)
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(SPEAK_MAX_CHARS)
    }
    expect(pieces.join(' ')).toBe(text)
  })

  test('one word too long is cut, never in the middle of a character', () => {
    const word = '𝒜'.repeat(3000)
    const pieces = speakable(word)
    expect(pieces.length).toBe(2)
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(SPEAK_MAX_CHARS)
      expect(piece.length % 2).toBe(0)
    }
    expect(pieces.join('')).toBe(word)
  })
})
