import type { Register } from 'claude-code'

import type { Host } from './host'

// The one place that hooks events and calls `$`; the features under hooks/
// reach the engine through the Host bound here (docs/dev-plan.md, 架构).
export const register: Register = on => {
  let host: Host | null = null

  on('session.start', async ($, e, next) => {
    host = {
      now: () => $.clock.now(),
      after: (ms, fn) => $.clock.after(ms, fn),
      every: (ms, fn) => $.clock.every(ms, fn),
      storeGet: key => $.store.get(key),
      storeSet: (key, value) => $.store.set(key, value),
      toast: text => $.ui.toast(text),
      debug: text => $.ui.log(text, { to: 'debug' }),
      registerCommand: spec => $.command.register(spec),
    }

    // Last, in its own try: a failed register must not stop the session's start
    try {
      await host.registerCommand({
        name: 'wwe',
        description: '打开 work-with-english 设置',
        immediate: true,
      })
    } catch (error) {
      host.debug(`/wwe was not registered: ${String(error)}`)
    }

    return next(e)
  })

  // Opens the settings from M2 on; until then it answers so nothing is printed
  on('command.run', { command: 'wwe' }, async () => ({}))
}
