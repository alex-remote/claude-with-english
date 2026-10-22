import { atom, memberOf, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { WwePara } from '../types'
import { settingsOpenedFromMessage } from './core/copy/settings'
import { isTasksArg, tasksOpenedFromMessage } from './core/copy/tasks'
import { DEFAULT_VIEW } from './core/settings/schema'
import { EMPTY_BOOK, FIRST_ASK_TAB, INITIAL_PANE, NOT_ASKING, NOT_SENT, NO_CARD, NO_PARA, NO_TASKS, UNKNOWN_SAVED } from './core/state/defaults'
import { hash } from './core/hash'
import { isWweCommand, wweArgsOf } from './core/text/command'
import { segment } from './core/text/segment'
import { localDate } from './core/time'
import { createBand } from './features/band/controller'
import type { Band } from './features/band/controller'
import { EMPTY_BAND } from './features/band/empty'
import { createCard } from './features/env/card'
import type { Card } from './features/env/card'
import { WRAP_UP_TOOL, cardQuote, cardTexts } from './features/env/nextStep'
import { sentView } from './features/env/sentView'
import { notFullscreen, startupToasts } from './features/env/toasts'
import { takeUnseenReport, weeklyReminder } from './features/stats/report'
import { bandView, isShown } from './features/band/view'
import { PANE_ID, createAnalyses } from './features/analysis/controller'
import { createSettings } from './features/settings/controller'
import type { Settings } from './features/settings/controller'
import { paneUiOf } from './features/settings/controls'
import type { PaneSlots } from './features/settings/controls'
import type { Analyses } from './features/analysis/controller'
import { analysisView } from './features/analysis/view'
import type { AnalysisSaved } from './features/analysis/view'
import { createPicker } from './features/pick/controller'
import type { Picker } from './features/pick/controller'
import { createReplies, translatable } from './features/reply/controller'
import type { Replies } from './features/reply/controller'
import { askLines, askView, blockOfLine, planOf, planView } from './features/reply/planAsk'
import { descriptionOf, toolLineView } from './features/reply/toolLine'
import { replyOnceView, replyView, wholeToggle, withTranslations } from './features/reply/view'
import type { ReplyPart } from './features/reply/view'
import { createSpeaker } from './features/speak/controller'
import type { Speaker } from './features/speak/controller'
import { createWordbook, hasMineButtons, savedKeyOf } from './features/wordbook/controller'
import type { Wordbook } from './features/wordbook/controller'
import { ankiLine, bookLists, mineView } from './features/wordbook/view'
import { createStatsPage } from './features/stats/controller'
import type { StatsPage } from './features/stats/controller'
import { statsSlot } from './features/stats/view'
import { shareUiOf, shareView } from './features/share/view'
import { TASKS_PANE, createTasks } from './features/tasks/controller'
import type { Tasks } from './features/tasks/controller'
import { PLAN_TOOL, stepBlock } from './features/tasks/plan'
import { tasksView } from './features/tasks/view'
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
const tasksAtom = atom({ plugin: 'work-with-english', key: 'tasks' } as const, NO_TASKS)
const cardAtom = atom({ plugin: 'work-with-english', key: 'card' } as const, NO_CARD)
const sentAtom = atom({ plugin: 'work-with-english', key: 'sent' } as const, NOT_SENT)
const askingAtom = atom({ plugin: 'work-with-english', key: 'asking' } as const, NOT_ASKING)
const askTabAtom = atom({ plugin: 'work-with-english', key: 'askTab' } as const, FIRST_ASK_TAB)

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
  let wordbook: Wordbook | null = null
  let statsPage: StatsPage | null = null
  let tasks: Tasks | null = null
  let card: Card | null = null
  /** F9: each reply's Markdown by the request id it is drawn under, to find a selection's sentence and code */
  const markdownByRequest = new Map<string, string>()
  let lastReadingMode: string | null = null
  /** The terminal's layout was seen once (运行环境 › 启动时的提示) */
  let isLayoutSeen = false
  /**
   * Something draws the session: the desktop app attaches only the session on
   * screen, so a toast in one nobody has open shows nowhere (2.1.304, 实测 10-22)
   */
  let markShown = () => {}
  const shown = new Promise<void>(resolve => {
    markShown = resolve
  })

  const todayOf = async (bound: Host) => {
    const ms = await bound.clock.now()
    return localDate(ms, -new Date(ms).getTimezoneOffset())
  }

  /** /wwe: the settings, on 统计's last week while a weekly report waits to be seen */
  async function openSettings() {
    const bound = host
    if (bound && settings) {
      analyses?.cancel()
      const isReport = await takeUnseenReport(bound).catch(() => false)
      if (isReport) {
        await bound.state.pane.update(pane => ({ ...pane, statsRange: 'lastWeek' }))
      }
      await settings.open(isReport ? 'stats' : 'translate')
    }
  }

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
        tasks: { get: () => read($, tasksAtom), update: fn => update($, tasksAtom, fn) },
        card: {
          get: id => read($, memberOf(cardAtom, { requestId: id })),
          update: (id, fn) => update($, memberOf(cardAtom, { requestId: id }), fn),
        },
        sent: {
          get: id => read($, memberOf(sentAtom, { requestId: id })),
          update: (id, fn) => update($, memberOf(sentAtom, { requestId: id }), fn),
        },
        asking: { get: () => read($, askingAtom), update: fn => update($, askingAtom, fn) },
        askTab: {
          get: id => read($, memberOf(askTabAtom, { requestId: id })),
          update: (id, fn) => update($, memberOf(askTabAtom, { requestId: id }), fn),
        },
      },
    }
    host = bound
    band = createBand(bound, {
      closePick: async () => {
        await picker?.close()
      },
    })
    const speakerOf = createSpeaker(bound)
    speaker = speakerOf
    const repliesOf = createReplies(bound)
    replies = repliesOf
    const wordbookOf = createWordbook(bound)
    wordbook = wordbookOf
    const statsOf = createStatsPage(bound)
    statsPage = statsOf
    tasks = createTasks(bound, { translate: blocks => repliesOf.translateLines(blocks) })
    card = createCard(bound, { translate: blocks => repliesOf.translateLines(blocks) })
    const settingsOf = createSettings(bound, {
      speaker: speakerOf,
      onTab: tab => {
        if (tab === 'wordbook') {
          void wordbookOf.loadPage().catch(error => bound.ui.debug(`word book page: ${String(error)}`))
        }
        if (tab === 'stats') {
          void statsOf.load().catch(error => bound.ui.debug(`stats page: ${String(error)}`))
        }
      },
      // The switch is on the 单词本 page: its line on Anki shows, and what waited goes in
      onAnkiSyncOn: () => void wordbookOf.loadPage().catch(error => bound.ui.debug(`anki catch up: ${String(error)}`)),
    })
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
        const outcome = await backupOrRestore(bound, await todayOf(bound))
        if (outcome === 'restored') {
          await loadSettings(bound)
        }
        // A session Claude started beside this one, or one left in the sidebar, waits until it is opened
        if ((await bound.session.surfaces()).length === 0) {
          await shown
        }
        await startupToasts(bound)
        // After the other toasts (F13 › 周报提醒)
        await weeklyReminder(bound, await todayOf(bound))
      })().catch(error => bound.ui.debug(`store backup: ${String(error)}`))
    })
    // Loaded again (an update, a reload) while its predecessor translated: what it left at 翻译中… goes again
    bound.clock.after(0, () => {
      void repliesOf.resume().catch(error => bound.ui.debug(`reply resume: ${String(error)}`))
    })
    bound.clock.every(CACHE_LOAD_MS, () => {
      void repliesOf.loadNoted().catch(error => bound.ui.debug(`reply cache load: ${String(error)}`))
      void wordbookOf.loadNoted().catch(error => bound.ui.debug(`word book status: ${String(error)}`))
    })
    bound.clock.every(SETTINGS_SYNC_MS, () => {
      void loadSettings(bound).catch(error => bound.ui.debug(`settings sync: ${String(error)}`))
    })

    // Last, in its own try: a failed register must not stop the session's start
    try {
      await bound.command.register({
        name: 'wwe',
        description: '打开 claude-with-english 设置',
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
    // The band's own record of the message being written goes with what it drew
    await band?.reset().catch(error => host?.ui.debug(`band reset: ${String(error)}`))
    if (host) {
      await loadSettings(host).catch(error => host?.ui.debug(`settings: ${String(error)}`))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // A window, a phone or the terminal took the session
  on('session.attach', ($, e, next) => {
    markShown()
    return next(e)
  })

  // /wwe: the settings; /wwe 任务: the task lists (F16); nothing printed
  on('command.run', { command: 'wwe' }, async ($, e) => {
    if (isTasksArg(e.args)) {
      await tasks?.open(true)
    } else {
      await openSettings()
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
    // /wwe sent on as a message: the desktop app's prompt box may not know a mod's command yet (#99691)
    const wweArgs = e.origin.kind === 'composer' ? wweArgsOf(e.text) : null
    if (wweArgs !== null) {
      const isTasks = isTasksArg(wweArgs)
      if (isTasks) {
        await tasks?.open(true)
      } else {
        await openSettings()
      }
      const bound = host
      bound?.clock.after(0, () => {
        void (async () => {
          // Where the prompt box kept the command, it goes with it
          if (isWweCommand((await bound.prompt.read()).text)) {
            await bound.prompt.fill({ text: '', mode: 'replace' })
          }
        })().catch(error => bound.ui.debug(`wwe as a message: ${String(error)}`))
      })
      return { drop: isTasks ? tasksOpenedFromMessage() : settingsOpenedFromMessage() }
    }
    // A summary card's button sent it: Claude's words, not typed here, neither held back nor counted
    if (!band || (await read($, memberOf(sentAtom, { requestId: hash(e.text.trim()) }))).isCard) {
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
    const picked = await read($, pickAtom)
    // F9 › 设置项: back to 段落模式, a selected passage goes at once; the settings sync clears it after
    const shown = await read($, settingsAtom)
    const isParagraph = shown.readingMode === 'paragraph'
    const vm = {
      band: await read($, bandAtom),
      speaking: await read($, speakingAtom),
      pick: picked && picked.kind !== 'word' && isParagraph ? null : picked,
      hasButtons: shown.bandButtons,
      isDesktop: e.surface === 'desktop',
    }
    if (!isShown(vm.band, vm.pick)) {
      return next(e)
    }
    const current = band
    const pick = vm.pick
    // What the mods under this one draw stays, under the band's lines
    const below = await next(e)
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
          // Keyed by what it reads, as the view tells 停止 by (features/band/view.tsx › pickRows)
          void speaker.speak(`pick-${pick.text}`, pick.text)
        }
      },
      pickAnalyse: () => {
        if (!pick || !analyses) {
          return
        }
        // A word waits for the line's lookup still on its way, so both say the same
        const done = pick.kind === 'word'
          ? analyses.analyseWord(pick.text, pick.sentence, picker?.lookupOf(pick) ?? null)
          : analyses.analyseText(pick.text, picker?.isOneSentence(pick) ?? false)
        void done.catch(error => host?.ui.debug(`pick analyse: ${String(error)}`))
      },
      pickTranslate: () => void picker?.toggleTranslation().catch(error => host?.ui.debug(`pick translate: ${String(error)}`)),
    }, below)
  })

  // F6: the main conversation's reply blocks, as they are kept
  on('session.append', ($, e, next) => {
    replies?.onAppend(e)
    card?.onAppend(e)
    return next(e)
  }).catch(($, e, next) => next(e))

  // F6: a turn's end, or Claude stopping to ask or to show its plan
  on('turn.complete', ($, e, next) => {
    replies?.onTurnComplete(e)
    // F16: a task list made after this is a new one
    if (e.agentId === undefined) {
      void tasks?.onTurnEnd().catch(error => host?.ui.debug(`tasks turn: ${String(error)}`))
      void card?.onTurnEnd().catch(error => host?.ui.debug(`card turn: ${String(error)}`))
    }
    return next(e)
  })

  // 桌面端: the summary card's text, translated at the end of the reply above it; the call goes on unchanged
  on('tool.call', { tool: WRAP_UP_TOOL }, async ($, e, next) => {
    if (e.agentId === undefined) {
      void card?.onCall(e as unknown as Record<string, unknown>).catch(error => host?.ui.debug(`card: ${String(error)}`))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // F16 任务: the desktop app's task list, as Claude sets it; the call itself goes on unchanged
  on('tool.call', { tool: PLAN_TOOL }, async ($, e, next) => {
    if (e.agentId === undefined) {
      void tasks?.onPlanCall(e as unknown as Record<string, unknown>).catch(error => host?.ui.debug(`tasks: ${String(error)}`))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // F16 任务: the task lists, the newest first, each step with its translation
  on('ui.render', { component: 'Pane', requestId: TASKS_PANE }, async ($, e) => {
    const shown = await read($, tasksAtom)
    const current = replies
    const paras = new Map<string, WwePara>()
    for (const list of shown.lists) {
      for (const step of list.steps) {
        const block = stepBlock(step.text)
        if (paras.has(block.hash)) {
          continue
        }
        const para = await read($, memberOf(paraAtom, { requestId: block.hash }))
        if (para.status === 'none' && translatable(block)) {
          current?.note(block.hash)
        } else if (para.status === 'pending') {
          current?.noteStale(block)
        }
        paras.set(block.hash, para)
      }
    }
    return tasksView($.ui.resolve(e), shown, text => paras.get(stepBlock(text).hash) ?? NO_PARA)
  })
  // F6 on the desktop: the description Claude gave a call, translated for its row; the call goes on unchanged
  on('tool.call', async ($, e, next) => {
    const description = e.agentId === undefined ? descriptionOf(e) : null
    if (description !== null && translatable(stepBlock(description))) {
      void replies?.translateToolLine(description).catch(error => host?.ui.debug(`tool line: ${String(error)}`))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // F6 on the desktop: a call's row with its description's translation under it, folded or unfolded
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const description = e.surface === 'terminal' ? null : descriptionOf(e.props.input)
    if (description === null || !translatable(stepBlock(description))) {
      return next(e)
    }
    const block = stepBlock(description)
    const para = await read($, memberOf(paraAtom, { requestId: block.hash }))
    if (para.status === 'none') {
      replies?.note(block.hash)
    } else if (para.status === 'pending') {
      replies?.noteStale(block)
    }
    const drawn = await next(e)
    return drawn ? toolLineView($.ui.resolve(e), drawn, para) : drawn
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
      const para = await read($, memberOf(paraAtom, { requestId: blockOfLine(line).hash }))
      if (para.status === 'pending') {
        replies.noteStale(blockOfLine(line))
      }
      paras.push(para)
    }
    if (paras.every(para => para.status === 'none')) {
      return next(e)
    }
    // Claude Code's dialog goes in exactly once, under the translation
    const dialog = e.requestId
    const isTabbed = (await read($, settingsAtom)).askLayout === 'one'
    const tab = await read($, memberOf(askTabAtom, { requestId: dialog }))
    return askView($.ui.resolve(e), lines, paras, await next(e), e.surface, isTabbed ? {
      index: tab.index,
      select: index => void host?.state.askTab.update(dialog, () => ({ index })).catch(error => host?.ui.debug(`ask tab: ${String(error)}`)),
    } : undefined)
  })

  // F6 › 计划和提问: the approved plan's translation under it
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const plan = e.props.tool === 'ExitPlanMode' ? planOf(e.props.output) : null
    const current = replies
    if (!current || plan === null) {
      return next(e)
    }
    const blocks = segment(plan)
    const paras = []
    for (const block of blocks) {
      const para = await read($, memberOf(paraAtom, { requestId: block.hash }))
      // Translated before /resume: kept on disk, as a reply's paragraph is
      if (para.status === 'none' && translatable(block)) {
        current.note(block.hash)
      } else if (para.status === 'pending') {
        current.noteStale(block)
      }
      paras.push(para)
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
    // Narration drawn as a reply block: translated as one from now on (not while drawing)
    const drawnText = e.props.text
    host?.clock.after(0, () => current?.onDrawn(drawnText))
    const blocks = segment(e.props.text)
    // 桌面端: the summary card under the turn's last reply block, translated at its end
    const kept = e.surface === 'terminal' ? NO_CARD : await read($, memberOf(cardAtom, { requestId: hash(e.props.text) }))
    // A card another version of the plugin kept in this session, in a shape this one does not know, is left out
    const ending = Array.isArray(kept.buttons) ? kept : NO_CARD
    if (!current || (!blocks.some(translatable) && ending.recap === '')) {
      return next(e)
    }
    // The desktop draws one Claude Code drawing per block: the translations go into its text
    if (e.surface !== 'terminal') {
      const paras: WwePara[] = []
      for (const block of blocks) {
        const para = await read($, memberOf(paraAtom, { requestId: block.hash }))
        if (para.status === 'none' && translatable(block)) {
          current.note(block.hash)
        } else if (para.status === 'pending') {
          current.noteStale(block)
        }
        paras.push(para)
      }
      const cardParas = new Map<string, WwePara>()
      for (const line of ending.recap === '' ? [] : cardTexts(ending)) {
        const block = stepBlock(line)
        const para = await read($, memberOf(paraAtom, { requestId: block.hash }))
        if (para.status === 'none' && translatable(block)) {
          current.note(block.hash)
        } else if (para.status === 'pending') {
          current.noteStale(block)
        }
        cardParas.set(line, para)
      }
      const quote = ending.recap === '' ? null : cardQuote(ending, line => cardParas.get(line) ?? NO_PARA)
      const translated = withTranslations(blocks, paras)
      const text = quote === null ? translated : `${translated ?? e.props.text}\n\n${quote}`
      const drawn = await next(text === null ? e : { ...e, props: { ...e.props, text } })
      if (!drawn) {
        return drawn
      }
      const own = blocks.flatMap((block, i) => (translatable(block) ? [{ block, para: paras[i] ?? NO_PARA }] : []))
      const toggle = wholeToggle(own.map(({ para }) => para))
      return replyOnceView(
        $.ui.resolve(e),
        drawn,
        toggle && {
          label: toggle.label,
          onPress: () => {
            // Each paragraph that is not as the button says yet; one being asked for is left to finish
            const moving = own.filter(({ para }) =>
              toggle.toShow ? para.status !== 'pending' && !(para.status === 'done' && para.shown) : para.status === 'done' && para.shown,
            )
            for (const { block } of moving) {
              void current.toggle(block).catch(error => host?.ui.debug(`reply toggle: ${String(error)}`))
            }
          },
        },
      )
    }
    const parts: ReplyPart[] = []
    for (const [index, block] of blocks.entries()) {
      const para = await read($, memberOf(paraAtom, { requestId: block.hash }))
      if (para.status === 'none' && translatable(block)) {
        current.note(block.hash)
      } else if (para.status === 'pending') {
        current.noteStale(block)
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

  // F8, F12: 朗读 and 加入单词本 on an English message you sent
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const book = wordbook
    const text = e.props.text
    // What a summary card's button sent: its translation under it
    const sentKey = hash(text.trim())
    if ((await read($, memberOf(sentAtom, { requestId: sentKey }))).isCard) {
      const para = await read($, memberOf(paraAtom, { requestId: sentKey }))
      if (para.status === 'none' && translatable(stepBlock(text.trim()))) {
        replies?.note(sentKey)
      } else if (para.status === 'pending') {
        replies?.noteStale(stepBlock(text.trim()))
      }
      const drawn = await next(e)
      return drawn ? sentView($.ui.resolve(e), drawn, para) : drawn
    }
    if (!book || e.props.origin.kind !== 'composer' || !hasMineButtons(text)) {
      return next(e)
    }
    const drawn = await next(e)
    if (!drawn) {
      return drawn
    }
    const key = savedKeyOf.mine(text)
    const { status } = await read($, memberOf(savedAtom, { requestId: key }))
    if (status === 'unknown') {
      book.noteMine(text)
    }
    return mineView(
      $.ui.resolve(e),
      drawn,
      { key, status, speaking: await read($, speakingAtom) },
      {
        speak: () => void speaker?.speak(`mine-${key}`, text),
        add: () => void book.addMine(text).catch(error => host?.ui.debug(`add mine: ${String(error)}`)),
      },
    )
  })

  // The one pane: the settings, or an analysis in their place (阅读辅助 › Pane 只有一个)
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const pane = await read($, paneAtom)
    if (pane.view === 'text' || pane.view === 'word') {
      const analysis = await read($, analysisAtom)
      const current = analyses
      if (analysis && current) {
        const book = wordbook
        // F12: each 加入单词本's state; one not known yet is looked up on the next tick
        const savedOf = async (key: string, note: () => void) => {
          const { status } = await read($, memberOf(savedAtom, { requestId: key }))
          if (status === 'unknown') {
            note()
          }
          return status
        }
        const saved: AnalysisSaved = { word: 'unknown', sentences: [] }
        if (book && analysis.status === 'done' && analysis.word) {
          const { lemma } = analysis.word
          saved.word = await savedOf(savedKeyOf.word(lemma, analysis.sentence), () => book.noteWord(lemma, analysis.sentence))
        }
        if (book && analysis.status === 'done' && analysis.text) {
          const sentences: AnalysisSaved['word'][] = []
          for (const { en } of analysis.text.sentences) {
            sentences.push(await savedOf(savedKeyOf.sentence(en), () => book.noteSentence(en)))
          }
          saved.sentences = sentences
        }
        return analysisView(
          $.ui.resolve(e),
          analysis,
          await read($, speakingAtom),
          {
            speak: (key, text) => void speaker?.speak(key, text),
            openWord: word => void current.analyseHardWord(word).catch(error => host?.ui.debug(`word: ${String(error)}`)),
            back: () => void current.back().catch(error => host?.ui.debug(`back: ${String(error)}`)),
            addWord: () => void book?.addWord(analysis).catch(error => host?.ui.debug(`add word: ${String(error)}`)),
            addSentence: index => {
              const sentence = analysis.text?.sentences[index]
              if (sentence) {
                void book?.addSentence(sentence).catch(error => host?.ui.debug(`add sentence: ${String(error)}`))
              }
            },
          },
          saved,
        )
      }
    }
    // F14: the share card, a page under 统计
    if (pane.view === 'share') {
      const share = (await read($, statsAtom))?.share
      const shareUi = shareUiOf($.ui.resolve(e))
      const page = statsPage
      if (share && shareUi && page) {
        const log = (what: string) => (error: unknown) => host?.ui.debug(`${what}: ${String(error)}`)
        return shareView(
          shareUi,
          { share },
          {
            back: () => void page.back().catch(log('share back')),
            setCardLanguage: value => void page.setCardLanguage(value).catch(log('card language')),
            postToX: () => void page.postToX().catch(log('post to X')),
            copyImage: () => void page.copyImage().catch(log('copy image')),
            copyText: surface => void page.copyText(surface).catch(log('copy text')),
          },
        )
      }
    }
    const ui = paneUiOf($.ui.resolve(e))
    // The settings also stand in for a share card whose figures are gone (/clear, a reload)
    if ((pane.view === 'settings' || pane.view === 'share') && settings && ui) {
      const settingsView = await read($, settingsAtom)
      const slots: PaneSlots = {}
      const book = wordbook
      if (pane.tab === 'wordbook' && book) {
        const vm = { book: await read($, bookAtom), settings: settingsView }
        slots.wordbook = bookLists(ui, vm, {
          remove: (kind, key) => void book.remove(kind, key).catch(error => host?.ui.debug(`remove: ${String(error)}`)),
        })
        slots.ankiStatus = ankiLine(ui, vm) ?? undefined
      }
      const page = statsPage
      if (pane.tab === 'stats' && page) {
        // The whole table: the charts are a Raster in the terminal and an Svg on the desktop
        slots.stats = statsSlot(
          $.ui.resolve(e),
          { stats: await read($, statsAtom), range: pane.statsRange, privacy: false },
          {
            setRange: range => void page.setRange(range).catch(error => host?.ui.debug(`stats range: ${String(error)}`)),
            openShare: () => void page.openShare().catch(error => host?.ui.debug(`open share: ${String(error)}`)),
          },
        )
      }
      return settings.view(ui, { pane, settings: settingsView, slots, speaking: await read($, speakingAtom) })
    }
    return next(e)
  })
}
