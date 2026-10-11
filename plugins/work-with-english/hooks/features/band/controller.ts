import type { Next, PromptEditInput, PromptEditResult, PromptSubmitInput, PromptSubmitResult } from 'claude-code'

import type { WweBand } from '../../../types'
import { createSlot } from '../../core/async/slot'
import { rowFailure, strictBlocked, verifyFailure } from '../../core/copy/band'
import { parseLeadingCommand, judgedText } from '../../core/text/command'
import { bandMode, isEnglishMessage, shouldBlock } from '../../core/text/lang'
import { diffMarks } from '../../core/text/diff'
import { visibleText } from '../../core/text/mask'
import { protect, restore, verify } from '../../core/text/protect'
import { localDate } from '../../core/time'
import { run } from '../../services/translate'
import type { Failed } from '../../services/translate/types'
import type { Host } from '../../host'
import { recordSent } from '../stats/record'
import { keepDraft } from '../wordbook/drafts'
import { EMPTY_BAND } from './empty'
import { decideCtrlA, decidePause, freshDraft, isTypingAlong, wayOf } from './model'
import type { Answer, Draft } from './model'

// The band above the prompt (F1 to F4): watches the Prompt through
// prompt.edit, asks for a translation at each pause, carries out Control+A
// and the band's buttons, and holds Enter back in strict mode. Its state
// lives in the module (a reload loses a half-written message's record,
// which only happens while developing); what the band draws is
// `host.state.band`.

/** Where a tip-of-the-day was last shown, so it shows once a day (F1) */
const TIP_KEY = 'flag/tipDate'

/**
 * Whether the Prompt's text and what Enter sent are one message: the
 * submitted text has long pastes expanded where the Prompt shows their
 * placeholders, and both are left out of what is compared.
 */
const isSameMessage = (inPrompt: string, sent: string) => visibleText(inPrompt).trim() === visibleText(sent).trim()

export type Band = ReturnType<typeof createBand>

export function createBand(
  host: Host,
  deps: {
    /** F9: the selection line goes when a message is sent, a message sent for the person too (D3) */
    closePick: () => Promise<void>
  },
) {
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
   * Asks for `text`'s translation (F1) or correction (F15) and shows it.
   * Resolves with the new answer, or null when it failed or was superseded.
   */
  async function request(text: string, mode: 'translate' | 'correct'): Promise<Answer | null> {
    const ticket = slot.begin()
    const isFirst = view.mode !== mode || view.error !== null
    await setView(band => ({
      ...band,
      mode,
      isPending: true,
      // F1: the first request of a message shows `EN …` over the text it asks about
      ...(isFirst ? { target: '', source: mode === 'translate' ? text : '', error: null, marks: [], isOk: false } : {}),
    }))

    // A leading command stays as typed: only what follows it is asked about
    const leading = parseLeadingCommand(text, await commandNames())
    const body = leading ? leading.rest : text
    const prefix = leading ? text.slice(0, text.length - leading.rest.length) : ''

    type Got = { ok: true; target: string; source: string; isOk: boolean; verified: boolean }
    const ask = async (): Promise<Got | Failed> => {
      const shielded = protect(body)
      if (mode === 'translate') {
        const result = await run(host, { kind: 'draft', text: shielded.masked }, { signal: ticket.signal })
        if (!result.ok) {
          return result
        }
        const verified = verify(result.value, shielded.tokens) === 'ok'
        return { ok: true, target: restore(result.value, shielded.tokens), source: text, isOk: false, verified }
      }
      const result = await run(host, { kind: 'correct', text: shielded.masked }, { signal: ticket.signal })
      if (!result.ok) {
        return result
      }
      const verified = verify(result.value.corrected, shielded.tokens) === 'ok'
      const corrected = restore(result.value.corrected, shielded.tokens)
      // ✓: nothing to fix, the first row is the sentence as written
      const isOk = result.value.ok || corrected.trim() === body.trim()
      return { ok: true, target: isOk ? body : corrected, source: result.value.zh, isOk, verified: isOk || verified }
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
      const reason = outcome.reason
      await setView(band => ({
        ...band,
        mode,
        isPending: false,
        error: rowFailure(mode, reason),
        // F1: the second row becomes the text that was not translated
        source: text,
        target: '',
        marks: [],
        showTip: false,
        blocked: band.blocked && { ...band.blocked, serviceDown: true },
      }))
      return null
    }

    failedText = null
    const target = prefix + outcome.target
    answer = { text, mode, target, verified: outcome.verified, isOk: outcome.isOk }
    if (mode === 'translate') {
      draft.sawTranslation = true
      draft.lastSource = text
    }
    // F15: the words the correction changed or added, marked; none on ✓
    const marks = mode === 'correct' && !outcome.isOk ? diffMarks(text, target) : []
    const showTip = mode === 'translate' && (view.showTip || (await isTipDue()))
    if (showTip) {
      draft.sawTip = true
    }
    const got = outcome
    await setView(band => ({
      ...band,
      mode,
      target,
      source: got.source,
      marks,
      isOk: got.isOk,
      isPending: false,
      error: got.verified ? null : verifyFailure(mode),
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
      draft.hasReplaced = true
      if (mode === 'translate') {
        draft.usedTranslation = true
      }
      // F4: the hint goes, and with it a 仍然发送 that let the text through
      draft.letThrough = false
      await setView(band => ({ ...band, blocked: null }))
    }
  }

  async function empty() {
    const filled = await host.prompt.fill({ text: '', mode: 'replace' })
    if (filled.isFilled) {
      promptText = ''
      draft.inserted = null
      // What goes out now is typed along, not put in (F13 › 照着敲)
      draft.usedTranslation = false
      draft.retyping = true
      draft.letThrough = false
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
      if (action.mode === 'translate') {
        draft.retyping = false
      }
      await request(text, action.mode)
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
    const got = await request(text, mode)
    const presses = draft.pendingCtrlA
    draft.pendingCtrlA = 0
    // F15: ✓ puts nothing in and empties nothing, at one press or two
    if (!got || got.isOk) {
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

  /** The message is gone, sent or let go: the band starts over for the next one (F1) */
  async function forget() {
    pause?.cancel()
    slot.cancel()
    draft = freshDraft()
    answer = null
    failedText = null
    blockedText = null
    promptText = ''
    await setView(() => EMPTY_BAND)
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
            draft.hasReplaced = true
            if (action.mode === 'translate') {
              draft.usedTranslation = true
            }
            draft.letThrough = false
            promptText = action.text
            void setView(band => ({ ...band, blocked: null }))
            return { text: action.text, cursor: action.text.length }
          case 'clear':
            draft.inserted = null
            draft.usedTranslation = false
            draft.retyping = true
            draft.letThrough = false
            promptText = ''
            void setView(band => ({ ...band, blocked: null }))
            return { text: '', cursor: 0 }
          case 'clearWhenDone':
            draft.pendingCtrlA += 1
            if (!action.isHeld) {
              // Control+A changes no text: the Prompt as it is now is what the press works on, so
              // no pause is set after it to ask again and take the press's request's place
              promptText = e.text
              break
            }
            return { text: e.text, cursor: e.cursor }
          case 'request':
            void catchUpAndPut(e.text, action.mode).catch(error => host.ui.debug(`band Control+A: ${String(error)}`))
            // Direct English: the caret goes to the start meanwhile, where a ✓ leaves it (F15).
            // The text may have changed with no edit of its own (↑, an image, Tab, P09): taken
            // as it is now, so no pause follows to take the press's request's place
            if (!action.isHeld) {
              promptText = e.text
              break
            }
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
        // The Prompt emptied while the band holds a result: by hand (Control+U), or with no
        // edit of its own (Enter held back, Esc Esc), so this one starts from nothing. As
        // after F3, what is typed now goes along the band (F1 › 照着敲时横条不动, F13 ›
        // 照着敲); ↑ brings no empty start
        const isEmptied = result.text === '' || (e.text === '' && promptText !== '')
        if (isEmptied && (answer !== null || view.isPending)) {
          draft.usedTranslation = false
          draft.retyping = true
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
        // ↑, Control+_ and Ctrl+R bring a text back without an edit (P09): the last edit's may be another's
        const edited = promptText
        blockedText = e.text
        const hasImage = (e.attachments ?? []).some(item => item.type === 'image')
        host.clock.after(0, () => {
          void (async () => {
            pause?.cancel()
            // Judged afresh from here; where the Prompt came back empty, the next edit starts
            // from nothing and onEdit takes it as typing along
            draft.retyping = false
            // The terminal keeps the text in the Prompt; where it came back empty, ↑ has it
            const box = await host.prompt.read()
            const isCleared = box.text === ''
            // What was sent as the Prompt held it, placeholders and all: the Prompt that kept it,
            // or else the last edit's text where that was this message, or else what was sent
            const typed = !isCleared ? box.text : isSameMessage(edited, e.text) ? edited : e.text
            // Emptied, the Prompt still counts as holding the text: ↑ brings it back unchanged (F4)
            promptText = typed
            await setView(band => ({ ...band, blocked: { hasImage, serviceDown: false, isCleared, isLetThrough: false } }))
            // F4: the band catches up with what was sent, if it had not
            // English with Chinese in it: the correction, the Chinese put into English,
            // whatever the band showed before (F4, F15)
            const mode = bandMode(judgedText(typed, []) ?? '') ?? 'translate'
            const isCaughtUp = answer !== null && answer.text === typed && answer.mode === mode && failedText !== typed
            if (!isCaughtUp) {
              await request(typed, mode)
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
      const typedMode = bandMode(judgedText(text, []) ?? '')
      // An empty Prompt, or mostly English typed along the band: the band's text goes in as it is
      // (F2); new text in the source language is translated first, as at a pause
      const isAlong = typedMode !== 'translate' && isTypingAlong(draft)
      if (answer && (text === '' || text === answer.text || isAlong)) {
        if (answer.verified && !answer.isOk) {
          await put(answer.target, answer.mode)
        }
        return
      }
      const mode = typedMode === 'correct' ? 'correct' : 'translate'
      const got = await request(text, mode)
      if (got?.verified && !got.isOk) {
        await put(got.target, mode, text)
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
        const { sawTip } = draft
        // A plugin's prompt, our own hooks pass it on: neither held back nor counted. While
        // Claude works it waits for the turn's end (P12), so the band does not wait for it (D3)
        void host.prompt.submit({ text, asUser: true }).catch(error => host.ui.debug(`send anyway: ${String(error)}`))
        await forget()
        await deps.closePick()
        if (sawTip) {
          await host.store.set(TIP_KEY, await today())
        }
        return
      }
      // Nothing in the Prompt to let through
      if (box.text === '') {
        return
      }
      draft.letThrough = true
      await setView(band => ({ ...band, blocked: band.blocked && { ...band.blocked, isLetThrough: true } }))
    },

    /** /clear, /resume and /branch: Claude Code emptied what the band draws, and the message went with it */
    reset: forget,

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
    // The tip showed for this message, whatever the band shows at the end (F1)
    if (sent.draft.sawTip) {
      await host.store.set(TIP_KEY, date)
    }
    await forget()
  }
}
