import type { WweCard, WweCardButton, WwePara } from '../../../types'
import { CARD_ASK, CARD_SENDS } from '../../core/copy/card'
import { progressInline } from '../../core/copy/common'

// 运行环境 › 桌面端: the summary card the desktop app draws when Claude calls
// its wrap_up tool. The app draws it whole, below the reply, with no place a
// plugin can draw in or under (实测 10-22), so its translation goes at the
// end of the reply above it. Only what is shown changes: nothing is added
// to what Claude reads.

/** The desktop app's tool that draws the summary card; no other host has it */
export const WRAP_UP_TOOL = 'mcp__ccd_turn__wrap_up'

/**
 * The card's text from the call: its recap, its question and its reply
 * buttons, each with the message a click sends (its label when it names none).
 */
export function cardOf(call: Record<string, unknown>): WweCard | null {
  const recap = typeof call.recap === 'string' ? call.recap.trim() : ''
  if (recap === '') {
    return null
  }
  const ask = typeof call.ask === 'string' && call.ask.trim() !== '' ? call.ask.trim() : null
  // An app action's button takes the app's own label, which the call does not carry
  const buttons = Array.isArray(call.actions)
    ? call.actions.flatMap((action): WweCardButton[] => {
        const { label, message, action: appAction } = (typeof action === 'object' && action !== null ? action : {}) as {
          label?: unknown
          message?: unknown
          action?: unknown
        }
        if (typeof label !== 'string' || label.trim() === '' || appAction !== undefined) {
          return []
        }
        const sent = typeof message === 'string' && message.trim() !== '' ? message.trim() : label.trim()
        return [{ label: label.trim(), message: sent }]
      })
    : []
  return { recap, ask, buttons: ask === null ? [] : buttons }
}

/** Every text of the card that is translated, each once: the recap, the question, each button and what it sends */
export const cardTexts = (card: WweCard): string[] => [
  ...new Set([card.recap, ...(card.ask === null ? [] : [card.ask]), ...card.buttons.flatMap(button => [button.label, button.message])]),
]

/** One text as a card's translation shows it: the translation, 翻译中…, why there is none; null for nothing */
export function shownOf(para: WwePara): string | null {
  return para.status === 'pending' ? progressInline('翻译') : para.status === 'failed' ? para.error : para.status === 'done' ? para.zh : null
}

/**
 * A card's translation, the summary card's and the question dialog's alike:
 * a rule that sets it apart from the reply's own translations, then its
 * paragraphs as one quote ("问题：…", a blank row, and the list under it).
 */
export function cardSection(paragraphs: readonly (readonly string[])[]): string {
  return `${CARD_RULE}\n\n${cardQuoteOf(paragraphs)}`
}

/** The rule a card's translation starts with */
export const CARD_RULE = '---'

const quoted = (row: string) => row.split('\n').map(part => (part === '' ? '>' : `> ${part}`)).join('\n')

/**
 * The paragraphs as one quote, a blank quote row between them: each its
 * first row, then the list under it ("- " or "1. " lines) after a blank row.
 */
export const cardQuoteOf = (paragraphs: readonly (readonly string[])[]) =>
  paragraphs.map(([head = '', ...items]) => (items.length > 0 ? [head, '', ...items] : [head]).map(quoted).join('\n')).join('\n>\n')

/**
 * The card's translation for the end of the reply above it: a rule that
 * sets it apart from the reply's own translations, then as a quote the
 * recap's, 问题, and each button with what a click sends. Null when none
 * of it is translated (a card not in English).
 */
export function cardQuote(card: WweCard, paraOf: (text: string) => WwePara): string | null {
  const recap = shownOf(paraOf(card.recap))
  const ask = card.ask === null ? null : shownOf(paraOf(card.ask))
  if (recap === null && ask === null) {
    return null
  }
  // A button that sends more than its label says what it sends; one not translated yet shows its own words
  const shown = (text: string) => shownOf(paraOf(text)) ?? text
  const buttons = card.buttons.map(({ label, message }) =>
    message === label ? `- ${shown(label)}` : `- ${shown(label)}${CARD_SENDS}${shown(message)}`,
  )
  return cardSection([...(recap === null ? [] : [[recap]]), ...(ask === null ? [] : [[`${CARD_ASK}${ask}`, ...buttons]])])
}
