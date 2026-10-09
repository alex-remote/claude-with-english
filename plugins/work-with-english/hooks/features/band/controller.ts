import type { Next, PromptEditInput, PromptEditResult, PromptSubmitInput, PromptSubmitResult } from 'claude-code'

import type { WweBand } from '../../../types'
import { createSlot } from '../../core/async/slot'
import { rowFailure, strictBlocked, verifyFailure } from '../../core/copy/band'
import { parseLeadingCommand, judgedText } from '../../core/text/command'
import { bandMode, isEnglishMessage, shouldBlock } from '../../core/text/lang'
import { protect, restore, verify } from '../../core/text/protect'
import { localDate } from '../../core/time'
import { run } from '../../services/translate'
import type { Host } from '../../host'
import { recordSent } from '../stats/record'
import { keepDraft } from '../wordbook/drafts'
import { EMPTY_BAND } from './empty'
import { decideCtrlA, decidePause, freshDraft, wayOf } from './model'
import type { Answer, Draft } from './model'

// The band above the prompt (F1 to F4): watches the Prompt through
// prompt.edit, asks for a translation at each pause, carries out Control+A
// and the band's buttons, and holds Enter back in strict mode. Its state
// lives in the module (a reload loses a half-written message's record,
// which only happens while developing); what the band draws is
// `host.state.band`.

/** Where a tip-of-the-day was last shown, so it shows once a day (F1) */
const TIP_KEY = 'flag/tipDate'

export type Band = ReturnType<typeof createBand>

export function createBand(host: Host) {
  let draft: Draft = freshDraft()
  /** The Prompt's text as the last edit left it */
  let promptText = ''
  /** What the two rows answer */
  let answer: Answer | null = null
  /** The last request for `failedText` failed: a pause asks again even for the same text */
  let failedText: string | null = null
  /** A mirror of host.state.band, for prompt.edit's 50 ms */
  let view: WweBand = EMPTY_BAND
  let delayMs = 700
  let pause: { cancel: () => void } | null = null
  /** The band was drawn in this session: Enter is held back only where its hint shows */
  let isDrawn = false
  /** F4: the text Enter last held back, for 仍然发送 */
  let blockedText: string | null = null
  const slot = createSlot()

  const setView = async (fn: (band: WweBand) => WweBand) => {
    view = await host.state.band.update(fn)
  }

  const now = () => host.clock.now()
  const today = async () => {
    const ms = await now()
    return localDate(ms, -new Date(ms).getTimezoneOffset())
  }

  const commandNames = async () => {
    try {
      return (await host.command.list()).map(command => command.name)
    } catch {
      return []
    }
  }

  /** The text to judge: a leading command off, null for shell input */
  const judgedOf = async (text: string) => judgedText(text, await commandNames())

  async function isTipDue() {
    return (await host.store.get(TIP_KEY)) !== (await today())
  }

  /**
   * Asks for `text`'s translation (or, from M3, correction) and shows it.
   * Resolves with the new answer, or null when it failed or was superseded.
   */
  async function request(text: string, mode: 'translate' | 'correct'): Promise<Answer | null> {
    const ticket = slot.begin()
    const isFirst = view.mode === 'none' || view.error !== null
    await setView(band => ({
      ...band,
      mode,
      isPending: true,
      // F1: the first request of a message shows `EN …` over the text it asks about
      ...(isFirst ? { target: '', source: text, error: null, marks: [], isOk: false } : {}),
    }))

    // A leading command stays as typed: only what follows it is asked about
    const leading = parseLeadingCommand(text, await commandNames())
    const body = leading ? leading.rest : text
    const prefix = leading ? text.slice(0, text.length - leading.rest.length) : ''

    const ask = async () => {
      const shielded = protect(body)
      const result = await run(host, { kind: 'draft', text: shielded.masked }, { signal: ticket.signal })
      if (!result.ok) {
        return result
      }
      return { ok: true as const, value: restore(result.value, shielded.tokens), verified: verify(result.value, shielded.tokens) === 'ok' }
    }

    let outcome = await ask()
    // F2 › 替换前核对: code, paths and placeholders must come back unchanged; one more try
    if (outcome.ok && !outcome.verified && ticket.isCurrent()) {
      outcome = await ask()
    }
    if (!ticket.isCurrent()) {
      return null
    }
    if (!outcome.ok) {
      if (outcome.kind === 'cancelled') {
        return null
      }
      failedText = text
      answer = null
      await setView(band => ({
        ...band,
        mode,
        isPending: false,
        error: rowFailure(mode, outcome.reason),
        // F1: the second row becomes the text that was not translated
        source: text,
        target: '',
        showTip: false,
        blocked: band.blocked && { ...band.blocked, serviceDown: true },
      }))
      return null
    }

    failedText = null
    const target = prefix + outcome.value
    answer = { text, mode, target, verified: outcome.verified, isOk: false }
    if (mode === 'translate') {
      draft.sawTranslation = true
      draft.lastSource = text
    }
    const showTip = view.showTip || (mode === 'translate' && (await isTipDue()))
    await setView(band => ({
      ...band,
      mode,
      target,
      source: text,
      marks: [],
      isOk: false,
      isPending: false,
      error: outcome.verified ? null : verifyFailure(mode),
      showTip,
    }))
    return answer
  }

  /** Puts `text` in the Prompt as F2 or F15 does, checking nothing was typed meanwhile. */
  async function put(text: string, mode: 'translate' | 'correct', expected?: string) {
    if (expected !== undefined) {
      const box = await host.prompt.read()
      if (box.text !== expected) {
        return
      }
    }
    const filled = await host.prompt.fill({ text, mode: 'replace' })
    if (filled.isFilled) {
      promptText = text
      draft.inserted = { text, mode }
      if (mode === 'translate') {
        draft.usedTranslation = true
      }
      await setView(band => ({ ...band, blocked: null }))
    }
  }

  async function empty() {
    const filled = await host.prompt.fill({ text: '', mode: 'replace' })
    if (filled.isFilled) {
      promptText = ''
      draft.inserted = null
      draft.retyping = true
      await setView(band => ({ ...band, blocked: null }))
    }
  }

  async function onPause(text: string) {
    pause = null
    if (text !== promptText) {
      return
    }
    const action = decidePause({ judged: await judgedOf(text), text, draft, answer, failed: failedText === text })
    if (action.kind === 'request') {
      // M1 translates; the correction (F15) comes with M3
      if (action.mode === 'translate') {
        draft.retyping = false
        await request(text, 'translate')
      }
    }
  }

  function schedule(text: string) {
    pause?.cancel()
    pause = host.clock.after(delayMs, () => {
      void onPause(text).catch(error => host.ui.debug(`band pause: ${String(error)}`))
    })
  }

  /** Control+A held before the band caught up: ask now, then put the result in (or empty, at a second press) */
  async function catchUpAndPut(text: string, mode: 'translate' | 'correct') {
    draft.pendingCtrlA = 1
    pause?.cancel()
    const got = mode === 'translate' ? await request(text, mode) : null
    const presses = draft.pendingCtrlA
    draft.pendingCtrlA = 0
    if (!got) {
      return
    }
    if (presses >= 2) {
      await empty()
      return
    }
    if (got.verified) {
      await put(got.target, mode, text)
    }
  }

  return {
    /** The settings a pause and Enter read, as the settings mirror changes */
    setDelay(ms: number) {
      delayMs = ms
    },

    markDrawn() {
      isDrawn = true
    },

    /** prompt.edit: Control+A answered at once, any other edit passed on and timed */
    async onEdit(e: PromptEditInput, next: Next<'prompt.edit'>): Promise<PromptEditResult> {
      const isCtrlA = e.key?.ctrl === true && e.key.key === 'a' && !e.key.meta && !e.key.shift
      if (isCtrlA) {
        // Synchronous: the 50 ms of prompt.edit leave no room to wait on a model
        const judged = judgedText(e.text, [])
        const action = decideCtrlA({ judged, text: e.text, draft, answer, isPending: view.isPending })
        switch (action.kind) {
          case 'replace':
            draft.inserted = { text: action.text, mode: action.mode }
            if (action.mode === 'translate') {
              draft.usedTranslation = true
            }
            promptText = action.text
            void setView(band => ({ ...band, blocked: null }))
            return { text: action.text, cursor: action.text.length }
          case 'clear':
            draft.inserted = null
            draft.retyping = true
            promptText = ''
            void setView(band => ({ ...band, blocked: null }))
            return { text: '', cursor: 0 }
          case 'clearWhenDone':
            draft.pendingCtrlA += 1
            return { text: e.text, cursor: e.cursor }
          case 'request':
            void catchUpAndPut(e.text, action.mode).catch(error => host.ui.debug(`band Control+A: ${String(error)}`))
            return { text: e.text, cursor: e.cursor }
          case 'pass':
            break
        }
      }
      const result = await next(e)
      if (result.text !== promptText) {
        const wasInserted = draft.inserted !== null && result.text !== draft.inserted.text
        if (wasInserted) {
          draft.inserted = null
        }
        promptText = result.text
        if (view.blocked && !view.blocked.isLetThrough) {
          void setView(band => ({ ...band, blocked: null }))
        }
        schedule(result.text)
      }
      return result
    },

    /** prompt.submit: the person's Enter is held back while strict mode sees a Han character */
    async onSubmit(e: PromptSubmitInput, next: Next<'prompt.submit'>): Promise<PromptSubmitResult> {
      if (e.origin.kind !== 'composer') {
        return next(e)
      }
      const judged = await judgedOf(e.text)
      if (judged === null) {
        return next(e)
      }
      const settings = await host.state.settings.get()
      const isLetThrough = draft.letThrough
      const isBlocked = settings.strict && isDrawn && !isLetThrough && shouldBlock(judged)
      if (isBlocked) {
        const typed = promptText
        blockedText = e.text
        const hasImage = (e.attachments ?? []).some(item => item.type === 'image')
        host.clock.after(0, () => {
          void (async () => {
            pause?.cancel()
            draft.retyping = false
            // The terminal keeps the text in the Prompt; where it came back empty, ↑ has it
            const box = await host.prompt.read()
            const isCleared = box.text === ''
            promptText = box.text
            await setView(band => ({ ...band, blocked: { hasImage, serviceDown: false, isCleared, isLetThrough: false } }))
            // F4: the band catches up with what was sent, if it had not
            const mode = bandMode(judgedText(typed, []) ?? '') ?? 'translate'
            const isCaughtUp = answer !== null && answer.text === typed && failedText !== typed
            if (!isCaughtUp && mode === 'translate') {
              await request(typed, 'translate')
            }
          })().catch(error => host.ui.debug(`band blocked: ${String(error)}`))
        })
        return { drop: strictBlocked() }
      }

      const result = await next(e)
      if (result.drop === undefined) {
        const sent = { text: e.text, judged, draft, isLetThrough }
        host.clock.after(0, () => {
          void settle(sent).catch(error => host.ui.debug(`band settle: ${String(error)}`))
        })
      }
      return result
    },

    /** 替换为译文 (F2) */
    async replace() {
      const box = await host.prompt.read()
      const text = box.text
      // An empty Prompt, or English typed along the band: the band's text goes in as it is
      if (answer && (text === '' || text === answer.text || draft.retyping)) {
        if (answer.verified) {
          await put(answer.target, answer.mode)
        }
        return
      }
      const mode = bandMode(judgedText(text, []) ?? '') === 'correct' ? 'correct' : 'translate'
      if (mode === 'translate') {
        const got = await request(text, mode)
        if (got?.verified) {
          await put(got.target, mode, text)
        }
      }
    },

    /** 清空输入框 (F3) */
    clear: empty,

    /**
     * 仍然发送 (F4): where the Prompt kept the text, the next Enter goes
     * through, images and pastes with it; where it came back empty, the text
     * Enter held back is sent for the person (without its images).
     */
    async sendAnyway() {
      const box = await host.prompt.read()
      if (box.text === '' && blockedText) {
        const text = blockedText
        blockedText = null
        // A plugin's prompt: no hook of ours sees it, so it is neither held back nor counted
        await host.prompt.submit({ text, asUser: true })
        pause?.cancel()
        slot.cancel()
        draft = freshDraft()
        answer = null
        failedText = null
        await setView(() => EMPTY_BAND)
        return
      }
      draft.letThrough = true
      await setView(band => ({ ...band, blocked: band.blocked && { ...band.blocked, isLetThrough: true } }))
    },

    /** What the band answers, for the view's 朗读 */
    targetText: () => (answer ? answer.target : null),
  }

  /** After a message entered: the band empties, the counts and the Chinese behind it are kept */
  async function settle(sent: { text: string; judged: string; draft: Draft; isLetThrough: boolean }) {
    const date = await today()
    if (!sent.isLetThrough && isEnglishMessage(sent.judged)) {
      await recordSent(host, date, wayOf(sent.draft))
      if (sent.draft.lastSource) {
        await keepDraft(host, sent.judged, { zh: sent.draft.lastSource, sawTranslation: sent.draft.sawTranslation })
      }
    }
    if (view.showTip) {
      await host.store.set(TIP_KEY, date)
    }
    pause?.cancel()
    slot.cancel()
    draft = freshDraft()
    answer = null
    failedText = null
    blockedText = null
    promptText = ''
    await setView(() => EMPTY_BAND)
  }
}
