import { maskSpans } from './mask'

// What a translation or correction keeps word for word (docs/feature-map.md,
// F1 不翻的, F2 替换前核对, F15 代码和占位): every part mask.ts leaves out goes
// to the model as a numbered placeholder and comes back as the original. ⟦n⟧
// is neither Markdown, code nor either language, so a model has no reason to
// translate or reformat it.

export type Protected = {
  /** The text with each left-out part replaced by its placeholder */
  masked: string
  /** The parts, placeholder n standing for tokens[n] */
  tokens: string[]
}

export type Verdict = 'ok' | 'mismatch'

/** The placeholder for tokens[index], for the prompt that asks a model to keep them. */
export const placeholder = (index: number): string => `⟦${index}⟧`

// A model may pad the number with spaces; the brackets and the number are what count
const PLACEHOLDER = /⟦\s*(\d+)\s*⟧/g

export function protect(text: string): Protected {
  const tokens: string[] = []
  let masked = ''
  let at = 0
  for (const span of maskSpans(text)) {
    masked += text.slice(at, span.start) + placeholder(tokens.length)
    tokens.push(text.slice(span.start, span.end))
    at = span.end
  }
  return { masked: masked + text.slice(at), tokens }
}

/** The translation with each placeholder put back as its part; check it with `verify` first. */
export function restore(translated: string, tokens: readonly string[]): string {
  return translated.replace(PLACEHOLDER, (whole, n: string) => tokens[Number(n)] ?? whole)
}

/**
 * Whether every placeholder came back exactly once and no other did. Their
 * order may change, as a translation reorders a sentence; a missing, repeated
 * or unknown one means a part would not come back word for word.
 */
export function verify(translated: string, tokens: readonly string[]): Verdict {
  const seen = new Array<number>(tokens.length).fill(0)
  for (const m of translated.matchAll(PLACEHOLDER)) {
    const n = Number(m[1])
    if (n >= tokens.length) {
      return 'mismatch'
    }
    seen[n] = (seen[n] ?? 0) + 1
  }
  return seen.every(count => count === 1) ? 'ok' : 'mismatch'
}
