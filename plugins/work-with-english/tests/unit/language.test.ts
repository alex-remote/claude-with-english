import { describe, expect, test } from 'claude-code/testing'
import type { SettingsSource } from 'claude-code'

import { INITIAL_PANE } from '../../hooks/core/state/defaults'
import { readReplyLanguage, replyLanguageRow, setTargetLanguage } from '../../hooks/features/settings/language'
import type { Host } from '../../hooks/host'
import type { WwePane } from '../../types'

// F5 回复语言: where Claude Code's `language` comes from, what the row under
// 回复语言 offers, and what 设为英语 writes.

type Sources = Partial<Record<SettingsSource, Record<string, unknown>>>

const PRECEDENCE: readonly SettingsSource[] = ['user', 'project', 'local', 'flag', 'policy']

/** A Host with Claude Code's settings by source, merged as the engine merges them; `merged` overrides it */
function fakeHost(sources: Sources, merged?: Record<string, unknown>) {
  const toasts: string[] = []
  const written: unknown[] = []
  let pane: WwePane = INITIAL_PANE
  const host = {
    settings: {
      read: async (args?: { source?: SettingsSource }) => {
        if (args?.source) {
          return sources[args.source] ?? {}
        }
        return merged ?? Object.assign({}, ...PRECEDENCE.map(source => sources[source] ?? {}))
      },
    },
    config: {
      set: async (args: { key: string; value: unknown }) => {
        written.push(args)
        sources.user = { ...sources.user, [args.key]: args.value }
        return { value: args.value }
      },
    },
    ui: {
      toast: (text: string) => {
        toasts.push(text)
      },
      debug: () => undefined,
    },
    state: {
      pane: {
        get: async () => pane,
        update: async (fn: (value: WwePane) => WwePane) => {
          pane = fn(pane)
          return pane
        },
      },
    },
  } as unknown as Host
  return { host, toasts, written, pane: () => pane }
}

describe('F5 回复语言', () => {
  test('未设置：显示“未设置”和“设为英语”', async () => {
    const { host } = fakeHost({})
    const language = await readReplyLanguage(host)
    expect(language).toEqual({ value: null, source: null })
    expect(replyLanguageRow(language)).toEqual({ kind: 'settable' })
  })

  test('用户设置是 English：与目标语言一致，不显示按钮', async () => {
    const { host } = fakeHost({ user: { language: 'English' } })
    const language = await readReplyLanguage(host)
    expect(language).toEqual({ value: 'English', source: 'user' })
    expect(replyLanguageRow(language)).toEqual({ kind: 'matches' })
  })

  test('写成 english、en：只有标准值算一致，显示“设为英语”', async () => {
    for (const spelling of ['english', 'en', 'Chinese']) {
      const { host } = fakeHost({ user: { language: spelling } })
      const language = await readReplyLanguage(host)
      expect(language).toEqual({ value: spelling, source: 'user' })
      expect(replyLanguageRow(language)).toEqual({ kind: 'settable' })
    }
  })

  test('项目设置指定：不显示按钮，写明在哪里指定', async () => {
    const { host } = fakeHost({ user: { language: 'English' }, project: { language: 'Chinese' } })
    const language = await readReplyLanguage(host)
    expect(language).toEqual({ value: 'Chinese', source: 'project' })
    expect(replyLanguageRow(language)).toEqual({ kind: 'fixed', source: 'project' })
  })

  test('本地设置、组织锁定：按来源写明', async () => {
    const local = fakeHost({ project: { language: 'English' }, local: { language: 'japanese' } })
    expect(replyLanguageRow(await readReplyLanguage(local.host))).toEqual({ kind: 'fixed', source: 'local' })
    const policy = fakeHost({ user: { language: 'English' }, policy: { language: 'Chinese' } })
    expect(await readReplyLanguage(policy.host)).toEqual({ value: 'Chinese', source: 'policy' })
    expect(replyLanguageRow(await readReplyLanguage(policy.host))).toEqual({ kind: 'fixed', source: 'policy' })
  })

  test('组织锁定成 English：一致，不显示按钮', async () => {
    const { host } = fakeHost({ policy: { language: 'English' } })
    expect(replyLanguageRow(await readReplyLanguage(host))).toEqual({ kind: 'matches' })
  })

  test('合并值和哪一层都对不上：算启动参数指定', async () => {
    const { host } = fakeHost({}, { language: 'Chinese' })
    expect(await readReplyLanguage(host)).toEqual({ value: 'Chinese', source: 'flag' })
  })

  test('设为英语：写入标准值，弹 Toast，再读一遍显示一致', async () => {
    const fake = fakeHost({ user: { language: 'english' } })
    await setTargetLanguage(fake.host)
    expect(fake.written).toEqual([{ key: 'language', value: 'English' }])
    expect(fake.toasts).toEqual(['已保存：回复语言 英语'])
    expect(fake.pane().replyLanguage).toEqual({ value: 'English', source: 'user' })
  })

  test('写入被拒绝：不弹 Toast，照实显示', async () => {
    const fake = fakeHost({ user: { language: 'english' } })
    ;(fake.host.config as { set: unknown }).set = async () => ({ deny: 'a hook refused it' })
    await setTargetLanguage(fake.host)
    expect(fake.toasts).toEqual([])
    expect(fake.pane().replyLanguage).toEqual({ value: 'english', source: 'user' })
  })
})
