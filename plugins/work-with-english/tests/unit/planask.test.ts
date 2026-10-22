import { describe, expect, test } from 'claude-code/testing'

import { segment } from '../../hooks/core/text/segment'
import { askFitted, askLines, askView, planOf, planView } from '../../hooks/features/reply/planAsk'
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

  // The summary card's form (features/env/nextStep), within 2.1.304's rows above the dialog:
  // at most 12 in the terminal, 48 on the desktop, at 40 columns
  const done = (zh: string): WwePara => ({ status: 'done', zh, error: null, shown: true })
  const longZh = '用户退出登录时，缓存应该怎样清除？这一句译文比较长，要占两行。'
  const longDesc = longZh + longZh
  const fourOptions = askLines([
    {
      question: 'Which way should the cache be cleared when the user signs out?',
      options: [1, 2, 3, 4].map(n => ({ label: `Option ${n}`, description: `What option ${n} does, said in full` })),
    },
  ])
  const parasOf = (lines: typeof fourOptions) => lines.map(line => done(line.isOption ? (line.number > 0 ? '选项' : longDesc) : longZh))

  test('问题 and each option under its number in the dialog, its description after ：, all of it on the desktop', () => {
    expect(askFitted(fourOptions, parasOf(fourOptions), 'desktop')).toEqual([
      [`问题：${longZh}`, ...[1, 2, 3, 4].map(n => `${n}. 选项：${longDesc}`)],
    ])
  })

  test('the terminal leaves out the options’ descriptions when all would not fit', () => {
    expect(askFitted(fourOptions, parasOf(fourOptions), 'terminal')).toEqual([[`问题：${longZh}`, '1. 选项', '2. 选项', '3. 选项', '4. 选项']])
  })

  test('questions too many for the rows keep what fits from the top; one too tall alone, or none translated, draws nothing', () => {
    const many = Array.from({ length: 8 }, (_, n) => ({ text: `Question ${n}?`, isOption: false, number: 0 }))
    expect(askFitted(many, many.map(() => done(longZh)), 'terminal')).toHaveLength(5)
    const tall = [{ text: 'Why?', isOption: false, number: 0 }]
    expect(askFitted(tall, [done(longZh.repeat(10))], 'terminal')).toEqual([])
    expect(askFitted(fourOptions, fourOptions.map(() => ({ status: 'none', zh: null, error: null, shown: false })), 'desktop')).toEqual([])
  })

  test('a line not translated yet reads as 翻译中… or as its own words', () => {
    const paras = parasOf(fourOptions).map((para, i) => (i === 0 ? { ...para, status: 'pending' as const, zh: null } : i === 1 ? { ...para, status: 'none' as const, zh: null } : para))
    expect(askFitted(fourOptions, paras, 'desktop')[0]?.slice(0, 2)).toEqual(['问题：翻译中…', `1. Option 1：${longDesc}`])
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

describe('the question dialog’s translation, as the summary card’s', () => {
  const lines = askLines([{ question: 'Which budget?', options: [{ label: 'large', description: 'Matches the defaults' }, { label: 'small' }] }])
  const zh = ['用哪种预算？', '大', '与默认设置一致', '小'].map((text): WwePara => ({ status: 'done', zh: text, error: null, shown: true }))
  const drawn = { type: 'Text', props: {}, children: ['the dialog'] } as unknown as Parameters<typeof askView>[3]

  test('the desktop: a rule and a quote above the dialog, a blank row before the options', () => {
    const tree = askView(UI, lines, zh, drawn, 'desktop') as unknown as Node
    expect(all(tree).find(node => node.type === 'Markdown')?.props.text).toBe('---\n\n> 问题：用哪种预算？\n>\n> 1. 大：与默认设置一致\n> 2. 小')
  })

  test('a dialog that asks several questions numbers them: 问题 1/2, 问题 2/2', () => {
    const two = askLines([
      { question: 'Which budget?', options: [{ label: 'large' }] },
      { question: 'Accept task?', options: [{ label: 'yes' }] },
    ])
    const zhTwo = ['用哪种预算？', '大', '接受 task 吗？', '接受'].map((text): WwePara => ({ status: 'done', zh: text, error: null, shown: true }))
    expect(askFitted(two, zhTwo, 'desktop')).toEqual([
      ['问题 1/2：用哪种预算？', '1. 大'],
      ['问题 2/2：接受 task 吗？', '1. 接受'],
    ])
  })

  test('the desktop gives a dialog of several questions a tab each, under the rule, and the chosen one’s translation alone', () => {
    const two = askLines([
      { question: 'Which budget?', options: [{ label: 'large', description: 'Matches the defaults' }] },
      { question: 'Accept task?', options: [{ label: 'yes' }] },
    ])
    const zhTwo = ['用哪种预算？', '大', '与默认设置一致', '接受 task 吗？', '接受'].map((text): WwePara => ({ status: 'done', zh: text, error: null, shown: true }))
    const chosen: number[] = []
    const tabsOf = (index: number) => ({ index, select: (k: number) => void chosen.push(k) })

    const first = askView(UI, two, zhTwo, drawn, 'desktop', tabsOf(0)) as unknown as Node
    // The tab names the question: no 问题： before it
    expect(markdownsOf(first)).toEqual(['---', '> 用哪种预算？\n>\n> 1. 大：与默认设置一致'])
    const buttons = all(first).filter(node => node.type === 'Button')
    expect(buttons.map(node => [node.props.label, node.props.variant ?? 'plain'])).toEqual([
      ['问题 1', 'primary'],
      ['问题 2', 'plain'],
    ])
    ;(buttons[1]?.props.onPress as () => void)()
    expect(chosen).toEqual([1])
    expect(all(first).at(-1)?.children).toEqual(['the dialog'])

    const second = askView(UI, two, zhTwo, drawn, 'desktop', tabsOf(1)) as unknown as Node
    expect(markdownsOf(second)[1]).toBe('> 接受 task 吗？\n>\n> 1. 接受')
    // A tab past the last, from a dialog asked again with fewer questions, shows the last
    expect(markdownsOf(askView(UI, two, zhTwo, drawn, 'desktop', tabsOf(5)) as unknown as Node)[1]).toBe('> 接受 task 吗？\n>\n> 1. 接受')

    // One question, or the terminal, draws as before: no tabs
    expect(all(askView(UI, lines, zh, drawn, 'desktop', tabsOf(0)) as unknown as Node).some(node => node.type === 'Button')).toBe(false)
    const terminal = askView(UI, two, zhTwo, drawn, 'terminal', tabsOf(1)) as unknown as Node
    expect(all(terminal).some(node => node.type === 'Button')).toBe(false)
    expect(all(terminal).filter(node => node.type === 'Text' && node.props.dimColor === true).map(node => node.children.join(''))).toEqual([
      '问题 1/2：用哪种预算？',
      '1. 大：与默认设置一致',
      '问题 2/2：接受 task 吗？',
      '1. 接受',
    ])
  })

  test('the terminal: the same rows in grey, with no Markdown', () => {
    const tree = askView(UI, lines, zh, drawn, 'terminal') as unknown as Node
    expect(all(tree).some(node => node.type === 'Markdown')).toBe(false)
    expect(all(tree).filter(node => node.type === 'Text' && node.props.dimColor === true).map(node => node.children.join(''))).toEqual([
      '问题：用哪种预算？',
      '1. 大：与默认设置一致',
      '2. 小',
    ])
  })
})
