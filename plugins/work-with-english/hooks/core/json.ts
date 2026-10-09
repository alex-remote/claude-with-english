// What a model was asked to answer in JSON (F15's correction, F6's
// paragraphs, F9's lookup, F11's analysis) often comes back in a ```json
// fence, sometimes after a line of prose. The caller checks the value's
// shape; a reply cut off by maxTokens only shows up here, as a parse error.

export type ParsedJson = { ok: true; value: unknown } | { ok: false; error: string }

/** The reply's JSON, out of its fence when it has one. */
export function parseModelJson(text: string): ParsedJson {
  try {
    return { ok: true, value: JSON.parse(unfence(text)) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * The text inside the first fence that starts a line, or the whole text
 * trimmed when there is none. JSON never holds a raw line break inside a
 * string, so the first line that starts with ``` after the opening one
 * closes the fence even when a value holds backticks.
 */
export function unfence(text: string): string {
  const start = text.search(/(?:^|\n)[ \t]*```/)
  if (start === -1) {
    return text.trim()
  }
  let body = text.slice(text.indexOf('```', start) + 3).replace(/^[\w-]*/, '')
  const close = body.search(/\n[ \t]*```/)
  if (close !== -1) {
    body = body.slice(0, close)
  } else {
    body = body.trimEnd()
    if (body.endsWith('```')) {
      body = body.slice(0, -3)
    }
  }
  return body.trim()
}
