import { hash } from '../../core/hash'
import { dataDirOf } from '../../services/datadir'
import { readJson, writeJson } from '../../services/files'
import type { Host } from '../../host'

// F12 › 你发出的句子: the source-language text the band last translated for
// a message the person then sent in English, kept beside it so the message
// can be saved to the word book later, after /resume too. Keyed by the
// English as sent; never cleared with the cache.

export type KeptDraft = {
  /** The band's last F1 source text for this message */
  zh: string
  /** A translation showed while it was written */
  sawTranslation: boolean
}

export const draftFileOf = (dataDir: string, english: string) => {
  const key = hash(english)
  return `${dataDir}/drafts/${key.slice(0, 2)}/${key}.json`
}

export async function keepDraft(host: Host, english: string, kept: KeptDraft): Promise<void> {
  await writeJson(host, draftFileOf(await dataDirOf(host), english), { v: 1, ...kept })
}

export async function keptDraftOf(host: Host, english: string): Promise<KeptDraft | null> {
  const value = await readJson(host, draftFileOf(await dataDirOf(host), english))
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const { zh, sawTranslation } = value as Record<string, unknown>
  return typeof zh === 'string' ? { zh, sawTranslation: sawTranslation === true } : null
}
