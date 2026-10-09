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
  /** What was sent came from F2's replace, edited or not (F13: 用译文) */
  usedTranslation: boolean
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
  lastSource: null,
  retyping: false,
  pendingCtrlA: 0,
  letThrough: false,
})

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
  /** Hold the key: ask for the newest text first, then put it in */
  | { kind: 'request'; mode: 'translate' | 'correct' }
  /** A second press while the first waits: empty the Prompt once the result is in */
  | { kind: 'clearWhenDone' }

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
  if (draft.pendingCtrlA > 0) {
    return { kind: 'clearWhenDone' }
  }
  if (draft.inserted && draft.inserted.text === text && text !== '') {
    return { kind: 'clear' }
  }
  if (judged === null || judged.trim() === '') {
    return { kind: 'pass' }
  }
  const isCaughtUp = (mode: 'translate' | 'correct') =>
    answer !== null && answer.text === text && answer.mode === mode && !isPending
  if (hasHan(judged)) {
    const mode = bandMode(judged) === 'correct' ? 'correct' : 'translate'
    if (isCaughtUp(mode) && answer && answer.verified && !answer.isOk) {
      return { kind: 'replace', text: answer.target, mode }
    }
    return { kind: 'request', mode }
  }
  // Direct English that nothing was put in for yet, and no translation to type along
  const isDirect = bandMode(judged) === 'correct' && !draft.sawTranslation && !draft.retyping && draft.inserted === null
  if (!isDirect) {
    return { kind: 'pass' }
  }
  if (isCaughtUp('correct') && answer) {
    if (answer.isOk) {
      return { kind: 'pass' }
    }
    return answer.verified ? { kind: 'replace', text: answer.target, mode: 'correct' } : { kind: 'request', mode: 'correct' }
  }
  return { kind: 'request', mode: 'correct' }
}

/** How a message sent in English was written (F13 › 写法). */
export function wayOf(draft: Draft): 'used' | 'retyped' | 'direct' {
  if (draft.usedTranslation) {
    return 'used'
  }
  return draft.sawTranslation ? 'retyped' : 'direct'
}
