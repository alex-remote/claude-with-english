import { REQUEST_TIMEOUT_MS } from '../../core/async/slot'
import type { Host } from '../../host'
import type { Prompt, RejectCause, TransportOutcome } from './types'

// The Claude Code account transport: `$.model.complete` with the model the
// settings name (P02, docs/references/claude-code-docs.md › 调模型).

/** A failure after 30 s (通用状态); the engine's own retries of 429 and 5xx count toward it. */
export const TIMEOUT_MS = REQUEST_TIMEOUT_MS

export const MAX_TOKENS_CAP = 8192

/**
 * A high guess of the input's tokens: a Han character or other non-ASCII
 * character is 1 to 2 tokens, so 2; ASCII runs about 4 characters a token,
 * counted as 3.
 */
export function estimateTokens(text: string): number {
  let wide = 0
  let ascii = 0
  for (const char of text) {
    if (char.charCodeAt(0) < 0x80) {
      ascii += 1
    } else {
      wide += 1
    }
  }
  return wide * 2 + Math.ceil(ascii / 3)
}

/**
 * The reply's cap: three times the input's tokens, plus 256, at most 8192. A
 * reply cut by the cap still comes back answered with no mark (P02), so the
 * cap is set well above what a translation of the input needs.
 */
export const maxTokensFor = (source: string) => Math.min(MAX_TOKENS_CAP, estimateTokens(source) * 3 + 256)

// The engine's refusals carry only a message; these fragments tell them
// apart. They are not documented, so a version upgrade reruns the tests (P02).
const REJECT_FRAGMENTS: readonly [RejectCause, string][] = [
  ['allowlist', "is not in this organization's allowlist"],
  ['maxTokens', 'is past what'],
  ['effort', 'effort must be one of'],
  ['timeoutMs', 'timeoutMs must be'],
]

export function rejectCauseOf(message: string): RejectCause {
  return REJECT_FRAGMENTS.find(([, fragment]) => message.includes(fragment))?.[0] ?? 'unknown'
}

export type ClaudeCall = {
  /** An alias (`haiku`) or a full model id */
  model: string
  /** The text the input's length is measured on: the source, not the instructions */
  source: string
  signal?: AbortSignal
}

export async function completeWithClaude(host: Host, prompt: Prompt, call: ClaudeCall): Promise<TransportOutcome> {
  let result: Awaited<ReturnType<Host['model']['complete']>>
  try {
    result = await host.model.complete(
      {
        model: call.model,
        system: prompt.system,
        prompt: prompt.prompt,
        maxTokens: maxTokensFor(call.source),
        timeoutMs: TIMEOUT_MS,
      },
      { signal: call.signal },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: 'reject', cause: rejectCauseOf(message), message }
  }
  if (result.isAnswered) {
    return { ok: true, text: result.text }
  }
  switch (result.reason) {
    case 'aborted':
      return { ok: false, reason: 'aborted' }
    case 'api-error':
      return { ok: false, reason: 'api-error', status: result.status, error: result.error }
    case 'empty-reply':
      return { ok: false, reason: 'empty-reply' }
  }
}
