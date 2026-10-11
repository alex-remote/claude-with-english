import { REQUEST_TIMEOUT_MS, raceTimeout } from '../../core/async/slot'
import { endpoints } from '../../core/endpoints'
import type { Host } from '../../host'
import { isKeyStale } from '../settings'
import { badFormat, describeApiError, errorCodeOf, network, timedOut } from './errors'
import type { Described, KeyStale, Service } from './errors'
import type { Prompt, TransportOutcome } from './types'

// The OpenAI-compatible transport: `$.http.fetch` to the chat address the
// 请求地址 leads to. The fetch has no timeout and can't be cancelled (P05),
// so it races 30 s on the clock and the caller's signal; an answer that comes
// after the race was lost is dropped.

export const TIMEOUT_MS = REQUEST_TIMEOUT_MS

type FetchInit = Parameters<Host['http']['fetch']>[1]

export type Fetched =
  | { ok: true; status: number; text: string }
  | { ok: false; reason: 'timeout' | 'aborted' }
  | { ok: false; reason: 'network'; message: string }

/** One request, or why it has no answer: 30 s passed, `signal` aborted, or it never reached the server. */
export async function fetchText(host: Host, url: string, init: FetchInit, signal?: AbortSignal): Promise<Fetched> {
  if (signal?.aborted) {
    return { ok: false, reason: 'aborted' }
  }
  let forget = () => {}
  const abort = new Promise<'aborted'>(resolve => {
    if (signal) {
      const onAbort = () => resolve('aborted')
      signal.addEventListener('abort', onAbort, { once: true })
      forget = () => signal.removeEventListener('abort', onAbort)
    }
  })
  try {
    const raced = await Promise.race([raceTimeout(host.http.fetch(url, init), TIMEOUT_MS, host.clock.after), abort])
    if (raced === 'aborted') {
      return { ok: false, reason: 'aborted' }
    }
    if (raced.timedOut) {
      return { ok: false, reason: 'timeout' }
    }
    return { ok: true, status: raced.value.status, text: raced.value.text }
  } catch (error) {
    return { ok: false, reason: 'network', message: error instanceof Error ? error.message : String(error) }
  } finally {
    forget()
  }
}

const isSuccess = (status: number) => status >= 200 && status < 300

export type Got = { ok: true; json: unknown } | { ok: false; status: number | null; described: Described }

/** A GET that answers JSON (the lists of models and voices), its failure in words. */
export async function getJson(host: Host, url: string, headers: Record<string, string>, service: Service): Promise<Got> {
  const fetched = await fetchText(host, url, { headers })
  if (!fetched.ok) {
    if (fetched.reason === 'network') {
      host.ui.debug(`GET ${url}: ${fetched.message}`)
    }
    return { ok: false, status: null, described: fetched.reason === 'network' ? network : timedOut }
  }
  if (!isSuccess(fetched.status)) {
    return { ok: false, status: fetched.status, described: describeApiError(service, fetched.status, errorCodeOf(fetched.text)) }
  }
  try {
    return { ok: true, json: JSON.parse(fetched.text) as unknown }
  } catch {
    return { ok: false, status: fetched.status, described: badFormat }
  }
}

/** `choices[0].message.content`, or null when the body has none. */
export function replyTextOf(body: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  const choices = (parsed as { choices?: unknown } | null)?.choices
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined
  const content = (first as { message?: { content?: unknown } } | undefined)?.message?.content
  return typeof content === 'string' ? content : null
}

export type OpenaiCall = {
  /** 请求地址: a Base URL or the full chat address */
  baseUrl: string
  key: string
  model: string
  signal?: AbortSignal
}

export async function completeWithOpenai(host: Host, prompt: Prompt, call: OpenaiCall): Promise<TransportOutcome | KeyStale> {
  // The Key is not sent to a new domain until it is entered again (F7)
  if (await isKeyStale(host)) {
    return { ok: false, reason: 'stale-key' }
  }
  const fetched = await fetchText(
    host,
    endpoints(call.baseUrl).chat,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${call.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: call.model,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.prompt },
        ],
      }),
    },
    call.signal,
  )
  if (!fetched.ok) {
    return fetched.reason === 'network'
      ? { ok: false, reason: 'api-error', status: null, error: fetched.message }
      : { ok: false, reason: 'aborted' }
  }
  if (!isSuccess(fetched.status)) {
    return { ok: false, reason: 'api-error', status: fetched.status, error: errorCodeOf(fetched.text) }
  }
  const text = replyTextOf(fetched.text)
  // Not the shape of a chat reply, or nothing in it: run() asks once more
  return text === null || text.trim() === '' ? { ok: false, reason: 'empty-reply' } : { ok: true, text }
}
