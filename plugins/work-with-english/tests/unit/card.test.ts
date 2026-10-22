import { describe, expect, test } from 'claude-code/testing'

import { NO_PARA } from '../../hooks/core/state/defaults'
import { cardOf, cardQuote } from '../../hooks/features/env/nextStep'
import type { WwePara } from '../../types'

// The desktop's summary card: its text from Claude's call, and its
// translation as the quote at the end of the reply above it.

const done = (zh: string): WwePara => ({ status: 'done', zh, error: null, shown: true })

describe('the summary card', () => {
  test('its recap, its question and the labels of its reply buttons; an app action’s button has no label to translate', () => {
    expect(cardOf({ recap: ' Done. ', ask: 'Ship it?', actions: [{ label: 'Ship', message: 'Ship it' }, { action: 'commit' }] })).toEqual({
      recap: 'Done.',
      ask: 'Ship it?',
      labels: ['Ship'],
    })
    expect(cardOf({ recap: 'Done.', actions: [{ label: 'Ship' }] })).toEqual({ recap: 'Done.', ask: null, labels: [] })
    expect(cardOf({ ask: 'Ship it?' })).toBeNull()
  })

  test('a recap alone is quoted alone; a card not in English adds nothing', () => {
    const card = { recap: 'Done.', ask: null, labels: [] }
    expect(cardQuote(card, () => done('完成。'))).toBe('---\n\n**下方卡片的译文**\n\n> 完成。')
    expect(cardQuote(card, () => NO_PARA)).toBeNull()
  })

  test('a button whose translation has not come shows its own label meanwhile', () => {
    const card = { recap: 'Done.', ask: 'Ship it?', labels: ['Ship', 'Wait'] }
    const zh: Record<string, WwePara> = { 'Done.': done('完成。'), 'Ship it?': done('要发布吗？'), Ship: done('发布') }
    expect(cardQuote(card, text => zh[text] ?? NO_PARA)).toBe('---\n\n**下方卡片的译文**\n\n> 完成。\n>\n> 问题：要发布吗？（发布 / Wait）')
  })
})
