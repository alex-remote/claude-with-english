import { describe, expect, test } from 'claude-code/testing'

import { segment } from '../../hooks/core/text/segment'
import { askLines, askRows, askShown, planOf, planView } from '../../hooks/features/reply/planAsk'
import { MARKDOWN_MAX, markdownPieces, replyView, wholeToggle, withTranslations } from '../../hooks/features/reply/view'
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

  // 2.1.304: at most 12 rows above the dialog in the terminal, 48 on the desktop, at 40 columns
  const done = (zh: string): WwePara => ({ status: 'done', zh, error: null, shown: true })
  const fourOptions = askLines([
    {
      question: 'Which way should the cache be cleared when the user signs out?',
      options: [1, 2, 3, 4].map(n => ({ label: `Option ${n}`, description: `What option ${n} does, said in full` })),
    },
  ])
  const longZh = '用户退出登录时，缓存应该怎样清除？这一句译文比较长，要占两行。'
  const parasOf = (lines: typeof fourOptions) => lines.map(line => done(line.isOption ? (line.number > 0 ? '选项' : longZh) : longZh))

  test('every line fits on the desktop', () => {
    expect(askShown(fourOptions, parasOf(fourOptions), askRows('desktop'))).toHaveLength(fourOptions.length)
  })

  test('the terminal leaves out the options’ descriptions when all would not fit', () => {
    const shown = askShown(fourOptions, parasOf(fourOptions), askRows('terminal'))
    expect(shown.map(i => fourOptions[i]?.text)).toEqual([fourOptions[0]?.text, 'Option 1', 'Option 2', 'Option 3', 'Option 4'])
  })

  test('a question too long for the rows keeps what fits from the top, and none when nothing does', () => {
    const many = Array.from({ length: 8 }, (_, n) => ({ text: `Question ${n}?`, isOption: false, number: 0 }))
    expect(askShown(many, many.map(() => done(longZh)), askRows('terminal'))).toEqual([0, 1, 2, 3, 4])
    expect(askShown(many, many.map(() => done(longZh)), 2)).toEqual([])
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

// The desktop app draws one Claude Code drawing per reply block (实测 10-22):
// each translation goes into the block's text as a quote after its paragraph.
describe('a reply on the desktop (F6)', () => {
  const blocks = segment('First paragraph.\n\n- one\n- two\n\nLast paragraph.')
  const shownZh = (zh: string): WwePara => ({ status: 'done', zh, error: null, shown: true })
  const none: WwePara = { status: 'none', zh: null, error: null, shown: true }

  test('each shown translation is quoted after its own paragraph, every line of it', () => {
    expect(withTranslations(blocks, [shownZh('第一段。'), shownZh('- 一\n- 二'), none])).toBe(
      'First paragraph.\n\n> 第一段。\n\n- one\n- two\n\n> - 一\n> - 二\n\nLast paragraph.',
    )
  })

  test('翻译中… and the reason a translation failed stand where it would', () => {
    const pending: WwePara = { status: 'pending', zh: null, error: null, shown: true }
    const failed: WwePara = { status: 'failed', zh: null, error: '译文暂不可用：超时', shown: true }
    expect(withTranslations(blocks, [pending, failed, none])).toBe(
      'First paragraph.\n\n> 翻译中…\n\n- one\n- two\n\n> 译文暂不可用：超时\n\nLast paragraph.',
    )
  })

  test('nothing shown leaves the text to Claude Code as it was', () => {
    expect(withTranslations(blocks, [none, { ...shownZh('二'), shown: false }, none])).toBeNull()
  })

  test('the block’s one button: 翻译 until every paragraph shows, then 收起译文; 翻译中… while one is asked', () => {
    expect(wholeToggle([])).toBeNull()
    expect(wholeToggle([none, shownZh('二')])).toEqual({ label: '翻译', toShow: true })
    expect(wholeToggle([shownZh('一'), shownZh('二')])).toEqual({ label: '收起译文', toShow: false })
    expect(wholeToggle([{ ...none, status: 'pending' }, shownZh('二')])).toEqual({ label: '翻译中…', toShow: true })
  })
})
