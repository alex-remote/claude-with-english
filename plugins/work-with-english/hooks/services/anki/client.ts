import type { Timer } from 'claude-code'

import { ANKI_REFUSED, ankiModelFieldsMissing, ankiModelRenamed } from '../../core/copy/wordbook'
import type { Host } from '../../host'
import { MODELS, missingFields, type AnkiModel } from './models'

// AnkiConnect, the Anki add-on (code 2055492159) that answers on
// 127.0.0.1:8765 while Anki is open: each call POSTs { action, version: 6,
// params } and gets { result, error } back.
// https://git.sr.ht/~foosoft/anki-connect/blob/master/README.md

export const ANKI_URL = 'http://127.0.0.1:8765'
export const ANKI_API_VERSION = 6
/** `$.http.fetch` has no timeout of its own; a sleeping Anki must not hold an add */
export const ANKI_TIMEOUT_MS = 3000

/** `$.store`: whether Anki ever answered, so the page explains it once until then */
export const EVER_KEY = 'flag/ankiEver'
/** `$.store`: our card types' ids in Anki, to tell a renamed one from a deleted one */
export const MODEL_IDS_KEY = 'anki/models'

/** Anki is not open, AnkiConnect is not there, or it did not answer in time */
export class AnkiOfflineError extends Error {}

/** AnkiConnect answered with an error */
export class AnkiCallError extends Error {}

/** Where syncing stands: connected, not, or stopped for the reason given */
export type AnkiConnection = 'ok' | 'offline' | { broken: string }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** One AnkiConnect action; its `result`, or AnkiOfflineError / AnkiCallError. */
export async function ankiCall<T>(host: Host, action: string, params?: Record<string, unknown>): Promise<T> {
  const body = JSON.stringify({ action, version: ANKI_API_VERSION, ...(params === undefined ? {} : { params }) })
  let timer: Timer | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = host.clock.after(ANKI_TIMEOUT_MS, () =>
      reject(new AnkiOfflineError(`${action}: no answer in ${ANKI_TIMEOUT_MS} ms`)),
    )
  })
  let response: Awaited<ReturnType<Host['http']['fetch']>>
  try {
    response = await Promise.race([host.http.fetch(ANKI_URL, { method: 'POST', body }), timeout])
  } catch (error) {
    throw error instanceof AnkiOfflineError ? error : new AnkiOfflineError(`${action}: ${messageOf(error)}`)
  } finally {
    timer?.cancel()
  }
  // Something else on the port, or an AnkiConnect that does not speak JSON
  if (!response.ok) {
    throw new AnkiOfflineError(`${action}: HTTP ${response.status}`)
  }
  let answer: unknown
  try {
    answer = JSON.parse(response.text)
  } catch {
    throw new AnkiOfflineError(`${action}: the answer is not JSON`)
  }
  if (typeof answer !== 'object' || answer === null || !('result' in answer)) {
    throw new AnkiOfflineError(`${action}: the answer has no result`)
  }
  const { result, error } = answer as { result: unknown; error?: unknown }
  if (error !== null && error !== undefined) {
    throw new AnkiCallError(`${action}: ${String(error)}`)
  }
  return result as T
}

export async function hasEverConnected(host: Host): Promise<boolean> {
  return (await host.store.get(EVER_KEY)) === true
}

async function markEver(host: Host): Promise<void> {
  if (!(await hasEverConnected(host))) {
    await host.store.set(EVER_KEY, true)
  }
}

async function knownModelIds(host: Host): Promise<Record<string, number>> {
  const value = await host.store.get(MODEL_IDS_KEY)
  const ids: Record<string, number> = {}
  if (typeof value === 'object' && value !== null) {
    for (const [name, id] of Object.entries(value)) {
      if (typeof id === 'number') {
        ids[name] = id
      }
    }
  }
  return ids
}

async function rememberModelIds(host: Host, inAnki: Readonly<Record<string, number>>): Promise<void> {
  const known = await knownModelIds(host)
  const ours: Record<string, number> = { ...known }
  for (const { modelName } of MODELS) {
    const id = inAnki[modelName]
    if (id !== undefined) {
      ours[modelName] = id
    }
  }
  if (MODELS.some(({ modelName }) => ours[modelName] !== known[modelName])) {
    await host.store.set(MODEL_IDS_KEY, ours)
  }
}

/**
 * Readies Anki for the word book: asks AnkiConnect's permission, makes the
 * deck and our two card types when they are not there. A card type of ours
 * renamed or missing a field of ours stops syncing, with the reason; one
 * deleted (its cards went with it) is made again.
 */
export async function ensureSetup(host: Host, deck: string): Promise<AnkiConnection> {
  try {
    type Permission = { permission?: unknown; requireApiKey?: unknown } | null
    const permission = await ankiCall<Permission>(host, 'requestPermission')
    await markEver(host)
    if (permission?.permission !== 'granted' || permission.requireApiKey === true) {
      return { broken: ANKI_REFUSED }
    }
    const decks = await ankiCall<string[]>(host, 'deckNames')
    if (!decks.includes(deck)) {
      await ankiCall(host, 'createDeck', { deck })
    }
    const inAnki = await ankiCall<Record<string, number>>(host, 'modelNamesAndIds')
    const known = await knownModelIds(host)
    const missing: AnkiModel[] = []
    for (const model of MODELS) {
      if (inAnki[model.modelName] !== undefined) {
        const fields = await ankiCall<string[]>(host, 'modelFieldNames', { modelName: model.modelName })
        const lost = missingFields(model, fields)
        if (lost.length > 0) {
          return { broken: ankiModelFieldsMissing(model.modelName, lost) }
        }
        continue
      }
      const id = known[model.modelName]
      const renamedTo = Object.keys(inAnki).find(name => id !== undefined && inAnki[name] === id)
      if (renamedTo !== undefined) {
        return { broken: ankiModelRenamed(model.modelName, renamedTo) }
      }
      missing.push(model)
    }
    for (const model of missing) {
      await ankiCall(host, 'createModel', { ...model })
    }
    const latest = missing.length > 0 ? await ankiCall<Record<string, number>>(host, 'modelNamesAndIds') : inAnki
    await rememberModelIds(host, latest)
    return 'ok'
  } catch (error) {
    if (!(error instanceof AnkiOfflineError)) {
      host.ui.debug(`anki setup: ${messageOf(error)}`)
    }
    return 'offline'
  }
}
