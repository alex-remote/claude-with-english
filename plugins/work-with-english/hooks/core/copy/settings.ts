import type { WweSettings } from '../../../types'
import type { SettingKey } from '../settings/schema'
import { savedToast } from './common'
import { SOURCE_LANG, TARGET_LANG, uiNameOf } from './lang'

// The words of the settings pane: its tabs, each setting's name and
// description, the options' labels and the error lines. Taken from the 设置
// table and each feature's 设置项 in docs/feature-map.md, then the prototype.
// A language is named in the sentence's own language, from the language table.

const SOURCE_NAME = uiNameOf(SOURCE_LANG)
const TARGET_NAME = uiNameOf(TARGET_LANG)

export const PANE_TITLE = 'work-with-english 设置'

export type SettingsTab = 'translate' | 'reading' | 'wordbook' | 'services' | 'shortcuts' | 'stats'

/** The tabs in the order the pane shows them */
export const SETTINGS_TABS: readonly SettingsTab[] = [
  'translate',
  'reading',
  'wordbook',
  'services',
  'shortcuts',
  'stats',
]

export const TAB_LABELS: Record<SettingsTab, string> = {
  translate: '翻译',
  reading: '阅读',
  wordbook: '单词本',
  services: '服务',
  shortcuts: '快捷键',
  stats: '统计',
}

/** What a toast calls each setting ("已保存：<设置项> <新值>") */
export const ITEM_NAMES: Record<SettingKey, string> = {
  delayMs: '翻译延迟',
  delayUnit: '翻译延迟',
  strict: '严格模式',
  translateService: '翻译服务',
  readingMode: '阅读方式',
  autoReply: '自动翻译回复',
  autoReplyCount: '自动翻译回复',
  autoPlanAsk: '自动翻译计划和提问',
  speechService: '朗读服务',
  voiceSystem: '声音',
  voiceOpenai: '声音',
  voiceEleven: '声音',
  ankiSync: '同步到 Anki',
  ankiDeck: '牌组',
  claudeModel: '模型',
  openaiBaseUrl: '请求地址',
  openaiKey: 'API Key',
  openaiModel: '翻译模型',
  openaiManual: '手动填写',
  openaiTtsModel: '朗读模型',
  elevenKey: 'API Key',
  elevenModel: '朗读模型',
  weeklyReminder: '每周提醒',
  cardLanguage: '卡片语言',
}

/** The pane's rows that show something but save nothing of the plugin's own */
export const LANGUAGES_NAME = '源语言和目标语言'
export const LANGUAGES_VALUE = `${SOURCE_NAME} → ${TARGET_NAME}`
export const REPLY_LANGUAGE_NAME = '回复语言'
/** F5: Claude Code's Language setting has no value */
export const REPLY_LANGUAGE_UNSET = '未设置'
export const REPLY_LANGUAGE_SET = `设为${TARGET_NAME}`
export const REPLY_LANGUAGE_MATCHES = '与目标语言一致'
/** F5: 设为英语 saves at once, so it raises a save's toast too: 已保存：回复语言 英语 */
export const replyLanguageSaved = () => savedToast(REPLY_LANGUAGE_NAME, TARGET_NAME)
export const CACHE_NAME = '本机缓存'
export const SHORTCUTS_NAME = 'Control+A 的用法'

/** The description under each setting, as the feature map words it */
export const DESCRIPTIONS = {
  languages:
    '箭头左边是源语言，也就是你的母语，在 Prompt 里输入的语言，也是界面和译文用的语言；右边是目标语言，想练习的语言，横条里显示的语言。',
  delay: '停止输入多久后开始翻译。范围 100 ms 到 5 s，改过后可以恢复默认。',
  strict: `防止 AI 对话上下文混入${SOURCE_NAME}，始终使用${TARGET_NAME}。关闭后可直接发送。`,
  replyLanguage:
    'Claude 按这个设置回复。这是 Claude Code 的全局设置，对所有会话立即生效，关闭本插件后仍会保留；语音输入和会话标题的语言也会随之改变。',
  paragraphMode: '每轮做完后自动翻译回复，鼠标移到段落上出现“翻译”“朗读”“解析”。',
  selectMode: '回复不自动翻译，段落上同样有这三个按钮；另外选中任意一段英文，横条上也出现“翻译”“朗读”“解析”。',
  readingMode:
    '两种方式下都可以双击单词查词。在桌面端，选中文字后需按 ⌘C 复制，横条上才会显示查词和翻译。',
  autoReply:
    'Claude 每轮做完后，自动翻译这一轮的回复，默认全部。只想看结论时，可以改成每轮最后几条；其他段落点“翻译”再翻。',
  autoPlanAsk: '自动翻译计划模式里的计划，以及 Claude 提问时的问题和选项。两种阅读方式下都起作用。',
  speechOnline: '在线语音更自然，读到一半可以停止。按字数收费，读过的内容会缓存，再读不重复收费。声音由 AI 生成。',
  cache:
    '回复的译文和朗读音频存在本机，一直保留。清除后，旧会话的段落要重新点“翻译”，在线语音要重新收费；单词本、统计和设置不受影响。',
  ankiSync: '需要电脑上开着 Anki，并装好 AnkiConnect 插件。',
  ankiDeck: '卡片建到这个牌组，没有就新建。',
  claudeModel:
    '用 Claude Code 当前登录的账号调用，计入你的套餐用量或 API 费用。Haiku、Sonnet、Opus 自动对应各自的最新版本；组织限制了可用模型时，只列出允许的。Claude Code 账号只能用于翻译和解析，不能朗读。',
  openaiBaseUrl: '填 Base URL 或完整地址，如 https://openrouter.ai/api/v1 或 …/v1/chat/completions。',
  openaiKey: '明文保存在本机，只发给上面的请求地址。换请求地址时，请一并换 Key。',
  openaiModel: '请求地址或 API Key 保存后，自动重新获取列表；获取不到时手动填写。',
  openaiTtsModel:
    '如 gpt-4o-mini-tts。填了才能在“阅读”页把朗读服务选成 OpenAI 兼容接口；不朗读可以不填。',
  openaiPage: 'Prompt 里的文字、Claude 的回复和你选中的文字会发到这个地址翻译、解析或朗读。',
  elevenKey: '明文保存在本机，只发给 ElevenLabs。',
  elevenPage: 'ElevenLabs 只能用于朗读。要朗读的文字会发给 ElevenLabs。',
  weeklyReminder: '每周第一次打开 Claude Code 时，提醒查看上周的周报。',
  cardLanguage: '卡片和分享文字用这种语言。默认用目标语言，看到分享的朋友多半更熟悉它。',
} as const

/** A description with a link to the 服务 page inside its sentence */
export type LinkedText = { before: string; link: string; after: string }

export const TRANSLATE_SERVICE_DESCRIPTION: LinkedText = {
  before: '输入时的译文、回复译文、划词翻译和解析都用它。没配置完成的服务不能选，',
  link: '去配置翻译服务',
  after: '。',
}

/** Under 朗读服务 while it is 系统声音; DESCRIPTIONS.speechOnline otherwise */
export const SPEECH_SYSTEM_DESCRIPTION: LinkedText = {
  before: '系统自带的声音，免费、离线可用，但听起来比较机械。想要更自然的声音，可以换成在线语音，',
  link: '去配置朗读服务',
  after: '。',
}

export const linkedPlain = (text: LinkedText) => text.before + text.link + text.after

/** Marks the default among a control's choices, as "段落模式（默认）" */
export const DEFAULT_SUFFIX = '（默认）'

export const onOff = (value: boolean) => (value ? '开' : '关')

export const READING_MODE_LABELS: Record<WweSettings['readingMode'], string> = {
  paragraph: '段落模式',
  select: '划选模式',
}

export const AUTO_REPLY_LABELS: Record<WweSettings['autoReply'], string> = {
  off: '关闭',
  last: '每轮最后',
  all: '全部',
}

/** The unit after the count field of 每轮最后 */
export const REPLY_COUNT_UNIT = '条'

export const lastRepliesText = (count: number) => `每轮最后 ${count} 条`

export const DELAY_UNITS: readonly WweSettings['delayUnit'][] = ['ms', 's']
export const RESET_DEFAULT = '恢复默认'

export const TRANSLATE_SERVICE_LABELS: Record<WweSettings['translateService'], string> = {
  claude: 'Claude Code 账号',
  openai: 'OpenAI 兼容接口',
}

export const SPEECH_SERVICE_LABELS: Record<WweSettings['speechService'], string> = {
  system: '系统声音',
  openai: 'OpenAI 兼容接口',
  elevenlabs: 'ElevenLabs',
}

/** A service's option with the model it would use, as "Claude Code 账号（Haiku）" */
export const serviceOption = (service: string, model: string) => `${service}（${model}）`

/** A service that can't be chosen yet, as "OpenAI 兼容接口（未配置完成）" */
export const notConfiguredOption = (service: string) => `${service}（未配置完成）`

/** The 服务 page's sub-menu, one tab per service */
export type ServiceTab = 'claude' | 'openai' | 'elevenlabs'

export const SERVICE_TAB_LABELS: Record<ServiceTab, string> = {
  claude: 'Claude Code 账号',
  openai: 'OpenAI 兼容接口',
  elevenlabs: 'ElevenLabs',
}

/** What a service tab says it is used for; null when it is used for neither */
export function usedFor(translate: boolean, speech: boolean): string | null {
  if (translate && speech) {
    return '用于翻译和朗读'
  }
  if (translate) {
    return '用于翻译'
  }
  return speech ? '用于朗读' : null
}

export const CLAUDE_MODEL_LABELS: Record<string, string> = {
  haiku: 'Haiku',
  sonnet: 'Sonnet',
  opus: 'Opus',
}

export const CUSTOM_MODEL_LABEL = '自定义模型 id'
export const CUSTOM_MODEL_PLACEHOLDER = '如 claude-haiku-4-5-20251001'
/** After a saved model the list no longer has */
export const NOT_IN_LIST_SUFFIX = '（列表里没有）'

export const OPENAI_URL_PLACEHOLDER = 'https://api.openai.com/v1'
export const OPENAI_MODEL_PLACEHOLDER = '如 gpt-4o-mini'
export const OPENAI_TTS_MODEL_PLACEHOLDER = '如 gpt-4o-mini-tts'
export const MANUAL_ENTRY = '手动填写'

/** The voice choice that leaves the system's own default */
export const SYSTEM_DEFAULT_VOICE = '系统默认'
export const TRY_VOICE = '试听'

export const CARD_LANGUAGE_LABELS: Record<WweSettings['cardLanguage'], string> = {
  target: `目标语言（${TARGET_NAME}）`,
  source: `源语言（${SOURCE_NAME}）`,
}

export const CARD_LANGUAGE_NAMES: Record<WweSettings['cardLanguage'], string> = {
  target: TARGET_NAME,
  source: SOURCE_NAME,
}

export const CACHE_CLEAR = '清除'
export const CACHE_CONFIRM = '确定清除'
export const CANCEL = '取消'

/** The line under a field whose value failed its check */
export const ERRORS = {
  delay: '请输入 100 ms 到 5 s 之间的数字',
  replyCount: '请输入 1 到 99 之间的整数',
  baseUrl: '请求地址要以 http:// 或 https:// 开头',
} as const

/**
 * What an API Key field shows while empty: the saved key's mask (schema's
 * maskKey: null for none, '' for one shorter than 8), or the shape of a key.
 */
export function keyPlaceholder(mask: string | null, shape: string): string {
  if (mask === null) {
    return shape
  }
  return mask === '' ? '已保存' : `已保存 ${mask}，输入新的 Key 替换`
}

/** The shapes of an empty key field, OpenAI's and ElevenLabs' */
export const OPENAI_KEY_SHAPE = 'sk-…'
export const ELEVEN_KEY_SHAPE = 'sk_…'

/** Under the key field after the address moved to another domain (F7) */
export const KEY_STALE_HINT = '请求地址换了域名，重新输入 API Key 后才获取模型列表。'

/** The 快捷键 page: what Control+A does, which can't be changed */
export const SHORTCUT_KEY = 'Control+A'
export const SHORTCUT_FIXED = '固定'
export const SHORTCUT_ROWS: readonly string[] = [
  '输入框中有汉字时，替换为横条上的译文或纠错',
  '输入框中是直接写、还没替换过的英文时，替换为纠错（纠错结果为“✓”时除外）',
  '输入框中是刚替换进去、未改动的译文或纠错时，清空输入框',
]
export const SHORTCUT_NOTES: readonly string[] = [
  '按两下 Control+A 即可清空输入框，按住 Control 连按两下 A 更快。其他时候，Control+A 仍是将光标移到行首。使用输入法时，请先选字上屏再按。横条上的“替换为译文”“替换为纠错”和“清空输入框”按钮效果相同。',
  '在 tmux 或 screen 中，如果前缀键设为 Control+A，按键不会传到 Claude Code。请点击横条上的按钮，或先按前缀键再按 a；终端未开启全屏渲染时，按钮不能用鼠标点击，请先按前缀键再按 a。',
]
