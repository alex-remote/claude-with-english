import { failure } from '../../core/copy/common'
import { coerceSetting, storeKeyOf } from '../../core/settings/schema'
import type { SettingKey } from '../../core/settings/schema'
import { speakable } from '../../core/text/speakable'
import type { Host } from '../../host'
import type { WweSettings } from '../../../types'
import { forget, onlinePieces, synthesize } from '../../services/speech/online'
import type { SpeechService } from '../../services/speech/online'
import { REASONS } from '../../services/translate/errors'

// F8 朗读: one place reads at a time. The system voice can't be stopped, so
// while it reads the other 朗读 buttons are dimmed and do nothing. An online
// voice can: its button turns into 停止, a press on it stops the reading,
// and a press on another 朗读 stops it and reads the new text. A failed
// online reading says why in a toast and never falls back to the system voice.

/** What 试听 reads */
export const TRY_TEXT = "Hi, I'm the voice that reads Claude's replies to you. How do I sound?"

export type Speaker = ReturnType<typeof createSpeaker>

type Reading = { key: string; via: 'system' | 'online'; stop: AbortController }

type Voice =
  | { via: 'system'; voice: string }
  | { via: 'online'; service: SpeechService; voice: string; model: string }

async function readSetting<K extends SettingKey>(host: Host, key: K): Promise<WweSettings[K]> {
  return coerceSetting(key, await host.store.get(storeKeyOf(key)))
}

/** The service, voice and model the settings name now (another session may have changed them). */
async function voiceOf(host: Host): Promise<Voice> {
  const service = await readSetting(host, 'speechService')
  switch (service) {
    case 'system':
      return { via: 'system', voice: await readSetting(host, 'voiceSystem') }
    case 'openai':
      return { via: 'online', service, voice: await readSetting(host, 'voiceOpenai'), model: await readSetting(host, 'openaiTtsModel') }
    case 'elevenlabs':
      return { via: 'online', service, voice: await readSetting(host, 'voiceEleven'), model: await readSetting(host, 'elevenModel') }
  }
}

export function createSpeaker(host: Host) {
  let current: Reading | null = null
  // A function, so a check after an await reads `current` as it is then
  const isSystemReading = () => current?.via === 'system'

  /** Stops an online reading at once; its loop sees the signal and reads no further piece. */
  async function stopOnline(): Promise<void> {
    const reading = current
    if (reading?.via !== 'online') {
      return
    }
    current = null
    reading.stop.abort()
    await host.state.speaking.update(() => null)
  }

  async function readSystem(reading: Reading, parts: readonly string[], voice: string) {
    try {
      for (const part of parts) {
        await host.audio.speak(part, voice === '' ? undefined : { voice })
      }
    } catch (error) {
      host.ui.debug(`speak ${reading.key}: ${String(error)}`)
    }
  }

  async function readOnline(reading: Reading, parts: readonly string[], voice: Extract<Voice, { via: 'online' }>) {
    const { signal } = reading.stop
    for (const text of parts) {
      if (signal.aborted) {
        return
      }
      const made = await synthesize(host, { service: voice.service, text, voice: voice.voice, model: voice.model })
      if (signal.aborted) {
        return
      }
      if (!made.ok) {
        host.ui.toast(failure('朗读', made.reason))
        return
      }
      try {
        const { base64 } = await host.fs.readBytes(made.path)
        if (signal.aborted) {
          return
        }
        await host.audio.play({ base64, mime: made.mime }, { signal })
      } catch (error) {
        host.ui.debug(`speak ${reading.key}: ${made.path}: ${String(error)}`)
        // A file that does not play is not kept, so the next press asks again
        await forget(host, made.path)
        host.ui.toast(failure('朗读', REASONS.unplayable))
        return
      }
    }
  }

  /** Reads `text` (Markdown allowed) aloud from the place named `key`; a press on what reads online stops it. */
  async function speak(key: string, text: string): Promise<void> {
    if (isSystemReading()) {
      return
    }
    if (current?.key === key) {
      await stopOnline()
      return
    }
    const voice = await voiceOf(host)
    // Another press may have begun reading meanwhile
    if (isSystemReading()) {
      return
    }
    const parts = voice.via === 'system' ? speakable(text) : onlinePieces(text)
    if (parts.length === 0) {
      return
    }
    await stopOnline()
    const reading: Reading = { key, via: voice.via, stop: new AbortController() }
    current = reading
    await host.state.speaking.update(() => ({ key, via: voice.via }))
    try {
      if (voice.via === 'system') {
        await readSystem(reading, parts, voice.voice)
      } else {
        await readOnline(reading, parts, voice)
      }
    } catch (error) {
      host.ui.debug(`speak ${key}: ${String(error)}`)
    } finally {
      // A newer reading or stop() has taken over the state already
      if (current === reading) {
        current = null
        await host.state.speaking.update(() => null)
      }
    }
  }

  return {
    speak,
    /** 试听: the current service and voice read a sample sentence; pressed again while it reads online, it stops. */
    test: (key: string, text: string = TRY_TEXT) => speak(key, text),
    /** Stops what reads online; the system voice can't be stopped. */
    stop: stopOnline,
  }
}
