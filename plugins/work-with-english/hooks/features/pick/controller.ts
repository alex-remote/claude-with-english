import type { WweLookup, WwePick } from '../../../types'
import { createSlot } from '../../core/async/slot'
import { lookupFailed, translateFailed } from '../../core/copy/pick'
import { classifySelection, findSentenceInReplies, looksLikeCode, sentenceOf, shouldShow } from '../../core/text/selection'
import { run } from '../../services/translate'
import type { Host } from '../../host'

// F9 划词翻译: what the person selected in a reply becomes the line at the
// bottom of the band. The fullscreen terminal answers $.ui.selection(),
// polled (there is no event for a selection, P25); the desktop app answers
// nothing, so a child process watches the clipboard and reports what is
// copied while Claude is in front (⌘C). A selection the line does not take
// (code in 段落模式, Chinese) leaves the line as it was.

/** How often the terminal's selection is read (P25: well under a second, no cost to speak of) */
export const SELECTION_POLL_MS = 400

const NO_TR: WwePick['tr'] = { status: 'none', zh: null, error: null, shown: false }

export type Picker = ReturnType<typeof createPicker>

export function createPicker(
  host: Host,
  deps: {
    /** The Markdown of the reply drawn under this request id, when one was */
    markdownOf: (requestId: string) => string | undefined
    /** The replies drawn so far, the latest last (the desktop takes 本句 from the latest that has the word) */
    replies: () => readonly string[]
  },
) {
  let lastSeen = ''
  const lookups = createSlot()
  const translations = createSlot()

  async function offer(raw: string, via: WwePick['via'], requestId?: string) {
    if (raw === lastSeen) {
      return
    }
    lastSeen = raw
    const selection = classifySelection(raw)
    const settings = await host.state.settings.get()
    const markdown = requestId ? deps.markdownOf(requestId) : undefined
    // A passage wholly in code does not come up; the desktop cannot tell where a copy came from
    const inCode = selection.kind === 'text' && (via === 'copy' ? looksLikeCode(raw) : markdown !== undefined && isInCode(markdown, raw))
    if (!shouldShow(selection.kind, settings.readingMode, inCode) || selection.kind === 'none') {
      return
    }
    const text = selection.kind === 'word' ? selection.word : selection.text
    const sentence =
      selection.kind !== 'word'
        ? null
        : markdown !== undefined
          ? sentenceOf(markdown, text)
          : via === 'copy'
            ? findSentenceInReplies(deps.replies(), text)
            : null
    const pick: WwePick = {
      kind: selection.kind,
      text,
      via,
      sentence,
      lookup: selection.kind === 'word' ? { status: 'pending', value: null, error: null } : null,
      tr: NO_TR,
    }
    translations.cancel()
    await host.state.pick.update(() => pick)
    if (selection.kind === 'word') {
      await lookUp(text, sentence)
    }
  }

  async function lookUp(word: string, sentence: string | null) {
    const ticket = lookups.begin()
    const result = await run(host, { kind: 'lookup', word, sentence }, { signal: ticket.signal })
    if (!ticket.isCurrent()) {
      return
    }
    await host.state.pick.update(pick =>
      pick && pick.text === word
        ? {
            ...pick,
            lookup: result.ok
              ? { status: 'done', value: result.value, error: null }
              : { status: 'failed', value: null, error: lookupFailed(result.reason) },
          }
        : pick,
    )
  }

  return {
    /** The fullscreen terminal: read the selection on a timer */
    watchTerminal() {
      host.clock.every(SELECTION_POLL_MS, () => {
        void (async () => {
          const selection = await host.ui.selection()
          if (selection && selection.text.trim() !== '') {
            await offer(selection.text, 'select', selection.requestId)
          }
        })().catch(error => host.ui.debug(`selection: ${String(error)}`))
      })
    },

    /** The desktop app: a child watches the clipboard, for the session's life */
    watchDesktop() {
      void (async () => {
        const child = host.proc.spawn({ argv: ['osascript', '-l', 'JavaScript', `${host.plugin.root}/assets/clipwatch.jxa`] })
        let pending = ''
        for await (const chunk of child) {
          pending += chunk.text
          let newline = pending.indexOf('\n')
          while (newline >= 0) {
            const line = pending.slice(0, newline)
            pending = pending.slice(newline + 1)
            newline = pending.indexOf('\n')
            try {
              const copied = JSON.parse(line) as { front?: unknown; text?: unknown }
              if (copied.front === true && typeof copied.text === 'string' && copied.text.trim() !== '') {
                await offer(copied.text, 'copy')
              }
            } catch {
              // osascript's own messages on stderr are not ours
            }
          }
        }
      })().catch(error => host.ui.debug(`clipboard watch: ${String(error)}`))
    },

    /** ✕, or a message sent */
    async close() {
      lookups.cancel()
      translations.cancel()
      await host.state.pick.update(() => null)
    },

    /** 翻译 on a passage: show it, hide it, show it again without asking */
    async toggleTranslation() {
      const pick = await host.state.pick.get()
      if (!pick || pick.kind !== 'text') {
        return
      }
      if (pick.tr.status === 'done') {
        await host.state.pick.update(p => p && { ...p, tr: { ...p.tr, shown: !p.tr.shown } })
        return
      }
      if (pick.tr.status === 'pending') {
        return
      }
      const ticket = translations.begin()
      await host.state.pick.update(p => p && { ...p, tr: { status: 'pending', zh: null, error: null, shown: true } })
      const result = await run(host, { kind: 'selection', text: pick.text }, { signal: ticket.signal })
      if (!ticket.isCurrent()) {
        return
      }
      await host.state.pick.update(p =>
        p && p.text === pick.text
          ? {
              ...p,
              tr: result.ok
                ? { status: 'done', zh: result.value, error: null, shown: true }
                : { status: 'failed', zh: null, error: translateFailed(result.reason), shown: true },
            }
          : p,
      )
    },

    /** 阅读方式 back to 段落模式: a selected passage goes, a selected word stays (F9 › 设置项) */
    async onReadingMode(mode: 'paragraph' | 'select') {
      if (mode === 'paragraph') {
        await host.state.pick.update(pick => (pick && pick.kind !== 'word' ? null : pick))
      }
    },

    /** The word's senses, when known, so the card says the same (阅读辅助 › 同一个词，释义一致) */
    lookupOf: (pick: WwePick): WweLookup | null => (pick.lookup?.status === 'done' ? pick.lookup.value : null),
  }
}

/** Every place the text stands in the reply is inside a code block or inline code */
export function isInCode(markdown: string, text: string): boolean {
  const code: [number, number][] = []
  for (const match of markdown.matchAll(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`/g)) {
    code.push([match.index, match.index + match[0].length])
  }
  let at = markdown.indexOf(text)
  if (at < 0) {
    return false
  }
  while (at >= 0) {
    const end = at + text.length
    if (!code.some(([start, stop]) => at >= start && end <= stop)) {
      return false
    }
    at = markdown.indexOf(text, at + 1)
  }
  return true
}
