import type { WweLookup, WweTextResult, WweWordResult } from '../../../types'

// What the translation service is asked and what it answers, one task kind
// per feature (docs/dev-plan.md › 服务层). M1 runs `draft`; the others are
// typed here so the features can be written against them, and run once
// their milestone adds the prompt.

/** F1: the prompt's text, masked by core/text/protect.ts (placeholders ⟦n⟧) */
export type DraftTask = { kind: 'draft'; text: string }
/** F15: an English message to correct */
export type CorrectTask = { kind: 'correct'; text: string }
/** F6: a reply block's paragraphs, translated in one request */
export type ReplyBlockTask = { kind: 'replyBlock'; paras: readonly string[] }
/** F6: one paragraph, from its own button */
export type ParaTask = { kind: 'para'; text: string }
/** F6: one paragraph of a reply or a plan, translated on its own; `before` the paragraph before it, for context */
export type ReplyParaTask = { kind: 'replyPara'; text: string; before: string | null }
/** F6: a plan's paragraphs */
export type PlanTask = { kind: 'plan'; paras: readonly string[] }
/** F6: a question's lines: the question, then its options */
export type AskTask = { kind: 'ask'; lines: readonly string[] }
/** F9: a selected passage */
export type SelectionTask = { kind: 'selection'; text: string }
/** F9: a selected word, with the sentence it was selected in when one is known */
export type LookupTask = { kind: 'lookup'; word: string; sentence: string | null }
/** F10: the word card, built on the lookup so the senses agree */
export type WordTask = { kind: 'word'; word: string; sentence: string | null; lookup: LookupValue }
/** F11: a paragraph or a selected sentence to analyse */
export type TextTask = { kind: 'text'; text: string }
/** F12: a sentence the user wrote in English, into the source language */
export type MyZhTask = { kind: 'myZh'; text: string }

export type Task =
  | DraftTask
  | CorrectTask
  | ReplyBlockTask
  | ParaTask
  | ReplyParaTask
  | PlanTask
  | AskTask
  | SelectionTask
  | LookupTask
  | WordTask
  | TextTask
  | MyZhTask

export type TaskKind = Task['kind']

/** F15 */
export type CorrectValue = { corrected: string; zh: string; ok: boolean }

/** F9 */
export type LookupValue = WweLookup

/** An English line and its translation */
export type Pair = { en: string; zh: string }

/** F10 */
export type WordValue = WweWordResult

/** F11 */
export type TextValue = WweTextResult

/** What each task kind answers. */
export type ValueOf = {
  draft: string
  correct: CorrectValue
  replyBlock: string[]
  para: string
  replyPara: string
  plan: string[]
  ask: string[]
  selection: string
  lookup: LookupValue
  word: WordValue
  text: TextValue
  myZh: string
}

/**
 * Why a task failed, as features branch on it; `reason` beside it is the
 * words they show. `cancelled` is the caller's own signal (a newer request
 * took over) and is never shown.
 */
export type FailureKind =
  | 'cancelled'
  | 'timeout'
  | 'auth'
  | 'quota'
  | 'model-unavailable'
  | 'invalid-request'
  | 'bad-format'
  | 'network'
  | 'not-implemented'
  | 'other'

export type Failed = { ok: false; kind: FailureKind; reason: string }

export type TranslateResult<T> = { ok: true; value: T } | Failed

/** One request as a transport sends it: the instructions, and the user message holding `<source>`. */
export type Prompt = { system: string; prompt: string }

/** Why the engine refused to send a model call, told apart by its message (P02). */
export type RejectCause = 'allowlist' | 'maxTokens' | 'effort' | 'timeoutMs' | 'unknown'

/** What one transport call came to, before errors.ts puts it in words. */
export type TransportOutcome =
  | { ok: true; text: string }
  /** Cut by the timeout or the caller's signal; only the signal tells which */
  | { ok: false; reason: 'aborted' }
  | { ok: false; reason: 'api-error'; status: number | null; error: string }
  | { ok: false; reason: 'empty-reply' }
  | { ok: false; reason: 'reject'; cause: RejectCause; message: string }

export type TransportFailure = Extract<TransportOutcome, { ok: false }>
