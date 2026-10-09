import { describe, expect, test } from 'claude-code/testing'

import { endpoints, hostOf, isHttpUrl } from '../../hooks/core/endpoints'

describe('endpoints', () => {
  test('a Base URL gets the three paths added', () => {
    expect(endpoints('https://openrouter.ai/api/v1')).toEqual({
      chat: 'https://openrouter.ai/api/v1/chat/completions',
      models: 'https://openrouter.ai/api/v1/models',
      speech: 'https://openrouter.ai/api/v1/audio/speech',
    })
  })

  test('a full address has its /chat/completions replaced', () => {
    expect(endpoints('https://api.openai.com/v1/chat/completions')).toEqual({
      chat: 'https://api.openai.com/v1/chat/completions',
      models: 'https://api.openai.com/v1/models',
      speech: 'https://api.openai.com/v1/audio/speech',
    })
  })

  test('trailing slashes and spaces go', () => {
    expect(endpoints(' https://openrouter.ai/api/v1/ ').models).toBe('https://openrouter.ai/api/v1/models')
    expect(endpoints('https://openrouter.ai/api/v1//').chat).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(endpoints('https://api.openai.com/v1/chat/completions/').models).toBe('https://api.openai.com/v1/models')
  })

  test('a local server works the same', () => {
    expect(endpoints('http://localhost:11434/v1').models).toBe('http://localhost:11434/v1/models')
  })

  test('/chat/completions in the middle of a path is kept', () => {
    expect(endpoints('https://proxy.example.com/chat/completions/v1').models).toBe(
      'https://proxy.example.com/chat/completions/v1/models',
    )
  })
})

describe('hostOf', () => {
  test('the host name of an address', () => {
    expect(hostOf('https://openrouter.ai/api/v1')).toBe('openrouter.ai')
    expect(hostOf('https://api.openai.com/v1/chat/completions')).toBe('api.openai.com')
  })

  test('case, port and credentials do not count', () => {
    expect(hostOf('https://OpenRouter.AI:443/api/v1')).toBe('openrouter.ai')
    expect(hostOf('http://localhost:11434/v1')).toBe('localhost')
    expect(hostOf('https://user:pass@api.example.com/v1')).toBe('api.example.com')
    expect(hostOf('https://api.example.com?x=1')).toBe('api.example.com')
    expect(hostOf('http://[::1]:8080/v1')).toBe('[::1]')
  })

  test('changing the path keeps the host; changing the domain does not', () => {
    expect(hostOf('https://openrouter.ai/api/v1')).toBe(hostOf('https://openrouter.ai/api/v1/chat/completions'))
    expect(hostOf('https://openrouter.ai/api/v1')).not.toBe(hostOf('https://api.openai.com/v1'))
  })

  test('no host gives null', () => {
    expect(hostOf('')).toBeNull()
    expect(hostOf('openrouter.ai/api/v1')).toBeNull()
    expect(hostOf('https://')).toBeNull()
    expect(hostOf('https:///v1')).toBeNull()
  })
})

describe('isHttpUrl', () => {
  test('http and https addresses with a host', () => {
    expect(isHttpUrl('https://openrouter.ai/api/v1')).toBe(true)
    expect(isHttpUrl('http://localhost:11434/v1')).toBe(true)
    expect(isHttpUrl(' https://api.openai.com/v1/chat/completions ')).toBe(true)
    expect(isHttpUrl('HTTPS://API.OPENAI.COM/V1')).toBe(true)
  })

  test('anything else is not', () => {
    expect(isHttpUrl('')).toBe(false)
    expect(isHttpUrl('openrouter.ai/api/v1')).toBe(false)
    expect(isHttpUrl('ftp://example.com/v1')).toBe(false)
    expect(isHttpUrl('https://')).toBe(false)
    expect(isHttpUrl('https://exa mple.com/v1')).toBe(false)
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
  })
})
