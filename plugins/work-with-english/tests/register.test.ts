import { describe, expect, mock, test } from 'claude-code/testing'

describe('register', () => {
  test('session.start registers /wwe to run mid-turn, and /wwe prints nothing', async ($, on) => {
    const registered: unknown[] = []
    mock.clock(on)
    mock.store(on, {})
    on('session.start', () => ({ cwd: '/work' }))
    on('command.register', ($, e) => {
      registered.push(e)
      return { value: { command: e.name } }
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
  })

  test('a refused /wwe still lets the session start', async ($, on) => {
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
