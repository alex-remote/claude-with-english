import { describe, expect, test } from 'claude-code/testing'

import { REQUEST_TIMEOUT_MS, createSlot, raceTimeout } from '../../hooks/core/async/slot'
import type { After } from '../../hooks/core/async/slot'
import { cyrb53, hash, hashParts } from '../../hooks/core/hash'
import { parseModelJson, unfence } from '../../hooks/core/json'
import { addDays, daysBetween, isLocalDate, localDate, mondayOf, parseUtcOffset } from '../../hooks/core/time'

describe('hash', () => {
  test('cyrb53 matches the reference values', () => {
    const value = (text: string, seed?: number) => {
      const { high, low } = cyrb53(text, seed)
      return high * 2 ** 32 + low
    }
    expect(value('a')).toBe(7929297801672961)
    expect(value('b')).toBe(8684336938537663)
    expect(value('revenge')).toBe(4051478007546757)
    expect(value('revenue')).toBe(8309097637345594)
    expect(value('revenue', 1)).toBe(8697026808958300)
  })

  test('a hash is 14 hex digits, the 32-bit lane first', () => {
    expect(hash('a')).toBe('82c979011c2ba7')
    expect(hash('revenge')).toBe('3b7483850e64cc')
    for (const text of ['', 'a', '帮我看看这个报错是怎么回事', 'x'.repeat(5000)]) {
      expect(hash(text)).toMatch(/^[0-9a-f]{14}$/)
    }
  })

  test('the same text always gives the same hash, and a seed changes it', () => {
    expect(hash('帮我看看这个报错是怎么回事')).toBe(hash('帮我看看这个报错是怎么回事'))
    expect(hash('revenge')).not.toBe(hash('revenue'))
    expect(hash('revenue', 1)).not.toBe(hash('revenue'))
  })

  test('hashParts keeps the parts apart', () => {
    expect(hashParts(['a', 'bc'])).not.toBe(hashParts(['ab', 'c']))
    expect(hashParts(['openai', 'gpt-4o-mini-tts', 'coral', 'I found the cause.'])).toBe(
      hashParts(['openai', 'gpt-4o-mini-tts', 'coral', 'I found the cause.']),
    )
    expect(hashParts(['system', '', '', 'cause'])).toMatch(/^[0-9a-f]{14}$/)
  })
})

describe('time', () => {
  test('parseUtcOffset reads `date +%z`', () => {
    expect(parseUtcOffset('+0800')).toBe(480)
    expect(parseUtcOffset('+0800\n')).toBe(480)
    expect(parseUtcOffset('-0530')).toBe(-330)
    expect(parseUtcOffset('+0000')).toBe(0)
    expect(parseUtcOffset('+0545')).toBe(345)
    expect(parseUtcOffset('+08:00')).toBe(480)
    expect(parseUtcOffset('')).toBeNull()
    expect(parseUtcOffset('CST')).toBeNull()
    expect(parseUtcOffset('0800')).toBeNull()
    expect(parseUtcOffset('+2500')).toBeNull()
    expect(parseUtcOffset('+0860')).toBeNull()
  })

  test('localDate is the date on this machine', () => {
    const at = Date.UTC(2026, 9, 9, 16, 30)
    expect(localDate(at, 480)).toBe('2026-10-10')
    expect(localDate(at, 0)).toBe('2026-10-09')
    expect(localDate(at, -300)).toBe('2026-10-09')
    // Local midnight in UTC+8 is 16:00 UTC the day before
    expect(localDate(Date.UTC(2026, 9, 8, 16, 0), 480)).toBe('2026-10-09')
    expect(localDate(Date.UTC(2026, 9, 8, 15, 59, 59, 999), 480)).toBe('2026-10-08')
    expect(localDate(Date.UTC(2026, 11, 31, 20, 0), 480)).toBe('2027-01-01')
  })

  test('isLocalDate takes real dates written YYYY-MM-DD alone', () => {
    expect(isLocalDate('2026-10-09')).toBe(true)
    expect(isLocalDate('2028-02-29')).toBe(true)
    expect(isLocalDate('2026-02-29')).toBe(false)
    expect(isLocalDate('2026-02-30')).toBe(false)
    expect(isLocalDate('2026-13-01')).toBe(false)
    expect(isLocalDate('2026-1-5')).toBe(false)
    expect(isLocalDate('day.json')).toBe(false)
  })

  test('mondayOf: a week runs Monday to Sunday (F13: 本周写“10月5日至今天”)', () => {
    expect(mondayOf('2026-10-05')).toBe('2026-10-05')
    expect(mondayOf('2026-10-09')).toBe('2026-10-05')
    expect(mondayOf('2026-10-11')).toBe('2026-10-05')
    expect(mondayOf('2026-10-12')).toBe('2026-10-12')
    expect(mondayOf('2027-01-01')).toBe('2026-12-28')
    expect(mondayOf('1969-12-31')).toBe('1969-12-29')
  })

  test('last week and its Sunday (F13: 上周的连续使用写“（截至上周日）”)', () => {
    const monday = mondayOf('2026-10-09')
    expect(addDays(monday, -7)).toBe('2026-09-28')
    expect(addDays(monday, -1)).toBe('2026-10-04')
  })

  test('F13: the 12 weekly bars run from “7月20日那周” to 本周', () => {
    const thisWeek = mondayOf('2026-10-09')
    expect(addDays(thisWeek, -7 * 11)).toBe('2026-07-20')
    expect(mondayOf('2026-07-20')).toBe('2026-07-20')
  })

  test('F13: a streak with nothing sent today counts up to yesterday', () => {
    expect(addDays(localDate(Date.UTC(2026, 9, 9, 2, 0), 480), -1)).toBe('2026-10-08')
  })

  test('addDays crosses months, years and leap days', () => {
    // F14: the 7 days up to Oct 6 start on Sep 30 (“Sep 30 – Oct 6, 2026”), up to Oct 7 on Oct 1
    expect(addDays('2026-10-06', -6)).toBe('2026-09-30')
    expect(addDays('2026-10-07', -6)).toBe('2026-10-01')
    // F14: 自己写的 is compared with the 7 days before those
    expect(addDays('2026-10-06', -13)).toBe('2026-09-23')
    expect(addDays('2026-10-06', -7)).toBe('2026-09-29')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-10-09', 0)).toBe('2026-10-09')
  })

  test('daysBetween counts from the first date to the second', () => {
    expect(daysBetween('2026-09-30', '2026-10-06')).toBe(6)
    expect(daysBetween('2026-10-06', '2026-09-30')).toBe(-6)
    expect(daysBetween('2026-10-09', '2026-10-09')).toBe(0)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    // F13 and F14: the last 12 weeks are 84 days
    expect(daysBetween(addDays('2026-10-09', -83), '2026-10-09')).toBe(83)
  })

  test('a date that is not one throws rather than computing garbage', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError)
    expect(() => daysBetween('today', '2026-10-09')).toThrow('not a date')
    expect(() => mondayOf('')).toThrow(RangeError)
  })
})

describe('json', () => {
  test('plain JSON parses', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseModelJson('  [1, 2]\n')).toEqual({ ok: true, value: [1, 2] })
  })

  test('a ```json fence and the blanks around it are dropped', () => {
    const correction = { corrected: 'I fixed the bug yesterday.', zh: '我昨天已经修好了这个 bug。', ok: false }
    expect(parseModelJson('```json\n' + JSON.stringify(correction) + '\n```')).toEqual({
      ok: true,
      value: correction,
    })
    expect(parseModelJson('\n  ```JSON\n{"a":1}\n```  \n')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseModelJson('```\n[1,2]\n```')).toEqual({ ok: true, value: [1, 2] })
    expect(parseModelJson('```json{"a":1}```')).toEqual({ ok: true, value: { a: 1 } })
  })

  test('prose before and after the fence is dropped', () => {
    expect(parseModelJson('Here is the result:\n```json\n{"a":1}\n```\nHope it helps.')).toEqual({
      ok: true,
      value: { a: 1 },
    })
  })

  test('backticks inside a value stay', () => {
    const text = '```json\n{"zh":"把 ```js 代码块``` 留着"}\n```'
    expect(parseModelJson(text)).toEqual({ ok: true, value: { zh: '把 ```js 代码块``` 留着' } })
  })

  test('a reply cut off or not JSON fails with the reason', () => {
    for (const text of ['```json\n{"corrected": "I fixed', 'not json', '', '```json\n```']) {
      const parsed = parseModelJson(text)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) {
        expect(parsed.error.length).toBeGreaterThan(0)
      }
    }
  })

  test('unfence leaves text without a fence trimmed', () => {
    expect(unfence('  {"a":1}  ')).toBe('{"a":1}')
    expect(unfence('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(unfence('use `code` here')).toBe('use `code` here')
  })
})

/** A promise to settle by hand */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

/** A `Host.clock.after` whose timer fires when the test says */
function fakeAfter() {
  const timers: { ms: number; fire: () => void; isCancelled: boolean }[] = []
  const after: After = (ms, fn) => {
    const timer = { ms, fire: fn, isCancelled: false }
    timers.push(timer)
    return { cancel: () => (timer.isCancelled = true) }
  }
  return { after, timers }
}

describe('slot', () => {
  test('the timeout is 30 seconds', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(30_000)
  })

  test('a newer request supersedes the one before it', () => {
    const slot = createSlot()
    const first = slot.begin()
    expect(first.gen).toBe(1)
    expect(first.isCurrent()).toBe(true)
    expect(first.signal.aborted).toBe(false)

    const second = slot.begin()
    expect(second.gen).toBe(2)
    expect(first.isCurrent()).toBe(false)
    expect(first.signal.aborted).toBe(true)
    expect(first.signal.reason).toBe('superseded')
    expect(second.isCurrent()).toBe(true)
    expect(second.signal.aborted).toBe(false)
  })

  test('cancel leaves nothing current until the next request', () => {
    const slot = createSlot()
    const first = slot.begin()
    slot.cancel()
    expect(first.isCurrent()).toBe(false)
    expect(first.signal.reason).toBe('cancelled')

    const next = slot.begin()
    expect(next.gen).toBeGreaterThan(first.gen)
    expect(next.isCurrent()).toBe(true)
    slot.cancel()
    slot.cancel()
    expect(next.isCurrent()).toBe(false)
  })

  test('a ticket aborted on its own stays current, so its failure shows', () => {
    const slot = createSlot()
    const ticket = slot.begin()
    ticket.abort()
    expect(ticket.signal.aborted).toBe(true)
    expect(ticket.signal.reason).toBe('timeout')
    expect(ticket.isCurrent()).toBe(true)
  })

  test('slots are independent', () => {
    const band = createSlot()
    const pick = createSlot()
    const a = band.begin()
    const b = pick.begin()
    band.begin()
    expect(a.isCurrent()).toBe(false)
    expect(b.isCurrent()).toBe(true)
  })

  test('raceTimeout: the value when it comes first, and the timer is stopped', async () => {
    const { after, timers } = fakeAfter()
    const reply = deferred<string>()
    const raced = raceTimeout(reply.promise, REQUEST_TIMEOUT_MS, after)
    reply.resolve('Can you take a look at this error?')
    expect(await raced).toEqual({ timedOut: false, value: 'Can you take a look at this error?' })
    expect(timers).toHaveLength(1)
    expect(timers[0]?.ms).toBe(30_000)
    expect(timers[0]?.isCancelled).toBe(true)
  })

  test('raceTimeout: timedOut when 30 seconds pass first, and a late value is dropped', async () => {
    const { after, timers } = fakeAfter()
    const reply = deferred<string>()
    const raced = raceTimeout(reply.promise, REQUEST_TIMEOUT_MS, after)
    timers[0]?.fire()
    expect(await raced).toEqual({ timedOut: true })
    reply.resolve('too late')
    await reply.promise
    expect(await raced).toEqual({ timedOut: true })
  })

  test('raceTimeout: a failure before the timeout rejects and stops the timer', async () => {
    const { after, timers } = fakeAfter()
    const reply = deferred<string>()
    const raced = raceTimeout(reply.promise, REQUEST_TIMEOUT_MS, after)
    reply.reject(new Error('429'))
    await expect(raced).rejects.toThrow('429')
    expect(timers[0]?.isCancelled).toBe(true)
  })

  test('raceTimeout: a failure after the timeout is dropped', async () => {
    const { after, timers } = fakeAfter()
    const reply = deferred<string>()
    const raced = raceTimeout(reply.promise, REQUEST_TIMEOUT_MS, after)
    timers[0]?.fire()
    reply.reject(new Error('500'))
    await reply.promise.catch(() => undefined)
    expect(await raced).toEqual({ timedOut: true })
  })
})
