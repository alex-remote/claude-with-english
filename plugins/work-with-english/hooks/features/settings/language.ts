import type { SettingsSource } from 'claude-code'

import type { WweReplyLanguage } from '../../../types'
import { TARGET_LANG, settingNameOf } from '../../core/copy/lang'
import { replyLanguageSaved } from '../../core/copy/settings'
import type { FixedSource } from '../../core/copy/settings'
import type { Host } from '../../host'

// F5 回复语言: Claude Code's own `language` setting, shown as it takes effect
// and written only when the user presses 设为英语 (P07,
// docs/references/claude-code-docs.md › F5 回复语言).

/** The sources, highest precedence first: the first that sets `language` is where it comes from */
const BY_PRECEDENCE: readonly SettingsSource[] = ['policy', 'flag', 'local', 'project', 'user']

const languageOf = (settings: Readonly<Record<string, unknown>>) =>
  typeof settings.language === 'string' && settings.language !== '' ? settings.language : null

/** The merged value, and the source with the highest precedence that sets it. */
export async function readReplyLanguage(host: Host): Promise<WweReplyLanguage> {
  const value = languageOf(await host.settings.read())
  if (value === null) {
    return { value: null, source: null }
  }
  const sources = await Promise.all(
    BY_PRECEDENCE.map(async source => {
      try {
        return languageOf(await host.settings.read({ source })) !== null
      } catch {
        return false
      }
    }),
  )
  // Set and in none of them: inline settings a host passed, as `--settings` does
  return { value, source: BY_PRECEDENCE[sources.indexOf(true)] ?? 'flag' }
}

/**
 * What the row under 回复语言 offers. Only the standard name counts as the
 * target language; a source above the user's own settings can't be written
 * from here, so it is named instead of 设为英语.
 */
export type ReplyLanguageRow = { kind: 'matches' } | { kind: 'settable' } | { kind: 'fixed'; source: FixedSource }

export function replyLanguageRow(language: WweReplyLanguage): ReplyLanguageRow {
  if (language.value === settingNameOf(TARGET_LANG)) {
    return { kind: 'matches' }
  }
  if (language.value === null || language.source === null || language.source === 'user') {
    return { kind: 'settable' }
  }
  return { kind: 'fixed', source: language.source }
}

/** 设为英语: writes the user's settings as /config would, then shows what now takes effect. */
export async function setTargetLanguage(host: Host): Promise<void> {
  const written = await host.config.set({ key: 'language', value: settingNameOf(TARGET_LANG) })
  if (written.deny === undefined) {
    host.ui.toast(replyLanguageSaved())
  } else {
    host.ui.debug(`language was not written: ${written.deny}`)
  }
  const replyLanguage = await readReplyLanguage(host)
  await host.state.pane.update(pane => ({ ...pane, replyLanguage }))
}
