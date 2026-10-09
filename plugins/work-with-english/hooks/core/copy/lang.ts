// The two languages of the product (界面语言): the source language, the
// user's own, which the interface is written in; and the target language,
// the one they practise. The first version has Simplified Chinese and
// English alone, so the pair is fixed here rather than a setting.

export type LangId = 'zh' | 'en'

export type Lang = {
  /** What the band's rows start with (F1 › 语言) */
  code: string
  /** The language's name as each language writes it: a sentence names a language in its own language */
  names: Readonly<Record<LangId, string>>
}

export const LANGS: Readonly<Record<LangId, Lang>> = {
  zh: { code: 'ZH', names: { zh: '简体中文', en: 'Simplified Chinese' } },
  en: { code: 'EN', names: { zh: '英语', en: 'English' } },
}

export const SOURCE_LANG: LangId = 'zh'
export const TARGET_LANG: LangId = 'en'

/** The band's row code: `EN`, `ZH` */
export const codeOf = (id: LangId) => LANGS[id].code

/** The name an interface sentence uses, written in the source language: 英语 */
export const uiNameOf = (id: LangId) => LANGS[id].names[SOURCE_LANG]

/**
 * F5: the standard name Claude Code's `language` setting is written with
 * (`English`); only this spelling counts as already set.
 */
export const settingNameOf = (id: LangId) => LANGS[id].names.en
