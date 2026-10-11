// work-with-english's values in `$.state`, one entry per key the module
// reads or writes, and the types of those values. The entries grow with the
// milestones in docs/dev-plan.md; the module imports the types from here.

/** Every setting, as stored under `settings/<key>` in `$.store` (core/settings/schema.ts). */
export type WweSettings = {
  /** F1: how long typing pauses before the band translates, in ms (100 to 5000) */
  delayMs: number
  /** F1: the unit the delay field shows */
  delayUnit: 'ms' | 's'
  /** F4 */
  strict: boolean
  /** F7: the service that translates, corrects and analyses */
  translateService: 'claude' | 'openai'
  /** F6, F9 */
  readingMode: 'paragraph' | 'select'
  /** F6: auto-translate replies in paragraph mode */
  autoReply: 'all' | 'last' | 'off'
  /** F6: N of "每轮最后 N 条" (1 to 99) */
  autoReplyCount: number
  /** F6: auto-translate plans and questions */
  autoPlanAsk: boolean
  /** F8 */
  speechService: 'system' | 'openai' | 'elevenlabs'
  /** F8: the voice per speech service; '' is the default (system default, the first ElevenLabs voice) */
  voiceSystem: string
  voiceOpenai: string
  voiceEleven: string
  /** F12 */
  ankiSync: boolean
  ankiDeck: string
  /** F7: Claude Code account model, an alias or a full id */
  claudeModel: string
  /** F7, F8: OpenAI-compatible endpoint */
  openaiBaseUrl: string
  openaiKey: string
  openaiModel: string
  openaiManual: boolean
  openaiTtsModel: string
  /** F8: ElevenLabs */
  elevenKey: string
  elevenModel: string
  /** F13 */
  weeklyReminder: boolean
  /** F14 */
  cardLanguage: 'target' | 'source'
}

/** The settings as drawings see them: API keys reduced to whether one is saved and its mask. */
export type WweSettingsView = Omit<WweSettings, 'openaiKey' | 'elevenKey'> & {
  openaiKeyMask: string | null
  elevenKeyMask: string | null
}

/** Where this session runs (运行环境). */
export type WweEnv = {
  surface: 'terminal' | 'desktop' | null
  /** The terminal's fullscreen layout; null until a drawing measured it */
  isFullscreen: boolean | null
  /** macOS on this machine, not a remote session; null until checked */
  isMacLocal: boolean | null
}

/** One span of a band row, marked when a correction changed or added it (F15). */
export type WweMark = { start: number; end: number }

/** The band above the prompt: F1's translation or F15's correction, and F4's hint. */
export type WweBand = {
  /** What the first two rows hold */
  mode: 'none' | 'translate' | 'correct'
  /** First row: the translation, or the corrected sentence; '' while a message's first request runs */
  target: string
  /** Second row: the text the first row answers (F1), or the user's sentence in the source language (F15) */
  source: string
  /** F15: the spans of `target` a correction changed or added */
  marks: readonly WweMark[]
  /** F15: nothing to fix (the ✓ form) */
  isOk: boolean
  /** A request for newer text is in flight: both rows dim */
  isPending: boolean
  /** The last request failed: the first row says why */
  error: string | null
  /** The once-a-day tip after the buttons */
  showTip: boolean
  /**
   * F4: the hint line after Enter was held back. `isCleared`: the Prompt came
   * back empty (the text went to the history), so the hint says how to get it
   * back; Claude Code 2.1.295's terminal leaves the text in the Prompt.
   */
  blocked: null | { hasImage: boolean; serviceDown: boolean; isCleared: boolean; isLetThrough: boolean }
}

/** The settings pages, in the order of 设置 */
export type WweTab = 'translate' | 'reading' | 'wordbook' | 'services' | 'shortcuts' | 'stats'

/** F5: Claude Code's `language` as it stands, and the source that set it */
export type WweReplyLanguage = {
  /** The merged value; null when nothing sets it */
  value: string | null
  /** The source with the highest precedence that sets it */
  source: 'user' | 'project' | 'local' | 'flag' | 'policy' | null
}

/**
 * The one pane: the settings, and from M4 the analyses, which take its place
 * (阅读辅助 › Pane 只有一个). Drafts of text fields live in the module, so a
 * redraw never writes over what is being typed (P24).
 */
export type WwePane = {
  view: 'settings' | 'word' | 'text' | 'share'
  tab: WweTab
  /** The 服务 page's submenu */
  svcTab: 'claude' | 'openai' | 'elevenlabs'
  /** The 统计 page's range */
  statsRange: 'week' | 'lastWeek' | 'all'
  /** Under a field whose value was refused: how to fix it, by setting key */
  errors: Readonly<Record<string, string>>
  /** A confirmation in progress (删除配置, 清除), by what it confirms */
  confirm: string | null
  /** Bumped to redraw a select with a new key after a refused choice, so it shows the saved value again (P24) */
  rev: number
  /** F5, read each time the settings open */
  replyLanguage: WweReplyLanguage | null
}

/** F6: one paragraph of Claude's replies, by the hash of its text */
export type WwePara = {
  status: 'none' | 'pending' | 'done' | 'failed'
  /** The translation, once it came */
  zh: string | null
  /** 译文暂不可用：<原因> */
  error: string | null
  /** Shown under the paragraph; 收起译文 hides it without forgetting it */
  shown: boolean
}

/** What is being read aloud now (F8), so other speak buttons dim or stop it. */
export type WweSpeaking = null | { key: string; via: 'system' | 'online' }

declare module 'claude-code' {
  interface PluginState {
    'work-with-english': {
      settings: WweSettingsView
      env: WweEnv
      band: WweBand
      speaking: WweSpeaking
      pane: WwePane
      para: StateFamily<WwePara>
    }
  }
}
