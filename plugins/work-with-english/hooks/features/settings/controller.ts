import type { UiFocusInput } from 'claude-code'

import type { WwePane, WweSettings, WweSettingsView, WweTab, WweSpeaking } from '../../../types'
import {
  CACHE_CLEAR_FAILED,
  PANE_TITLE,
  cacheCleared,
  configDeleted,
  elevenFailed,
  modelsFailed,
} from '../../core/copy/settings'
import type { ServiceTab } from '../../core/copy/settings'
import { REPO_URL } from '../../core/copy/share'
import { delayFieldText } from '../../core/settings/format'
import { CUSTOM_MODEL_OPTION, commitInput, resetDelay, selectValue, switchDelayUnit } from '../../core/settings/save'
import type { Commit, CommitExtra, InputKey, SelectKey } from '../../core/settings/save'
import { coerceSetting, storeKeyOf, viewOf } from '../../core/settings/schema'
import {
  CATALOG_KEYS,
  KEY_STALE_FLAG,
  SERVICE_SETTINGS,
  elevenListOf,
  englishVoicesOf,
  isSpeechReady,
  openaiListOf,
} from '../../core/settings/services'
import { INITIAL_PANE } from '../../core/state/defaults'
import { localDate } from '../../core/time'
import type { Host } from '../../host'
import { listModels as listOpenaiModels } from '../../services/catalog/openai'
import { listModels as listElevenModels, listVoices as listElevenVoices } from '../../services/catalog/elevenlabs'
import { dataDirOf } from '../../services/datadir'
import { removeDir, sizeOfKb } from '../../services/files'
import { isKeyStale, loadAll, refresh, saveSetting } from '../../services/settings'
import { writeNow } from '../../services/storeBackup'
import type { Speaker } from '../speak/controller'
import type { ControlKey, PaneActions, PaneSlots, PaneUi, PaneVm, SwitchKey } from './controls'
import { readReplyLanguage, setTargetLanguage } from './language'
import { paneView } from './pane'
import { MODEL_ALIASES, allowedOf, isServiceReady, serviceTabOf } from './pages/services'

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
  openaiBaseUrl: 'openai-url',
  openaiKey: 'openai-key',
  openaiModel: 'openai-model-id',
  openaiTtsModel: 'openai-tts-model',
  elevenKey: 'eleven-key',
}

/** The dropdown each picked setting is chosen in, drawn again when a pick is refused */
const SELECTS: Partial<Record<SelectKey, ControlKey>> = {
  translateService: 'translate-service',
  autoReply: 'auto-reply',
  claudeModel: 'claude-model',
  openaiModel: 'openai-model',
  elevenModel: 'eleven-model',
  speechService: 'speech-service',
  voiceSystem: 'voice-system',
  voiceOpenai: 'voice-openai',
  voiceEleven: 'voice-eleven',
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

/** The tab 去配置翻译服务 opens: the service still to configure */
const CONFIGURE_TAB: ServiceTab = 'openai'

/** What 试听 reads under, as the speaker keys a reading (features/speak/controller.ts) */
const TRY_KEY = 'try'

const IDLE = { status: 'idle', error: null } as const

/** Today on this machine's calendar, YYYY-MM-DD, as the store's backup is dated (register.tsx) */
async function todayOf(host: Host): Promise<string> {
  const ms = await host.clock.now()
  return localDate(ms, -new Date(ms).getTimezoneOffset())
}

export type Settings = ReturnType<typeof createSettings>

export type SettingsDeps = {
  /** F8: 试听 on the 阅读 page */
  speaker?: Speaker
  /** A page came into view, by /wwe or a tab: the 单词本 and 统计 pages load what they show */
  onTab?: (tab: WweTab) => void
  /** 同步到 Anki turned on in this pane: what waits goes into Anki (F12 › 关掉同步时) */
  onAnkiSyncOn?: () => void
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
  /** Counted up by each fetch of a service's lists: the answer to an older one is dropped (通用状态 › 被取代) */
  let openaiGen = 0
  let elevenGen = 0
  /** 试听 pressed in this pane is still reading */
  let isTrying = false
  /** The fetches and measurements under way, outside the queue: they may take 30 s */
  const running = new Set<Promise<void>>()

  /** Starts work that must not hold up the controls; its failure goes to the debug log */
  function background(name: string, work: () => Promise<void>) {
    const done = work().catch(error => host.ui.debug(`settings ${name}: ${String(error)}`))
    running.add(done)
    void done.finally(() => running.delete(done))
  }

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
      await afterKeySave(setting, commit)
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

  /**
   * What the address and the keys are committed with (F7 获取模型列表): the
   * OpenAI key is held back from a new domain, and a key whose last fetch
   * failed counts as saved again when it is entered again.
   */
  async function keyExtra(setting: InputKey): Promise<CommitExtra> {
    if (setting === 'openaiBaseUrl' || setting === 'openaiKey') {
      const pane = await host.state.pane.get()
      return { keyStale: await isKeyStale(host), fetchFailed: pane.openaiFetch.status === 'failed' }
    }
    if (setting === 'elevenKey') {
      return { fetchFailed: (await host.state.pane.get()).elevenFetch.status === 'failed' }
    }
    return {}
  }

  async function commitField(setting: InputKey) {
    const draft = drafts.get(setting)
    if (draft === undefined) {
      return
    }
    drafts.delete(setting)
    const saved = await loadAll(host)
    const unit = shownUnit ?? saved.delayUnit
    const extra = { unit, ...(await keyExtra(setting)) }
    await settle(setting, draft, commitInput(setting, draft, saved, extra), saved, unit)
  }

  /**
   * After the address or a key is saved: the hint about a new domain follows
   * the flag, and the lists are fetched again when the commit asks (F7).
   */
  async function afterKeySave(setting: InputKey, commit: Extract<Commit<InputKey>, { kind: 'save' }>) {
    if (commit.keyStale !== undefined) {
      const keyStale = commit.keyStale
      await host.state.pane.update(pane => ({ ...pane, keyStale }))
    }
    if (setting === 'openaiBaseUrl' && commit.keyStale === true && !commit.refetch) {
      // A list asked of the old address is no answer for the new one
      openaiGen += 1
      await host.state.pane.update(pane => ({ ...pane, openaiFetch: IDLE }))
    }
    if (commit.refetch) {
      if (setting === 'elevenKey') {
        background('eleven fetch', fetchEleven)
      } else {
        background('openai fetch', fetchOpenai)
      }
    }
  }

  /**
   * F7 获取模型列表: the address's models with the saved key. The list goes to
   * `$.store` (catalog/openai) and the page; a failure keeps the last list and
   * says why under the dropdown. Each start drops the answer to the one before.
   */
  async function fetchOpenai() {
    const gen = ++openaiGen
    await host.state.pane.update(pane => ({ ...pane, openaiFetch: { status: 'loading', error: null } }))
    const saved = await loadAll(host)
    if (saved.openaiBaseUrl === '' || saved.openaiKey === '' || saved.openaiManual || (await isKeyStale(host))) {
      if (gen === openaiGen) {
        await host.state.pane.update(pane => ({ ...pane, openaiFetch: IDLE }))
      }
      return
    }
    const got = await listOpenaiModels(host, saved.openaiBaseUrl, saved.openaiKey)
    if (gen !== openaiGen) {
      return
    }
    if (!got.ok) {
      const error = modelsFailed(got.reason)
      await host.state.pane.update(pane => ({ ...pane, openaiFetch: { status: 'failed', error } }))
      return
    }
    const list = { ids: got.ids, from: got.from }
    await host.store.set(CATALOG_KEYS.openai, list)
    await host.state.pane.update(pane => ({ ...pane, openaiList: list, openaiFetch: IDLE }))
  }

  /**
   * F8: the ElevenLabs account's models that can read aloud and its voices.
   * A voice is saved when none is, the list's first, so reading needs no list
   * of its own in each session. A failure keeps the key, the last lists and
   * what was picked from them (F7 › ElevenLabs).
   */
  async function fetchEleven() {
    const gen = ++elevenGen
    await host.state.pane.update(pane => ({ ...pane, elevenFetch: { status: 'loading', error: null } }))
    const key = coerceSetting('elevenKey', await host.store.get(storeKeyOf('elevenKey')))
    if (key === '') {
      if (gen === elevenGen) {
        await host.state.pane.update(pane => ({ ...pane, elevenFetch: IDLE }))
      }
      return
    }
    const [models, voices] = await Promise.all([listElevenModels(host, key), listElevenVoices(host, key)])
    if (gen !== elevenGen) {
      return
    }
    const failed = !models.ok ? models : !voices.ok ? voices : null
    if (failed !== null || !models.ok || !voices.ok) {
      const error = elevenFailed(failed?.reason ?? '')
      await host.state.pane.update(pane => ({ ...pane, elevenFetch: { status: 'failed', error } }))
      return
    }
    const list = { models: models.models, voices: voices.voices }
    await host.store.set(CATALOG_KEYS.elevenlabs, list)
    const first = list.voices[0]
    if (first && coerceSetting('voiceEleven', await host.store.get(storeKeyOf('voiceEleven'))) === '') {
      await host.store.set(storeKeyOf('voiceEleven'), first.id)
      await refresh(host)
    }
    await host.state.pane.update(pane => ({ ...pane, elevenList: list, elevenFetch: IDLE }))
  }

  /** F8: the system's English voices, once a session; none when `say` can't list them */
  async function readSystemVoices() {
    let names: string[] = []
    try {
      const run = await host.proc.run(['say', '-v', '?'])
      if (run.exitCode === 0) {
        names = englishVoicesOf(run.stdout)
      } else {
        host.ui.debug(`say -v ?: exited ${run.exitCode}: ${run.stderr.trim()}`)
      }
    } catch (error) {
      host.ui.debug(`say -v ?: ${String(error)}`)
    }
    await host.state.pane.update(pane => ({ ...pane, systemVoices: names }))
  }

  /** The two folders 清除 empties: the replies' translations and the online audio (dev-plan › 数据目录里的文件) */
  async function cachePaths(): Promise<string[]> {
    const dir = await dataDirOf(host)
    return [`${dir}/replies`, `${dir}/tts`]
  }

  /** 本机缓存's size; the last size stays shown while it is measured again */
  async function measureCache() {
    try {
      const kb = await sizeOfKb(host, await cachePaths())
      await host.state.pane.update(pane => ({ ...pane, cache: { status: 'done', kb } }))
    } catch (error) {
      host.ui.debug(`cache size: ${String(error)}`)
      await host.state.pane.update(pane => ({ ...pane, cache: { status: 'failed', kb: 0 } }))
    }
  }

  /** A page came into view: the 阅读 page measures the cache and, the first time, lists the system's voices */
  async function onPageShown(tab: WweTab) {
    deps.onTab?.(tab)
    if (tab !== 'reading') {
      return
    }
    const pane = await host.state.pane.get()
    background('cache size', measureCache)
    if (pane.systemVoices === null) {
      background('system voices', readSystemVoices)
    }
  }

  /** F6 › 存多久: 确定清除 removes the two folders and says how much it freed */
  async function clearCache() {
    await host.state.pane.update(pane => ({ ...pane, confirm: null, cache: { status: 'loading', kb: pane.cache.kb } }))
    const paths = await cachePaths()
    try {
      const kb = await sizeOfKb(host, paths)
      for (const path of paths) {
        await removeDir(host, path)
      }
      await host.state.pane.update(pane => ({ ...pane, cache: { status: 'done', kb: 0 } }))
      host.ui.toast(cacheCleared(kb))
    } catch (error) {
      host.ui.debug(`cache clear: ${String(error)}`)
      host.ui.toast(CACHE_CLEAR_FAILED)
      await measureCache()
    }
  }

  /**
   * F7 删除配置: every setting of the service, its key and its lists go. A
   * service in use gives way to the default, the toast says so, and the
   * store's backup is written again at once so the key leaves no copy there.
   */
  async function deleteConfig(service: 'openai' | 'elevenlabs') {
    if (service === 'openai') {
      openaiGen += 1
    } else {
      elevenGen += 1
    }
    const saved = await loadAll(host)
    const translateBack = service === 'openai' && saved.translateService === 'openai'
    const speechBack = saved.speechService === service
    const settings = SERVICE_SETTINGS[service]
    const fields: ControlKey[] = []
    for (const key of settings) {
      await host.store.delete(storeKeyOf(key))
      const field = FIELDS[key as InputKey]
      if (field) {
        drafts.delete(key as InputKey)
        refused.delete(key as InputKey)
        fields.push(field)
      }
    }
    await host.store.delete(CATALOG_KEYS[service])
    if (service === 'openai') {
      await host.store.delete(KEY_STALE_FLAG)
    }
    if (translateBack) {
      await host.store.set(storeKeyOf('translateService'), 'claude')
    }
    if (speechBack) {
      await host.store.set(storeKeyOf('speechService'), 'system')
    }
    await refresh(host)
    await host.state.pane.update(pane => {
      const errors = Object.fromEntries(
        Object.entries(pane.errors).filter(([key]) => !(settings as readonly string[]).includes(key)),
      )
      const emptied =
        service === 'openai'
          ? { openaiList: null, openaiFetch: IDLE, keyStale: false }
          : { elevenList: null, elevenFetch: IDLE }
      return { ...pane, ...emptied, errors, confirm: null }
    })
    await rekey(...fields, service === 'openai' ? 'openai-model' : 'eleven-model')
    try {
      await writeNow(host, await todayOf(host))
    } catch (error) {
      host.ui.debug(`store backup after 删除配置: ${String(error)}`)
    }
    host.ui.toast(configDeleted(service, translateBack, speechBack))
  }

  /** F7 手动填写: switches how 翻译模型 is filled in; unticked, the list is fetched once */
  async function toggleManual() {
    await commitField('openaiModel')
    const saved = await loadAll(host)
    const commit = selectValue('openaiManual', !saved.openaiManual, saved, { keyStale: await isKeyStale(host) })
    if (commit.kind !== 'save') {
      return
    }
    await saveSetting(host, 'openaiManual', commit.value)
    if (commit.value) {
      // Ticked: no list is asked, and the answer to one under way is not wanted
      openaiGen += 1
      await host.state.pane.update(pane => ({ ...pane, openaiFetch: IDLE }))
    } else if (commit.refetch) {
      background('openai fetch', fetchOpenai)
    }
  }

  /** F8 试听: the current service and voice read a sample; pressed while it reads online, it stops */
  async function tryVoice() {
    const speaker = deps.speaker
    if (!speaker) {
      return
    }
    const pane = await host.state.pane.get()
    if (pane.trying === 'online') {
      await speaker.stop()
      return
    }
    if (pane.trying === 'system' || isTrying) {
      return
    }
    const service = coerceSetting('speechService', await host.store.get(storeKeyOf('speechService')))
    const trying = service === 'system' ? 'system' : 'online'
    isTrying = true
    await host.state.pane.update(current => ({ ...current, trying }))
    try {
      await speaker.test(TRY_KEY)
    } finally {
      isTrying = false
      await host.state.pane.update(current => ({ ...current, trying: null }))
    }
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

  async function switchTab(tab: WweTab, svcTab?: ServiceTab, autoFocus: WwePane['autoFocus'] = null) {
    await commitAll()
    await closeCustom()
    const settings = await host.state.settings.get()
    const sub = tab === 'services' ? { svcTab: svcTab ?? serviceTabOf(settings.translateService) } : {}
    await host.state.pane.update(pane => ({ ...pane, tab, ...sub, confirm: null, autoFocus }))
    await onPageShown(tab)
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
      (setting === 'translateService' && !isServiceReady(value as WweSettings['translateService'], viewOf(saved))) ||
      (setting === 'speechService' && !isSpeechReady(value as WweSettings['speechService'], viewOf(saved)))
    const commit = selectValue(setting, value, saved, { isDisabled })
    if (setting === 'claudeModel') {
      isCustomOpen = false
      drafts.delete('claudeModel')
      await clearError('claudeModel')
    }
    if (commit.kind === 'save') {
      // An ElevenLabs voice is stored by its id and named in the toast
      const label =
        setting === 'voiceEleven'
          ? (await host.state.pane.get()).elevenList?.voices.find(voice => voice.id === value)?.name
          : undefined
      await saveSetting(host, setting, commit.value, label === undefined ? {} : { label })
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
      if (setting === 'ankiSync' && commit.value === true) {
        deps.onAnkiSyncOn?.()
      }
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
        await host.state.pane.update(pane => ({ ...pane, svcTab: tab, confirm: null, autoFocus: null }))
      }),
    gotoServices: () => act('goto services', () => switchTab('services', CONFIGURE_TAB)),
    gotoSpeech: () => act('goto speech', () => switchTab('services', 'openai', 'openai-tts-model')),
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
    toggleManual: () => act('manual', toggleManual),
    // Not in the queue: 停止 must not wait for the reading it stops
    tryVoice: () => void tryVoice().catch(error => host.ui.debug(`settings try: ${String(error)}`)),
    ask: what => act('ask', () => host.state.pane.update(pane => ({ ...pane, confirm: what })).then(() => undefined)),
    cancel: () => act('cancel', () => host.state.pane.update(pane => ({ ...pane, confirm: null })).then(() => undefined)),
    confirm: () =>
      act('confirm', async () => {
        const { confirm } = await host.state.pane.get()
        if (confirm === 'clear-cache') {
          await clearCache()
        } else if (confirm === 'delete-openai') {
          await deleteConfig('openai')
        } else if (confirm === 'delete-elevenlabs') {
          await deleteConfig('elevenlabs')
        }
      }),
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
        // The lists another session fetched since, and its key flag
        const [openaiList, elevenList, keyStale] = await Promise.all([
          host.store.get(CATALOG_KEYS.openai).then(openaiListOf),
          host.store.get(CATALOG_KEYS.elevenlabs).then(elevenListOf),
          isKeyStale(host),
        ]).catch(error => {
          host.ui.debug(`settings lists: ${String(error)}`)
          return [null, null, false] as const
        })
        await host.state.pane.update(pane => ({
          // A pane kept from before a reload may lack what this version draws
          ...INITIAL_PANE,
          ...pane,
          view: 'settings',
          tab,
          svcTab: serviceTabOf(settings?.translateService ?? 'claude'),
          errors: {},
          confirm: null,
          replyLanguage,
          openaiList,
          elevenList,
          keyStale,
          trying: isTrying ? (pane.trying ?? null) : null,
          autoFocus: null,
        }))
        await host.ui.open({ id: PANE_ID, title: PANE_TITLE, focus: true, closeOnEscape: true })
        await onPageShown(tab)
      })
    },

    /** Resolves once the fetches and measurements started so far are done (for tests) */
    async settled() {
      while (running.size > 0) {
        await Promise.all([...running])
      }
    },

    /** The whole pane, from the two `$.state` values the Pane hook reads */
    view(ui: PaneUi, vm: { pane: WwePane; settings: WweSettingsView; slots?: PaneSlots; speaking?: WweSpeaking }) {
      const { settings } = vm
      // A pane kept from before a reload may lack what this version draws
      const pane: WwePane = { ...INITIAL_PANE, ...vm.pane }
      const model: PaneVm = {
        pane,
        slots: vm.slots ?? {},
        speaking: vm.speaking ?? null,
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
