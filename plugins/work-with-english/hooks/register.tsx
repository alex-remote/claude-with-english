import { atom, memberOf, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { DEFAULT_VIEW } from './core/settings/schema'
import { EMPTY_BOOK, INITIAL_PANE, NO_PARA, UNKNOWN_SAVED } from './core/state/defaults'
import { segment } from './core/text/segment'
import { localDate } from './core/time'
import { createBand } from './features/band/controller'
import type { Band } from './features/band/controller'
import { EMPTY_BAND } from './features/band/empty'
import { notFullscreen, startupToasts } from './features/env/toasts'
import { takeUnseenReport, weeklyReminder } from './features/stats/report'
import { bandView, isShown } from './features/band/view'
import { PANE_ID, createAnalyses } from './features/analysis/controller'
import { createSettings } from './features/settings/controller'
import type { Settings } from './features/settings/controller'
import { paneUiOf } from './features/settings/controls'
import type { Analyses } from './features/analysis/controller'
import { analysisView } from './features/analysis/view'
import { createPicker } from './features/pick/controller'
import type { Picker } from './features/pick/controller'
import { createReplies, translatable } from './features/reply/controller'
import type { Replies } from './features/reply/controller'
import { askLines, askView, blockOfLine, planOf, planView } from './features/reply/planAsk'
import { replyView } from './features/reply/view'
import type { ReplyPart } from './features/reply/view'
import { createSpeaker } from './features/speak/controller'
import type { Speaker } from './features/speak/controller'
import type { Host } from './host'
import { refresh } from './services/settings'
import { backupOrRestore } from './services/storeBackup'

// The one place that hooks events and calls `$`; the features under hooks/
// reach the engine through the Host bound here (docs/dev-plan.md, 架构).
// Every atom lives here too: the scan reads an atom only in the file that
// reads and updates it (docs/references/claude-code-docs.md, 开发约定 › 写法).

const settingsAtom = atom({ plugin: 'work-with-english', key: 'settings' } as const, DEFAULT_VIEW)
const envAtom = atom({ plugin: 'work-with-english', key: 'env' } as const, {
  surface: null,
  isFullscreen: null,
  isMacLocal: null,
})
const bandAtom = atom({ plugin: 'work-with-english', key: 'band' } as const, EMPTY_BAND)
const speakingAtom = atom({ plugin: 'work-with-english', key: 'speaking' } as const, null)
const paneAtom = atom({ plugin: 'work-with-english', key: 'pane' } as const, INITIAL_PANE)
const paraAtom = atom({ plugin: 'work-with-english', key: 'para' } as const, NO_PARA)
const analysisAtom = atom({ plugin: 'work-with-english', key: 'analysis' } as const, null)
const pickAtom = atom({ plugin: 'work-with-english', key: 'pick' } as const, null)
const savedAtom = atom({ plugin: 'work-with-english', key: 'saved' } as const, UNKNOWN_SAVED)
const bookAtom = atom({ plugin: 'work-with-english', key: 'book' } as const, EMPTY_BOOK)
const statsAtom = atom({ plugin: 'work-with-english', key: 'stats' } as const, null)

/** How often a session picks up settings another session changed (设置: 下次用到时就按新值来) */
const SETTINGS_SYNC_MS = 5000

/** How often paragraphs drawn without a translation in $.state are looked up in the cache */
const CACHE_LOAD_MS = 400

export const register: Register = on => {
  let host: Host | null = null
  let band: Band | null = null
  let speaker: Speaker | null = null
  let replies: Replies | null = null
  let analyses: Analyses | null = null
  let settings: Settings | null = null
  let picker: Picker | null = null
  /** F9: each reply's Markdown by the request id it is drawn under, to find a selection's sentence and code */
  const markdownByRequest = new Map<string, string>()
  let lastReadingMode: string | null = null
  /** The terminal's layout was seen once (运行环境 › 启动时的提示) */
  let isLayoutSeen = false

  /** The settings into $.state and the band's mirror, as $.store holds them now */
  async function loadSettings(bound: Host) {
    const settings = await refresh(bound)
    band?.setDelay(settings.delayMs)
    if (lastReadingMode !== null && lastReadingMode !== settings.readingMode) {
      await picker?.onReadingMode(settings.readingMode)
    }
    lastReadingMode = settings.readingMode
  }

  on('session.start', async ($, e, next) => {
    const bound: Host = {
      clock: {
        now: () => $.clock.now(),
        after: (ms, fn) => $.clock.after(ms, fn),
        every: (ms, fn) => $.clock.every(ms, fn),
      },
      model: { complete: (request, options) => $.model.complete(request, options) },
      http: { fetch: (url, init) => $.http.fetch(url, init) },
      proc: { run: (argv, init) => $.process.run(argv, init), spawn: request => $.process.spawn(request) },
      fs: {
        read: path => $.fs.read(path),
        readBytes: path => $.fs.read(path, { as: 'bytes' }),
        write: (path, text) => $.fs.write(path, text),
        list: path => $.fs.list(path),
        exists: path => $.fs.exists(path),
      },
      store: {
        get: key => $.store.get(key),
        set: (key, value) => $.store.set(key, value),
        delete: key => $.store.delete(key),
        keys: () => $.store.keys(),
      },
      env: {
        home: () => $.env.get('HOME'),
        configDir: () => $.env.get('CLAUDE_CONFIG_DIR'),
        pluginCacheDir: () => $.env.get('CLAUDE_CODE_PLUGIN_CACHE_DIR'),
        isSsh: async () =>
          (await $.env.get('SSH_CONNECTION')) !== undefined || (await $.env.get('SSH_TTY')) !== undefined,
        isDesktopApp: async () => (await $.env.get('CLAUDE_CODE_DESKTOP_APP_VERSION')) !== undefined,
      },
      ui: {
        toast: text => $.ui.toast(text),
        debug: text => $.ui.log(text, { to: 'debug' }),
        open: pane => $.ui.open(pane),
        close: pane => $.ui.close(pane),
        copy: args => $.ui.copy(args),
        selection: () => $.ui.selection(),
        invalidate: () => $.ui.invalidate('ui.render'),
      },
      prompt: {
        read: () => $.prompt.read(),
        fill: input => $.prompt.fill(input),
        submit: input => $.prompt.submit(input),
      },
      command: {
        register: spec => $.command.register(spec),
        list: () => $.command.list(),
      },
      settings: { read: args => $.settings.read(args) },
      config: {
        set: args => $.config.set(args),
        list: () => $.config.list(),
      },
      audio: {
        speak: (text, options) => $.audio.speak(text, options),
        play: (clip, options) => $.audio.play(clip, options),
      },
      session: {
        id: () => $.session.id(),
        surfaces: () => $.session.surfaces(),
        version: () => $.session.version(),
      },
      plugin: { name: $.plugin.name, root: $.plugin.root },
      state: {
        settings: { get: () => read($, settingsAtom), update: fn => update($, settingsAtom, fn) },
        env: { get: () => read($, envAtom), update: fn => update($, envAtom, fn) },
        band: { get: () => read($, bandAtom), update: fn => update($, bandAtom, fn) },
        speaking: { get: () => read($, speakingAtom), update: fn => update($, speakingAtom, fn) },
        pane: { get: () => read($, paneAtom), update: fn => update($, paneAtom, fn) },
        para: {
          get: id => read($, memberOf(paraAtom, { requestId: id })),
          update: (id, fn) => update($, memberOf(paraAtom, { requestId: id }), fn),
        },
        analysis: { get: () => read($, analysisAtom), update: fn => update($, analysisAtom, fn) },
        pick: { get: () => read($, pickAtom), update: fn => update($, pickAtom, fn) },
        saved: {
          get: id => read($, memberOf(savedAtom, { requestId: id })),
          update: (id, fn) => update($, memberOf(savedAtom, { requestId: id }), fn),
        },
        book: { get: () => read($, bookAtom), update: fn => update($, bookAtom, fn) },
        stats: { get: () => read($, statsAtom), update: fn => update($, statsAtom, fn) },
      },
    }
    host = bound
    band = createBand(bound)
    const speakerOf = createSpeaker(bound)
    speaker = speakerOf
    const repliesOf = createReplies(bound)
    replies = repliesOf
    const settingsOf = createSettings(bound, { speaker: speakerOf })
    settings = settingsOf
    // An analysis taking the pane commits the field being edited first (设置 › 保存)
    analyses = createAnalyses(bound, () => settingsOf.onClose())
    const pickerOf = createPicker(bound, {
      markdownOf: requestId => markdownByRequest.get(requestId),
      replies: () => [...markdownByRequest.values()],
    })
    picker = pickerOf
    if (e.surface === 'terminal') {
      pickerOf.watchTerminal()
    } else if (await bound.env.isDesktopApp().catch(() => false)) {
      pickerOf.watchDesktop()
    }
    await loadSettings(bound).catch(error => bound.ui.debug(`settings: ${String(error)}`))

    // After the first prompt can go: the store's backup first, before anything writes to it
    bound.clock.after(0, () => {
      void (async () => {
        const ms = await bound.clock.now()
        const today = localDate(ms, -new Date(ms).getTimezoneOffset())
        const outcome = await backupOrRestore(bound, today)
        if (outcome === 'restored') {
          await loadSettings(bound)
        }
        await startupToasts(bound)
        // After the other toasts (F13 › 周报提醒)
        await weeklyReminder(bound, today)
      })().catch(error => bound.ui.debug(`store backup: ${String(error)}`))
    })
    bound.clock.every(CACHE_LOAD_MS, () => {
      void repliesOf.loadNoted().catch(error => bound.ui.debug(`reply cache load: ${String(error)}`))
    })
    bound.clock.every(SETTINGS_SYNC_MS, () => {
      void loadSettings(bound).catch(error => bound.ui.debug(`settings sync: ${String(error)}`))
    })

    // Last, in its own try: a failed register must not stop the session's start
    try {
      await bound.command.register({
        name: 'wwe',
        description: '打开 work-with-english 设置',
        immediate: true,
      })
    } catch (error) {
      bound.ui.debug(`/wwe was not registered: ${String(error)}`)
    }

    return next(e)
  })

  // /clear, /resume and /branch reset $.state and start no session.start
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    replies?.forgetLooked()
    if (host) {
      await loadSettings(host).catch(error => host?.ui.debug(`settings: ${String(error)}`))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // /wwe: the settings, on 统计's last week while a weekly report waits to be seen; nothing printed
  on('command.run', { command: 'wwe' }, async () => {
    const bound = host
    if (bound && settings) {
      analyses?.cancel()
      const isReport = await takeUnseenReport(bound).catch(() => false)
      if (isReport) {
        await bound.state.pane.update(pane => ({ ...pane, statsRange: 'lastWeek' }))
      }
      await settings.open(isReport ? 'stats' : 'translate')
    }
    return {}
  }).catch(($, e, next) => next(e))

  // 设置 › 保存: the ring leaving a field commits it; closing the pane commits them all
  on('ui.focus', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    void settings?.onFocus(e).catch(error => host?.ui.debug(`settings focus: ${String(error)}`))
    return next(e)
  }).catch(($, e, next) => next(e))
  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    void settings?.onClose().catch(error => host?.ui.debug(`settings close: ${String(error)}`))
    return next(e)
  }).catch(($, e, next) => next(e))

  // F1 to F3: every edit of the Prompt; Control+A answered here, at once
  on('prompt.edit', async ($, e, next) => (band ? band.onEdit(e, next) : next(e))).catch(($, e, next) => next(e))

  // F4: the person's Enter
  on('prompt.submit', async ($, e, next) => {
    if (!band) {
      return next(e)
    }
    const result = await band.onSubmit(e, next)
    // F9: the selection line goes when the next message is sent
    if (result.drop === undefined && e.origin.kind === 'composer') {
      void picker?.close().catch(error => host?.ui.debug(`pick close: ${String(error)}`))
    }
    return result
  }).catch(($, e, next) => next(e))

  // The band above the prompt
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!band || e.props.hasSurvey) {
      return next(e)
    }
    band.markDrawn()
    if (!isLayoutSeen && e.surface === 'terminal' && e.viewport?.isFullscreen !== undefined) {
      isLayoutSeen = true
      const isFullscreen = e.viewport.isFullscreen
      const bound = host
      // Not while drawing: the toast and its flag go out from a timer
      bound?.clock.after(0, () => {
        void (async () => {
          await bound.state.env.update(env => ({ ...env, surface: 'terminal', isFullscreen }))
          if (!isFullscreen) {
            await notFullscreen(bound)
          }
        })().catch(error => bound.ui.debug(`layout: ${String(error)}`))
      })
    }
    const vm = { band: await read($, bandAtom), speaking: await read($, speakingAtom), pick: await read($, pickAtom) }
    if (!isShown(vm.band, vm.pick)) {
      return next(e)
    }
    const current = band
    const pick = vm.pick
    return bandView($.ui.resolve(e), vm, {
      replace: () => void current.replace().catch(error => host?.ui.debug(`replace: ${String(error)}`)),
      clear: () => void current.clear().catch(error => host?.ui.debug(`clear: ${String(error)}`)),
      speak: () => {
        const text = current.targetText()
        if (text && speaker) {
          void speaker.speak('band', text)
        }
      },
      sendAnyway: () => void current.sendAnyway().catch(error => host?.ui.debug(`send anyway: ${String(error)}`)),
      pickClose: () => void picker?.close().catch(error => host?.ui.debug(`pick close: ${String(error)}`)),
      pickSpeak: () => {
        if (pick && speaker) {
          void speaker.speak('pick', pick.text)
        }
      },
      pickAnalyse: () => {
        if (!pick || !analyses) {
          return
        }
        const done = pick.kind === 'word'
          ? analyses.analyseWord(pick.text, pick.sentence, picker?.lookupOf(pick) ?? null)
          : analyses.analyseText(pick.text, true)
        void done.catch(error => host?.ui.debug(`pick analyse: ${String(error)}`))
      },
      pickTranslate: () => void picker?.toggleTranslation().catch(error => host?.ui.debug(`pick translate: ${String(error)}`)),
    })
  })

  // F6: the main conversation's reply blocks, as they are kept
  on('session.append', ($, e, next) => {
    replies?.onAppend(e)
    return next(e)
  }).catch(($, e, next) => next(e))

  // F6: a turn's end, or Claude stopping to ask or to show its plan
  on('turn.complete', ($, e, next) => {
    replies?.onTurnComplete(e)
    return next(e)
  })
  on('tool.call', { tool: ['AskUserQuestion', 'ExitPlanMode'] }, async ($, e, next) => {
    const current = e.agentId === undefined ? replies : null
    current?.onWait()
    if (current && e.tool === 'AskUserQuestion') {
      void current.translateAsk(e.questions).catch(error => host?.ui.debug(`ask: ${String(error)}`))
    }
    const ran = await next(e)
    if (current && e.tool === 'ExitPlanMode') {
      void current.translatePlan(ran.result).catch(error => host?.ui.debug(`plan: ${String(error)}`))
    }
    return ran
  }).catch(($, e, next) => next(e))

  // F6 › 计划和提问: the question's translation above Claude Code's own dialog
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const lines = askLines(e.props.questions)
    if (!replies || lines.length === 0) {
      return next(e)
    }
    const paras = []
    for (const line of lines) {
      paras.push(await read($, memberOf(paraAtom, { requestId: blockOfLine(line).hash })))
    }
    if (paras.every(para => para.status === 'none')) {
      return next(e)
    }
    // Claude Code's dialog goes in exactly once, under the translation
    return askView($.ui.resolve(e), lines, paras, await next(e))
  })

  // F6 › 计划和提问: the approved plan's translation under it
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const plan = e.props.tool === 'ExitPlanMode' ? planOf(e.props.output) : null
    if (!replies || plan === null) {
      return next(e)
    }
    const blocks = segment(plan)
    const paras = []
    for (const block of blocks) {
      paras.push(await read($, memberOf(paraAtom, { requestId: block.hash })))
    }
    const drawn = await next(e)
    if (!drawn || paras.every(para => para.status === 'none')) {
      return drawn
    }
    return planView($.ui.resolve(e), blocks, paras, drawn)
  })

  // F6: each paragraph as Claude Code draws it, its translation under it
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    markdownByRequest.set(e.requestId, e.props.text)
    const current = replies
    const blocks = segment(e.props.text)
    if (!current || !blocks.some(translatable)) {
      return next(e)
    }
    const parts: ReplyPart[] = []
    for (const [index, block] of blocks.entries()) {
      const para = await read($, memberOf(paraAtom, { requestId: block.hash }))
      if (para.status === 'none' && translatable(block)) {
        current.note(block.hash)
      }
      const drawn = await next({
        ...e,
        props: { ...e.props, text: block.text, isFirstOfReply: e.props.isFirstOfReply && index === 0 },
      })
      if (drawn) {
        parts.push({ drawn, block, para, hasButtons: translatable(block) })
      }
    }
    return replyView(
      $.ui.resolve(e),
      parts,
      {
        toggle: block => void current.toggle(block).catch(error => host?.ui.debug(`reply toggle: ${String(error)}`)),
        speak: block => void speaker?.speak(`para-${block.hash}`, block.text),
        analyse: block =>
          void analyses?.analyseText(block.text, false).catch(error => host?.ui.debug(`analyse: ${String(error)}`)),
      },
      await read($, speakingAtom),
    )
  })

  // The one pane: the settings, or an analysis in their place (阅读辅助 › Pane 只有一个)
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const pane = await read($, paneAtom)
    if (pane.view === 'text' || pane.view === 'word') {
      const analysis = await read($, analysisAtom)
      const current = analyses
      if (analysis && current) {
        return analysisView($.ui.resolve(e), analysis, await read($, speakingAtom), {
          speak: (key, text) => void speaker?.speak(key, text),
          openWord: word => void current.analyseHardWord(word).catch(error => host?.ui.debug(`word: ${String(error)}`)),
          back: () => void current.back().catch(error => host?.ui.debug(`back: ${String(error)}`)),
        })
      }
    }
    const ui = paneUiOf($.ui.resolve(e))
    if (pane.view === 'settings' && settings && ui) {
      return settings.view(ui, { pane, settings: await read($, settingsAtom) })
    }
    return next(e)
  })
}
