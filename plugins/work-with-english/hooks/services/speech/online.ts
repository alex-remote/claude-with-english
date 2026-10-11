import { REQUEST_TIMEOUT_MS } from '../../core/async/slot'
import { endpoints, isHttpUrl } from '../../core/endpoints'
import { hashParts } from '../../core/hash'
import { coerceSetting, storeKeyOf } from '../../core/settings/schema'
import type { SettingKey } from '../../core/settings/schema'
import { speakable } from '../../core/text/speakable'
import type { Host } from '../../host'
import type { WweSettings } from '../../../types'
import { ELEVEN_API, listVoices } from '../catalog/elevenlabs'
import { dataDirOf } from '../datadir'
import { remove } from '../files'
import { isKeyStale } from '../settings'
import { describeApiError, errorCodeOf, generic, keyStale, network, noVoice, notConfigured, timedOut } from '../translate/errors'
import type { Described } from '../translate/errors'
import type { Failed } from '../translate/types'

// F8 在线语音: one piece of text read by OpenAI's speech endpoint or by
// ElevenLabs, as an audio file in the data directory. `$.http.fetch` can't
// carry binary and `$.fs.write` writes only text (P05, M6 probe), so curl
// downloads it: the whole request, the Key included, is a config on curl's
// stdin (`-K -`), never in its arguments. The file is the cache, so the same
// service, model, voice and text are paid for once.

export const SPEECH_TIMEOUT_MS = REQUEST_TIMEOUT_MS

/**
 * A piece's longest text: about 1.5 minutes of speech, so each clip stays
 * well under the 4 MiB `$.fs.read` takes, and the first one comes sooner.
 */
export const ONLINE_MAX_CHARS = 1500

/** 声音 › OpenAI 默认 coral */
export const DEFAULT_OPENAI_VOICE = 'coral'

export type SpeechService = 'openai' | 'elevenlabs'

export type SpeechRequest = {
  service: SpeechService
  text: string
  /** OpenAI's voice name, or ElevenLabs' voice_id; '' is the default (coral, or the account's first voice) */
  voice: string
  model: string
}

export type Speech = { ok: true; path: string; mime: string; isCached: boolean } | Failed

const MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4' } as const
type Ext = keyof typeof MIME

/** Both services are asked for mp3; a server that answers AAC in MP4 gets .m4a */
const extOf = (contentType: string): Ext => (/mp4|m4a|aac/i.test(contentType) ? 'm4a' : 'mp3')

// curl's exit codes: 22 an HTTP error (fail-with-body), 28 its own timeout;
// these never reached a server or lost it on the way
const CURL_HTTP_ERROR = 22
const CURL_TIMEOUT = 28
const CURL_NETWORK = new Set([5, 6, 7, 35, 52, 55, 56, 60])

/** What online speech reads: speakable()'s pieces, cut again at sentence ends to at most ONLINE_MAX_CHARS. */
export function onlinePieces(markdown: string): string[] {
  return speakable(markdown).flatMap(piece => cut(piece, ONLINE_MAX_CHARS))
}

function cut(text: string, max: number): string[] {
  const out: string[] = []
  let rest = text
  while (rest.length > max) {
    const head = rest.slice(0, max)
    let at = 0
    for (const end of head.matchAll(/[.!?。！？]+["'”’)\]]*\s+|\n+/g)) {
      at = (end.index ?? 0) + end[0].length
    }
    if (at === 0) {
      at = head.lastIndexOf(' ') + 1
    }
    if (at === 0) {
      at = /[\uD800-\uDBFF]/.test(head.slice(-1)) ? max - 1 : max
    }
    out.push(rest.slice(0, at).trim())
    rest = rest.slice(at)
  }
  out.push(rest.trim())
  return out.filter(piece => piece !== '')
}

/** One value of a curl config line: double quoted, `\` and `"` escaped; a line break would end the line, so it throws. */
export function curlQuote(value: string): string {
  if (/[\r\n\0]/.test(value)) {
    throw new Error('a curl config value cannot hold a line break')
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export type CurlRequest = { url: string; headers: Record<string, string>; body: string }

/** A POST as the config `curl -K -` reads; stdout gets "<status> <content type>". */
export function curlConfig(request: CurlRequest, output: string): string {
  return (
    [
      `url = ${curlQuote(request.url)}`,
      'request = "POST"',
      ...Object.entries(request.headers).map(([name, value]) => `header = ${curlQuote(`${name}: ${value}`)}`),
      `data-binary = ${curlQuote(request.body)}`,
      `output = ${curlQuote(output)}`,
      'create-dirs',
      'fail-with-body',
      'silent',
      'show-error',
      'write-out = "%{http_code} %{content_type}"',
    ].join('\n') + '\n'
  )
}

export function openaiSpeechRequest(baseUrl: string, key: string, piece: { text: string; voice: string; model: string }): CurlRequest {
  return {
    url: endpoints(baseUrl).speech,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: piece.model, input: piece.text, voice: piece.voice, response_format: 'mp3' }),
  }
}

export function elevenSpeechRequest(key: string, piece: { text: string; voice: string; model: string }): CurlRequest {
  return {
    url: `${ELEVEN_API}/v1/text-to-speech/${encodeURIComponent(piece.voice)}?output_format=mp3_44100_128`,
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: piece.text, model_id: piece.model }),
  }
}

const failed = (described: Described): Failed => ({ ok: false, ...described })

/** Read now, not from the mirror, as translate/index.ts does. */
async function readSetting<K extends SettingKey>(host: Host, key: K): Promise<WweSettings[K]> {
  return coerceSetting(key, await host.store.get(storeKeyOf(key)))
}

// Per Host: the ElevenLabs account's first voice by Key, once asked; the
// downloads running, by cache key, so a piece pressed again waits for its
// download instead of paying for a second one.
const firstVoices = new WeakMap<Host, Map<string, string>>()
const running = new WeakMap<Host, Map<string, Promise<Speech>>>()

function mapOf<V>(maps: WeakMap<Host, Map<string, V>>, host: Host): Map<string, V> {
  let map = maps.get(host)
  if (!map) {
    map = new Map()
    maps.set(host, map)
  }
  return map
}

async function firstVoiceOf(host: Host, key: string): Promise<{ ok: true; id: string } | Failed> {
  const known = mapOf(firstVoices, host).get(key)
  if (known) {
    return { ok: true, id: known }
  }
  const listed = await listVoices(host, key)
  if (!listed.ok) {
    return listed
  }
  const first = listed.voices[0]
  if (!first) {
    return failed(noVoice)
  }
  mapOf(firstVoices, host).set(key, first.id)
  return { ok: true, id: first.id }
}

/** tts/<hh>/<hash>: the same service, model, voice and text, the same file. */
export const speechHashOf = (request: SpeechRequest) =>
  hashParts([request.service, request.model, request.voice, request.text])

async function cachedIn(host: Host, dir: string, hash: string): Promise<{ path: string; mime: string } | null> {
  let entries: Awaited<ReturnType<Host['fs']['list']>>
  try {
    entries = await host.fs.list(dir)
  } catch {
    return null
  }
  for (const ext of Object.keys(MIME) as Ext[]) {
    if (entries.some(entry => entry.name === `${hash}.${ext}` && entry.kind === 'file' && entry.size > 0)) {
      return { path: `${dir}/${hash}.${ext}`, mime: MIME[ext] }
    }
  }
  return null
}

const discard = (host: Host, path: string) => remove(host, path).catch(() => {})

function curlFailure(service: SpeechService, exitCode: number, status: number, body: string): Described {
  if (exitCode === CURL_TIMEOUT) {
    return timedOut
  }
  if (exitCode === CURL_HTTP_ERROR || (exitCode === 0 && status > 0)) {
    return describeApiError(service, status, errorCodeOf(body))
  }
  return CURL_NETWORK.has(exitCode) ? network : generic
}

async function download(host: Host, service: SpeechService, dir: string, hash: string, request: CurlRequest): Promise<Speech> {
  // A name of its own, so a download cut short is never taken for the cache
  const part = `${dir}/${hash}-${Math.random().toString(36).slice(2, 10)}.part`
  let run: Awaited<ReturnType<Host['proc']['run']>>
  try {
    run = await host.proc.run(['curl', '-K', '-'], { stdin: curlConfig(request, part), timeoutMs: SPEECH_TIMEOUT_MS })
  } catch (error) {
    // Still running at 30 s: the engine ended curl and rejected (P05)
    host.ui.debug(`speech ${service}: ${String(error)}`)
    await discard(host, part)
    return failed(/still running/i.test(String(error)) ? timedOut : generic)
  }
  const [, code = '000', contentType = ''] = /^(\d{3})\s*(.*)$/s.exec(run.stdout.trim()) ?? []
  const status = Number(code)
  if (run.exitCode !== 0 || status < 200 || status >= 300) {
    const body = run.exitCode === CURL_HTTP_ERROR ? await host.fs.read(part).catch(() => '') : ''
    await discard(host, part)
    host.ui.debug(`speech ${service}: curl exited ${run.exitCode}, HTTP ${code}: ${run.stderr.trim()}`)
    return failed(curlFailure(service, run.exitCode, status, body))
  }
  const ext = extOf(contentType)
  const path = `${dir}/${hash}.${ext}`
  const moved = await host.proc.run(['mv', '-f', part, path])
  if (moved.exitCode !== 0) {
    host.ui.debug(`speech ${service}: mv exited ${moved.exitCode}: ${moved.stderr.trim()}`)
    await discard(host, part)
    return failed(generic)
  }
  return { ok: true, path, mime: MIME[ext], isCached: false }
}

async function synthesizeOnce(host: Host, request: SpeechRequest): Promise<Speech> {
  const { service, text, model } = request
  const key = await readSetting(host, service === 'openai' ? 'openaiKey' : 'elevenKey')
  let voice = request.voice
  if (voice === '' && service === 'openai') {
    voice = DEFAULT_OPENAI_VOICE
  } else if (voice === '') {
    if (key === '') {
      return failed(notConfigured)
    }
    const first = await firstVoiceOf(host, key)
    if (!first.ok) {
      return first
    }
    voice = first.id
  }
  const piece = { service, text, voice, model }
  const hash = speechHashOf(piece)
  const dir = `${await dataDirOf(host)}/tts/${hash.slice(0, 2)}`
  const hit = await cachedIn(host, dir, hash)
  if (hit) {
    return { ok: true, ...hit, isCached: true }
  }

  let curlRequest: CurlRequest
  if (service === 'openai') {
    const baseUrl = await readSetting(host, 'openaiBaseUrl')
    if (!isHttpUrl(baseUrl) || key === '' || model === '') {
      return failed(notConfigured)
    }
    // The Key is not sent to a new domain until it is entered again (F7)
    if (await isKeyStale(host)) {
      return failed(keyStale)
    }
    curlRequest = openaiSpeechRequest(baseUrl, key, piece)
  } else {
    if (key === '' || model === '') {
      return failed(notConfigured)
    }
    curlRequest = elevenSpeechRequest(key, piece)
  }

  const downloads = mapOf(running, host)
  let pending = downloads.get(hash)
  if (!pending) {
    pending = download(host, service, dir, hash, curlRequest).finally(() => downloads.delete(hash))
    downloads.set(hash, pending)
  }
  return pending
}

/**
 * The audio file of one piece (one of `onlinePieces`), from the cache or
 * downloaded into it; `mime` is what `$.audio.play` is given with its bytes.
 */
export async function synthesize(host: Host, request: SpeechRequest): Promise<Speech> {
  try {
    return await synthesizeOnce(host, request)
  } catch (error) {
    host.ui.debug(`speech ${request.service}: ${String(error)}`)
    return failed(generic)
  }
}

/** Drops a cached file that would not play, so the next press downloads it again. */
export const forget = (host: Host, path: string) => discard(host, path)
