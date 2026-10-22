import type { WweCard, WwePara } from '../../../types'
import { CARD_ASK, CARD_RECAP } from '../../core/copy/card'
import { progressInline } from '../../core/copy/common'

// 运行环境 › 桌面端: the summary card the desktop app draws when Claude calls
// its wrap_up tool. The app draws it whole, below the reply, with no place a
// plugin can draw in or under (实测 10-22), so its translation goes at the
// end of the reply above it. Only what is shown changes: nothing is added
// to what Claude reads.

/** The desktop app's tool that draws the summary card; no other host has it */
export const WRAP_UP_TOOL = 'mcp__ccd_turn__wrap_up'

/** The card's text from the call: its recap, its question and the labels of its reply buttons */
export function cardOf(call: Record<string, unknown>): WweCard | null {
  const recap = typeof call.recap === 'string' ? call.recap.trim() : ''
  if (recap === '') {
    return null
  }
  const ask = typeof call.ask === 'string' && call.ask.trim() !== '' ? call.ask.trim() : null
  // An app action's button takes the app's own label, which the call does not carry
  const labels = Array.isArray(call.actions)
    ? call.actions.flatMap(action => {
        const { label, action: appAction } = (typeof action === 'object' && action !== null ? action : {}) as {
          label?: unknown
          action?: unknown
        }
        return typeof label === 'string' && label.trim() !== '' && appAction === undefined ? [label.trim()] : []
      })
    : []
  return { recap, ask, labels: ask === null ? [] : labels }
}

/** Every text of the card that is translated: the recap, the question, each button */
export const cardTexts = (card: WweCard): string[] => [card.recap, ...(card.ask === null ? [] : [card.ask]), ...card.labels]

/** One text as the card's translation shows it: the translation, 翻译中…, why there is none; null for nothing */
function shownOf(para: WwePara): string | null {
  return para.status === 'pending' ? progressInline('翻译') : para.status === 'failed' ? para.error : para.status === 'done' ? para.zh : null
}

/**
 * The card's translation as a Markdown quote for the end of the reply above
 * it: 卡片 and the recap's, then 问题 with the buttons' in brackets. Null when
 * none of it is translated (a card not in English).
 */
export function cardQuote(card: WweCard, paraOf: (text: string) => WwePara): string | null {
  const recap = shownOf(paraOf(card.recap))
  const ask = card.ask === null ? null : shownOf(paraOf(card.ask))
  if (recap === null && ask === null) {
    return null
  }
  const buttons = card.labels.map(label => shownOf(paraOf(label)) ?? label)
  const lines = [
    ...(recap === null ? [] : [`${CARD_RECAP}${recap}`]),
    ...(ask === null ? [] : [`${CARD_ASK}${ask}${buttons.length > 0 ? `（${buttons.join(' / ')}）` : ''}`]),
  ]
  return lines.map(line => line.split('\n').map(part => `> ${part}`).join('\n')).join('\n>\n')
}
