import type { WweSettings, WweSettingsView } from '../../types'
import { toastText } from '../core/settings/format'
import { SETTING_KEYS, coerceSetting, storeKeyOf, viewOf } from '../core/settings/schema'
import type { SettingKey } from '../core/settings/schema'
import { KEY_STALE_FLAG as KEY_STALE } from '../core/settings/services'
import type { Host } from '../host'

// The settings in `$.store`, one key each and shared by every session on the
// machine, and their copy in `$.state.settings` for the drawings. A save reads
// the store again first, so what another session saved since shows too
// (interface.md › Save from more than one session).

/** Every setting as stored now; a missing or broken value reads as its default. */
export async function loadAll(host: Host): Promise<WweSettings> {
  const values = await Promise.all(
    SETTING_KEYS.map(async key => [key, coerceSetting(key, await host.store.get(storeKeyOf(key)))] as const),
  )
  return Object.fromEntries(values) as WweSettings
}

/** Whether the saved OpenAI key is held back from the address (CommitExtra's `keyStale`). */
export async function isKeyStale(host: Host): Promise<boolean> {
  return (await host.store.get(KEY_STALE)) === true
}

export type SaveOptions = {
  /** Saved with the value under the same toast, as 翻译延迟's unit */
  also?: Partial<WweSettings>
  /** The value as the toast names it, when what is stored is an id */
  label?: string
  /** A commit's `keyStale`: true sets the flag, false clears it, left out it stays */
  keyStale?: boolean
}

/**
 * Writes one setting (and `also`, and the key flag), shows the new settings
 * to the drawings and raises the toast. Resolves to every setting as now
 * stored. A failed store write rejects before the state or the toast changes.
 */
export async function saveSetting<K extends SettingKey>(
  host: Host,
  key: K,
  value: WweSettings[K],
  options: SaveOptions = {},
): Promise<WweSettings> {
  const fresh = await loadAll(host)
  const patch: Partial<WweSettings> = { ...options.also }
  patch[key] = value
  for (const k of Object.keys(patch) as SettingKey[]) {
    if (patch[k] !== undefined) {
      await host.store.set(storeKeyOf(k), patch[k])
    }
  }
  if (options.keyStale === true) {
    await host.store.set(KEY_STALE, true)
  } else if (options.keyStale === false) {
    await host.store.delete(KEY_STALE)
  }
  const settings: WweSettings = { ...fresh, ...patch }
  await host.state.settings.update(() => viewOf(settings))
  const text = toastText(key, value, settings, options.label)
  if (text !== null) {
    host.ui.toast(text)
  }
  return settings
}

/**
 * Reads every setting again and writes `$.state.settings` only when what the
 * drawings see changed, so the 5-second sync redraws nothing on its own.
 * Resolves to every setting as now stored, keys included, for the module's copy.
 */
export async function refresh(host: Host): Promise<WweSettings> {
  const settings = await loadAll(host)
  const view = viewOf(settings)
  if (!sameView(await host.state.settings.get(), view)) {
    await host.state.settings.update(() => view)
  }
  return settings
}

function sameView(a: WweSettingsView, b: WweSettingsView): boolean {
  return (Object.keys(b) as (keyof WweSettingsView)[]).every(k => a[k] === b[k])
}
