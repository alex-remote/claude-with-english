import { describe, expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { firstRunToast } from '../../hooks/core/copy/common'
import { settingsOpenedFromMessage } from '../../hooks/core/copy/settings'
import { WRAP_UP_TOOL, withQuestionInReply } from '../../hooks/features/env/nextStep'
import { start, world } from '../support/engine'

// The desktop app as 3.1623.0 (Claude Code 2.1.304) runs a mod, measured on
// 10-22: it keeps several sessions running (split view, the sidebar, the
// sessions Claude starts beside one) and attaches only the one on screen;
// its prompt box may send a mod's command on as a message (#99691).

/** The test's `on`, which the kit types but does not export by name */
type On = Parameters<TestBody>[1]

// Each test loads the whole mod; on a busy machine that alone takes seconds
const LOADS_THE_MOD = { timeoutMs: 60_000 }

/** What /wwe reads before it opens the pane, and the panes opened */
function settingsPane(on: On) {
  const opened: { id: string }[] = []
  on('settings.read', () => ({ value: {} }))
  on('config.list', () => ({ value: [] }))
  on('ui.open', ($, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  return opened
}

describe('the desktop app', () => {
  test('a session nobody has open keeps its start-up toast until a window shows it', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
    await w.clock.settle()
    expect(w.toasts).toEqual([])

    w.surfaces = ['desktop']
    await $.session.attach({ surface: 'desktop', clientId: 'desktop-1' })
    await w.clock.settle()
    expect(w.toasts).toEqual([firstRunToast()])
  })

  test('a session on screen at its start shows the toast at once', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    await start($, w, 'desktop')
    expect(w.toasts).toEqual([firstRunToast()])
  })

  test('/wwe sent on as a message opens the settings, goes no further and leaves the prompt box', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    const opened = settingsPane(on)
    await start($, w, 'desktop')
    w.prompt = { text: '/wwe', cursor: 4 }

    const result = await $.prompt.submit({ text: '/wwe', wait: false, origin: { kind: 'composer' } })
    await w.clock.settle()

    expect(result).toEqual({ drop: settingsOpenedFromMessage() })
    expect(opened).toMatchObject([{ id: 'wwe' }])
    expect(w.submitted).toEqual([])
    expect(w.prompt.text).toBe('')
  })

  test('the summary card’s tool tells Claude to ask in its reply; every other tool reads as it was', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    on('tool.describe', ($, e) => ({ description: e.description }))
    await start($, w, 'desktop')
    const provider = { plugin: 'mcp:ccd_turn', tier: 'user' } as const

    const card = await $.tool.describe({ tool: WRAP_UP_TOOL, description: 'Fill the "next step" box.', provider })
    const bash = await $.tool.describe({ tool: 'Bash', description: 'Runs a command.', provider: { plugin: 'engine', tier: 'core' } })

    expect(card.description).toBe(withQuestionInReply('Fill the "next step" box.'))
    expect(card.description).toContain('pass `recap` alone')
    expect(bash.description).toBe('Runs a command.')
    // Asked again, as on a resumed thread: the note is not added twice
    expect(withQuestionInReply(card.description)).toBe(card.description)
  })

  test('the session’s start asks for the tools’ descriptions again, so the card’s note reaches the first turn', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    const asked: string[] = []
    on('ui.invalidate', ($, e) => {
      asked.push(e.event)
      return { value: undefined }
    })
    await start($, w, 'desktop')
    expect(asked).toContain('tool.describe')
  })

  test('a message that only starts with the letters goes on as any other', LOADS_THE_MOD, async ($, on) => {
    const w = world(on)
    const opened = settingsPane(on)
    await start($, w, 'desktop')

    await $.prompt.submit({ text: '/wwexyz is not ours', wait: false, origin: { kind: 'composer' } })

    expect(opened).toEqual([])
    expect(w.submitted).toEqual(['/wwexyz is not ours'])
  })
})
