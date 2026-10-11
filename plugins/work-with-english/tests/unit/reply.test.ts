import type { Args } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_VIEW } from '../../hooks/core/settings/schema'
import { NO_PARA } from '../../hooks/core/state/defaults'
import { segment } from '../../hooks/core/text/segment'
import { createReplies } from '../../hooks/features/reply/controller'
import { replyView } from '../../hooks/features/reply/view'
import type { ReplyPart, ReplyUi } from '../../hooks/features/reply/view'
import type { WwePara, WweSettingsView } from '../../types'
import { fakeHost } from '../support/anki'

// F6 › 一轮做完再翻 over the shared test Host, its model answering only when
// the test says, as a real one takes a second or more for each reply: what
// is under each reply while the turn's requests are out, one after another.

const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const REPLIES = [
  'Let me check how the config is loaded.',
  'The loader reads the file twice.',
  'I found the cause. Want me to fix it?',
] as const

function world(settings: WweSettingsView = DEFAULT_VIEW) {
  const fake = fakeHost()
  const paras = new Map<string, WwePara>()
  const out: { system: string; prompt: string; answer: (text: string) => void }[] = []
  const host = fake.host as unknown as Record<string, any>
  host.state = {
    para: {
      get: async (id: string) => paras.get(id) ?? NO_PARA,
      update: async (id: string, fn: (value: WwePara) => WwePara) => {
        const value = fn(paras.get(id) ?? NO_PARA)
        paras.set(id, value)
        return value
      },
    },
    settings: { get: async () => settings },
  }
  host.model.complete = (request: { system: string; prompt: string }) =>
    new Promise(resolve => {
      out.push({ ...request, answer: text => resolve({ isAnswered: true, text, usage: USAGE }) })
    })
  const replies = createReplies(fake.host)
  const statusOf = (text: string) => segment(text).map(block => (paras.get(block.hash) ?? NO_PARA).status)
  return { replies, paras, out, statusOf }
}

const flush = async () => {
  for (let i = 0; i < 50; i += 1) {
    await Promise.resolve()
  }
}

const appended = (text: string) =>
  ({
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
    door: 'response',
    origin: { kind: 'model', model: 'claude-test' },
    uuid: text,
  }) as unknown as Args<'session.append'>

const turnEnd = { turnId: 't1', answer: '', durationMs: 1000, isAborted: false, reason: 'answer' } as unknown as Args<'turn.complete'>

// The drawing as data, as tests/ui/wordbook.test.ts draws it
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
const textOf = (node: Node | string): string => (typeof node === 'string' ? node : node.children.map(textOf).join(''))
const all = (node: Node, out: Node[] = []): Node[] => {
  out.push(node)
  node.children.forEach(child => typeof child !== 'string' && all(child, out))
  return out
}

/** The reply as AssistantMessage draws it now: the grey line under each paragraph */
function underLines(w: ReturnType<typeof world>, text: string): string[] {
  const parts: ReplyPart[] = segment(text).map(block => ({
    drawn: { type: 'Text', props: {}, children: [block.text] } as unknown as ReplyPart['drawn'],
    block,
    para: w.paras.get(block.hash) ?? NO_PARA,
    hasButtons: true,
  }))
  const tree = replyView(UI, parts, { toggle: () => undefined, speak: () => undefined, analyse: () => undefined }) as unknown as Node
  return all(tree)
    .filter(node => node.type === 'Text' && node.props.dimColor === true)
    .map(textOf)
}

describe('F6 › 一轮做完再翻', () => {
  test('at the turn’s end every reply to translate says 翻译中… at once, while only the last is asked', async () => {
    const w = world()
    for (const text of REPLIES) {
      w.replies.onAppend(appended(text))
    }
    w.replies.onTurnComplete(turnEnd)
    await flush()

    // One request out, for the last reply; the model has not answered it yet
    expect(w.out.length).toBe(1)
    expect(w.out[0]?.prompt).toContain('I found the cause.')
    for (const text of REPLIES) {
      expect(w.statusOf(text)).toEqual(['pending'])
      expect(underLines(w, text)).toEqual(['翻译中…'])
    }

    // Each comes in as its request answers, the last first
    w.out[0]?.answer(JSON.stringify(['我找到原因了。要我修吗？']))
    await flush()
    expect(w.statusOf(REPLIES[2])).toEqual(['done'])
    expect(w.statusOf(REPLIES[0])).toEqual(['pending'])
    expect(w.out.length).toBe(2)
    expect(w.out[1]?.prompt).toContain('The loader reads the file twice.')
    w.out[1]?.answer(JSON.stringify(['加载器把文件读了两次。']))
    await flush()
    w.out[2]?.answer(JSON.stringify(['我来看看配置是怎么加载的。']))
    await flush()
    for (const text of REPLIES) {
      expect(w.statusOf(text)).toEqual(['done'])
    }
    expect(w.out.length).toBe(3)
  })

  test('翻译 on a reply still waiting its turn asks for it at once, and the turn does not ask for it again', async () => {
    const w = world()
    for (const text of REPLIES) {
      w.replies.onAppend(appended(text))
    }
    w.replies.onTurnComplete(turnEnd)
    await flush()
    const [first] = segment(REPLIES[0])
    if (!first) {
      throw new Error('no block')
    }
    void w.replies.toggle(first)
    await flush()
    expect(w.out.length).toBe(2)
    expect(w.out[1]?.prompt).toContain('Let me check how the config is loaded.')
    w.out[1]?.answer('我来看看配置是怎么加载的。')
    await flush()
    expect(w.statusOf(REPLIES[0])).toEqual(['done'])

    w.out[0]?.answer(JSON.stringify(['我找到原因了。要我修吗？']))
    await flush()
    w.out[2]?.answer(JSON.stringify(['加载器把文件读了两次。']))
    await flush()
    expect(w.out.length).toBe(3)
    expect(w.statusOf(REPLIES[0])).toEqual(['done'])
  })

  test('每轮最后 1 条: only the last says 翻译中…; the others stay as they are, waiting for 翻译', async () => {
    const w = world({ ...DEFAULT_VIEW, autoReply: 'last', autoReplyCount: 1 })
    for (const text of REPLIES) {
      w.replies.onAppend(appended(text))
    }
    w.replies.onTurnComplete(turnEnd)
    await flush()
    expect(w.out.length).toBe(1)
    expect(w.statusOf(REPLIES[2])).toEqual(['pending'])
    expect(w.statusOf(REPLIES[0])).toEqual(['none'])
    expect(underLines(w, REPLIES[0])).toEqual([])
  })
})
