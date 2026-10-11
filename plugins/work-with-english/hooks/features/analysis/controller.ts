import type { WweAnalysis, WweTextResult } from '../../../types'
import { createSlot } from '../../core/async/slot'
import { analysisFailed } from '../../core/copy/analysis'
import { sentenceOf } from '../../core/text/selection'
import { run } from '../../services/translate'
import type { Host } from '../../host'

// F10 单词解析 and F11 语法分析 in the pane, which the settings share
// (阅读辅助 › Pane 只有一个): opening one puts it in the settings' place.
// A newer request takes the place of one still out (通用状态 › 被取代); a
// result that comes after the pane closed is kept and does not reopen it.

export const PANE_ID = 'wwe'

export type Analyses = ReturnType<typeof createAnalyses>

export function createAnalyses(host: Host, beforeOpen: () => Promise<void>) {
  const slot = createSlot()

  async function show(analysis: WweAnalysis) {
    await beforeOpen()
    await host.state.analysis.update(() => analysis)
    await host.state.pane.update(pane => ({ ...pane, view: analysis.kind }))
    // The pane takes the keys only from an empty Prompt (阅读辅助 › 关闭和返回)
    const box = await host.prompt.read().catch(() => ({ text: 'x', cursor: 0 }))
    await host.ui.open({ id: PANE_ID, title: 'work-with-english', closeOnEscape: true, ...(box.text === '' ? { focus: true } : {}) })
  }

  async function lookupAndCard(word: string, sentence: string | null) {
    const ticket = slot.begin()
    const lookup = await run(host, { kind: 'lookup', word, sentence }, { signal: ticket.signal })
    if (!ticket.isCurrent()) {
      return
    }
    if (!lookup.ok) {
      await host.state.analysis.update(a => a && { ...a, status: 'failed', error: analysisFailed(lookup.reason) })
      return
    }
    const card = await run(host, { kind: 'word', word, sentence, lookup: lookup.value }, { signal: ticket.signal })
    if (!ticket.isCurrent()) {
      return
    }
    await host.state.analysis.update(a =>
      a &&
      (card.ok
        ? { ...a, status: 'done', word: card.value, error: null }
        : { ...a, status: 'failed', error: analysisFailed(card.reason) }),
    )
  }

  return {
    /** F11: 解析 on a paragraph, or on a sentence selected in 划选模式 */
    async analyseText(subject: string, isSentence: boolean) {
      await show({ kind: 'text', status: 'pending', subject, sentence: null, isSentence, text: null, word: null, error: null, back: null })
      const ticket = slot.begin()
      const result = await run(host, { kind: 'text', text: subject }, { signal: ticket.signal })
      if (!ticket.isCurrent()) {
        return
      }
      await host.state.analysis.update(a =>
        a &&
        (result.ok
          ? { ...a, status: 'done', text: result.value, error: null }
          : { ...a, status: 'failed', error: analysisFailed(result.reason) }),
      )
    },

    /** F10: 解析 on a selected word, with the sentence it was read in when known */
    async analyseWord(word: string, sentence: string | null) {
      await show({ kind: 'word', status: 'pending', subject: word, sentence, isSentence: false, text: null, word: null, error: null, back: null })
      await lookupAndCard(word, sentence)
    },

    /** F10 from F11's hard words: the word in the first sentence of the paragraph that holds it */
    async analyseHardWord(word: string) {
      const now = await host.state.analysis.get()
      if (!now || now.kind !== 'text' || !now.text) {
        return
      }
      const back = { subject: now.subject, isSentence: now.isSentence, text: now.text }
      const sentence = sentenceIn(now.text, word) ?? sentenceOf(now.subject, word)
      await host.state.analysis.update(() => ({
        kind: 'word',
        status: 'pending',
        subject: word,
        sentence,
        isSentence: false,
        text: null,
        word: null,
        error: null,
        back,
      }))
      await host.state.pane.update(pane => ({ ...pane, view: 'word' }))
      await lookupAndCard(word, sentence)
    },

    /** ← 返回语法分析: the analysis as it was, not asked again */
    async back() {
      slot.cancel()
      const now = await host.state.analysis.get()
      if (!now?.back) {
        return
      }
      const { subject, isSentence, text } = now.back
      await host.state.analysis.update(() => ({
        kind: 'text',
        status: 'done',
        subject,
        sentence: null,
        isSentence,
        text,
        word: null,
        error: null,
        back: null,
      }))
      await host.state.pane.update(pane => ({ ...pane, view: 'text' }))
    },

    /** A newer request or the settings took the pane: whatever is out is no longer wanted */
    cancel() {
      slot.cancel()
    },
  }
}

/** The first of the analysed sentences that holds the word, whole word, any case */
function sentenceIn(text: WweTextResult, word: string): string | null {
  const pattern = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')
  return text.sentences.find(sentence => pattern.test(sentence.en))?.en ?? null
}
