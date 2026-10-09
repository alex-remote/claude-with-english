import { describe, expect, test } from 'claude-code/testing'

import { diffMarks } from '../../hooks/core/text/diff'

/** The marked parts of the corrected sentence, as text. */
const marked = (original: string, corrected: string) =>
  diffMarks(original, corrected).map(({ start, end }) => corrected.slice(start, end))

describe('diffMarks: the examples of F15 and the prototype', () => {
  test('I have fixed the bug yesterday. → fixed is marked', () => {
    expect(marked('I have fixed the bug yesterday.', 'I fixed the bug yesterday.')).toEqual(['fixed'])
  })

  test('Can you check why this test is fail? → fails is marked', () => {
    expect(marked('Can you check why this test is fail?', 'Can you check why this test fails?')).toEqual(['fails'])
  })

  test('nothing to fix: no marks', () => {
    expect(marked("Can you help me figure out what's causing this error?", "Can you help me figure out what's causing this error?")).toEqual([])
    expect(marked('Can you help me figure out', 'Can you help me figure out')).toEqual([])
  })

  test('a question mark added at the end is not marked', () => {
    expect(marked("Can you help me figure out what's causing this error", "Can you help me figure out what's causing this error?")).toEqual([])
  })

  test('Run the tests 然后 deploy → the Chinese put into English is marked whole', () => {
    expect(marked('Run the tests 然后 deploy', 'Run the tests and then deploy.')).toEqual(['and then'])
  })

  test('Please check the config 吧 → a Chinese particle taken out marks nothing', () => {
    expect(marked('Please check the config 吧', 'Please check the config.')).toEqual([])
  })
})

describe('diffMarks: changed and added words', () => {
  test('the offsets point into the corrected sentence, end exclusive', () => {
    expect(diffMarks('I have fixed the bug yesterday.', 'I fixed the bug yesterday.')).toEqual([{ start: 2, end: 7 }])
    expect(diffMarks('Run the tests 然后 deploy', 'Run the tests and then deploy.')).toEqual([{ start: 14, end: 22 }])
  })

  test('a misspelled word, a word added, and a case fixed are each marked', () => {
    expect(marked('I found teh bug', 'I found the bug')).toEqual(['the'])
    expect(marked('I found bug in the loader', 'I found a bug in the loader')).toEqual(['a'])
    expect(marked('i think so', 'I think so')).toEqual(['I'])
  })

  test('changes apart from each other are separate spans, in order', () => {
    expect(marked('She go to the office and work there yesterday', 'She went to the office and worked there yesterday')).toEqual([
      'went',
      'worked',
    ])
  })

  test('words changed next to each other are one span', () => {
    expect(marked('Can you helps me fixing this?', 'Can you help me fix this?')).toEqual(['help', 'fix'])
    expect(marked('He have went home', 'He has gone home')).toEqual(['has gone'])
  })

  test("words with ' or - inside are one word", () => {
    expect(marked('I dont know', "I don't know")).toEqual(["don't"])
    expect(marked('Its fine', "It's fine")).toEqual(["It's"])
    expect(marked('Let me follow up on this', 'Let me follow-up on this')).toEqual(['follow-up'])
    expect(marked("I don't know", "I don't know")).toEqual([])
  })

  test('spaces are not words: spacing alone changes nothing', () => {
    expect(marked('I  fixed   it .', 'I fixed it.')).toEqual([])
  })

  test('punctuation changed alone is not marked', () => {
    expect(marked('Is it done.', 'Is it done?')).toEqual([])
    expect(marked('First, run it', 'First run it')).toEqual([])
  })

  test('punctuation next to a changed word stays outside the span', () => {
    expect(marked('Run the tests 然后，deploy', 'Run the tests, and then deploy.')).toEqual(['and then'])
  })
})

describe('diffMarks: deleted words are not shown', () => {
  test('the word right after the words taken out is marked', () => {
    expect(marked('He is more taller than me', 'He is taller than me')).toEqual(['taller'])
    expect(marked('I am agree with you', 'I agree with you')).toEqual(['agree'])
  })

  test('with no word right after, nothing is marked', () => {
    expect(marked('I finished it already.', 'I finished it.')).toEqual([])
    expect(marked('I finished it already', 'I finished it')).toEqual([])
  })
})

describe('diffMarks: Chinese in the English', () => {
  test('a Chinese fragment in the middle is marked whole', () => {
    expect(marked('Please 帮我看看 the logs', 'Please take a look at the logs')).toEqual(['take a look at'])
  })

  test('Chinese at the start, and Chinese only taken out', () => {
    expect(marked('把 the file 删掉', 'Delete the file')).toEqual(['Delete'])
  })

  test('one change holding Chinese and English words is one span', () => {
    expect(marked('I has 一个 question', 'I have a question')).toEqual(['have a'])
  })
})

describe('diffMarks: size', () => {
  test('a long Prompt with one change is marked at that change', () => {
    const words = Array.from({ length: 3000 }, (_, i) => `word${i}`)
    const original = [...words.slice(0, 1500), 'teh', ...words.slice(1500)].join(' ')
    const corrected = [...words.slice(0, 1500), 'the', ...words.slice(1500)].join(' ')
    expect(marked(original, corrected)).toEqual(['the'])
  })

  test('two long texts with nothing in common are one span', () => {
    const original = Array.from({ length: 2100 }, (_, i) => `a${i}`).join(' ')
    const corrected = Array.from({ length: 2100 }, (_, i) => `b${i}`).join(' ')
    expect(diffMarks(original, corrected)).toEqual([{ start: 0, end: corrected.length }])
  })

  test('empty text has no marks', () => {
    expect(diffMarks('', '')).toEqual([])
    expect(marked('', 'Hello.')).toEqual(['Hello'])
    expect(diffMarks('Hello.', '')).toEqual([])
  })
})
