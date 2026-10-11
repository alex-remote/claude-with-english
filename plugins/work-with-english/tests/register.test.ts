import { describe, expect, mock, test } from 'claude-code/testing'

// Each test loads the whole mod; on a busy machine that alone takes seconds
const LOADS_THE_MOD = { timeoutMs: 60_000 }

describe('register', () => {
  test('session.start registers /wwe to run mid-turn; /wwe opens the settings and prints nothing', LOADS_THE_MOD, async ($, on) => {
    const registered: unknown[] = []
    mock.clock(on)
    mock.store(on, {})
    on('session.start', () => ({ cwd: '/work' }))
    on('command.register', ($, e) => {
      registered.push(e)
      return { value: { command: e.name } }
    })
    // /wwe reads the settings and F5's language, then opens the pane
    const opened: unknown[] = []
    on('settings.read', () => ({ value: {} }))
    on('config.list', () => ({ value: [] }))
    on('ui.open', ($, e) => {
      opened.push(e)
      return { value: { isPlaced: true } }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const answer = await $.command.run({
      command: 'wwe',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 120 },
    })

    expect(registered).toMatchObject([
      { name: 'wwe', description: '打开 work-with-english 设置', immediate: true },
    ])
    expect(answer).toEqual({})
    expect(opened).toMatchObject([{ id: 'wwe', focus: true, closeOnEscape: true }])
  })

  test('a refused /wwe still lets the session start', LOADS_THE_MOD, async ($, on) => {
    const logged: string[] = []
    mock.clock(on)
    on('session.start', () => ({ cwd: '/work' }))
    on('command.register', () => ({ deny: 'the name is taken' }))
    on('ui.log', ($, e) => {
      logged.push(e.text)
      return { value: undefined }
    })

    const started = await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

    expect(started).toEqual({ cwd: '/work' })
    expect(logged.join('\n')).toContain('/wwe was not registered')
  })
})
