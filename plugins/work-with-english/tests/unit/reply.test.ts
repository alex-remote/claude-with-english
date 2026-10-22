import type { Args } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_VIEW } from '../../hooks/core/settings/schema'
import { NO_PARA } from '../../hooks/core/state/defaults'
import { segment } from '../../hooks/core/text/segment'
import { createReplies } from '../../hooks/features/reply/controller'
import { replyView } from '../../hooks/features/reply/view'
import type { ReplyPart, ReplyUi } from '../../hooks/features/reply/view'
import type { WweAsking, WwePara, WweSettingsView } from '../../types'
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

function world(settings: WweSettingsView = DEFAULT_VIEW, store: Record<string, unknown> = {}) {
  const fake = fakeHost({ store })
  const paras = new Map<string, WwePara>()
  let asking: WweAsking = { blocks: [] }
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
    asking: {
      get: async () => asking,
      update: async (fn: (value: WweAsking) => WweAsking) => (asking = fn(asking)),
    },
  }
  host.model.complete = (request: { system: string; prompt: string }) =>
    new Promise(resolve => {
      out.push({ ...request, answer: text => resolve({ isAnswered: true, text, usage: USAGE }) })
    })
  const replies = createReplies(fake.host)
  /** The module loaded again, as an update or a reload does: its own memory gone, $.state kept */
  const reload = () => createReplies(fake.host)
  const statusOf = (text: string) => segment(text).map(block => (paras.get(block.hash) ?? NO_PARA).status)
  return { replies, paras, out, statusOf, reload, files: fake.files }
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

const thought = (text: string) =>
  ({
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'thinking', thinking: text, signature: 'sig' }] },
    door: 'response',
    origin: { kind: 'model', model: 'claude-test' },
    uuid: `thinking-${text}`,
  }) as unknown as Args<'session.append'>

describe('F6 › a reload while translating (an update, the desktop reloading a session not on screen)', () => {
  test('the module loaded again asks again for what its predecessor left at 翻译中…, without being drawn', async () => {
    const w = world()
    w.replies.onAppend(appended(REPLIES[0]))
    await flush()
    expect(w.out.length).toBe(1)
    expect(w.statusOf(REPLIES[0])).toEqual(['pending'])

    // Its request died with it; $.state still says 翻译中…
    const next = w.reload()
    await next.resume()
    await flush()
    expect(w.out.length).toBe(2)
    w.out[1]?.answer('我来看看配置是怎么加载的。')
    await flush()
    expect(w.statusOf(REPLIES[0])).toEqual(['done'])

    // Loaded once more with nothing left waiting: nothing asked
    await w.reload().resume()
    await flush()
    expect(w.out.length).toBe(2)
  })
})

describe('F6 › narration (the desktop draws thinking text as a reply block)', () => {
  test('a thinking block is translated once drawn as a reply block, in either order; one never drawn costs nothing', async () => {
    const w = world()
    w.replies.onAppend(thought('Let me check the loader first.'))
    await flush()
    expect(w.out.length).toBe(0)
    w.replies.onDrawn('Let me check the loader first.')
    await flush()
    expect(w.out.length).toBe(1)
    expect(w.out[0]?.prompt).toContain('Let me check the loader first.')

    // Drawn before its thinking block came
    w.replies.onDrawn('Then I will read the config.')
    w.replies.onAppend(thought('Then I will read the config.'))
    await flush()
    expect(w.out.length).toBe(2)

    // Hidden thinking, never drawn: nothing asked
    w.replies.onAppend(thought('Some private reasoning.'))
    await flush()
    expect(w.out.length).toBe(2)
  })
})

describe('F6 › 翻译中… left behind', () => {
  test('one a module cut off mid-request left is asked again; one this module is asking is left alone', async () => {
    const w = world()
    const [first] = segment(REPLIES[0])
    if (!first) {
      throw new Error('no block')
    }
    // $.state outlives the module: a reload kept the 翻译中… of a request that died with it
    w.paras.set(first.hash, { status: 'pending', zh: null, error: null, shown: true })
    w.replies.noteStale(first)
    await w.replies.loadNoted()
    await flush()
    expect(w.out.length).toBe(1)
    expect(w.out[0]?.prompt).toContain('Let me check how the config is loaded.')
    w.out[0]?.answer(JSON.stringify(['我来看看配置是怎么加载的。']))
    await flush()
    expect(w.statusOf(REPLIES[0])).toEqual(['done'])

    // Written and asked for here: drawn as 翻译中… while its request is out, not asked twice
    w.replies.onAppend(appended(REPLIES[1]))
    await flush()
    expect(w.out.length).toBe(2)
    const [second] = segment(REPLIES[1])
    if (!second) {
      throw new Error('no block')
    }
    w.replies.noteStale(second)
    await w.replies.loadNoted()
    await flush()
    expect(w.out.length).toBe(2)
  })
})

describe('F6 › 翻译时机', () => {
  // 全部 with 每轮做完后: every reply, at the turn's end, as before 0.1.3
  const TURN_END = { ...DEFAULT_VIEW, autoReplyWhen: 'turnEnd' } as const

  test('全部: each reply is asked for as soon as it is written; the turn’s end asks for none again', async () => {
    const w = world()
    w.replies.onAppend(appended(REPLIES[0]))
    await flush()
    expect(w.out.length).toBe(1)
    expect(w.out[0]?.prompt).toContain('Let me check how the config is loaded.')
    expect(w.statusOf(REPLIES[0])).toEqual(['pending'])
    w.replies.onAppend(appended(REPLIES[1]))
    await flush()
    expect(w.out.length).toBe(2)
    w.out[0]?.answer('我来看看配置是怎么加载的。')
    await flush()
    expect(w.statusOf(REPLIES[0])).toEqual(['done'])

    w.replies.onAppend(appended(REPLIES[2]))
    w.replies.onTurnComplete(turnEnd)
    await flush()
    expect(w.out.length).toBe(3)
    w.out[1]?.answer('加载器把文件读了两次。')
    w.out[2]?.answer('我找到原因了。要我修吗？')
    await flush()
    for (const text of REPLIES) {
      expect(w.statusOf(text)).toEqual(['done'])
    }
    expect(w.out.length).toBe(3)
  })

  test('附带前一段: a paragraph goes with the one before it; turned off, alone', async () => {
    const twoParas = 'The loader reads the file twice.\n\nSo the second read wins.'
    const on = world()
    on.replies.onAppend(appended(twoParas))
    await flush()
    expect(on.out.map(request => request.prompt.includes('<before>'))).toEqual([false, true])
    expect(on.out[1]?.prompt).toContain('<before>\nThe loader reads the file twice.\n</before>')

    const off = world({ ...DEFAULT_VIEW, replyContext: false })
    off.replies.onAppend(appended(twoParas))
    await flush()
    expect(off.out.map(request => request.prompt.includes('<before>'))).toEqual([false, false])
  })

  test('每轮做完后: nothing is asked while the turn goes on', async () => {
    const w = world(TURN_END)
    for (const text of REPLIES) {
      w.replies.onAppend(appended(text))
    }
    await flush()
    expect(w.out.length).toBe(0)
  })

  test('at the turn’s end every reply says 翻译中… and is asked at once, the last first', async () => {
    const w = world(TURN_END)
    for (const text of REPLIES) {
      w.replies.onAppend(appended(text))
    }
    w.replies.onTurnComplete(turnEnd)
    await flush()

    // Every request out, the last reply's first; the model has not answered yet
    expect(w.out.length).toBe(3)
    expect(w.out[0]?.prompt).toContain('I found the cause.')
    expect(w.out[2]?.prompt).toContain('Let me check how the config is loaded.')
    for (const text of REPLIES) {
      expect(w.statusOf(text)).toEqual(['pending'])
      expect(underLines(w, text)).toEqual(['翻译中…'])
    }

    // Each comes in as its own request answers
    w.out[0]?.answer('我找到原因了。要我修吗？')
    await flush()
    expect(w.statusOf(REPLIES[2])).toEqual(['done'])
    expect(w.statusOf(REPLIES[0])).toEqual(['pending'])
    w.out[1]?.answer('加载器把文件读了两次。')
    w.out[2]?.answer('我来看看配置是怎么加载的。')
    await flush()
    for (const text of REPLIES) {
      expect(w.statusOf(text)).toEqual(['done'])
    }
    expect(w.out.length).toBe(3)
  })

  test('同时翻译的请求数 1: one request at a time, the last reply first; 翻译 on one waiting asks nothing more', async () => {
    const w = world(TURN_END, { 'settings/translateConcurrency': 1 })
    for (const text of REPLIES) {
      w.replies.onAppend(appended(text))
    }
    w.replies.onTurnComplete(turnEnd)
    await flush()
    expect(w.out.length).toBe(1)
    expect(w.out[0]?.prompt).toContain('I found the cause.')
    const [first] = segment(REPLIES[0])
    if (!first) {
      throw new Error('no block')
    }
    // Its request waits for a slot: 翻译中… already, so the button sends nothing
    void w.replies.toggle(first)
    await flush()
    expect(w.out.length).toBe(1)

    w.out[0]?.answer('我找到原因了。要我修吗？')
    await flush()
    expect(w.out.length).toBe(2)
    expect(w.out[1]?.prompt).toContain('The loader reads the file twice.')
    w.out[1]?.answer('加载器把文件读了两次。')
    await flush()
    w.out[2]?.answer('我来看看配置是怎么加载的。')
    await flush()
    expect(w.out.length).toBe(3)
    for (const text of REPLIES) {
      expect(w.statusOf(text)).toEqual(['done'])
    }
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
