import { describe, expect, test } from 'claude-code/testing'

import { placeholder, protect, restore, verify } from '../../hooks/core/text/protect'

// docs/feature-map.md: F1 不翻的, F2 替换前核对, F15 代码和占位.

describe('protect', () => {
  test('a path written against Chinese becomes a placeholder', () => {
    expect(protect('看看src/app.ts的问题')).toEqual({ masked: '看看⟦0⟧的问题', tokens: ['src/app.ts'] })
  })

  test('code, backticks, paths, commands, @ mentions, placeholders and URLs are all kept', () => {
    const text =
      '[Image #1] 先跑 /review，再看 @src/app.ts 里的 `useEffect` 和 ·fetchUser·，参考 https://react.dev/learn\n```ts\nconst a = 1\n```'
    const { masked, tokens } = protect(text)
    expect(tokens).toEqual([
      '[Image #1]',
      '/review',
      '@src/app.ts',
      '`useEffect`',
      '·fetchUser·',
      'https://react.dev/learn',
      '```ts\nconst a = 1\n```',
    ])
    expect(masked).toBe('⟦0⟧ 先跑 ⟦1⟧，再看 ⟦2⟧ 里的 ⟦3⟧ 和 ⟦4⟧，参考 ⟦5⟧\n⟦6⟧')
  })

  test('a long paste is kept whole, as submitted and as the Prompt shows it', () => {
    expect(protect('[Pasted text #1 +11 lines] 总结一下').tokens).toEqual(['[Pasted text #1 +11 lines]'])
    const sent = '<pasted_content id="bb60">\n第一行\n</pasted_content id="bb60">\n总结一下'
    expect(protect(sent)).toEqual({
      masked: '⟦0⟧\n总结一下',
      tokens: ['<pasted_content id="bb60">\n第一行\n</pasted_content id="bb60">'],
    })
  })

  test('F15: an English sentence keeps its code too', () => {
    expect(protect('I have fixed the bug in src/app.ts with --force yesterday.')).toEqual({
      masked: 'I have fixed the bug in ⟦0⟧ with ⟦1⟧ yesterday.',
      tokens: ['src/app.ts', '--force'],
    })
  })

  test('text with nothing to keep is unchanged', () => {
    expect(protect('帮我看看这个报错是怎么回事')).toEqual({ masked: '帮我看看这个报错是怎么回事', tokens: [] })
    expect(placeholder(3)).toBe('⟦3⟧')
  })
})

describe('restore', () => {
  test('each placeholder comes back as its part, wherever the translation put it', () => {
    const { tokens } = protect('看看src/app.ts的问题，先跑 /review')
    expect(restore('Run ⟦1⟧ first, then look at the problem in ⟦0⟧', tokens)).toBe(
      'Run /review first, then look at the problem in src/app.ts',
    )
  })

  test('a placeholder padded with spaces still comes back', () => {
    expect(restore('Look at ⟦ 0 ⟧.', ['src/app.ts'])).toBe('Look at src/app.ts.')
  })
})

describe('verify', () => {
  const tokens = ['src/app.ts', '/review']

  test('every placeholder once, in any order, is ok', () => {
    expect(verify('Look at ⟦0⟧, then run ⟦1⟧', tokens)).toBe('ok')
    expect(verify('Run ⟦1⟧, then look at ⟦0⟧', tokens)).toBe('ok')
    expect(verify('Hello', [])).toBe('ok')
  })

  test('one missing, repeated or unknown is a mismatch', () => {
    expect(verify('Look at ⟦0⟧', tokens)).toBe('mismatch')
    expect(verify('Look at ⟦0⟧ and ⟦0⟧, then run ⟦1⟧', tokens)).toBe('mismatch')
    expect(verify('Look at ⟦0⟧, then run ⟦1⟧ and ⟦2⟧', tokens)).toBe('mismatch')
    expect(verify('Hello ⟦0⟧', [])).toBe('mismatch')
  })

  test('a part the model rewrote instead of keeping its placeholder is a mismatch', () => {
    expect(verify('Look at src/app.ts, then run ⟦1⟧', tokens)).toBe('mismatch')
  })
})
