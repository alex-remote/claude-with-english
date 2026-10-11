import { describe, expect, test } from 'claude-code/testing'

import type { WweSpeaking } from '../../types'
import { TRY_TEXT, createSpeaker } from '../../hooks/features/speak/controller'
import type { Host } from '../../hooks/host'
import {
  ONLINE_MAX_CHARS,
  SPEECH_TIMEOUT_MS,
  curlConfig,
  curlQuote,
  onlinePieces,
  speechHashOf,
  synthesize,
} from '../../hooks/services/speech/online'
import type { SpeechRequest } from '../../hooks/services/speech/online'

// F8 在线语音: curl downloads into tts/, the cache spares a second request,
// and 朗读 stops, switches and fails as 同时只读一处 and 通用状态 say. The
// Host answers curl by its stdin config, keeps files in a Map and plays
// clips until their signal aborts.

const DATA = '/Users/t/.claude/plugins/data/work-with-english-inline'
const OPENAI_KEY = 'sk-test-abcd1234'
const ELEVEN_KEY = 'xi-test-5678efgh'

const ONLINE_STORE = {
  'settings/speechService': 'openai',
  'settings/openaiBaseUrl': 'https://api.example.com/v1',
  'settings/openaiKey': OPENAI_KEY,
  'settings/openaiTtsModel': 'gpt-4o-mini-tts',
  'settings/voiceOpenai': 'coral',
  'settings/elevenKey': ELEVEN_KEY,
}

type Curl = { url: string; headers: string[]; body: string; output: string; flags: string[]; stdin: string; timeoutMs?: number }
type CurlAnswer = { status: number; type?: string; body?: string } | { exit: number } | Error
type CurlHandler = (curl: Curl) => CurlAnswer | Promise<CurlAnswer>

/** The `name = "value"` lines of a curl config, unquoted; a bare name is a flag. */
function parseConfig(stdin: string): Curl {
  const curl: Curl = { url: '', headers: [], body: '', output: '', flags: [], stdin }
  for (const line of stdin.split('\n').filter(l => l !== '')) {
    const match = /^([\w-]+)(?: = "((?:[^"\\]|\\.)*)")?$/.exec(line)
    if (!match) {
      throw new Error(`not a config line: ${line}`)
    }
    const [, name = '', quoted] = match
    const value = quoted?.replace(/\\(.)/g, '$1')
    if (value === undefined) {
      curl.flags.push(name)
    } else if (name === 'url') {
      curl.url = value
    } else if (name === 'header') {
      curl.headers.push(value)
    } else if (name === 'data-binary') {
      curl.body = value
    } else if (name === 'output') {
      curl.output = value
    } else {
      curl.flags.push(`${name}=${value}`)
    }
  }
  return curl
}

const mp3 = (text = 'audio'): CurlAnswer => ({ status: 200, type: 'audio/mpeg', body: `ID3 ${text}` })

type Options = {
  store?: Record<string, unknown>
  curl?: CurlHandler
  /** What `http.fetch` answers (ElevenLabs' voices) */
  fetch?: (url: string) => { status: number; text: string }
  /** 'hold': a clip plays until its signal aborts or `endPlay` */
  play?: 'instant' | 'hold' | Error
  /** 'hold': the system voice speaks until `endSpeak` */
  speak?: 'instant' | 'hold'
}

function fakeHost(options: Options = {}) {
  const store: Record<string, unknown> = { ...ONLINE_STORE, ...options.store }
  const files = new Map<string, string>()
  const argvs: string[][] = []
  const curls: Curl[] = []
  const fetches: string[] = []
  const plays: { base64: string; mime: string; signal: AbortSignal }[] = []
  const spoken: string[] = []
  const toasts: string[] = []
  const debug: string[] = []
  const speakingLog: WweSpeaking[] = []
  let speaking: WweSpeaking = null
  let endPlay: () => void = () => {}
  let endSpeak: () => void = () => {}

  const listDir = (dir: string) => {
    const inside = [...files.keys()].filter(path => path.startsWith(`${dir}/`))
    if (inside.length === 0) {
      throw new Error(`$.fs.list(${dir}) failed: ENOENT`)
    }
    return inside
      .filter(path => !path.slice(dir.length + 1).includes('/'))
      .map(path => ({ name: path.slice(dir.length + 1), kind: 'file' as const, size: files.get(path)?.length ?? 0, mtimeMs: 0, isLink: false }))
  }

  const host = {
    plugin: { name: 'work-with-english', root: '/Users/t/dev/work-with-english' },
    env: { home: async () => '/Users/t', configDir: async () => undefined, pluginCacheDir: async () => undefined },
    store: { get: async (key: string) => store[key] },
    fs: {
      read: async (path: string) => {
        const text = files.get(path)
        if (text === undefined) {
          throw new Error(`ENOENT ${path}`)
        }
        return text
      },
      readBytes: async (path: string) => {
        const text = files.get(path)
        if (text === undefined) {
          throw new Error(`ENOENT ${path}`)
        }
        return { base64: btoa(text) }
      },
      list: async (dir: string) => listDir(dir),
      exists: async (path: string) => files.has(path),
    },
    proc: {
      run: async (argv: readonly string[], init: { stdin?: string; timeoutMs?: number } = {}) => {
        argvs.push([...argv])
        const done = (exitCode: number, stdout = '', stderr = '') => ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })
        const [command, a = '', b = ''] = argv
        if (command === 'mv') {
          const [, , from = '', to = ''] = argv
          const text = files.get(from)
          if (text === undefined) {
            return done(1, '', 'No such file')
          }
          files.delete(from)
          files.set(to, text)
          return done(0)
        }
        if (command === 'rm') {
          files.delete(b || a)
          return done(0)
        }
        if (command !== 'curl') {
          throw new Error(`unexpected command ${command}`)
        }
        const curl = { ...parseConfig(init.stdin ?? ''), timeoutMs: init.timeoutMs }
        curls.push(curl)
        const answer = await (options.curl ?? (() => mp3()))(curl)
        if (answer instanceof Error) {
          throw answer
        }
        if ('exit' in answer) {
          return done(answer.exit, '000 ', 'curl: (7) Failed to connect')
        }
        files.set(curl.output, answer.body ?? '')
        const failed = answer.status >= 400 && curl.flags.includes('fail-with-body')
        return done(failed ? 22 : 0, `${answer.status} ${answer.type ?? 'application/json'}`, failed ? `curl: (22) The requested URL returned error: ${answer.status}` : '')
      },
    },
    http: {
      fetch: async (url: string) => {
        fetches.push(url)
        const answer = options.fetch?.(url) ?? { status: 404, text: '' }
        return { ...answer, ok: answer.status < 300, headers: {} }
      },
    },
    clock: { after: () => ({ cancel: () => {} }) },
    audio: {
      speak: (text: string, opts?: { voice?: string }) => {
        spoken.push(opts?.voice ? `${opts.voice}: ${text}` : text)
        return options.speak === 'hold'
          ? new Promise<void>(resolve => {
              endSpeak = resolve
            })
          : Promise.resolve()
      },
      play: (clip: { base64: string; mime: string }, opts: { signal: AbortSignal }) => {
        plays.push({ ...clip, signal: opts.signal })
        const mode = options.play ?? 'instant'
        if (mode instanceof Error) {
          return Promise.reject(mode)
        }
        if (mode === 'instant') {
          return Promise.resolve()
        }
        return new Promise<void>(resolve => {
          endPlay = resolve
          opts.signal.addEventListener('abort', () => resolve(), { once: true })
        })
      },
    },
    state: {
      speaking: {
        get: async () => speaking,
        update: async (fn: (value: WweSpeaking) => WweSpeaking) => {
          speaking = fn(speaking)
          speakingLog.push(speaking)
          return speaking
        },
      },
    },
    ui: { toast: (text: string) => toasts.push(text), debug: (text: string) => debug.push(text) },
  }
  return {
    host: host as unknown as Host,
    files,
    argvs,
    curls,
    fetches,
    plays,
    spoken,
    toasts,
    debug,
    speakingLog,
    speaking: () => speaking,
    endPlay: () => endPlay(),
    endSpeak: () => endSpeak(),
  }
}

const OPENAI_PIECE: SpeechRequest = { service: 'openai', text: 'I found the cause.', voice: 'coral', model: 'gpt-4o-mini-tts' }

const cachePath = (request: SpeechRequest, ext: string) => {
  const hash = speechHashOf(request)
  return `${DATA}/tts/${hash.slice(0, 2)}/${hash}.${ext}`
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>(settle => {
    resolve = settle
  })
  return { promise, resolve }
}

const flush = async () => {
  for (let i = 0; i < 200; i += 1) {
    await Promise.resolve()
  }
}

describe('curl config', () => {
  test('each value double quoted, with " and \\ escaped; a line break is refused', () => {
    expect(curlQuote('Say "hi" \\ there')).toBe('"Say \\"hi\\" \\\\ there"')
    expect(() => curlQuote('sk-1\nurl = "https://evil.example"')).toThrow('line break')
  })

  test('a POST that keeps the body on a 4xx, writes the file and prints the status and type', () => {
    const config = curlConfig({ url: 'https://api.example.com/v1/audio/speech', headers: { 'xi-api-key': 'k' }, body: '{"a":"b"}' }, '/d/x.part')
    expect(config.split('\n')).toEqual([
      'url = "https://api.example.com/v1/audio/speech"',
      'request = "POST"',
      'header = "xi-api-key: k"',
      'data-binary = "{\\"a\\":\\"b\\"}"',
      'output = "/d/x.part"',
      'create-dirs',
      'fail-with-body',
      'silent',
      'show-error',
      'write-out = "%{http_code} %{content_type}"',
      '',
    ])
  })
})

describe('onlinePieces', () => {
  test('a short text is one piece, as speakable() gives it', () => {
    expect(onlinePieces('I found the `cause`.')).toEqual(['I found the cause.'])
  })

  test('a long text is cut at sentence ends, each piece at most ONLINE_MAX_CHARS', () => {
    const sentence = 'The config loader reads the port before the environment file is loaded. '
    const text = sentence.repeat(60).trim()
    const pieces = onlinePieces(text)
    expect(pieces.length).toBeGreaterThan(2)
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(ONLINE_MAX_CHARS)
      expect(piece.endsWith('loaded.')).toBe(true)
    }
    expect(pieces.join(' ')).toBe(text)
  })

  test('with no sentence end in reach, at a space', () => {
    const words = 'word '.repeat(400).trim()
    const pieces = onlinePieces(words)
    expect(pieces.every(piece => piece.length <= ONLINE_MAX_CHARS && !piece.startsWith(' '))).toBe(true)
    expect(pieces.join(' ')).toBe(words)
  })
})

describe('synthesize: OpenAI', () => {
  test('curl -K - with the request on stdin, the Key never in argv, 30 s; the file lands in tts/<hh>/', async () => {
    const t = fakeHost()
    const made = await synthesize(t.host, OPENAI_PIECE)

    expect(made).toEqual({ ok: true, path: cachePath(OPENAI_PIECE, 'mp3'), mime: 'audio/mpeg', isCached: false })
    expect(t.argvs[0]).toEqual(['curl', '-K', '-'])
    expect(t.argvs.flat().join(' ')).not.toContain(OPENAI_KEY)
    const [curl] = t.curls
    expect(curl?.timeoutMs).toBe(SPEECH_TIMEOUT_MS)
    expect(SPEECH_TIMEOUT_MS).toBe(30000)
    expect(curl?.url).toBe('https://api.example.com/v1/audio/speech')
    expect(curl?.headers).toEqual([`Authorization: Bearer ${OPENAI_KEY}`, 'Content-Type: application/json'])
    expect(JSON.parse(curl?.body ?? '')).toEqual({ model: 'gpt-4o-mini-tts', input: 'I found the cause.', voice: 'coral', response_format: 'mp3' })
    expect(curl?.flags).toContain('fail-with-body')
    expect(curl?.flags).toContain('silent')
    // Downloaded beside the cache under a name of its own, then moved in
    expect(curl?.output.startsWith(`${DATA}/tts/`)).toBe(true)
    expect(curl?.output.endsWith('.part')).toBe(true)
    expect([...t.files.keys()]).toEqual([cachePath(OPENAI_PIECE, 'mp3')])
  })

  test('the same service, model, voice and text again: from the cache, no second request', async () => {
    const t = fakeHost()
    await synthesize(t.host, OPENAI_PIECE)
    const again = await synthesize(t.host, OPENAI_PIECE)
    expect(again).toEqual({ ok: true, path: cachePath(OPENAI_PIECE, 'mp3'), mime: 'audio/mpeg', isCached: true })
    expect(t.curls).toHaveLength(1)
    // Another voice is another file
    await synthesize(t.host, { ...OPENAI_PIECE, voice: 'marin' })
    expect(t.curls).toHaveLength(2)
  })

  test('pressed again while its download runs: one request', async () => {
    const gate = deferred<CurlAnswer>()
    const t = fakeHost({ curl: () => gate.promise })
    const first = synthesize(t.host, OPENAI_PIECE)
    const second = synthesize(t.host, OPENAI_PIECE)
    await flush()
    gate.resolve(mp3())
    expect(await first).toMatchObject({ ok: true })
    expect(await second).toMatchObject({ ok: true, path: cachePath(OPENAI_PIECE, 'mp3') })
    expect(t.curls).toHaveLength(1)
  })

  test('AAC in MP4 is kept as .m4a', async () => {
    const t = fakeHost({ curl: () => ({ status: 200, type: 'audio/mp4', body: 'ftypM4A' }) })
    expect(await synthesize(t.host, OPENAI_PIECE)).toMatchObject({ ok: true, path: cachePath(OPENAI_PIECE, 'm4a'), mime: 'audio/mp4' })
    expect(await synthesize(t.host, OPENAI_PIECE)).toMatchObject({ isCached: true, path: cachePath(OPENAI_PIECE, 'm4a') })
  })

  test('the default voice is coral', async () => {
    const t = fakeHost()
    await synthesize(t.host, { ...OPENAI_PIECE, voice: '' })
    expect(JSON.parse(t.curls[0]?.body ?? '').voice).toBe('coral')
  })

  test('401: API Key 不对或已过期; the body is read, the partial file removed, nothing cached', async () => {
    const t = fakeHost({ curl: () => ({ status: 401, body: '{"error":{"code":"invalid_api_key"}}' }) })
    expect(await synthesize(t.host, OPENAI_PIECE)).toEqual({ ok: false, kind: 'auth', reason: 'API Key 不对或已过期' })
    expect(t.files.size).toBe(0)
    expect(t.argvs.some(argv => argv[0] === 'rm' && (argv[2] ?? '').endsWith('.part'))).toBe(true)
    expect(t.debug.join('\n')).toContain('HTTP 401')
  })

  test('换了域名: the Key is held back, nothing is sent', async () => {
    const t = fakeHost({ store: { 'flag/keyStale': true } })
    expect(await synthesize(t.host, OPENAI_PIECE)).toEqual({
      ok: false,
      kind: 'auth',
      reason: '请求地址换了域名，请到“服务”页重新输入 API Key',
    })
    expect(t.curls).toHaveLength(0)
  })

  test('no 朗读模型: 服务还没有配置完成, nothing sent', async () => {
    const t = fakeHost()
    expect(await synthesize(t.host, { ...OPENAI_PIECE, model: '' })).toMatchObject({ ok: false, reason: '服务还没有配置完成，请到“服务”页填写' })
    expect(t.curls).toHaveLength(0)
  })

  test('still running at 30 s: the engine rejects, 30 秒内没有结果', async () => {
    const t = fakeHost({ curl: () => new Error('HooksError: work-with-english: $.process.run(curl) aborted: still running after 30000ms') })
    expect(await synthesize(t.host, OPENAI_PIECE)).toEqual({ ok: false, kind: 'timeout', reason: '30 秒内没有结果' })
    expect(t.files.size).toBe(0)
  })

  test('no connection: 网络连接失败', async () => {
    const t = fakeHost({ curl: () => ({ exit: 7 }) })
    expect(await synthesize(t.host, OPENAI_PIECE)).toEqual({ ok: false, kind: 'network', reason: '网络连接失败' })
  })
})

describe('synthesize: ElevenLabs', () => {
  const ELEVEN_PIECE: SpeechRequest = { service: 'elevenlabs', text: 'Hello there.', voice: 'JBFqnCBsd6RMkjVDRZzb', model: 'eleven_multilingual_v2' }

  test('POST /v1/text-to-speech/<voice_id> as mp3, the Key in xi-api-key on stdin', async () => {
    const t = fakeHost()
    expect(await synthesize(t.host, ELEVEN_PIECE)).toMatchObject({ ok: true, path: cachePath(ELEVEN_PIECE, 'mp3') })
    const [curl] = t.curls
    expect(curl?.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_44100_128')
    expect(curl?.headers).toEqual([`xi-api-key: ${ELEVEN_KEY}`, 'Content-Type: application/json'])
    expect(JSON.parse(curl?.body ?? '')).toEqual({ text: 'Hello there.', model_id: 'eleven_multilingual_v2' })
    expect(t.argvs.flat().join(' ')).not.toContain(ELEVEN_KEY)
  })

  test('no voice chosen: the account’s first voice, asked once', async () => {
    const t = fakeHost({
      fetch: () => ({ status: 200, text: JSON.stringify({ voices: [{ voice_id: 'first-id', name: 'George' }, { voice_id: 'second-id', name: 'Sarah' }] }) }),
    })
    await synthesize(t.host, { ...ELEVEN_PIECE, voice: '' })
    await synthesize(t.host, { ...ELEVEN_PIECE, voice: '', text: 'Another one.' })
    expect(t.fetches).toEqual(['https://api.elevenlabs.io/v2/voices?page_size=100&include_total_count=false'])
    expect(t.curls.map(c => c.url.split('?')[0])).toEqual([
      'https://api.elevenlabs.io/v1/text-to-speech/first-id',
      'https://api.elevenlabs.io/v1/text-to-speech/first-id',
    ])
  })

  test('out of credit answers 401 quota_exceeded: 请求太多或额度用完', async () => {
    const t = fakeHost({ curl: () => ({ status: 401, body: '{"detail":{"status":"quota_exceeded","message":"…"}}' }) })
    expect(await synthesize(t.host, ELEVEN_PIECE)).toEqual({ ok: false, kind: 'quota', reason: '请求太多或额度用完' })
  })
})

const settle = async (t: { speaking: () => WweSpeaking }) => {
  await flush()
  return t.speaking()
}

describe('朗读 with an online voice', () => {
  test('the button reads 停止 while it plays (via online); the clip is played from the file; then back', async () => {
    const t = fakeHost()
    await createSpeaker(t.host).speak('para-1', 'I found the cause.')
    expect(t.speakingLog).toEqual([{ key: 'para-1', via: 'online' }, null])
    expect(t.plays).toHaveLength(1)
    expect(t.plays[0]?.base64).toBe(btoa('ID3 audio'))
    expect(t.plays[0]?.mime).toBe('audio/mpeg')
    expect(t.spoken).toEqual([])
  })

  test('a press on the same button stops it, and the state goes back at once', async () => {
    const t = fakeHost({ play: 'hold' })
    const speaker = createSpeaker(t.host)
    const reading = speaker.speak('para-1', 'I found the cause.')
    expect(await settle(t)).toEqual({ key: 'para-1', via: 'online' })
    await speaker.speak('para-1', 'I found the cause.')
    expect(t.plays[0]?.signal.aborted).toBe(true)
    expect(t.speaking()).toBeNull()
    await reading
    expect(t.speakingLog).toEqual([{ key: 'para-1', via: 'online' }, null])
  })

  test('a press on another 朗读 stops what reads and reads the new text', async () => {
    const t = fakeHost({ play: 'hold' })
    const speaker = createSpeaker(t.host)
    const first = speaker.speak('para-1', 'First paragraph.')
    await settle(t)
    const second = speaker.speak('para-2', 'Second paragraph.')
    expect(await settle(t)).toEqual({ key: 'para-2', via: 'online' })
    expect(t.plays[0]?.signal.aborted).toBe(true)
    expect(t.plays).toHaveLength(2)
    await first
    // The first reading ending does not clear the second's state
    expect(t.speaking()).toEqual({ key: 'para-2', via: 'online' })
    t.endPlay()
    await second
    expect(t.speaking()).toBeNull()
    expect(JSON.parse(t.curls[1]?.body ?? '').input).toBe('Second paragraph.')
  })

  test('stopped while the first of several pieces plays: the rest are never asked for', async () => {
    const t = fakeHost({ play: 'hold' })
    const speaker = createSpeaker(t.host)
    const long = 'The config loader reads the port before the environment file is loaded. '.repeat(60)
    const reading = speaker.speak('msg-1', long)
    await settle(t)
    expect(t.curls).toHaveLength(1)
    await speaker.stop()
    await reading
    expect(t.curls).toHaveLength(1)
    expect(t.plays).toHaveLength(1)
    expect(t.speaking()).toBeNull()
  })

  test('stopped while its audio downloads: nothing plays, the download is kept for the next press', async () => {
    const gate = deferred<CurlAnswer>()
    const t = fakeHost({ curl: () => gate.promise })
    const speaker = createSpeaker(t.host)
    const reading = speaker.speak('para-1', 'I found the cause.')
    await settle(t)
    await speaker.speak('para-1', 'I found the cause.')
    gate.resolve(mp3())
    await reading
    expect(t.plays).toHaveLength(0)
    await speaker.speak('para-1', 'I found the cause.')
    expect(t.curls).toHaveLength(1)
    expect(t.plays).toHaveLength(1)
  })

  test('a failure: a toast says why, the button goes back, and the system voice does not take over', async () => {
    const t = fakeHost({ curl: () => ({ status: 401, body: '{"error":{"code":"invalid_api_key"}}' }) })
    await createSpeaker(t.host).speak('para-1', 'I found the cause.')
    expect(t.toasts).toEqual(['朗读失败：API Key 不对或已过期'])
    expect(t.speaking()).toBeNull()
    expect(t.spoken).toEqual([])
    expect(t.plays).toEqual([])
  })

  test('a file that does not play: 音频无法播放, and it leaves the cache', async () => {
    const t = fakeHost({ play: new Error('HooksError: afplay exited 1') })
    await createSpeaker(t.host).speak('para-1', 'I found the cause.')
    expect(t.toasts).toEqual(['朗读失败：音频无法播放'])
    expect(t.files.size).toBe(0)
    expect(t.speaking()).toBeNull()
  })

  test('试听 reads the sample with the current service; pressed again, it stops', async () => {
    const t = fakeHost({ play: 'hold' })
    const speaker = createSpeaker(t.host)
    const trying = speaker.test('try')
    expect(await settle(t)).toEqual({ key: 'try', via: 'online' })
    expect(JSON.parse(t.curls[0]?.body ?? '').input).toBe(TRY_TEXT)
    await speaker.test('try')
    await trying
    expect(t.speaking()).toBeNull()
  })

  test('nothing left to read once code is taken out: no request, no state', async () => {
    const t = fakeHost()
    await createSpeaker(t.host).speak('para-1', '```\nnpm test\n```')
    expect(t.curls).toEqual([])
    expect(t.speakingLog).toEqual([])
  })
})

describe('朗读 with the system voice', () => {
  test('reads with $.audio.speak; meanwhile other presses and stop() do nothing', async () => {
    const t = fakeHost({ store: { 'settings/speechService': 'system', 'settings/voiceSystem': 'Samantha' }, speak: 'hold' })
    const speaker = createSpeaker(t.host)
    const reading = speaker.speak('para-1', 'First.')
    expect(await settle(t)).toEqual({ key: 'para-1', via: 'system' })
    await speaker.speak('para-2', 'Second.')
    await speaker.speak('para-1', 'First.')
    await speaker.stop()
    expect(t.speaking()).toEqual({ key: 'para-1', via: 'system' })
    t.endSpeak()
    await reading
    expect(t.spoken).toEqual(['Samantha: First.'])
    expect(t.speaking()).toBeNull()
    expect(t.curls).toEqual([])
  })

  test('the system default voice is left to the system', async () => {
    const t = fakeHost({ store: { 'settings/speechService': 'system' } })
    await createSpeaker(t.host).speak('band', 'Hello.')
    expect(t.spoken).toEqual(['Hello.'])
    expect(t.speakingLog).toEqual([{ key: 'band', via: 'system' }, null])
  })
})
