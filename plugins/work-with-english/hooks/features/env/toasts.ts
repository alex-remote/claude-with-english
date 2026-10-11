import { firstRunToast, notFullscreenToast, notMacLocalToast } from '../../core/copy/common'
import type { Host } from '../../host'

// The toasts at start-up (命令 › 第一次使用的提示, 运行环境 › 启动时的提示),
// each shown once ever: a flag in $.store remembers it, so a reload or a new
// session never shows it again.

const FIRST_RUN = 'flag/firstRun'
const PLATFORM = 'flag/platformToast'
const FULLSCREEN = 'flag/fullscreenToast'

async function once(host: Host, flag: string, text: string) {
  if ((await host.store.get(flag)) === true) {
    return
  }
  await host.store.set(flag, true)
  host.ui.toast(text)
}

/** macOS on this machine: `uname -s` is Darwin and no SSH session carries it */
export async function isMacLocal(host: Host): Promise<boolean> {
  const uname = await host.proc.run(['uname', '-s'])
  return uname.stdout.trim() === 'Darwin' && !(await host.env.isSsh())
}

/** At start-up, after the store's backup is restored. */
export async function startupToasts(host: Host) {
  await once(host, FIRST_RUN, firstRunToast())
  const isLocal = await isMacLocal(host).catch(() => true)
  await host.state.env.update(env => ({ ...env, isMacLocal: isLocal }))
  if (!isLocal) {
    await once(host, PLATFORM, notMacLocalToast())
  }
}

/** The first time a terminal draws without fullscreen rendering. */
export const notFullscreen = (host: Host) => once(host, FULLSCREEN, notFullscreenToast())
