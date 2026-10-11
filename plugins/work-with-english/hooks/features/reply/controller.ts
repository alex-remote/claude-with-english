import type { Args } from 'claude-code'

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
import { askLines, blockOfLine, planOf } from './planAsk'

// F6 回复译文: collects the main conversation's reply blocks as they are
// appended, and when the turn ends (or stops for a question or a plan)
// translates them as the reading settings say, last first. A translation is
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

  const today = async () => {
    const ms = await host.clock.now()
    return localDate(ms, -new Date(ms).getTimezoneOffset())
  }

  async function keep(paraHash: string, zh: string) {
    await writeJson(host, cacheFileOf(await dataDirOf(host), paraHash), { v: 1, zh })
  }

  /** Asks for every paragraph of one reply block in one request. */
  async function translateBlock(reply: ReplyBlock, isAutomatic: boolean) {
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
    if (missing.length === 0) {
      return
    }
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
    // 一轮做完再翻: every reply to translate says 翻译中… at once, not only the one asked
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
    // The last first: usually the conclusion, the one read first
    for (const reply of [...chosen].reverse()) {
      await translateBlock(reply, true).catch(error => host.ui.debug(`reply auto: ${String(error)}`))
    }
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
            pending.push({ text: block.text, blocks: segment(block.text) })
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

    /** F6 › 计划和提问: the approved plan, from the result of the call that left plan mode */
    async translatePlan(output: unknown) {
      const plan = planOf(output)
      if (plan === null || !(await host.state.settings.get()).autoPlanAsk) {
        return
      }
      await translateBlock({ text: plan, blocks: segment(plan) }, true)
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
      await host.state.para.update(block.hash, para => ({ ...para, status: 'pending', error: null, shown: true }))
      const shielded = protect(block.text)
      const result = await run(host, { kind: 'para', text: shielded.masked })
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

    /** Loads the noted paragraphs' kept translations; run from a timer, never while drawing. */
    async loadNoted() {
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
