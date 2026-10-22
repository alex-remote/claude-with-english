import type { Args } from 'claude-code'

import type { WweCard } from '../../../types'
import { hash } from '../../core/hash'
import type { Block } from '../../core/text/segment'
import type { Host } from '../../host'
import { stepBlock } from '../tasks/plan'
import { cardOf, cardTexts } from './nextStep'

// The desktop's summary card: its text as Claude's call set it, translated as
// a reply's paragraphs are, and kept at the turn's end under the hash of the
// turn's last reply block, at whose end the reply draws it.

export type Card = ReturnType<typeof createCard>

export function createCard(host: Host, deps: { translate: (blocks: readonly Block[]) => Promise<void> }) {
  /** The main conversation's last reply block of this turn */
  let lastText: string | null = null
  /** The card Claude set in this turn, the last one if several */
  let card: WweCard | null = null

  return {
    /** session.append: the main conversation's reply blocks, the last one kept */
    onAppend(e: Args<'session.append'>) {
      if (e.agentId !== undefined || e.door !== 'response' || e.message.type !== 'assistant') {
        return
      }
      for (const block of e.message.content) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
          lastText = block.text
        }
      }
    },

    /** Claude's call of the card's tool in the main conversation: its text, asked for translation at once */
    async onCall(call: Record<string, unknown>) {
      const set = cardOf(call)
      if (set === null) {
        return
      }
      card = set
      await deps.translate(cardTexts(set).map(stepBlock))
    },

    /** The turn's end: the card goes to the turn's last reply block */
    async onTurnEnd() {
      const shown = card
      const text = lastText
      card = null
      lastText = null
      if (shown && text !== null) {
        await host.state.card.update(hash(text), () => shown)
      }
    },
  }
}
