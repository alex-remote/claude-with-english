import type { WweSettings } from '../../../types'
import type { SettingKey } from '../settings/schema'
import { failure, progressInPane, progressInline, savedToast } from './common'
import { SOURCE_LANG, TARGET_LANG, uiNameOf } from './lang'

// The words of the settings pane: its tabs, each setting's name and
// description, the options' labels and the error lines. Taken from the 设置
// table and each feature's 设置项 in docs/feature-map.md, then the prototype.
// A language is named in the sentence's own language, from the language table.

const SOURCE_NAME = uiNameOf(SOURCE_LANG)
const TARGET_NAME = uiNameOf(TARGET_LANG)

export const PANE_TITLE = 'claude-with-english 设置'

/** /wwe arrived as a message (the desktop app before it knows the command): the reason it was not sent */
export const settingsOpenedFromMessage = () => '已打开 claude-with-english 设置，这条命令没有发给 Claude。'

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
  bandButtons: '横条按钮',
  translateService: '翻译服务',
  readingMode: '阅读方式',
  autoReply: '自动翻译回复',
  autoReplyCount: '自动翻译回复',
  autoReplyWhen: '翻译时机',
  autoPlanAsk: '自动翻译计划和提问',
  replyContext: '附带前一段',
  translateConcurrency: '同时翻译的请求数',
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
/** F5: the value as it stands, under 回复语言 */
export const replyLanguageValue = (value: string | null) =>
  `Claude Code 的 Language 设置：${value ?? REPLY_LANGUAGE_UNSET}`

/** F5: the settings that outrank the user's own, where 设为英语 can't write */
export type FixedSource = 'project' | 'local' | 'flag' | 'policy'

const FIXED_SOURCE_NAMES: Record<FixedSource, string> = {
  project: '项目设置',
  local: '项目的本地设置',
  flag: '启动参数',
  policy: '组织设置',
}

/** F5: in place of 设为英语 when a source above the user's own sets the language */
export const replyLanguageFixed = (source: FixedSource) =>
  `回复语言由${FIXED_SOURCE_NAMES[source]}指定，这里不能修改。`
export const CACHE_NAME = '本机缓存'
export const SHORTCUTS_NAME = 'Control+A 的用法'

/** The description under each setting, as the feature map words it */
export const DESCRIPTIONS = {
  languages:
    '箭头左边是源语言，也就是你的母语，在 Prompt 里输入的语言，也是界面和译文用的语言；右边是目标语言，想练习的语言，横条里显示的语言。',
  delay: '停止输入多久后开始翻译。范围 100 ms 到 5 s，改过后可以恢复默认。',
  bandButtons:
    '在横条上显示“替换为译文”（直接写英文时是“替换为纠错”）和“清空输入框”。熟悉 Control+A 后可以关掉：按 Control+A 替换，按住 Control 连按两下 A 清空。',
  strict: `防止 AI 对话上下文混入${SOURCE_NAME}，始终使用${TARGET_NAME}。关闭后可直接发送。`,
  replyLanguage:
    'Claude 按这个设置回复。这是 Claude Code 的全局设置，对所有会话立即生效，关闭本插件后仍会保留；语音输入和会话标题的语言也会随之改变。',
  paragraphMode: '自动翻译回复，鼠标移到段落上出现“翻译”“朗读”“解析”。',
  selectMode: '回复不自动翻译，段落上同样有这三个按钮；另外选中任意一段英文，横条上也出现“翻译”“朗读”“解析”。',
  readingMode:
    '两种方式下都可以双击单词查词。在桌面端，选中文字后需按 ⌘C 复制，横条上才会显示查词和翻译。',
  autoReply:
    'Claude 的回复默认全部自动翻译，每条写完后就翻，也可以改成每轮做完后再翻。只想看结论时，可以改成每轮最后几条，在这一轮做完后翻；其他段落点“翻译”再翻。',
  autoPlanAsk: '自动翻译计划模式里的计划，以及 Claude 提问时的问题和选项。两种阅读方式下都起作用。',
  replyContext: '回复和计划按段翻译，每段单独请求。打开后每段附带前一段，用词和指代更连贯，用量稍多。',
  translateConcurrency: '同时发出的翻译请求最多几个，1 到 8。调大翻得更快，但更容易触发服务的频率限制。',
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

/**
 * TRANSLATE_SERVICE_DESCRIPTION as a pane draws it: a pane's text can't hold
 * a button, so the sentence ends and the link follows as a button.
 */
export const TRANSLATE_SERVICE_NOTE = '输入时的译文、回复译文、划词翻译和解析都用它。没配置完成的服务不能选。'

/** Marks the default among a control's choices, as "段落模式（默认）" */
export const DEFAULT_SUFFIX = '（默认）'

export const onOff = (value: boolean) => (value ? '开' : '关')

/** A radio choice: 阅读方式's two modes */
export const radioLabel = (label: string, isChosen: boolean) => `${isChosen ? '●' : '○'} ${label}`

/** What Enter does in a field of the pane, shown after ⏎ while it has focus */
export const FIELD_SUBMIT = '保存'

/** The tab bar's link to the plugin's repository: a pane draws no icon, so it is a word */
export const GITHUB_LABEL = 'GitHub'

export const READING_MODE_LABELS: Record<WweSettings['readingMode'], string> = {
  paragraph: '段落模式',
  select: '划选模式',
}

export const AUTO_REPLY_LABELS: Record<WweSettings['autoReply'], string> = {
  off: '关闭',
  last: '每轮最后',
  all: '全部',
}

/** 翻译时机 under 自动翻译回复 = 全部 */
export const AUTO_REPLY_WHEN_LABELS: Record<WweSettings['autoReplyWhen'], string> = {
  written: '每条写完后',
  turnEnd: '每轮做完后',
}

/** The unit after the count field of 每轮最后 */
export const REPLY_COUNT_UNIT = '条'

/** The unit after the field of 同时翻译的请求数 */
export const CONCURRENCY_UNIT = '个'

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

/** A service's tab with what it is used for: Claude Code 账号（用于翻译） */
export const serviceTabLabel = (tab: ServiceTab, use: string | null) =>
  use === null ? SERVICE_TAB_LABELS[tab] : `${SERVICE_TAB_LABELS[tab]}（${use}）`

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
/** The id field's label under 自定义模型 id */
export const CUSTOM_MODEL_FIELD = '模型 id'

/** F7: the organization's list leaves out the default Haiku */
export const modelReplaced = (model: string) => `组织不允许使用 Haiku，已改用 ${model}。`

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

/** 本机缓存 while `du` measures it, and when it could not */
export const CACHE_MEASURING = progressInPane('计算')
export const CACHE_UNKNOWN = '无法计算占用的空间'

/** A size on disk from `du -sk`: 512 KB, 12 MB, 1.5 GB */
export function sizeText(kb: number): string {
  if (kb < 1024) {
    return `${Math.max(0, Math.round(kb))} KB`
  }
  const mb = kb / 1024
  if (mb < 1024) {
    return `${trimmed(mb)} MB`
  }
  return `${trimmed(mb / 1024)} GB`
}

/** One decimal at most, none when it is 0: 12 MB, 1.5 MB */
const trimmed = (n: number) => String(n >= 100 ? Math.round(n) : Math.round(n * 10) / 10)

/** F6 › 存多久: the toast after 确定清除, and the one when the files could not be removed */
export const cacheCleared = (kb: number) => `已清除译文和朗读缓存，释放了 ${sizeText(kb)}。`
export const CACHE_CLEAR_FAILED = '清除缓存失败，请稍后再试。'

/** F8: 试听 beside 声音, what it says while the system voice reads it, and while an online voice does */
export const TRYING = progressInline('试听')
export const STOP = '停止'

/**
 * SPEECH_SYSTEM_DESCRIPTION as a pane draws it: the sentence ends and
 * 去配置朗读服务 follows as a button, as TRANSLATE_SERVICE_NOTE does.
 */
export const SPEECH_SYSTEM_NOTE = '系统自带的声音，免费、离线可用，但听起来比较机械。想要更自然的声音，可以换成在线语音。'

/** A checkbox, drawn as a button: 手动填写 */
export const checkboxLabel = (label: string, isChecked: boolean) => `${isChecked ? '☑' : '☐'} ${label}`

/** 翻译模型 before a model is chosen from the list */
export const PICK_MODEL = '选择模型'

/** Where a list would be, while there is none: nothing to ask with yet, or the fetch gave none */
export const OPENAI_NEEDS_FIRST = '先填请求地址和 API Key'
export const ELEVEN_NEEDS_FIRST = '先填 API Key'
export const NO_LIST = '未获取到模型列表'

/** F7 获取模型列表 and F8's fetch of models and voices, under way (通用状态 › 进行中) */
export const FETCHING_MODELS = progressInPane('获取模型列表')
export const FETCHING_ELEVEN = progressInPane('获取模型和声音')

/** A fetch's failure line under the dropdown (通用状态 › 失败); the reason says what to check */
export const modelsFailed = (reason: string) => `${failure('获取模型列表', reason)}。`
export const elevenFailed = (reason: string) => `${failure('获取模型和声音', reason)}。`

/** Under the dropdown after a fetch: 共 N 个，来自 <地址> */
export const modelsFrom = (count: number, from: string) => `共 ${count} 个，来自 ${from}`
export const elevenFrom = (models: number, voices: number) =>
  `共 ${models} 个能朗读的模型、${voices} 个声音，来自你的 ElevenLabs 账号`

/** F7: the saved 翻译模型 is not in the list fetched since */
export const MODEL_GONE_HINT = '已保存的模型不在新获取的列表里，仍按它翻译。'

/** Under ElevenLabs' 朗读模型 */
export const ELEVEN_MODEL_NOTE =
  'eleven_multilingual_v2 是 ElevenLabs 的默认模型；eleven_flash_v2_5 更快、更省额度；eleven_v4 表现力最强。声音在“阅读”页选。'

/** F7 › 页面提示 › 配置状态: what the OpenAI-compatible service still lacks */
export const openaiMissingText = (items: readonly string[]) => `还缺${items.join('、')}。填全后可以在“翻译”页选用。`
export const OPENAI_READY = '✓ 已配置完成，可以在“翻译”页选用。'
/** In use: ✓ 使用中，翻译使用 <模型>，朗读使用 <朗读模型> */
export const inUseText = (translate: string | null, speech: string | null) =>
  `✓ 使用中，${[translate === null ? null : `翻译使用 ${translate}`, speech === null ? null : `朗读使用 ${speech}`]
    .filter(part => part !== null)
    .join('，')}`
export const ELEVEN_MISSING = '还缺 API Key。填好后会获取你账号里的模型和声音，然后可以在“阅读”页选用。'
export const ELEVEN_READY = '✓ 已配置完成，可以在“阅读”页选用。'
export const elevenInUse = (model: string, voice: string) => `✓ 使用中，朗读使用 ${model}，声音 ${voice}`

/** 删除配置, at the foot of the OpenAI-compatible and ElevenLabs tabs */
export const DELETE_CONFIG = '删除配置'
export const DELETE_CONFIRM = '确定删除'
export const DELETE_NOTE = '清掉这个服务的全部配置，包括 API Key。'

/** The toast after 确定删除: what went back to its default with the service */
export function configDeleted(service: 'openai' | 'elevenlabs', translateBack: boolean, speechBack: boolean): string {
  const head = service === 'openai' ? '已删除 OpenAI 兼容接口的配置' : '已删除 ElevenLabs 的配置'
  const back = [translateBack ? '，翻译改回 Claude Code 账号' : '', speechBack ? '，朗读改回系统声音' : '']
  return `${head}${back.join('')}。`
}

/** The line under a field whose value failed its check */
export const ERRORS = {
  delay: '请输入 100 ms 到 5 s 之间的数字',
  replyCount: '请输入 1 到 99 之间的整数',
  concurrency: '请输入 1 到 8 之间的整数',
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
