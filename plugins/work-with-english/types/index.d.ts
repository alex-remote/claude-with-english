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
  /** 快捷键和按钮: 替换为译文 (替换为纠错) and 清空输入框 on the band */
  bandButtons: boolean
  /** F7: the service that translates, corrects and analyses */
  translateService: 'claude' | 'openai'
  /** F6, F9 */
  readingMode: 'paragraph' | 'select'
  /** F6: auto-translate replies in paragraph mode */
  autoReply: 'all' | 'last' | 'off'
  /** F6: N of "每轮最后 N 条" (1 to 99) */
  autoReplyCount: number
  /** F6: with 全部, a reply translated once it is written, or all of them at the turn's end */
  autoReplyWhen: 'written' | 'turnEnd'
  /** F6: auto-translate plans and questions */
  autoPlanAsk: boolean
  /** F6: a question dialog of several questions on the desktop: a tab each, one translation at a time, or all of them */
  askLayout: 'one' | 'all'
  /** F6: each paragraph of a reply or a plan asked with the paragraph before it, for consistent terms */
  replyContext: boolean
  /** F7: at most this many translation requests out at once (1 to 8) */
  translateConcurrency: number
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
  /** A confirmation in progress, by what it confirms: 删除配置 of a service, or 清除 of 本机缓存 */
  confirm: 'delete-openai' | 'delete-elevenlabs' | 'clear-cache' | null
  /** Bumped to redraw a select with a new key after a refused choice, so it shows the saved value again (P24) */
  rev: number
  /** F5, read each time the settings open */
  replyLanguage: WweReplyLanguage | null
  /** F7: the models the OpenAI-compatible 请求地址 listed last, as `$.store` keeps them (catalog/openai); null before any */
  openaiList: { ids: string[]; from: string } | null
  /** F8: ElevenLabs' models that can read aloud and the account's voices (catalog/eleven); null before any */
  elevenList: { models: { id: string; name: string }[]; voices: { id: string; name: string }[] } | null
  /** F7 获取模型列表: under way, or failed with the line to show (获取模型列表失败：<原因>) */
  openaiFetch: { status: 'idle' | 'loading' | 'failed'; error: string | null }
  /** F8: the same for ElevenLabs' models and voices */
  elevenFetch: { status: 'idle' | 'loading' | 'failed'; error: string | null }
  /** F7: the address moved to another domain and the API Key was not entered again since */
  keyStale: boolean
  /** F8: the system's English voices (`say -v ?`), read when the 阅读 page first opens; null until then */
  systemVoices: string[] | null
  /** F8: 试听 reading now, with the system voice (试听中…) or online (停止); null when not */
  trying: 'system' | 'online' | null
  /** F6, F8: 本机缓存, the KB the replies' translations and the online audio take */
  cache: { status: 'loading' | 'done' | 'failed'; kb: number }
  /** The field that takes the focus ring once the pane takes the keyboard: 朗读模型 after 去配置朗读服务 */
  autoFocus: 'openai-tts-model' | null
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

/** F11: one sentence of an analysis */
export type WweSentence = { en: string; zh: string; parts: { text: string; role: string }[]; points: string[] }

/** F11: an analysis, as the model gave it */
export type WweTextResult = { sentences: WweSentence[]; hard: string[] }

/** F9, F10: a word as the dictionary gives it; `cur` is the sense the sentence uses */
export type WweLookup = { lemma: string; ipa: string; senses: string[]; cur: number | null; formNote: string | null }

/** F10: the word card */
export type WweWordResult = WweLookup & {
  inSentence: string | null
  sentenceZh: string | null
  usages: { en: string; zh: string }[]
  examples: { en: string; zh: string }[]
}

/** F10, F11: what the pane's analysis view shows, while the pane shows one */
export type WweAnalysis = {
  kind: 'text' | 'word'
  status: 'pending' | 'done' | 'failed'
  /** F11: the paragraph or the sentence analysed; F10: the word as selected */
  subject: string
  /** F10: the sentence the word was read in, when known */
  sentence: string | null
  /** F11: 这段的难词, or 这句的难词 for a sentence selected in 划选模式 */
  isSentence: boolean
  text: WweTextResult | null
  word: WweWordResult | null
  /** 解析失败：<原因> */
  error: string | null
  /** F10 opened from F11's hard words: ← 返回语法分析 goes back to this, without asking again */
  back: { subject: string; isSentence: boolean; text: WweTextResult } | null
}

/** F9: the selection line at the bottom of the band */
export type WwePick = {
  /** A word or a phrase, a passage, or a passage too long to work on */
  kind: 'word' | 'text' | 'long'
  /** What was selected (a word without the punctuation around it) */
  text: string
  /** 已选中 (the fullscreen terminal) or 已复制 (the desktop app, after ⌘C) */
  via: 'select' | 'copy'
  /** The sentence it was read in, for 本句; null when not known */
  sentence: string | null
  /** A word's senses */
  lookup: { status: 'pending' | 'done' | 'failed'; value: WweLookup | null; error: string | null } | null
  /** A passage's translation, shown under it after 翻译 */
  tr: { status: 'none' | 'pending' | 'done' | 'failed'; zh: string | null; error: string | null; shown: boolean }
}

/** What is being read aloud now (F8), so other speak buttons dim or stop it. */
export type WweSpeaking = null | { key: string; via: 'system' | 'online' }

/** F12: what an entry's 加入单词本 button says, by the hash of what it adds (features/wordbook/controller.ts › savedKeyOf) */
export type WweSaved = {
  /** unknown: not looked up yet; sentenceMissing: the word is kept, this sentence not (补上这一句) */
  status: 'unknown' | 'none' | 'added' | 'sentenceMissing' | 'adding'
}

/** F12: one word on the 单词本 page */
export type WweBookWord = {
  lemma: string
  ipa: string
  isSynced: boolean
  /** Oldest first, each with its own 本句释义 */
  sentences: { en: string; zh: string; form: string; sense: string }[]
}

/** F12: one sentence on the 单词本 page */
export type WweBookSentence = {
  en: string
  zh: string
  zhIsTranslation: boolean
  source: 'mine' | 'reply'
  isSynced: boolean
}

/** F12: the 单词本 page's lists, newest first, and where syncing to Anki stands */
export type WweBook = {
  status: 'loading' | 'done' | 'failed'
  words: WweBookWord[]
  sentences: WweBookSentence[]
  anki: {
    /** 'unknown' until this page's check has answered */
    link: 'unknown' | 'ok' | 'offline' | 'broken'
    /** With link 'broken': what broke and how to get it back */
    reason: string | null
    hasEverConnected: boolean
    pendingWords: number
    pendingSentences: number
  }
}

/** F13: one day's numbers, every session added in (core/stats/aggregate › StatsRow) */
export type WweStatsDay = {
  used: number
  retyped: number
  direct: number
  words: number
  newWords: number
  newSents: number
}

/** F14: what a share-card export is doing, by its button */
export type WweShareAction = 'post' | 'image' | 'text'

/** F14: the share card, while the pane shows it (features/stats/controller.ts › openShare) */
export type WweShare = {
  /** The seven days up to the day it was opened (core/share/card › CardStats) */
  card: {
    from: string
    to: string
    sent: number
    ownPct: number
    delta: number | null
    words: number
    newWords: number
    streak: number
    /** A level a day for the last 12 weeks, -1 after today */
    heat: readonly (-1 | 0 | 1 | 2 | 3 | 4)[]
  }
  /** 卡片语言 as the card is drawn now */
  lang: 'en' | 'zh'
  /** The card as an SVG document with the product icon, for the desktop's preview; null while it is made */
  svg: string | null
  /** The export under way: the three buttons can't be pressed meanwhile */
  busy: WweShareAction | null
  /** The last export that failed and why, under its button until another starts */
  error: { action: WweShareAction; reason: string } | null
}

/** F13, F14: the 统计 page's figures and the share card, while the pane shows them (features/stats, features/share) */
export type WweStats = {
  /** loading: the first read has not answered yet; failed: it could not read the files */
  status: 'loading' | 'done' | 'failed'
  /** The local date the days were read on, YYYY-MM-DD; '' before the first read */
  today: string
  /** Every day with numbers, by date; the page's ranges and charts are counted from these */
  days: Readonly<Record<string, WweStatsDay>>
  /** With status failed: 读取统计失败：<原因> */
  error: string | null
  share: WweShare | null
}

/**
 * F6: the paragraphs asked for translation in this session, so a module
 * loaded again (an update, a reload) asks again for one its predecessor left
 * at 翻译中…; $.state outlives the module, its requests do not
 */
export type WweAsking = { blocks: { kind: string; text: string; hash: string }[] }

/** F6: which question's translation a several-question dialog shows, by the dialog's tool_use_id */
export type WweAskTab = { index: number }

/** One reply button of the summary card: what it reads, and what a click sends as the person's message */
export type WweCardButton = { label: string; message: string }

/** The desktop app's summary card, as Claude's call set it; recap '' for none (features/env/nextStep) */
export type WweCard = { recap: string; ask: string | null; buttons: WweCardButton[] }

/** Whether a message is one a summary card's button sends, by the hash of its text */
export type WweCardSent = { isCard: boolean }

/** F16: one step of a task list Claude keeps in the desktop app, as it last set it */
export type WweTaskStep = { text: string; status: 'pending' | 'in_progress' | 'completed' }

/** F16: one task list: when Claude made it, in which turn, and its steps in Claude's order */
export type WweTaskList = { at: number; turn: number; steps: WweTaskStep[] }

/** F16: the 任务 pane's lists, the newest first */
export type WweTasks = {
  lists: WweTaskList[]
  /** The main conversation's turns ended so far: a list made again in the same turn replaces that turn's */
  turn: number
  /** The pane opened by itself once this session; closed after that, it waits for /wwe 任务 */
  isShown: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'work-with-english': {
      settings: WweSettingsView
      env: WweEnv
      band: WweBand
      speaking: WweSpeaking
      pane: WwePane
      para: StateFamily<WwePara>
      analysis: WweAnalysis | null
      pick: WwePick | null
      saved: StateFamily<WweSaved>
      book: WweBook
      stats: WweStats | null
      tasks: WweTasks
      card: StateFamily<WweCard>
      sent: StateFamily<WweCardSent>
      asking: WweAsking
      askTab: StateFamily<WweAskTab>
    }
  }
}
