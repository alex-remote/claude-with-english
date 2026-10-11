import type { WweSettings } from '../../../types'
import { progressInPane, savedToast } from './common'
import { SOURCE_LANG, TARGET_LANG, uiNameOf, type LangId } from './lang'

// Every word of the share card and the post that goes with it (F14), in the
// two languages a card can be in, as docs/feature-map.md writes them; the
// prototype where the map gives no wording (the Chinese card's labels). The
// first version's pair is fixed, Simplified Chinese into English, so the
// target language is written in, not filled in.

/** The plugin's GitHub repository, where the post links */
export const REPO_URL = 'https://github.com/alex-remote/claude-with-english'

/** The repository as the card writes it, without the scheme */
export const REPO_TEXT = 'github.com/alex-remote/claude-with-english'

/** The line that installs the plugin, on a line of its own in the post */
export const INSTALL_COMMAND = '/plugin install work-with-english --marketplace alex-remote/claude-with-english'

/** The 卡片语言 setting's two choices */
export type CardLangSetting = WweSettings['cardLanguage']

/** Which language a card is in: the target language by default, or the source language */
export const cardLangOf = (setting: CardLangSetting): LangId => (setting === 'source' ? SOURCE_LANG : TARGET_LANG)

/** The words of a card and its post in one language */
export type ShareCopy = {
  /** Fixed lines: English breaks after "How to Vibe Code", Chinese fits one */
  title: readonly string[]
  /** After the seven days' first and last date */
  pastWeek: (range: string) => string
  /** Beside each of the five numbers */
  sentLabel: (sent: number) => string
  /** `delta` is null when the seven days before had no English message */
  ownLabel: (delta: number | null) => string
  wordsLabel: () => string
  /** Claude's words as the number shows them: 51.9k, 5.2 万, 9,876 */
  wordsNumber: (words: number) => string
  newWordsLabel: (newWords: number) => string
  streakLabel: () => string
  /** The grid's legend, read the way GitHub's contribution graph is */
  heatTitle: () => string
  heatNote: () => string
  heatLess: () => string
  heatMore: () => string
  /** Two lines beside the large opening quote */
  pitch: readonly [string, string]
  /** The footer: what the plugin is */
  footer: () => string
  /** The post's three parts */
  opening: () => string
  installTitle: () => string
  star: () => string
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** 9,876 */
const grouped = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

export const SHARE_COPY: Readonly<Record<LangId, ShareCopy>> = {
  en: {
    title: ['How to Vibe Code', 'in English?'],
    pastWeek: (range) => `${range} (past week)`,
    sentLabel: (sent) => `${plural(sent, 'message', 'messages')} in English`,
    ownLabel: (delta) => {
      if (delta === null) {
        return 'written by myself'
      }
      if (delta === 0) {
        return 'written by myself, same as the previous week'
      }
      const n = Math.abs(delta)
      return `written by myself, ${delta > 0 ? 'up' : 'down'} ${n} ${plural(n, 'point', 'points')}`
    },
    wordsLabel: () => "words of Claude's replies read",
    wordsNumber: (words) => (words >= 10000 ? `${(words / 1000).toFixed(1)}k` : grouped(words)),
    newWordsLabel: (newWords) => plural(newWords, 'new word saved', 'new words saved'),
    streakLabel: () => 'day streak',
    heatTitle: () => 'Last 12 weeks',
    heatNote: () => 'Each square is a day',
    heatLess: () => 'Less',
    heatMore: () => 'More',
    pitch: ['Think in your language.', 'Work with Claude Code in English.'],
    footer: () => 'A free, open-source Claude Code plugin',
    opening: () =>
      'Using claude-with-english, I can work with Claude in English, not just my native language. Every prompt is practice! 🚀',
    installTitle: () => 'Install in Claude Code:',
    star: () => '⭐ Star it on GitHub',
  },
  zh: {
    title: ['如何用英语氛围编程？'],
    pastWeek: (range) => `${range}（最近一周）`,
    sentLabel: () => '条英文消息',
    ownLabel: (delta) => {
      if (delta === null) {
        return '自己写的'
      }
      if (delta === 0) {
        return '自己写的，和前一周一样'
      }
      return `自己写的，比前一周${delta > 0 ? '高' : '低'} ${Math.abs(delta)} 个百分点`
    },
    wordsLabel: () => '词英文回复',
    wordsNumber: (words) => (words >= 10000 ? `${(words / 10000).toFixed(1)} 万` : grouped(words)),
    newWordsLabel: () => '个新词',
    streakLabel: () => '天连续使用',
    heatTitle: () => '最近 12 周',
    heatNote: () => '每格代表一天',
    heatLess: () => '少',
    heatMore: () => '多',
    pitch: ['用母语思考，', '用英语和 Claude Code 协作。'],
    footer: () => '免费开源的 Claude Code 插件',
    opening: () => '有了 claude-with-english，除了母语，我也能用英语和 Claude 协作了。每发一条消息，都是一次练习！🚀',
    installTitle: () => '在 Claude Code 里安装：',
    star: () => '⭐ 在 GitHub 上点个 Star 吧～',
  },
}

/** X's limit, after the count beside 分享文字 */
export const POST_LIMIT = 280

// The share view in the Pane, written in the source language

export const backToStats = () => '← 返回统计'
export const postToX = () => '发到 X'
export const copyImage = () => '复制图片'
export const copyText = () => '复制文字'

/** What the card says to a reader who can't see it */
export const cardAlt = () => '分享卡'

export const cardLangName = () => '卡片语言'
export const cardLangDescription = () => '卡片和分享文字用这种语言。默认用目标语言，看到分享的朋友多半更熟悉它。'

/** The dropdown's two fixed choices: 目标语言（英语）, 源语言（简体中文） */
export const cardLangOptions = (): readonly { value: CardLangSetting; label: string }[] => [
  { value: 'target', label: `目标语言（${uiNameOf(TARGET_LANG)}）` },
  { value: 'source', label: `源语言（${uiNameOf(SOURCE_LANG)}）` },
]

/** Choosing one saves it: 已保存：卡片语言 简体中文 */
export const cardLangSaved = (setting: CardLangSetting) => savedToast(cardLangName(), uiNameOf(cardLangOf(setting)))

/** Over the post's text, its length as X counts it: 分享文字（271/280） */
export const shareTextTitle = (length: number) => `分享文字（${length}/${POST_LIMIT}）`

export const shareHelp = () =>
  '“发到 X”先把卡片复制成图片，再在浏览器里打开填好文字的发帖页，在那里点一下输入框，按 ⌘V 贴上卡片，发不发由你决定。发到别处时，用“复制图片”和“复制文字”。复制会替换剪贴板里原来的内容。'

/** 发到 X: the compose page opens without the cursor in it, so ⌘V needs a click first */
export const postedToast = () => '卡片图片已复制。在发帖页点一下输入框，再按 ⌘V 贴上。'
export const imageCopiedToast = () => '已复制卡片图片。'
export const textCopiedToast = () => '已复制分享文字。'

/** Beside 生成分享卡 when it can't be pressed: the card is always the last seven days */
export const noMessagesInPastWeek = () => '最近 7 天没有发出英文消息。'

/** The desktop's preview while the card is drawn with its icon */
export const cardMaking = () => progressInPane('生成卡片')

/** The three exports, by the button that starts them */
export type ShareAction = 'post' | 'image' | 'text'

/**
 * In place of a button while its export runs (通用状态 › 进行中). 发到 X
 * names what the person will see: the plugin never posts.
 */
export const exportProgress = (action: ShareAction) =>
  action === 'post' ? progressInPane('打开发帖页') : progressInPane(action === 'image' ? '复制图片' : '复制文字')

/** Under the button whose export failed; pressing it again tries again (通用状态 › 失败) */
export const exportFailed = (action: ShareAction, reason: string) =>
  `${action === 'post' ? '发到 X 失败' : action === 'image' ? '复制图片失败' : '复制文字失败'}：${reason}`

/** Why an export failed, by the step that failed */
export const EXPORT_REASONS = {
  png: '无法生成卡片图片',
  clipboard: '无法写入剪贴板',
  open: '无法打开浏览器',
  timeout: '30 秒内没有结果',
} as const
