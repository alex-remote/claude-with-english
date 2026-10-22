import { describe, expect, test } from 'claude-code/testing'

import { NO_PARA } from '../../hooks/core/state/defaults'
import { cardOf, cardQuote, cardTexts } from '../../hooks/features/env/nextStep'
import type { WwePara } from '../../types'

// The desktop's summary card: its text from Claude's call, and its
// translation for the end of the reply above it.

const done = (zh: string): WwePara => ({ status: 'done', zh, error: null, shown: true })
const RULE = '---\n\n'

describe('the summary card', () => {
  test('its recap, its question and its reply buttons with what each sends; an app action’s button is left out', () => {
    expect(
      cardOf({
        recap: ' Done. ',
        ask: 'Archive it?',
        actions: [{ label: 'Archive it', message: 'Archive the stale setup session.' }, { label: 'Keep it' }, { action: 'commit' }],
      }),
    ).toEqual({
      recap: 'Done.',
      ask: 'Archive it?',
      buttons: [
        { label: 'Archive it', message: 'Archive the stale setup session.' },
        { label: 'Keep it', message: 'Keep it' },
      ],
    })
    expect(cardOf({ recap: 'Done.', actions: [{ label: 'Ship' }] })).toEqual({ recap: 'Done.', ask: null, buttons: [] })
    expect(cardOf({ ask: 'Ship it?' })).toBeNull()
  })

  test('each text translated once: the recap, the question, each label and each message', () => {
    const card = { recap: 'Done.', ask: 'Archive it?', buttons: [{ label: 'Archive it', message: 'Archive the session.' }, { label: 'Keep it', message: 'Keep it' }] }
    expect(cardTexts(card)).toEqual(['Done.', 'Archive it?', 'Archive it', 'Archive the session.', 'Keep it'])
  })

  test('a recap alone is quoted alone; a card not in English adds nothing', () => {
    const card = { recap: 'Done.', ask: null, buttons: [] }
    expect(cardQuote(card, () => done('完成。'))).toBe(`${RULE}> 完成。`)
    expect(cardQuote(card, () => NO_PARA)).toBeNull()
  })

  test('each button with what a click sends; one whose translation has not come shows its own words', () => {
    const card = {
      recap: 'Done.',
      ask: 'Archive it?',
      buttons: [
        { label: 'Archive it', message: 'Archive the stale setup session.' },
        { label: 'Keep it', message: 'Keep it' },
      ],
    }
    const zh: Record<string, WwePara> = {
      'Done.': done('完成。'),
      'Archive it?': done('要归档吗？'),
      'Archive it': done('归档'),
      'Archive the stale setup session.': done('归档过期的设置会话。'),
    }
    expect(cardQuote(card, text => zh[text] ?? NO_PARA)).toBe(
      `${RULE}> 完成。\n>\n> 问题：要归档吗？\n>\n> - 归档，点击后发送：归档过期的设置会话。\n> - Keep it`,
    )
  })
})
