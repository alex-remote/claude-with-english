import type { SelectOption } from 'claude-code'

import { CLAUDE_MODEL_LABELS, CUSTOM_MODEL_LABEL, DEFAULT_SUFFIX, NOT_IN_LIST_SUFFIX } from '../copy/settings'
import { CUSTOM_MODEL_OPTION } from './save'
import { DEFAULT_SETTINGS } from './schema'

// F7 › Claude Code 账号: the 模型 dropdown under an organization's
// `availableModels` (model-config.md › Restrict model selection), and the
// model a translation then uses. The 服务 page draws the one and the
// translation service sends the other, so both read the same rule.

export const MODEL_ALIASES = ['haiku', 'sonnet', 'opus'] as const

const isAlias = (model: string): model is (typeof MODEL_ALIASES)[number] =>
  (MODEL_ALIASES as readonly string[]).includes(model)

/** `availableModels` as the merged settings hold it; null when it restricts nothing */
export function allowedOf(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const list = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
  return list.length === 0 ? null : list
}

const familyOf = (id: string) => MODEL_ALIASES.find(alias => id.includes(alias)) ?? null

/**
 * Whether the organization's list lets a model through (model-config.md ›
 * Restrict model selection): an entry names a family, a version prefix or a
 * full id, and an alias passes while any version of its family does.
 */
export function isModelAllowed(model: string, allowed: readonly string[] | null): boolean {
  if (allowed === null) {
    return true
  }
  const wanted = model.trim().toLowerCase()
  return allowed.some(raw => {
    const entry = raw.trim().toLowerCase()
    if (isAlias(wanted)) {
      return familyOf(entry) === wanted
    }
    if (isAlias(entry)) {
      return familyOf(wanted) === entry
    }
    return wanted === entry || wanted.startsWith(`${entry}-`)
  })
}

export type ModelChoice = {
  options: SelectOption[]
  /** What the dropdown shows */
  value: string
  /** The model as the 翻译 page names it: Claude Code 账号（Haiku） */
  label: string
  /** The alias the default Haiku gave way to, as named */
  replacedBy: string | null
  /** The id field under the dropdown shows */
  hasField: boolean
}

/**
 * The 模型 dropdown under an organization's list: only what it allows, the
 * default Haiku given up for the first that is allowed, and a saved model
 * the list leaves out still shown, marked （列表里没有）(F7).
 */
export function modelChoice(saved: string, allowed: readonly string[] | null, isCustomOpen: boolean): ModelChoice {
  const permitted: readonly string[] = MODEL_ALIASES.filter(alias => isModelAllowed(alias, allowed))
  const replacement = saved === DEFAULT_SETTINGS.claudeModel && !permitted.includes(saved) ? permitted[0] : undefined
  const options: SelectOption[] = MODEL_ALIASES.filter(
    alias => permitted.includes(alias) || (alias === saved && replacement === undefined),
  ).map(alias => ({
    value: alias,
    label:
      (CLAUDE_MODEL_LABELS[alias] ?? alias) +
      (alias === DEFAULT_SETTINGS.claudeModel ? DEFAULT_SUFFIX : '') +
      (permitted.includes(alias) ? '' : NOT_IN_LIST_SUFFIX),
  }))
  const isSavedAlias = isAlias(saved)
  options.push({
    value: CUSTOM_MODEL_OPTION,
    label: CUSTOM_MODEL_LABEL + (isSavedAlias || isModelAllowed(saved, allowed) ? '' : NOT_IN_LIST_SUFFIX),
  })
  const shown = replacement ?? saved
  const hasField = isCustomOpen || !isSavedAlias
  return {
    options,
    value: hasField ? CUSTOM_MODEL_OPTION : shown,
    label: isSavedAlias ? (CLAUDE_MODEL_LABELS[shown] ?? shown) : saved,
    replacedBy: replacement === undefined ? null : (CLAUDE_MODEL_LABELS[replacement] ?? replacement),
    hasField,
  }
}

/**
 * The model a translation with the Claude Code account sends: the saved one,
 * or for the default Haiku the organization doesn't allow, the first alias it
 * does, as the dropdown shows (modelChoice). A saved model the list later
 * leaves out goes as it is, and the engine's refusal says to change it.
 */
export function modelInUse(saved: string, allowed: readonly string[] | null): string {
  const choice = modelChoice(saved, allowed, false)
  return choice.hasField ? saved : choice.value
}
