import { endpoints } from '../../core/endpoints'
import type { Host } from '../../host'
import { badFormat, describeListFailure } from '../translate/errors'
import { getJson } from '../translate/openai'
import type { Failed } from '../translate/types'

// F7 获取模型列表: the models an OpenAI-compatible 请求地址 offers
// (GET <base>/models, `data[].id`). Asking and reading only; when to ask
// and where the list is kept belong to the settings.

export type ModelList = {
  ok: true
  /** Each id once, sorted */
  ids: string[]
  /** The address asked, for “共 N 个，来自 <地址>” */
  from: string
}

/** The ids in a list-models body, or null when it has no `data` list. */
export function modelIdsOf(json: unknown): string[] | null {
  const data = (json as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) {
    return null
  }
  const ids = data
    .map(item => (item as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === 'string' && id !== '')
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}

export async function listModels(host: Host, baseUrl: string, key: string): Promise<ModelList | Failed> {
  const from = endpoints(baseUrl).models
  const got = await getJson(host, from, { Authorization: `Bearer ${key}` }, 'openai')
  if (!got.ok) {
    return { ok: false, ...describeListFailure('openai', got.described, got.status) }
  }
  const ids = modelIdsOf(got.json)
  return ids ? { ok: true, ids, from } : { ok: false, ...describeListFailure('openai', badFormat, null) }
}
