import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { DEFAULT_VIEW } from './core/settings/schema'
import { EMPTY_BAND } from './features/band/empty'
import type { Host } from './host'

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

export const register: Register = on => {
  let host: Host | null = null

  on('session.start', async ($, e, next) => {
    const bound: Host = {
      clock: {
        now: () => $.clock.now(),
        after: (ms, fn) => $.clock.after(ms, fn),
        every: (ms, fn) => $.clock.every(ms, fn),
      },
      model: { complete: (request, options) => $.model.complete(request, options) },
      http: { fetch: (url, init) => $.http.fetch(url, init) },
      proc: { run: (argv, init) => $.process.run(argv, init) },
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
        surfaces: () => $.session.surfaces(),
        version: () => $.session.version(),
      },
      plugin: { name: $.plugin.name, root: $.plugin.root },
      state: {
        settings: { get: () => read($, settingsAtom), update: fn => update($, settingsAtom, fn) },
        env: { get: () => read($, envAtom), update: fn => update($, envAtom, fn) },
        band: { get: () => read($, bandAtom), update: fn => update($, bandAtom, fn) },
        speaking: { get: () => read($, speakingAtom), update: fn => update($, speakingAtom, fn) },
      },
    }
    host = bound

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

  // Opens the settings from M2 on; until then it answers so nothing is printed
  on('command.run', { command: 'wwe' }, async () => ({})).catch(($, e, next) => next(e))
}
