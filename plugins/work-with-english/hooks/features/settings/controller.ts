import type { UiFocusInput } from 'claude-code'

import type { WwePane, WweSettings, WweSettingsView, WweTab } from '../../../types'
import { PANE_TITLE } from '../../core/copy/settings'
import type { ServiceTab } from '../../core/copy/settings'
import { REPO_URL } from '../../core/copy/share'
import { delayFieldText } from '../../core/settings/format'
import { CUSTOM_MODEL_OPTION, commitInput, resetDelay, selectValue, switchDelayUnit } from '../../core/settings/save'
import type { Commit, InputKey, SelectKey } from '../../core/settings/save'
import { coerceSetting, viewOf } from '../../core/settings/schema'
import type { Host } from '../../host'
import { loadAll, refresh, saveSetting } from '../../services/settings'
import type { Speaker } from '../speak/controller'
import type { ControlKey, PaneActions, PaneSlots, PaneUi, PaneVm, SwitchKey } from './controls'
import { readReplyLanguage, setTargetLanguage } from './language'
import { paneView } from './pane'
import { MODEL_ALIASES, SERVICE_TABS, allowedOf, isServiceReady, serviceTabOf } from './pages/services'

// The settings pane behind /wwe (设置): opens it, draws it, and saves each
// control by the rules of 设置 › 保存. A field's draft lives here, never in
// $.state, so a redraw can't write over what is being typed (P24). A field
// is left only by Enter, Tab or a click on another control, a tab, or the
// pane closing: a click on the Prompt raises nothing (P24), so those are the
// moments a draft is committed.

/** The one pane's id: the settings now, the analyses from M4 */
export const PANE_ID = 'wwe'

/** The field each typed setting is edited in */
const FIELDS: Partial<Record<InputKey, ControlKey>> = {
  delayMs: 'delay',
  autoReplyCount: 'reply-count',
  ankiDeck: 'anki-deck',
  claudeModel: 'model-id',
}

/** The dropdown each picked setting is chosen in, drawn again when a pick is refused */
const SELECTS: Partial<Record<SelectKey, ControlKey>> = {
  translateService: 'translate-service',
  autoReply: 'auto-reply',
  claudeModel: 'claude-model',
}

const settingOfField = (control: string) =>
  (Object.keys(FIELDS) as InputKey[]).find(setting => FIELDS[setting] === control) ?? null

/** A control's key without the generation a redraw gave it */
const baseOf = (key: string) => key.split('#')[0] ?? key

const isAlias = (model: string) => (MODEL_ALIASES as readonly string[]).includes(model)

/** The text a field shows for a saved value */
function fieldTextOf(setting: InputKey, saved: WweSettings, unit: WweSettings['delayUnit']): string {
  switch (setting) {
    case 'delayMs':
      return delayFieldText(saved.delayMs, unit)
    case 'claudeModel':
      return isAlias(saved.claudeModel) ? '' : saved.claudeModel
    // A key field is drawn empty, its mask in the placeholder (设置 › 保存)
    case 'openaiKey':
    case 'elevenKey':
      return ''
    default:
      return String(saved[setting])
  }
}

/** The tab 去配置翻译服务 opens: the service still to configure, once there is one */
const CONFIGURE_TAB: ServiceTab = SERVICE_TABS.includes('openai') ? 'openai' : 'claude'

export type Settings = ReturnType<typeof createSettings>

export type SettingsDeps = {
  /** F8: 试听 on the 阅读 page */
  speaker?: Speaker
  /** A page came into view, by /wwe or a tab: the 单词本 and 统计 pages load what they show */
  onTab?: (tab: WweTab) => void
}

export function createSettings(host: Host, deps: SettingsDeps = {}) {
  /** What each field holds while edited, by setting */
  const drafts = new Map<InputKey, string>()
  /** The settings whose field shows a red line, as pane.errors does */
  const refused = new Set<InputKey>()
  /** The generation a control was last drawn again at; its key carries it */
  const generations = new Map<ControlKey, number>()
  let generation = 0
  /** The control that has the focus ring, as ui.focus last said */
  let focused: string | null = null
  /** The unit picked beside 翻译延迟 and not saved yet */
  let shownUnit: WweSettings['delayUnit'] | null = null
  /** 自定义模型 id picked, its id not typed yet */
  let isCustomOpen = false
  /** The organization's availableModels, read each time the pane opens */
  let allowedModels: readonly string[] | null = null

  // One change at a time: a press can come while the focus moving onto it still saves
  let queue: Promise<unknown> = Promise.resolve()
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }
  /** A control's work, in turn; the promise settles once it is done and never rejects */
  const act = (name: string, task: () => Promise<void>) =>
    serial(task).catch(error => host.ui.debug(`settings ${name}: ${String(error)}`))

  /** Draws the controls again under new keys, so they show the saved value (P24) */
  async function rekey(...controls: ControlKey[]) {
    generation += 1
    for (const control of controls) {
      generations.set(control, generation)
    }
    await host.state.pane.update(pane => ({ ...pane, rev: pane.rev + 1 }))
  }

  async function setError(setting: InputKey, message: string) {
    refused.add(setting)
    await host.state.pane.update(pane => ({ ...pane, errors: { ...pane.errors, [setting]: message } }))
  }

  async function clearError(setting: InputKey) {
    if (!refused.delete(setting)) {
      return
    }
    await host.state.pane.update(pane => {
      const { [setting]: _, ...errors } = pane.errors
      return { ...pane, errors }
    })
  }

  /** A field's commit: saved, refused with its red line, or put back to the saved value */
  async function settle(
    setting: InputKey,
    draft: string,
    commit: Commit<InputKey>,
    saved: WweSettings,
    unit: WweSettings['delayUnit'],
  ) {
    if (commit.kind === 'invalid') {
      // Typing since the commit began wins over the draft it took
      if (!drafts.has(setting)) {
        drafts.set(setting, draft)
      }
      await setError(setting, commit.message)
      return
    }
    await clearError(setting)
    let after = saved
    if (commit.kind === 'save') {
      after = await saveSetting(host, setting, commit.value, { also: commit.also, keyStale: commit.keyStale })
      if (setting === 'delayMs') {
        shownUnit = null
      }
    }
    const controls: ControlKey[] = []
    const shown = fieldTextOf(setting, after, shownUnit ?? after.delayUnit)
    // The field keeps what was typed until its value prop changes: emptied, or
    // typed as another spelling of the same value, it is drawn afresh
    if (commit.kind === 'revert' || (draft.trim() !== shown && fieldTextOf(setting, saved, unit) === shown)) {
      const field = FIELDS[setting]
      if (field) {
        controls.push(field)
      }
    }
    if (setting === 'claudeModel') {
      isCustomOpen = false
      if (commit.kind === 'revert') {
        controls.push('claude-model')
      }
    }
    if (controls.length > 0) {
      await rekey(...controls)
    }
  }

  async function commitField(setting: InputKey) {
    const draft = drafts.get(setting)
    if (draft === undefined) {
      return
    }
    drafts.delete(setting)
    const saved = await loadAll(host)
    const unit = shownUnit ?? saved.delayUnit
    await settle(setting, draft, commitInput(setting, draft, saved, { unit }), saved, unit)
  }

  async function commitAll() {
    for (const setting of [...drafts.keys()]) {
      await commitField(setting)
    }
  }

  async function closeCustom() {
    if (!isCustomOpen) {
      return
    }
    isCustomOpen = false
    drafts.delete('claudeModel')
    await rekey('claude-model')
  }

  async function switchTab(tab: WweTab, svcTab?: ServiceTab) {
    await commitAll()
    await closeCustom()
    const settings = await host.state.settings.get()
    const sub = tab === 'services' ? { svcTab: svcTab ?? serviceTabOf(settings.translateService) } : {}
    await host.state.pane.update(pane => ({ ...pane, tab, ...sub }))
    deps.onTab?.(tab)
  }

  async function pick(setting: SelectKey, raw: string) {
    if (setting === 'claudeModel' && raw === CUSTOM_MODEL_OPTION) {
      isCustomOpen = true
      host.ui.invalidate()
      return
    }
    // Only one of the setting's own values; a model id is any text
    if (coerceSetting(setting, raw) !== raw) {
      return
    }
    const value = raw as WweSettings[SelectKey]
    const saved = await loadAll(host)
    const isDisabled =
      setting === 'translateService' && !isServiceReady(value as WweSettings['translateService'], viewOf(saved))
    const commit = selectValue(setting, value, saved, { isDisabled })
    if (setting === 'claudeModel') {
      isCustomOpen = false
      drafts.delete('claudeModel')
      await clearError('claudeModel')
    }
    if (commit.kind === 'save') {
      await saveSetting(host, setting, commit.value)
    } else if (commit.kind === 'revert') {
      const select = SELECTS[setting]
      if (select) {
        await rekey(select)
      }
    }
    host.ui.invalidate()
  }

  async function flip(setting: SwitchKey) {
    const saved = await loadAll(host)
    const commit = selectValue(setting, !saved[setting], saved)
    if (commit.kind === 'save') {
      await saveSetting(host, setting, commit.value)
    }
  }

  /** The unit beside 翻译延迟: a number typed before is read in the new unit; the unit alone saves nothing */
  async function changeUnit(raw: string) {
    if (raw !== 'ms' && raw !== 's') {
      return
    }
    const saved = await loadAll(host)
    const from = shownUnit ?? saved.delayUnit
    if (raw === from) {
      return
    }
    const draft = drafts.get('delayMs') ?? null
    drafts.delete('delayMs')
    shownUnit = raw
    const commit = switchDelayUnit(draft, saved, from, raw)
    if (commit.kind === 'noop') {
      await clearError('delayMs')
    } else {
      await settle('delayMs', draft ?? '', commit, saved, raw)
    }
    host.ui.invalidate()
  }

  async function reset() {
    drafts.delete('delayMs')
    await clearError('delayMs')
    shownUnit = null
    const saved = await loadAll(host)
    const commit = resetDelay(saved)
    if (commit.kind === 'save') {
      await saveSetting(host, 'delayMs', commit.value, { also: commit.also })
    }
    host.ui.invalidate()
  }

  const actions: PaneActions = {
    tab: tab => act('tab', () => switchTab(tab)),
    serviceTab: tab =>
      act('service tab', async () => {
        await commitAll()
        await closeCustom()
        await host.state.pane.update(pane => ({ ...pane, svcTab: tab }))
      }),
    gotoServices: () => act('goto services', () => switchTab('services', CONFIGURE_TAB)),
    github: () =>
      host.proc
        .run(['open', REPO_URL])
        .then(result => {
          if (result.exitCode !== 0) {
            host.ui.debug(`open ${REPO_URL}: ${result.stderr}`)
          }
        })
        .catch(error => host.ui.debug(`open ${REPO_URL}: ${String(error)}`)),
    edit: (setting, text) => {
      drafts.set(setting, text)
      focused = FIELDS[setting] ?? focused
    },
    submit: (setting, text) => {
      drafts.set(setting, text)
      focused = FIELDS[setting] ?? focused
      return act('submit', () => commitField(setting))
    },
    pick: (setting, value) => act('pick', () => pick(setting, value)),
    flip: setting => act('flip', () => flip(setting)),
    delayUnit: unit => act('unit', () => changeUnit(unit)),
    resetDelay: () => act('reset', reset),
    setReplyLanguage: () => act('language', () => setTargetLanguage(host)),
  }

  return {
    /**
     * /wwe: reads the settings and F5's language again, then opens the pane
     * on `tab` with the keyboard in it. From M8 the caller passes 'stats'
     * while a weekly report is unseen.
     */
    open(tab: WweTab = 'translate') {
      return serial(async () => {
        await commitAll()
        drafts.clear()
        generations.clear()
        focused = null
        shownUnit = null
        isCustomOpen = false
        refused.clear()
        const [settings, replyLanguage, allowed] = await Promise.all([
          refresh(host).catch(error => {
            host.ui.debug(`settings: ${String(error)}`)
            return null
          }),
          readReplyLanguage(host).catch(error => {
            host.ui.debug(`language: ${String(error)}`)
            return null
          }),
          host.settings
            .read()
            .then(merged => allowedOf(merged.availableModels))
            .catch(error => {
              host.ui.debug(`availableModels: ${String(error)}`)
              return null
            }),
        ])
        allowedModels = allowed
        await host.state.pane.update(pane => ({
          ...pane,
          view: 'settings',
          tab,
          svcTab: serviceTabOf(settings?.translateService ?? 'claude'),
          errors: {},
          confirm: null,
          replyLanguage,
        }))
        await host.ui.open({ id: PANE_ID, title: PANE_TITLE, focus: true, closeOnEscape: true })
        deps.onTab?.(tab)
      })
    },

    /** The whole pane, from the two `$.state` values the Pane hook reads */
    view(ui: PaneUi, vm: { pane: WwePane; settings: WweSettingsView; slots?: PaneSlots }) {
      const { pane, settings } = vm
      const model: PaneVm = {
        pane,
        slots: vm.slots ?? {},
        settings,
        delayUnit: shownUnit ?? settings.delayUnit,
        isCustomModelOpen: isCustomOpen,
        allowedModels,
        key: control => {
          const at = generations.get(control)
          return at === undefined ? control : `${control}#${at}`
        },
        fieldText: (setting, saved) =>
          pane.errors[setting] === undefined ? saved : (drafts.get(setting) ?? saved),
      }
      return paneView(ui, model, actions)
    },

    /** ui.focus in the pane: leaving a field commits what was typed in it */
    onFocus(e: UiFocusInput) {
      return serial(async () => {
        const next = e.element === undefined ? null : baseOf(e.element)
        const previous = focused
        focused = next
        if (previous === next) {
          return
        }
        const setting = previous === null ? null : settingOfField(previous)
        if (setting !== null) {
          await commitField(setting)
        }
        // 自定义模型 id left without an id: the dropdown goes back to the saved model
        if (next !== 'claude-model' && next !== 'model-id') {
          await closeCustom()
        }
      })
    },

    /** ui.close, before the pane goes: every draft is committed as on leaving its field */
    onClose() {
      return serial(async () => {
        await commitAll()
        drafts.clear()
        generations.clear()
        focused = null
        shownUnit = null
        isCustomOpen = false
      })
    },
  }
}
