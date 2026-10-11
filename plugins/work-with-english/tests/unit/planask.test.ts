import { describe, expect, test } from 'claude-code/testing'

import { segment } from '../../hooks/core/text/segment'
import { askLines, planOf, planView } from '../../hooks/features/reply/planAsk'
import { MARKDOWN_MAX, markdownPieces, replyView } from '../../hooks/features/reply/view'
import type { ReplyPart, ReplyUi } from '../../hooks/features/reply/view'
import type { WwePara } from '../../types'

describe('plan and question lines (F6 › 计划和提问)', () => {
  test('a question, then each option and its description, numbered as the dialog numbers them', () => {
    const lines = askLines([
      {
        question: 'Which test framework do you prefer?',
        header: 'Test framework',
        options: [
          { label: 'Jest', description: 'Popular and batteries included' },
          { label: 'Vitest', description: 'Fast and Vite native' },
        ],
        multiSelect: false,
      },
    ])
    expect(lines).toEqual([
      { text: 'Which test framework do you prefer?', isOption: false, number: 0 },
      { text: 'Jest', isOption: true, number: 1 },
      { text: 'Popular and batteries included', isOption: true, number: 0 },
      { text: 'Vitest', isOption: true, number: 2 },
      { text: 'Fast and Vite native', isOption: true, number: 0 },
    ])
  })

  test('anything that is not a question is left out', () => {
    expect(askLines([null, 'text', { options: 'none' }])).toEqual([])
  })

  test('the plan comes with the result of the call that leaves plan mode', () => {
    expect(planOf({ plan: '## Plan\n\nAdd a README.', isAgent: false })).toBe('## Plan\n\nAdd a README.')
    expect(planOf({ plan: null, isAgent: false })).toBeNull()
    expect(planOf('denied')).toBeNull()
  })
})

// 2.1.288 的写法规则: a Markdown takes at most 10,000 characters there, and a
// longer one refuses the whole tree; a translation that long is cut in
// several, never left out or cut short.

type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] }
const flat = (children: unknown): (Node | string)[] =>
  children === undefined || children === null || typeof children === 'boolean'
    ? []
    : Array.isArray(children)
      ? children.flatMap(flat)
      : typeof children === 'string' || typeof children === 'number'
        ? [String(children)]
        : [children as Node]
const element = (type: string) => (props: Record<string, unknown>) => {
  const { children, ...rest } = props
  return { type, props: rest, children: flat(children) }
}
const UI = { Box: element('Box'), Text: element('Text'), Button: element('Button'), Markdown: element('Markdown') } as unknown as ReplyUi
const all = (node: Node, out: Node[] = []): Node[] => {
  out.push(node)
  node.children.forEach(child => typeof child !== 'string' && all(child, out))
  return out
}
const markdownsOf = (tree: unknown) =>
  all(tree as Node)
    .filter(node => node.type === 'Markdown')
    .map(node => String(node.props.text))

const done = (zh: string): WwePara => ({ status: 'done', zh, error: null, shown: true })

/** A plan's list of 300 files, the translation's `restore` having put each path back: over 20,000 characters */
const LONG_LIST = Array.from({ length: 300 }, (_, i) => `${i + 1}. \`packages/app/src/features/module-${i}/components/index.tsx\`：改导入`).join('\n')
const words = (text: string) => text.replace(/\s+/g, ' ').trim()

describe('a translation longer than one Markdown takes (2.1.288)', () => {
  test('a short one is one Markdown, as it was', () => {
    expect(markdownPieces('我找到原因了。')).toEqual(['我找到原因了。'])
  })

  test('a long list is cut between its lines into Markdown of 10,000 characters at most, nothing lost', () => {
    expect(LONG_LIST.length).toBeGreaterThan(2 * MARKDOWN_MAX)
    const pieces = markdownPieces(LONG_LIST)
    expect(pieces.length).toBe(3)
    for (const piece of pieces) {
      expect(piece.length <= MARKDOWN_MAX).toBe(true)
    }
    expect(pieces.join('\n')).toBe(LONG_LIST)
  })

  test('paragraphs are kept whole where they fit, the cut after a blank line', () => {
    const a = `A${'甲'.repeat(6000)}`
    const b = `B${'乙'.repeat(6000)}`
    expect(markdownPieces(`${a}\n\n${b}`)).toEqual([a, b])
  })

  test('code cut in two is closed and opened again, so both halves stay code', () => {
    const code = Array.from({ length: 500 }, (_, i) => `    const value${i} = read(${i}) // 第 ${i} 行`).join('\n')
    const text = `步骤：\n\n   \`\`\`ts\n${code}\n   \`\`\`\n\n完成。`
    const pieces = markdownPieces(text)
    expect(pieces.length).toBeGreaterThan(1)
    for (const piece of pieces) {
      expect(piece.length <= MARKDOWN_MAX).toBe(true)
      // Every piece closes the code it opens
      expect((piece.match(/^ *```/gm) ?? []).length % 2).toBe(0)
    }
    expect(words(pieces.join('\n')).replace(/ ``` ```ts/g, '')).toBe(words(text))
  })

  test('one line longer than a Markdown takes goes in slices', () => {
    const line = '长'.repeat(25_000)
    const pieces = markdownPieces(line)
    expect(pieces.map(piece => piece.length <= MARKDOWN_MAX)).toEqual([true, true, true])
    expect(pieces.join('')).toBe(line)
  })

  test('the plan’s translation under it: in pieces, all of it', () => {
    const [block] = segment('1. a\n2. b')
    if (!block) {
      throw new Error('no block')
    }
    const drawn = { type: 'Text', props: {}, children: ['plan'] } as unknown as Parameters<typeof planView>[3]
    const texts = markdownsOf(planView(UI, [block], [done(LONG_LIST)], drawn))
    expect(texts.length).toBe(3)
    expect(texts.every(text => text.length <= MARKDOWN_MAX)).toBe(true)
    expect(texts.join('\n')).toBe(LONG_LIST)
  })

  test('a reply paragraph’s translation under it: in pieces, not cut at 10,000', () => {
    const [block] = segment('1. a\n2. b')
    if (!block) {
      throw new Error('no block')
    }
    const part: ReplyPart = {
      drawn: { type: 'Text', props: {}, children: ['reply'] } as unknown as ReplyPart['drawn'],
      block,
      para: done(LONG_LIST),
      hasButtons: true,
    }
    const texts = markdownsOf(replyView(UI, [part], { toggle: () => undefined, speak: () => undefined, analyse: () => undefined }))
    expect(texts.every(text => text.length <= MARKDOWN_MAX)).toBe(true)
    expect(texts.join('\n')).toBe(LONG_LIST)
  })
})
