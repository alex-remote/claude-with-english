import { describe, expect, test } from 'claude-code/testing'

import type { Host } from '../../hooks/host'
import { listModels as listElevenModels, listVoices } from '../../hooks/services/catalog/elevenlabs'
import { listModels } from '../../hooks/services/catalog/openai'
import { REASONS, errorCodeOf } from '../../hooks/services/translate/errors'
import { run } from '../../hooks/services/translate/index'
import { TIMEOUT_MS, replyTextOf } from '../../hooks/services/translate/openai'
import { draftPrompt } from '../../hooks/services/translate/prompts'

// F7: the OpenAI-compatible transport, its failures, and the lists of
// models and voices, against an `http.fetch` that answers by address.

type Init = { method?: string; headers?: Record<string, string>; body?: string }
type Call = { url: string; init: Init }
type Answer = { status: number; text: string } | Error | Promise<{ status: number; text: string }>
type Handler = (url: string, init: Init, call: number) => Answer

const KEY = 'sk-test-abcd1234'

const OPENAI_STORE = {
  'settings/translateService': 'openai',
  'settings/openaiBaseUrl': 'https://api.example.com/v1',
  'settings/openaiKey': KEY,
  'settings/openaiModel': 'gpt-4o-mini',
}

/** A clock moved by hand: `advance` runs the timers that come due. */
function manualClock() {
  let now = 0
  const timers: { at: number; fn: () => void; cancelled: boolean }[] = []
  return {
    after: (ms: number, fn: () => void) => {
      const timer = { at: now + ms, fn, cancelled: false }
      timers.push(timer)
      return { cancel: () => void (timer.cancelled = true) }
    },
    advance: (ms: number) => {
      now += ms
      for (const timer of timers.filter(t => !t.cancelled && t.at <= now)) {
        timer.cancelled = true
        timer.fn()
      }
    },
    pending: () => timers.filter(t => !t.cancelled).length,
  }
}

function fakeHost(handler: Handler, store: Record<string, unknown> = OPENAI_STORE) {
  const calls: Call[] = []
  const debug: string[] = []
  const clock = manualClock()
  const host = {
    http: {
      fetch: async (url: string, init: Init = {}) => {
        calls.push({ url, init })
        const answer = await handler(url, init, calls.length)
        if (answer instanceof Error) {
          throw answer
        }
        return { ...answer, ok: answer.status >= 200 && answer.status < 300, headers: {} }
      },
    },
    clock: { after: clock.after },
    store: { get: async (key: string) => store[key] },
    ui: { debug: (text: string) => debug.push(text) },
  }
  return { host: host as unknown as Host, calls, debug, clock }
}

const chat = (content: unknown) => ({ status: 200, text: JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content } }] }) })
const error = (status: number, body: unknown = '') => ({ status, text: typeof body === 'string' ? body : JSON.stringify(body) })

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>(settle => {
    resolve = settle
  })
  return { promise, resolve }
}

const flush = async () => {
  for (let i = 0; i < 100; i += 1) {
    await Promise.resolve()
  }
}

const DRAFT = { kind: 'draft', text: '帮我看看这个报错是怎么回事' } as const

describe('openai transport: the request', () => {
  test('POST <base>/chat/completions with the Key in the header, the model, and system and user messages', async () => {
    const { host, calls } = fakeHost(() => chat("Can you help me figure out what's causing this error?"))
    const result = await run(host, DRAFT)

    expect(result).toEqual({ ok: true, value: "Can you help me figure out what's causing this error?" })
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.url).toBe('https://api.example.com/v1/chat/completions')
    expect(call?.url).not.toContain(KEY)
    expect(call?.init.method).toBe('POST')
    expect(call?.init.headers).toEqual({ Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' })
    expect(JSON.parse(call?.init.body ?? '')).toEqual({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: draftPrompt(DRAFT.text).system },
        { role: 'user', content: '<source>\n帮我看看这个报错是怎么回事\n</source>' },
      ],
    })
  })

  test('a full chat address works as well as a Base URL', async () => {
    const { host, calls } = fakeHost(() => chat('ok'), {
      ...OPENAI_STORE,
      'settings/openaiBaseUrl': 'https://openrouter.ai/api/v1/chat/completions/',
    })
    await run(host, DRAFT)
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/chat/completions')
  })

  test('the Claude Code model is not used', async () => {
    const { host, calls } = fakeHost(() => chat('ok'), { ...OPENAI_STORE, 'settings/claudeModel': 'opus' })
    await run(host, DRAFT)
    expect(JSON.parse(calls[0]?.init.body ?? '').model).toBe('gpt-4o-mini')
  })

  test('replyTextOf reads choices[0].message.content and nothing else', () => {
    expect(replyTextOf(chat('Hi').text)).toBe('Hi')
    expect(replyTextOf('<html>')).toBeNull()
    expect(replyTextOf('{"choices":[]}')).toBeNull()
    expect(replyTextOf(chat(null).text)).toBeNull()
  })
})

describe('openai transport: 换了域名 and missing settings', () => {
  test('while the Key is held back from a new domain, nothing is sent', async () => {
    const { host, calls } = fakeHost(() => chat('ok'), { ...OPENAI_STORE, 'flag/keyStale': true })
    expect(await run(host, DRAFT)).toEqual({ ok: false, kind: 'auth', reason: REASONS.keyStale })
    expect(REASONS.keyStale).toBe('请求地址换了域名，请到“服务”页重新输入 API Key')
    expect(calls).toHaveLength(0)
  })

  test('a setting missing: no request, 服务还没有配置完成', async () => {
    const { host, calls } = fakeHost(() => chat('ok'), { ...OPENAI_STORE, 'settings/openaiKey': '' })
    expect(await run(host, DRAFT)).toEqual({ ok: false, kind: 'other', reason: '服务还没有配置完成，请到“服务”页填写' })
    expect(calls).toHaveLength(0)
  })
})

describe('openai transport: failures by status', () => {
  test('401 and 403: API Key 不对或已过期', async () => {
    for (const status of [401, 403]) {
      const { host } = fakeHost(() => error(status, { error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } }))
      expect(await run(host, DRAFT)).toEqual({ ok: false, kind: 'auth', reason: 'API Key 不对或已过期' })
    }
  })

  test('429, and an account out of credit: 请求太多或额度用完', async () => {
    const { host } = fakeHost(() => error(429, { error: { type: 'rate_limit_exceeded' } }))
    expect(await run(host, DRAFT)).toEqual({ ok: false, kind: 'quota', reason: '请求太多或额度用完' })
    const broke = fakeHost(() => error(429, { error: { code: 'insufficient_quota', type: 'insufficient_quota' } }))
    expect(await run(broke.host, DRAFT)).toMatchObject({ ok: false, kind: 'quota' })
  })

  test('5xx: <状态码> <错误>, or the status alone', async () => {
    const { host, debug } = fakeHost(() => error(500, { error: { message: 'boom', type: 'server_error' } }))
    expect(await run(host, DRAFT)).toEqual({ ok: false, kind: 'other', reason: '500 server_error' })
    expect(debug.join('\n')).toContain('api-error 500 server_error')
    const bare = fakeHost(() => error(503, '<html>Service Unavailable</html>'))
    expect(await run(bare.host, DRAFT)).toEqual({ ok: false, kind: 'other', reason: '503' })
  })

  test('a model the server does not have', async () => {
    const { host } = fakeHost(() => error(404, { error: { code: 'model_not_found' } }))
    expect(await run(host, DRAFT)).toMatchObject({ ok: false, kind: 'model-unavailable' })
  })

  test('no connection: 网络连接失败, and the engine’s words go to the debug log', async () => {
    const { host, debug } = fakeHost(() => new Error('$.http.fetch(https://api.example.com/v1/chat/completions) failed: ECONNREFUSED'))
    expect(await run(host, DRAFT)).toEqual({ ok: false, kind: 'network', reason: '网络连接失败' })
    expect(debug.join('\n')).toContain('ECONNREFUSED')
  })

  test('a body that is no chat reply is asked once more, then 返回的内容无法解析', async () => {
    const { host, calls } = fakeHost(() => ({ status: 200, text: '<html>not json</html>' }))
    expect(await run(host, DRAFT)).toEqual({ ok: false, kind: 'bad-format', reason: '返回的内容无法解析' })
    expect(calls).toHaveLength(2)
  })

  test('the second try can succeed', async () => {
    const { host, calls } = fakeHost((_url, _init, call) => (call === 1 ? chat('') : chat('Fixed it.')))
    expect(await run(host, DRAFT)).toEqual({ ok: true, value: 'Fixed it.' })
    expect(calls).toHaveLength(2)
  })
})

describe('openai transport: 30 s and late answers', () => {
  test('no answer in 30 s fails, and the answer that comes later is dropped', async () => {
    const late = deferred<{ status: number; text: string }>()
    const { host, clock } = fakeHost(() => late.promise)
    let result: unknown = 'pending'
    void run(host, DRAFT).then(value => {
      result = value
    })
    await flush()
    clock.advance(TIMEOUT_MS - 1)
    await flush()
    expect(result).toBe('pending')
    clock.advance(1)
    await flush()
    expect(result).toEqual({ ok: false, kind: 'timeout', reason: '30 秒内没有结果' })
    late.resolve(chat('Too late.'))
    await flush()
    expect(result).toMatchObject({ ok: false, kind: 'timeout' })
  })

  test('an answer in time cancels the timer', async () => {
    const { host, clock } = fakeHost(() => chat('ok'))
    await run(host, DRAFT)
    expect(clock.pending()).toBe(0)
  })

  test('the caller’s signal ends the wait at once: cancelled, the late answer dropped', async () => {
    const late = deferred<{ status: number; text: string }>()
    const { host } = fakeHost(() => late.promise)
    const stop = new AbortController()
    const pending = run(host, DRAFT, { signal: stop.signal })
    await flush()
    stop.abort('superseded')
    expect(await pending).toEqual({ ok: false, kind: 'cancelled', reason: '已取消' })
    late.resolve(chat('Too late.'))
    await flush()
  })

  test('a slot ticket aborted for its own timeout reads as the timeout', async () => {
    const late = deferred<{ status: number; text: string }>()
    const { host } = fakeHost(() => late.promise)
    const stop = new AbortController()
    const pending = run(host, DRAFT, { signal: stop.signal })
    await flush()
    stop.abort('timeout')
    expect(await pending).toMatchObject({ ok: false, kind: 'timeout' })
  })
})

describe('errorCodeOf', () => {
  test('OpenAI’s error.code, else error.type; ElevenLabs’ detail.status; else nothing', () => {
    expect(errorCodeOf('{"error":{"code":"invalid_api_key","type":"invalid_request_error"}}')).toBe('invalid_api_key')
    expect(errorCodeOf('{"error":{"code":null,"type":"server_error"}}')).toBe('server_error')
    expect(errorCodeOf('{"detail":{"status":"quota_exceeded","message":"…"}}')).toBe('quota_exceeded')
    expect(errorCodeOf('{"detail":[{"msg":"field required"}]}')).toBe('')
    expect(errorCodeOf('Bad Gateway')).toBe('')
  })
})

describe('获取模型列表 (OpenAI-compatible)', () => {
  test('GET <base>/models with the Key in the header: the ids once each, sorted, and the address', async () => {
    const { host, calls } = fakeHost(() => ({
      status: 200,
      text: JSON.stringify({ object: 'list', data: [{ id: 'gpt-4o-mini' }, { id: 'deepseek-chat' }, { id: 'gpt-4o-mini' }, { id: 7 }] }),
    }))
    expect(await listModels(host, 'https://api.example.com/v1/', KEY)).toEqual({
      ok: true,
      ids: ['deepseek-chat', 'gpt-4o-mini'],
      from: 'https://api.example.com/v1/models',
    })
    expect(calls[0]?.url).toBe('https://api.example.com/v1/models')
    expect(calls[0]?.init.headers).toEqual({ Authorization: `Bearer ${KEY}` })
    expect(calls[0]?.init.method).toBeUndefined()
  })

  test('from the full chat address too', async () => {
    const { host, calls } = fakeHost(() => ({ status: 200, text: '{"data":[]}' }))
    expect(await listModels(host, 'https://openrouter.ai/api/v1/chat/completions', KEY)).toMatchObject({ ok: true, ids: [] })
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/models')
  })

  test('401: the status, then 检查 API Key 或勾选“手动填写”', async () => {
    const { host } = fakeHost(() => error(401, { error: { code: 'invalid_api_key' } }))
    expect(await listModels(host, 'https://api.example.com/v1', KEY)).toEqual({
      ok: false,
      kind: 'auth',
      reason: '401 API Key 不对或已过期，请检查 API Key 或勾选“手动填写”',
    })
  })

  test('any other failure points to 手动填写', async () => {
    const offline = fakeHost(() => new Error('ECONNREFUSED'))
    expect(await listModels(offline.host, 'https://api.example.com/v1', KEY)).toEqual({
      ok: false,
      kind: 'network',
      reason: '网络连接失败，可以勾选“手动填写”',
    })
    const missing = fakeHost(() => error(404, 'Not Found'))
    expect(await listModels(missing.host, 'https://api.example.com/v1', KEY)).toMatchObject({ reason: '404，可以勾选“手动填写”' })
    const html = fakeHost(() => ({ status: 200, text: '<html></html>' }))
    expect(await listModels(html.host, 'https://api.example.com/v1', KEY)).toMatchObject({
      kind: 'bad-format',
      reason: '返回的内容无法解析，可以勾选“手动填写”',
    })
  })

  test('no answer in 30 s', async () => {
    const { host, clock } = fakeHost(() => new Promise(() => {}))
    const pending = listModels(host, 'https://api.example.com/v1', KEY)
    await flush()
    clock.advance(TIMEOUT_MS)
    expect(await pending).toEqual({ ok: false, kind: 'timeout', reason: '30 秒内没有结果，可以勾选“手动填写”' })
  })
})

describe('ElevenLabs: 获取模型和声音', () => {
  test('the models that can read aloud, with the Key in xi-api-key', async () => {
    const { host, calls } = fakeHost(() => ({
      status: 200,
      text: JSON.stringify([
        { model_id: 'eleven_multilingual_v2', name: 'Eleven Multilingual v2', can_do_text_to_speech: true },
        { model_id: 'eleven_english_sts_v2', name: 'Eleven English v2', can_do_text_to_speech: false },
        { model_id: 'eleven_flash_v2_5', can_do_text_to_speech: true },
      ]),
    }))
    expect(await listElevenModels(host, KEY)).toEqual({
      ok: true,
      models: [
        { id: 'eleven_multilingual_v2', name: 'Eleven Multilingual v2' },
        { id: 'eleven_flash_v2_5', name: 'eleven_flash_v2_5' },
      ],
    })
    expect(calls[0]?.url).toBe('https://api.elevenlabs.io/v1/models')
    expect(calls[0]?.init.headers).toEqual({ 'xi-api-key': KEY })
  })

  test('the voices, 100 to a page, as voice_id and name in the order given', async () => {
    const { host, calls } = fakeHost(() => ({
      status: 200,
      text: JSON.stringify({
        voices: [
          { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', category: 'premade' },
          { voice_id: 'EXAVITQu4vr4xnAQ0X5k', name: 'Sarah' },
        ],
        has_more: false,
      }),
    }))
    expect(await listVoices(host, KEY)).toEqual({
      ok: true,
      voices: [
        { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George' },
        { id: 'EXAVITQu4vr4xnAQ0X5k', name: 'Sarah' },
      ],
    })
    expect(calls[0]?.url).toBe('https://api.elevenlabs.io/v2/voices?page_size=100&include_total_count=false')
    expect(calls[0]?.url).not.toContain(KEY)
    expect(calls[0]?.init.headers).toEqual({ 'xi-api-key': KEY })
  })

  test('a wrong Key: 401……检查 API Key; no 手动填写 here', async () => {
    const { host } = fakeHost(() => error(401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } }))
    expect(await listVoices(host, KEY)).toEqual({ ok: false, kind: 'auth', reason: '401 API Key 不对或已过期，请检查 API Key' })
    expect(await listElevenModels(host, KEY)).toMatchObject({ kind: 'auth' })
  })

  test('an account out of credit answers 401 quota_exceeded: that is the quota, not the Key', async () => {
    const { host } = fakeHost(() => error(401, { detail: { status: 'quota_exceeded', message: 'This request exceeds your quota' } }))
    expect(await listVoices(host, KEY)).toEqual({ ok: false, kind: 'quota', reason: '请求太多或额度用完' })
  })

  test('a body that is not the list', async () => {
    const { host } = fakeHost(() => ({ status: 200, text: '{"detail":"oops"}' }))
    expect(await listElevenModels(host, KEY)).toMatchObject({ ok: false, kind: 'bad-format' })
    expect(await listVoices(host, KEY)).toMatchObject({ ok: false, kind: 'bad-format' })
  })
})
