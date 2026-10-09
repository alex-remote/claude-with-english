import { speakable } from '../../core/text/speakable'
import type { Host } from '../../host'

// F8 朗读: one place reads at a time. The system voice can't be stopped, so
// while it reads the other 朗读 buttons are dimmed and do nothing; the
// online voices (M6) stop what reads and read the new text.

export type Speaker = ReturnType<typeof createSpeaker>

export function createSpeaker(host: Host) {
  return {
    /** Reads `text` (Markdown allowed) aloud from the place named `key`. */
    async speak(key: string, text: string) {
      const now = await host.state.speaking.get()
      if (now !== null) {
        return
      }
      const parts = speakable(text)
      if (parts.length === 0) {
        return
      }
      const settings = await host.state.settings.get()
      await host.state.speaking.update(() => ({ key, via: 'system' }))
      try {
        for (const part of parts) {
          await host.audio.speak(part, settings.voiceSystem === '' ? undefined : { voice: settings.voiceSystem })
        }
      } catch (error) {
        host.ui.debug(`speak ${key}: ${String(error)}`)
      } finally {
        await host.state.speaking.update(() => null)
      }
    },
  }
}
