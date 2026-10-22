import type { Args } from 'claude-code'

import { hash } from '../../core/hash'
import { countEnWords, mainLang } from '../../core/text/lang'
import { protect, restore } from '../../core/text/protect'
import { needsTranslation, segment } from '../../core/text/segment'
import type { Block } from '../../core/text/segment'
import { localDate } from '../../core/time'
import { dataDirOf } from '../../services/datadir'
import { readJson, writeJson } from '../../services/files'
import { run } from '../../services/translate'
import type { Host } from '../../host'
import { addToDay } from '../stats/record'
import { stepBlock } from '../tasks/plan'
import { askLines, blockOfLine, planOf } from './planAsk'

// F6 回复译文: collects the main conversation's reply blocks as they are
// appended. With 全部 each is translated as soon as it is written (翻译时机
// 每条写完后, the default); otherwise they wait for the turn's end (or a stop
// for a question or a plan), which also asks again for any that failed. A translation is
// kept per paragraph, by the hash of its text, in $.state for the drawing
// and in a file of the data directory, so /resume shows it again without
// asking (译文存在本机，不进 Claude 的上下文).

/** 译文暂不可用：<原因> */
export const unavailable = (reason: string) => `译文暂不可用：${reason}`

const cacheFileOf = (dataDir: string, paraHash: string) => `${dataDir}/replies/${paraHash.slice(0, 2)}/${paraHash}.json`

type ReplyBlock = { text: string; blocks: Block[] }

/** What is translated: a paragraph in the target language, never code */
export const translatable = (block: Block) => needsTranslation(block) && mainLang(block.text) === 'en'

export type Replies = ReturnType<typeof createReplies>

export function createReplies(host: Host) {
  /** The reply blocks of the stretch of the turn not handled yet */
  let pending: ReplyBlock[] = []
  /** Paragraphs whose cache was looked for in this session */
  const looked = new Set<string>()
  const toLoad = new Set<string>()
  /** Paragraphs a turn's end showed 翻译中… under, waiting for their reply's request */
  const queued = new Set<string>()
  /** Paragraphs whose request is on its way */
  const inFlight = new Set<string>()
  /**
   * Thinking blocks with text, by the hash of it: the desktop draws its
   * narration, the text Claude writes between calls, as a reply block. One is
   * translated only once drawn, so thinking a surface never draws costs nothing.
   */
  const narration = new Map<string, ReplyBlock>()
  /** Reply blocks drawn before their thinking block came: the order the desktop may take */
  const drawnFirst = new Set<string>()

  /** A narration block from now on a reply like any other */
  function promote(reply: ReplyBlock) {
    pending.push(reply)
    void translateWritten(reply).catch(error => host.ui.debug(`narration written: ${String(error)}`))
  }
  /**
   * Paragraphs drawn as 翻译中… that no request of this module is on: the
   * module before it was cut off mid-request (a reload, an update), and
   * $.state kept its 翻译中…. Asked again from the timer, the cache first.
   */
  const stale = new Map<string, Block>()
  const isAsking = (paraHash: string) => inFlight.has(paraHash) || queued.has(paraHash)

  const today = async () => {
    const ms = await host.clock.now()
    return localDate(ms, -new Date(ms).getTimezoneOffset())
  }

  async function keep(paraHash: string, zh: string) {
    await writeJson(host, cacheFileOf(await dataDirOf(host), paraHash), { v: 1, zh })
  }

  /**
   * Asks for the paragraphs of one block not translated yet: a reply's or a
   * plan's each in a request of its own, all at once (`perParagraph`); short
   * lines (a question's, a task list's, a card's) together in one request.
   */
  async function translateBlock(reply: ReplyBlock, isAutomatic: boolean, perParagraph = false) {
    const todo = reply.blocks.filter(translatable)
    const missing: Block[] = []
    for (const block of todo) {
      // Pending since the turn's end and not asked yet: its turn now
      const isQueued = queued.delete(block.hash)
      const now = await host.state.para.get(block.hash)
      if (now.status === 'done' || (now.status === 'pending' && !isQueued)) {
        continue
      }
      missing.push(block)
    }
    // Asked already, by the reply as written or by the turn's end: one request per paragraph
    const asking = missing.filter(block => !inFlight.has(block.hash))
    if (asking.length === 0) {
      return
    }
    for (const block of asking) {
      inFlight.add(block.hash)
    }
    try {
      await (perParagraph ? askEach(asking, reply.blocks) : askFor(asking, isAutomatic))
    } finally {
      for (const block of asking) {
        inFlight.delete(block.hash)
      }
    }
  }

  /** The paragraphs' translations, in one request, into $.state and the cache */
  async function askFor(missing: readonly Block[], isAutomatic: boolean) {
    for (const block of missing) {
      await host.state.para.update(block.hash, para => ({ ...para, status: 'pending', error: null, shown: true }))
    }
    const shielded = missing.map(block => protect(block.text))
    const result = await run(host, { kind: 'replyBlock', paras: shielded.map(s => s.masked) })
    for (const [i, block] of missing.entries()) {
      if (result.ok) {
        const zh = restore(result.value[i] ?? '', shielded[i]?.tokens ?? [])
        await host.state.para.update(block.hash, () => ({ status: 'done', zh, error: null, shown: true }))
        await keep(block.hash, zh).catch(error => host.ui.debug(`reply cache: ${String(error)}`))
      } else {
        await host.state.para.update(block.hash, para => ({
          ...para,
          status: 'failed',
          error: unavailable(result.reason),
          shown: true,
        }))
      }
    }
    if (!result.ok && !isAutomatic) {
      host.ui.debug(`reply translation: ${result.kind}`)
    }
  }

  /** The longest paragraph before that goes with a request as context */
  const BEFORE_MAX = 2000

  /**
   * Each paragraph in a request of its own, all sent at once (同时翻译的请求数
   * caps how many are out), each shown as its translation comes; with 附带前一段
   * the paragraph before it in its block goes along, for consistent terms.
   */
  async function askEach(missing: readonly Block[], blocks: readonly Block[]) {
    const { replyContext } = await host.state.settings.get()
    for (const block of missing) {
      await host.state.para.update(block.hash, para => ({ ...para, status: 'pending', error: null, shown: true }))
    }
    await Promise.all(
      missing.map(async block => {
        const at = blocks.findIndex(other => other.hash === block.hash)
        const before = replyContext && at > 0 ? (blocks[at - 1]?.text.slice(0, BEFORE_MAX) ?? null) : null
        const shielded = protect(block.text)
        const result = await run(host, { kind: 'replyPara', text: shielded.masked, before })
        if (result.ok) {
          const zh = restore(result.value, shielded.tokens)
          await host.state.para.update(block.hash, () => ({ status: 'done', zh, error: null, shown: true }))
          await keep(block.hash, zh).catch(error => host.ui.debug(`reply cache: ${String(error)}`))
        } else {
          await host.state.para.update(block.hash, para => ({ ...para, status: 'failed', error: unavailable(result.reason), shown: true }))
        }
      }),
    )
  }

  /** 全部 with 每条写完后: a reply block translated as soon as it is written, without waiting for the turn's end */
  async function translateWritten(reply: ReplyBlock) {
    const settings = await host.state.settings.get()
    if (settings.readingMode === 'paragraph' && settings.autoReply === 'all' && settings.autoReplyWhen === 'written') {
      await translateBlock(reply, true, true)
    }
  }

  /** The stale 翻译中… paragraphs: from the cache when kept there, else asked again */
  async function askStale() {
    if (stale.size === 0) {
      return
    }
    const blocks = [...stale.values()]
    stale.clear()
    const dataDir = await dataDirOf(host)
    for (const block of blocks) {
      if (isAsking(block.hash) || (await host.state.para.get(block.hash)).status !== 'pending') {
        continue
      }
      const kept = await readJson(host, cacheFileOf(dataDir, block.hash))
      const zh = typeof kept === 'object' && kept !== null ? (kept as { zh?: unknown }).zh : undefined
      if (typeof zh === 'string') {
        await host.state.para.update(block.hash, para => ({ ...para, status: 'done', zh, error: null }))
        continue
      }
      // Its turn now, as a paragraph the turn's end marked
      queued.add(block.hash)
      void translateBlock({ text: block.text, blocks: [block] }, true, true).catch(error => host.ui.debug(`reply stale: ${String(error)}`))
    }
  }

  /** The end of a stretch of the turn: count the English words, translate as the settings say. */
  async function finish() {
    const stretch = pending
    pending = []
    if (stretch.length === 0) {
      return
    }
    // F13 › 英文回复: the words of replies written in the target language, code left out
    const words = stretch
      .flatMap(reply => reply.blocks)
      .filter(block => block.kind !== 'code' && mainLang(block.text) === 'en')
      .reduce((sum, block) => sum + countEnWords(block.text), 0)
    if (words > 0) {
      await addToDay(host, await today(), { words }).catch(error => host.ui.debug(`reply words: ${String(error)}`))
    }

    const settings = await host.state.settings.get()
    if (settings.readingMode !== 'paragraph' || settings.autoReply === 'off') {
      return
    }
    const chosen = settings.autoReply === 'last' ? stretch.slice(-settings.autoReplyCount) : stretch
    // At the turn's end every reply still to translate says 翻译中… at once, not only the one asked
    for (const block of chosen.flatMap(reply => reply.blocks).filter(translatable)) {
      let isMarked = false
      await host.state.para.update(block.hash, para => {
        isMarked = para.status === 'none' || para.status === 'failed'
        return isMarked ? { ...para, status: 'pending', error: null, shown: true } : para
      })
      if (isMarked) {
        queued.add(block.hash)
      }
    }
    // All at once, the last first: usually the conclusion, the one read first. 同时翻译的请求数
    // caps how many go out; the rest wait in the order they were asked
    await Promise.all(
      [...chosen].reverse().map(reply => translateBlock(reply, true, true).catch(error => host.ui.debug(`reply auto: ${String(error)}`))),
    )
  }

  return {
    /** session.append: the main conversation's reply blocks, and the prompts that start a new stretch */
    onAppend(e: Args<'session.append'>) {
      if (e.agentId !== undefined) {
        return
      }
      const { message } = e
      if (e.door === 'response' && message.type === 'assistant') {
        for (const block of message.content) {
          if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
            const reply = { text: block.text, blocks: segment(block.text) }
            pending.push(reply)
            void translateWritten(reply).catch(error => host.ui.debug(`reply written: ${String(error)}`))
          } else if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim() !== '') {
            const key = hash(block.thinking.trim())
            const reply = { text: block.thinking, blocks: segment(block.thinking) }
            if (drawnFirst.delete(key)) {
              promote(reply)
            } else {
              narration.set(key, reply)
            }
          }
        }
        return
      }
      // A prompt queued while Claude worked joins the running turn (P14): the
      // replies before it count as a turn of their own (F6 › 一轮怎么算)
      if (e.door === 'delivery' && message.type === 'user' && !message.isMeta && pending.length > 0) {
        void finish().catch(error => host.ui.debug(`reply finish: ${String(error)}`))
      }
    },

    /** A reply block drawn: a narration block among them is from now on a reply like any other */
    onDrawn(text: string) {
      const key = hash(text.trim())
      const reply = narration.get(key)
      if (!reply) {
        // Kept a while, for a thinking block that comes after its drawing
        if (drawnFirst.size > 500) {
          drawnFirst.clear()
        }
        drawnFirst.add(key)
        return
      }
      narration.delete(key)
      promote(reply)
    },

    /** A question or a plan: Claude stops to wait for the person, the stretch before it is done */
    onWait() {
      void finish().catch(error => host.ui.debug(`reply finish: ${String(error)}`))
    },

    /** turn.complete of the main conversation */
    onTurnComplete(e: Args<'turn.complete'>) {
      if (e.agentId !== undefined) {
        return
      }
      void finish().catch(error => host.ui.debug(`reply finish: ${String(error)}`))
    },

    /** F6 › 计划和提问: the question and its options, as Claude asks (never counted in 每轮最后 N 条) */
    async translateAsk(questions: readonly unknown[]) {
      if (!(await host.state.settings.get()).autoPlanAsk) {
        return
      }
      const blocks = askLines(questions).map(blockOfLine)
      await translateBlock({ text: '', blocks }, true)
    },

    /** F6 on the desktop: the description of a tool call, as its row shows it; asked only while replies translate on their own */
    async translateToolLine(text: string) {
      const settings = await host.state.settings.get()
      if (settings.readingMode === 'paragraph' && settings.autoReply !== 'off') {
        await translateBlock({ text, blocks: [stepBlock(text)] }, true)
      }
    },

    /** F16 任务: a task list's steps, each a paragraph of its own; one translated before is not asked again */
    async translateLines(blocks: readonly Block[]) {
      await translateBlock({ text: '', blocks: [...blocks] }, true)
    },

    /** F6 › 计划和提问: the approved plan, from the result of the call that left plan mode */
    async translatePlan(output: unknown) {
      const plan = planOf(output)
      if (plan === null || !(await host.state.settings.get()).autoPlanAsk) {
        return
      }
      await translateBlock({ text: plan, blocks: segment(plan) }, true, true)
    },

    /**
     * 翻译 on a paragraph: show what is kept, or ask for this one paragraph;
     * one still waiting for its reply's turn is asked now, ahead of the rest.
     */
    async toggle(block: Block) {
      const now = await host.state.para.get(block.hash)
      if (now.status === 'done') {
        await host.state.para.update(block.hash, para => ({ ...para, shown: !para.shown }))
        return
      }
      if (now.status === 'pending' && !queued.delete(block.hash)) {
        return
      }
      inFlight.add(block.hash)
      await host.state.para.update(block.hash, para => ({ ...para, status: 'pending', error: null, shown: true }))
      const shielded = protect(block.text)
      const result = await run(host, { kind: 'para', text: shielded.masked }).finally(() => inFlight.delete(block.hash))
      if (result.ok) {
        const zh = restore(result.value, shielded.tokens)
        await host.state.para.update(block.hash, () => ({ status: 'done', zh, error: null, shown: true }))
        await keep(block.hash, zh).catch(error => host.ui.debug(`reply cache: ${String(error)}`))
      } else {
        await host.state.para.update(block.hash, para => ({ ...para, status: 'failed', error: unavailable(result.reason) }))
      }
    },

    /**
     * A paragraph drawn with nothing in $.state: its translation may be in the
     * cache (/resume, a new session). Noted while drawing, loaded by `loadNoted`.
     */
    note(paraHash: string) {
      if (!looked.has(paraHash)) {
        looked.add(paraHash)
        toLoad.add(paraHash)
      }
    },

    /** A paragraph drawn as 翻译中…: noted when no request of this module is on it */
    noteStale(block: Block) {
      if (!isAsking(block.hash)) {
        stale.set(block.hash, block)
      }
    },

    /** Loads the noted paragraphs' kept translations; run from a timer, never while drawing. */
    async loadNoted() {
      await askStale()
      if (toLoad.size === 0) {
        return
      }
      const batch = [...toLoad]
      toLoad.clear()
      const dataDir = await dataDirOf(host)
      for (const paraHash of batch) {
        const kept = await readJson(host, cacheFileOf(dataDir, paraHash))
        const zh = typeof kept === 'object' && kept !== null ? (kept as { zh?: unknown }).zh : undefined
        if (typeof zh === 'string') {
          await host.state.para.update(paraHash, para =>
            para.status === 'none' ? { status: 'done', zh, error: null, shown: true } : para,
          )
        }
      }
    },

    /** /clear, /resume and /branch emptied $.state: look in the cache again */
    forgetLooked() {
      looked.clear()
    },
  }
}
