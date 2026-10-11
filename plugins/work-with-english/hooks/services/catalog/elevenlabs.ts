import type { Host } from '../../host'
import { badFormat, describeListFailure } from '../translate/errors'
import type { Described } from '../translate/errors'
import { getJson } from '../translate/openai'
import type { Failed } from '../translate/types'

// F8: the models that can read aloud and the voices of an ElevenLabs
// account, asked with the Key in the `xi-api-key` header, never in the
// address. Asking and reading only; where the lists are kept and when they
// are asked again belong to the settings.

/** The default address only: no region setting (F8 › ElevenLabs 的地区) */
export const ELEVEN_API = 'https://api.elevenlabs.io'

export type ElevenModel = { id: string; name: string }
export type ElevenVoice = { id: string; name: string }

const field = (item: unknown, name: string): unknown => (item as Record<string, unknown> | null)?.[name]

/** The models with `can_do_text_to_speech`, or null when the body is not a list. */
export function speechModelsOf(json: unknown): ElevenModel[] | null {
  if (!Array.isArray(json)) {
    return null
  }
  return json.flatMap(item => {
    const id = field(item, 'model_id')
    const name = field(item, 'name')
    return field(item, 'can_do_text_to_speech') === true && typeof id === 'string' && id !== ''
      ? [{ id, name: typeof name === 'string' && name !== '' ? name : id }]
      : []
  })
}

/** `voices[]` as `{ id: voice_id, name }`, in the order given, or null when there is no list. */
export function voicesOf(json: unknown): ElevenVoice[] | null {
  const voices = field(json, 'voices')
  if (!Array.isArray(voices)) {
    return null
  }
  return voices.flatMap(item => {
    const id = field(item, 'voice_id')
    const name = field(item, 'name')
    return typeof id === 'string' && id !== '' ? [{ id, name: typeof name === 'string' && name !== '' ? name : id }] : []
  })
}

const failedList = (got: { status: number | null; described: Described }): Failed => ({
  ok: false,
  ...describeListFailure('elevenlabs', got.described, got.status),
})

export async function listModels(host: Host, key: string): Promise<{ ok: true; models: ElevenModel[] } | Failed> {
  const got = await getJson(host, `${ELEVEN_API}/v1/models`, { 'xi-api-key': key }, 'elevenlabs')
  if (!got.ok) {
    return failedList(got)
  }
  const models = speechModelsOf(got.json)
  return models ? { ok: true, models } : failedList({ status: null, described: badFormat })
}

/** The first 100 voices (one page), the account's own and the premade ones. */
export async function listVoices(host: Host, key: string): Promise<{ ok: true; voices: ElevenVoice[] } | Failed> {
  const url = `${ELEVEN_API}/v2/voices?page_size=100&include_total_count=false`
  const got = await getJson(host, url, { 'xi-api-key': key }, 'elevenlabs')
  if (!got.ok) {
    return failedList(got)
  }
  const voices = voicesOf(got.json)
  return voices ? { ok: true, voices } : failedList({ status: null, described: badFormat })
}
