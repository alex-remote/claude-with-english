import { bandMode, hasHan } from '../../core/text/lang'

// What the band does at a pause and at Control+A, as pure decisions over
// the message being written (F1 › 横条显示什么, F2, F3, F15, 快捷键和按钮).
// The controller keeps the state and carries the decisions out.

/** What the band knows about the message being written, from its first key to Enter. */
export type Draft = {
  /** The text F2 or F15 just put in the Prompt, until the person changes it */
  inserted: { text: string; mode: 'translate' | 'correct' } | null
  /** A translation showed for this message (F13: 照着敲 rather than 直接写) */
  sawTranslation: boolean
  /** What is in the Prompt came from F2's replace, edited or not (F13: 用译文); emptying it ends that */
  usedTranslation: boolean
  /** F2 or F15 put text in for this message: English edited after it is no longer written directly */
  hasReplaced: boolean
  /** The day's tip showed for this message: once it is sent, the tip waits for the next day (F1) */
  sawTip: boolean
  /** The source text of the last translation (F12 keeps it beside what was sent) */
  lastSource: string | null
  /**
   * The Prompt was emptied while the band held a result (F3, or Enter blocked):
   * the person types along and the band holds, until new source-language text
   * arrives
   */
  retyping: boolean
  /** Control+A came before the band caught up: how many presses wait for the result */
  pendingCtrlA: number
  /** F4: let the next Enter through once (仍然发送 with text in the Prompt) */
  letThrough: boolean
}

export const freshDraft = (): Draft => ({
  inserted: null,
  sawTranslation: false,
  usedTranslation: false,
  hasReplaced: false,
  sawTip: false,
  lastSource: null,
  retyping: false,
  pendingCtrlA: 0,
  letThrough: false,
})

/**
 * The person types along the band rather than over something put in (F1 ›
 * 照着敲时横条不动, F13 › 照着敲): after the Prompt was emptied, or with a
 * translation shown and none of it put in.
 */
export const isTypingAlong = (draft: Draft): boolean => draft.retyping || (draft.sawTranslation && !draft.usedTranslation)

/** What the band's two rows answer, when they answer the Prompt as it stands. */
export type Answer = {
  /** The Prompt's text the rows were made for */
  text: string
  mode: 'translate' | 'correct'
  /** The text to put in the Prompt */
  target: string
  /** Code, paths and placeholders came back unchanged (F2 › 替换前核对) */
  verified: boolean
  /** F15: nothing to fix */
  isOk: boolean
}

export type PauseAction = { kind: 'none' } | { kind: 'request'; mode: 'translate' | 'correct' }

/**
 * At a pause in typing. `judged` is the Prompt with a leading command taken
 * off (null for shell input); `answer` what the band shows now, if anything;
 * `failed` whether the last request for this same text failed.
 */
export function decidePause(input: {
  judged: string | null
  text: string
  draft: Draft
  answer: Answer | null
  failed: boolean
}): PauseAction {
  const { judged, text, draft, answer, failed } = input
  if (judged === null || text.trim() === '') {
    return { kind: 'none' }
  }
  const mode = bandMode(judged)
  if (mode === null) {
    return { kind: 'none' }
  }
  // The text the band already answers: ask again only after a failure
  if (answer && answer.text === text && answer.mode === mode && !failed) {
    return { kind: 'none' }
  }
  if (mode === 'translate') {
    return { kind: 'request', mode }
  }
  // English: the band holds while the person types along a translation or a
  // correction, and after a replace nobody edited (F1 › 照着敲时横条不动, F15)
  if (draft.sawTranslation || draft.retyping) {
    return { kind: 'none' }
  }
  if (draft.inserted && draft.inserted.text === text) {
    return { kind: 'none' }
  }
  return { kind: 'request', mode }
}

export type CtrlAAction =
  /** Control+A as Claude Code does it: the caret to the start of the line */
  | { kind: 'pass' }
  /** Put the band's text in, now */
  | { kind: 'replace'; text: string; mode: 'translate' | 'correct' }
  /** Empty the Prompt (F3) */
  | { kind: 'clear' }
  /**
   * Ask for the newest text first, then put it in. Held: the key waits for
   * the result (a Han character in the Prompt); otherwise it is the editor's
   * own meanwhile, so a correction that comes back ✓ leaves the caret at the
   * start (F15)
   */
  | { kind: 'request'; mode: 'translate' | 'correct'; isHeld: boolean }
  /** A second press while the first waits: empty the Prompt once the result is in, unless it is ✓ */
  | { kind: 'clearWhenDone'; isHeld: boolean }

/**
 * Control+A (快捷键和按钮 › 什么时候生效): a Han character in the Prompt
 * replaces with the translation; direct English not yet replaced replaces
 * with the correction; what was just put in and not changed is cleared;
 * anything else is the editor's own Control+A.
 */
export function decideCtrlA(input: {
  judged: string | null
  text: string
  draft: Draft
  answer: Answer | null
  isPending: boolean
}): CtrlAAction {
  const { judged, text, draft, answer, isPending } = input
  const isHeld = judged !== null && hasHan(judged)
  if (draft.pendingCtrlA > 0) {
    return { kind: 'clearWhenDone', isHeld }
  }
  if (draft.inserted && draft.inserted.text === text && text !== '') {
    return { kind: 'clear' }
  }
  if (judged === null || judged.trim() === '') {
    return { kind: 'pass' }
  }
  const isCaughtUp = (mode: 'translate' | 'correct') =>
    answer !== null && answer.text === text && answer.mode === mode && !isPending
  const isUsable = (got: Answer | null): got is Answer => got !== null && got.verified && !got.isOk
  if (hasHan(judged)) {
    const mode = bandMode(judged) === 'correct' ? 'correct' : 'translate'
    if (isCaughtUp(mode) && isUsable(answer)) {
      return { kind: 'replace', text: answer.target, mode }
    }
    // Mostly English typed along the band, a Chinese word in it: the band holds and its text goes in (F2)
    if (mode === 'correct' && isTypingAlong(draft) && !isPending && isUsable(answer)) {
      return { kind: 'replace', text: answer.target, mode: answer.mode }
    }
    return { kind: 'request', mode, isHeld: true }
  }
  // Direct English that nothing was put in for yet, and no translation to type along
  const isDirect =
    bandMode(judged) === 'correct' && !draft.sawTranslation && !draft.retyping && draft.inserted === null && !draft.hasReplaced
  if (!isDirect) {
    return { kind: 'pass' }
  }
  if (isCaughtUp('correct') && answer) {
    if (answer.isOk) {
      return { kind: 'pass' }
    }
    return answer.verified ? { kind: 'replace', text: answer.target, mode: 'correct' } : { kind: 'request', mode: 'correct', isHeld: false }
  }
  return { kind: 'request', mode: 'correct', isHeld: false }
}

/** How a message sent in English was written (F13 › 写法). */
export function wayOf(draft: Draft): 'used' | 'retyped' | 'direct' {
  if (draft.usedTranslation) {
    return 'used'
  }
  return draft.sawTranslation ? 'retyped' : 'direct'
}
