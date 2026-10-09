import { describe, expect, test } from 'claude-code/testing'

import * as copy from '../../hooks/core/copy/share'
import { CARD_INK, SVG_MAX_LENGTH, cardSvg, cardWords, type CardData, type HeatLevel } from '../../hooks/core/share/card'
import { dateRange, pastWeekDate } from '../../hooks/core/share/dates'
import { composeUrl, shareText } from '../../hooks/core/share/text'
import { measure, semiboldInkTop } from '../../hooks/core/share/widths'
import { xLength } from '../../hooks/core/share/xlength'

// docs/feature-map.md › F14 and the prototype's share card, example for
// example: the post's two versions word for word, their lengths as X counts
// them, the date line's three cases, the card's words, and an SVG that sips
// can draw.

const EN_TEXT = [
  'Using claude-with-english, I can work with Claude in English, not just my native language. Every prompt is practice! 🚀',
  '',
  'Install in Claude Code:',
  '/plugin install work-with-english --marketplace alex-remote/claude-with-english',
  '',
  '⭐ Star it on GitHub',
  'https://github.com/alex-remote/claude-with-english',
].join('\n')

const ZH_TEXT = [
  '有了 claude-with-english，除了母语，我也能用英语和 Claude 协作了。每发一条消息，都是一次练习！🚀',
  '',
  '在 Claude Code 里安装：',
  '/plugin install work-with-english --marketplace alex-remote/claude-with-english',
  '',
  '⭐ 在 GitHub 上点个 Star 吧～',
  'https://github.com/alex-remote/claude-with-english',
].join('\n')

/** Twelve weeks up to Tuesday 2026-10-06: the last column stops after Tuesday */
const HEAT: readonly HeatLevel[] = Array.from({ length: 84 }, (_, i): HeatLevel =>
  i >= 79 ? -1 : (([0, 1, 2, 3, 4] as const)[i % 5] ?? 0),
)

/** The feature map's card: 355, 67% up 3 points, 51.9k, 11, 24 */
const EXAMPLE: CardData = {
  from: '2026-09-30',
  to: '2026-10-06',
  sent: 355,
  ownPct: 67,
  delta: 3,
  words: 51_900,
  newWords: 11,
  streak: 24,
  heat: HEAT,
}

/** Equal to `digits` decimals, like toBeCloseTo */
const near = (actual: number, expected: number, digits: number) =>
  expect(Math.abs(actual - expected)).toBeLessThan(10 ** -digits / 2)

/** As long as the prototype's cropped product icon: 112,018 characters as a data URI */
const ICON = { href: `data:image/png;base64,${'A'.repeat(112_018 - 22)}`, width: 329, height: 240 }

describe('xLength', () => {
  test('the English post is 271 and the Chinese 257, as X counts them (F14 › 字数)', () => {
    expect(xLength(EN_TEXT)).toBe(271)
    expect(xLength(ZH_TEXT)).toBe(257)
  })

  test('both posts stay within 280', () => {
    expect(xLength(shareText('en'))).toBeLessThanOrEqual(copy.POST_LIMIT)
    expect(xLength(shareText('zh'))).toBeLessThanOrEqual(copy.POST_LIMIT)
  })

  test('the space the compose page adds counts, so nothing is 1', () => {
    expect(xLength('')).toBe(1)
    expect(xLength('abc')).toBe(4)
  })

  test('a CJK character weighs 2 and a link 23 whatever its length', () => {
    expect(xLength('中文')).toBe(5)
    expect(xLength('https://github.com/alex-remote/claude-with-english')).toBe(24)
    expect(xLength('see https://a.co and https://example.com/a/very/long/path')).toBe(4 + 23 + 5 + 23 + 1)
  })

  test('an emoji weighs 2 however many code points make it', () => {
    expect(xLength('🚀')).toBe(3)
    expect(xLength('👍\u{1F3FD}')).toBe(3)
    expect(xLength('👨\u200D👩\u200D👧')).toBe(3)
    expect(xLength('⭐\uFE0F')).toBe(3)
  })

  test('curly quotes and dashes weigh 1, as X weighs general punctuation', () => {
    expect(xLength('“a” – b')).toBe(8)
  })
})

describe('dates', () => {
  test('two months: Sep 30 – Oct 6, 2026 (past week), 2026.9.30 – 10.6（最近一周）', () => {
    expect(pastWeekDate('2026-09-30', '2026-10-06', 'en')).toBe('Sep 30 – Oct 6, 2026 (past week)')
    expect(pastWeekDate('2026-09-30', '2026-10-06', 'zh')).toBe('2026.9.30 – 10.6（最近一周）')
  })

  test('one month is written once in English, and on both ends in Chinese', () => {
    expect(dateRange('2026-10-01', '2026-10-07', 'en')).toBe('Oct 1 – 7, 2026')
    expect(dateRange('2026-10-01', '2026-10-07', 'zh')).toBe('2026.10.1 – 10.7')
  })

  test('across a year both ends carry their year', () => {
    expect(dateRange('2026-12-28', '2027-01-03', 'en')).toBe('Dec 28, 2026 – Jan 3, 2027')
    expect(dateRange('2026-12-28', '2027-01-03', 'zh')).toBe('2026.12.28 – 2027.1.3')
    expect(pastWeekDate('2026-12-28', '2027-01-03', 'zh')).toBe('2026.12.28 – 2027.1.3（最近一周）')
  })

  test('a date not written YYYY-MM-DD is refused', () => {
    expect(() => dateRange('2026-9-30', '2026-10-06', 'en')).toThrow('YYYY-MM-DD')
  })
})

describe('shareText', () => {
  test('three parts, a blank line between them, word for word', () => {
    expect(shareText('en')).toBe(EN_TEXT)
    expect(shareText('zh')).toBe(ZH_TEXT)
  })

  test('no hashtags, no backticks, nothing from the card', () => {
    for (const text of [shareText('en'), shareText('zh')]) {
      expect(text).not.toContain('#')
      expect(text).not.toContain('`')
      expect(text).not.toContain('Think in your language')
    }
  })

  test('the compose page carries the link inside text, newlines as %0A, and no url parameter', () => {
    const url = composeUrl(EN_TEXT)
    expect(url).toStartWith('https://x.com/intent/tweet?text=')
    expect(url).toContain('practice!%20%F0%9F%9A%80%0A%0AInstall%20in%20Claude%20Code%3A%0A%2Fplugin')
    expect(url).not.toContain('&url=')
    expect(decodeURIComponent(url.slice('https://x.com/intent/tweet?text='.length))).toBe(EN_TEXT)
  })
})

describe('copy', () => {
  test('the dropdown has two fixed choices', () => {
    expect(copy.cardLangOptions()).toEqual([
      { value: 'target', label: '目标语言（英语）' },
      { value: 'source', label: '源语言（简体中文）' },
    ])
    expect(copy.cardLangOf('target')).toBe('en')
    expect(copy.cardLangOf('source')).toBe('zh')
  })

  test('choosing a language saves it', () => {
    expect(copy.cardLangSaved('source')).toBe('已保存：卡片语言 简体中文')
    expect(copy.cardLangSaved('target')).toBe('已保存：卡片语言 英语')
  })

  test('the toasts', () => {
    expect(copy.postedToast()).toBe('卡片图片已复制。在发帖页点一下输入框，再按 ⌘V 贴上。')
    expect(copy.imageCopiedToast()).toBe('已复制卡片图片。')
    expect(copy.textCopiedToast()).toBe('已复制分享文字。')
  })

  test('the share view', () => {
    expect(copy.backToStats()).toBe('← 返回统计')
    expect(copy.postToX()).toBe('发到 X')
    expect(copy.copyImage()).toBe('复制图片')
    expect(copy.copyText()).toBe('复制文字')
    expect(copy.cardLangName()).toBe('卡片语言')
    expect(copy.cardLangDescription()).toBe('卡片和分享文字用这种语言。默认用目标语言，看到分享的朋友多半更熟悉它。')
    expect(copy.shareTextTitle(xLength(shareText('en')))).toBe('分享文字（271/280）')
    expect(copy.shareHelp()).toBe(
      '“发到 X”先把卡片复制成图片，再在浏览器里打开填好文字的发帖页，在那里点一下输入框，按 ⌘V 贴上卡片，发不发由你决定。发到别处时，用“复制图片”和“复制文字”。复制会替换剪贴板里原来的内容。',
    )
    expect(copy.noMessagesInPastWeek()).toBe('最近 7 天没有发出英文消息。')
  })
})

describe('cardWords', () => {
  test("the feature map's English card", () => {
    const words = cardWords(EXAMPLE, 'en')
    expect(words.title).toEqual(['How to Vibe Code', 'in English?'])
    expect(words.date).toBe('Sep 30 – Oct 6, 2026 (past week)')
    expect(words.numbers).toEqual(['355', '67%', '51.9k', '11', '24'])
    expect(words.labels).toEqual([
      'messages in English',
      'written by myself, up 3 points',
      "words of Claude's replies read",
      'new words saved',
      'day streak',
    ])
    expect(words.heat).toEqual({ title: 'Last 12 weeks', note: 'Each square is a day', less: 'Less', more: 'More' })
    expect(words.pitch).toEqual(['Think in your language.', 'Work with Claude Code in English.'])
    expect(words.repo).toBe('github.com/alex-remote/claude-with-english')
    expect(words.footer).toBe('A free, open-source Claude Code plugin')
  })

  test("the feature map's Chinese card", () => {
    const words = cardWords(EXAMPLE, 'zh')
    expect(words.title).toEqual(['如何用英语氛围编程？'])
    expect(words.date).toBe('2026.9.30 – 10.6（最近一周）')
    expect(words.numbers).toEqual(['355', '67%', '5.2 万', '11', '24'])
    expect(words.labels).toEqual(['条英文消息', '自己写的，比前一周高 3 个百分点', '词英文回复', '个新词', '天连续使用'])
    expect(words.heat).toEqual({ title: '最近 12 周', note: '每格代表一天', less: '少', more: '多' })
    expect(words.pitch).toEqual(['用母语思考，', '用英语和 Claude Code 协作。'])
    expect(words.footer).toBe('免费开源的 Claude Code 插件')
  })

  test('against the week before: up, down, the same, or nothing to compare with', () => {
    const own = (delta: number | null, lang: 'en' | 'zh') => cardWords({ ...EXAMPLE, delta }, lang).labels[1]
    expect(own(1, 'en')).toBe('written by myself, up 1 point')
    expect(own(-2, 'en')).toBe('written by myself, down 2 points')
    expect(own(-1, 'en')).toBe('written by myself, down 1 point')
    expect(own(0, 'en')).toBe('written by myself, same as the previous week')
    expect(own(null, 'en')).toBe('written by myself')
    expect(own(-2, 'zh')).toBe('自己写的，比前一周低 2 个百分点')
    expect(own(0, 'zh')).toBe('自己写的，和前一周一样')
    expect(own(null, 'zh')).toBe('自己写的')
  })

  test('one message, one new word', () => {
    const words = cardWords({ ...EXAMPLE, sent: 1, newWords: 1 }, 'en')
    expect(words.labels[0]).toBe('message in English')
    expect(words.labels[3]).toBe('new word saved')
  })

  test("Claude's words: abbreviated from 10,000, grouped below", () => {
    expect(cardWords({ ...EXAMPLE, words: 9876 }, 'en').numbers[2]).toBe('9,876')
    expect(cardWords({ ...EXAMPLE, words: 9876 }, 'zh').numbers[2]).toBe('9,876')
    expect(cardWords({ ...EXAMPLE, words: 10_000 }, 'en').numbers[2]).toBe('10.0k')
    expect(cardWords({ ...EXAMPLE, words: 123_456 }, 'zh').numbers[2]).toBe('12.3 万')
  })
})

describe('widths', () => {
  // NSString sizeWithAttributes, the same fonts and sizes (P06)
  test('the static tables match what macOS measures', () => {
    // The tables keep a tenth of a unit, so 42 Menlo characters land 0.05 px off
    const within = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(0.1)
    within(measure('今天练了 42 句英语', 'PingFangSC-Semibold', 56), 498.62)
    within(measure('Practiced 42 sentences today', 'PingFangSC-Regular', 32), 444.43)
    within(measure('我重构了认证模块，把登录延迟降低了 40%。', 'PingFangSC-Regular', 28), 572.9)
    within(measure('github.com/alex-remote/claude-with-english', 'Menlo-Bold', 26), 657.44)
    within(measure('Sep 30 – Oct 6, 2026 (past week)', 'PingFangSC-Regular', 16), 256.87)
  })

  test('a no-break space is as wide as a space', () => {
    expect(measure('\u00A0', 'PingFangSC-Regular', 1000)).toBe(333)
    expect(measure('\u00A0a', 'PingFangSC-Semibold', 20)).toBe(measure(' a', 'PingFangSC-Semibold', 20))
  })

  test('an emoji is 1 em, whatever it is made of (sips drew each so)', () => {
    for (const emoji of ['🚀', '⭐', '⭐\uFE0F', '👍\u{1F3FD}', '👨\u200D👩\u200D👧', '❤\uFE0F', '🇨🇳']) {
      expect(measure(emoji, 'PingFangSC-Regular', 100)).toBe(100)
      near(measure(`ll${emoji}ll`, 'Menlo-Bold', 100), 4 * 60.21 + 100, 5)
    }
  })

  test('the ink of the bold lines the icon and the quote line up with', () => {
    near(semiboldInkTop('How to Vibe Code', 30), 21.9, 5)
    near(semiboldInkTop('Hb', 30), 21.87, 5)
    near(semiboldInkTop('如何用英语氛围编程？', 30), 24.93, 5)
  })
})

describe('cardSvg', () => {
  const texts = (svg: string) => [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1])
  const attrOf = (el: string, name: string) => Number(new RegExp(` ${name}="([^"]+)"`).exec(el)?.[1])

  test('the English card says what the feature map shows, at 1080 wide', () => {
    const svg = cardSvg({ ...EXAMPLE, icon: ICON }, 'en')
    expect(svg).toStartWith('<svg xmlns="http://www.w3.org/2000/svg" width="1080" ')
    expect(texts(svg)).toEqual([
      'How to Vibe Code',
      'in English?',
      'Sep 30 – Oct 6, 2026 (past week)',
      '355',
      'messages in English',
      '67%',
      'written by myself, up 3 points',
      '51.9k',
      "words of Claude's replies read",
      '11',
      'new words saved',
      '24',
      'day streak',
      'Last 12 weeks',
      'Each square is a day',
      'Less',
      'More',
      '“',
      'Think in your language.',
      'Work with Claude Code in English.',
      'github.com/alex-remote/claude-with-english',
      'A free, open-source Claude Code plugin',
    ])
    expect(svg).toContain(`href="${ICON.href}"`)
  })

  test('the Chinese card', () => {
    const all = texts(cardSvg({ ...EXAMPLE, icon: ICON }, 'zh'))
    for (const s of ['如何用英语氛围编程？', '2026.9.30 – 10.6（最近一周）', '5.2 万', '自己写的，比前一周高 3 个百分点']) {
      expect(all).toContain(s)
    }
    for (const s of ['最近 12 周', '每格代表一天', '少', '多', '用母语思考，', '用英语和 Claude Code 协作。', '免费开源的 Claude Code 插件']) {
      expect(all).toContain(s)
    }
  })

  test('a long label wraps beside its number', () => {
    const all = texts(cardSvg({ ...EXAMPLE, delta: 0 }, 'en'))
    expect(all).toContain('written by myself, same as the previous')
    expect(all).toContain('week')
  })

  test('the repository is one line of bold monospace in the accent', () => {
    const svg = cardSvg(EXAMPLE, 'en')
    const repo = svg.match(/<text [^>]*>github\.com\/alex-remote\/claude-with-english<\/text>/g) ?? []
    expect(repo).toHaveLength(1)
    expect(repo[0]).toContain('font-family="Menlo, monospace"')
    expect(repo[0]).toContain('font-weight="700"')
    expect(repo[0]).toContain(`fill="${CARD_INK.accent}"`)
  })

  test('the icon is as tall as the title and date in both languages, its right edge 10 into the margin', () => {
    const image = (lang: 'en' | 'zh') => /<image [^>]*>/.exec(cardSvg({ ...EXAMPLE, icon: ICON }, lang))?.[0] ?? ''
    const en = image('en')
    const zh = image('zh')
    // English: from the title's cap line (40 + 30 − 21.9) to the date's descender (40 + 2 × 38 + 4 + 16 + 3)
    near(attrOf(en, 'y'), 48.1, 1)
    near(attrOf(en, 'y') + attrOf(en, 'height'), 139, 1)
    expect(attrOf(zh, 'height')).toBe(attrOf(en, 'height'))
    // Chinese: centred on the one-line title and the date
    const zhTop = 40 + 30 - 24.93
    near(attrOf(zh, 'y') + attrOf(zh, 'height') / 2, (zhTop + 101) / 2, 1)
    near(attrOf(en, 'x') + attrOf(en, 'width'), 510, 1)
    near(attrOf(en, 'width') / attrOf(en, 'height'), 329 / 240, 3)
  })

  test("a day after today isn't drawn", () => {
    const svg = cardSvg(EXAMPLE, 'en')
    // 79 days and the legend's 5 swatches
    expect(svg.match(/<rect [^>]*width="19"/g) ?? []).toHaveLength(79)
    expect(svg.match(/<rect [^>]*width="11"/g) ?? []).toHaveLength(5)
    // The 统计 page's grid, which ends today, goes in as it is
    expect(cardSvg({ ...EXAMPLE, heat: HEAT.slice(0, 79) }, 'en')).toBe(svg)
  })

  test("the legend's last row is level with the grid's bottom, its lightest level white", () => {
    const rects = (svg: string, width: number) =>
      (svg.match(new RegExp(`<rect [^>]*width="${width}"[^>]*>`, 'g')) ?? []).map((el) => ({
        bottom: attrOf(el, 'y') + attrOf(el, 'height'),
        fill: /fill="([^"]+)"/.exec(el)?.[1],
      }))
    const svg = cardSvg(EXAMPLE, 'en')
    const days = rects(svg, 19)
    const swatches = rects(svg, 11)
    near(Math.max(...swatches.map((s) => s.bottom)), Math.max(...days.map((d) => d.bottom)), 3)
    expect(swatches[0]?.fill).toBe('#FFFFFF')
  })

  test('the large quote is level with the pitch’s first line, the pitch beside it, the footer centred', () => {
    for (const lang of ['en', 'zh'] as const) {
      const svg = cardSvg(EXAMPLE, lang)
      const words = cardWords(EXAMPLE, lang)
      const el = (s: string) => new RegExp(`<text [^>]*>${s}</text>`).exec(svg)?.[0] ?? ''
      const quote = el('“')
      const pitch = el(words.pitch[0])
      // Georgia Bold's “ reaches 745.1/1000 above its baseline and ends 471.7/1000 right of its origin
      near(attrOf(quote, 'y') - 0.7451 * 104, attrOf(pitch, 'y') - semiboldInkTop(words.pitch[0], 23), 1)
      expect(attrOf(pitch, 'x')).toBeGreaterThan(attrOf(quote, 'x') + 0.4717 * 104)
      const footer = el(words.footer)
      near(attrOf(footer, 'x') + measure(words.footer, 'PingFangSC-Regular', 14) / 2, 270, 1)
    }
  })

  test('the title keeps clear of the icon; beside the one-line Chinese title it stands out above and below', () => {
    const icon = (lang: 'en' | 'zh') => /<image [^>]*>/.exec(cardSvg({ ...EXAMPLE, icon: ICON }, lang))?.[0] ?? ''
    expect(40 + measure('How to Vibe Code', 'PingFangSC-Semibold', 30)).toBeLessThanOrEqual(attrOf(icon('en'), 'x') - 10)
    expect(40 + measure('如何用英语氛围编程？', 'PingFangSC-Semibold', 30)).toBeLessThanOrEqual(attrOf(icon('zh'), 'x') - 10)
    const zh = icon('zh')
    // The title's ink top and the date's descender
    expect(attrOf(zh, 'y')).toBeLessThan(40 + 30 - 24.93)
    expect(attrOf(zh, 'y') + attrOf(zh, 'height')).toBeGreaterThan(40 + 38 + 4 + 16 + 3)
  })

  test('within the desktop Svg element’s 131,072 characters with the icon, at the most a card can hold', () => {
    // Every day drawn, five-digit numbers, a label that wraps, a date across a year
    const full: CardData = {
      ...EXAMPLE,
      from: '2026-12-28',
      to: '2027-01-03',
      sent: 12_345,
      ownPct: 100,
      delta: 0,
      words: 999_999,
      newWords: 1234,
      streak: 365,
      heat: Array.from({ length: 84 }, (_, i): HeatLevel => (([0, 1, 2, 3, 4] as const)[i % 5] ?? 0)),
      icon: ICON,
    }
    for (const lang of ['en', 'zh'] as const) {
      expect(cardSvg(full, lang).length).toBeLessThanOrEqual(SVG_MAX_LENGTH)
    }
  })

  test('only what sips draws: numeric weights, no tspan, no text-anchor, no file paths', () => {
    for (const lang of ['en', 'zh'] as const) {
      const svg = cardSvg({ ...EXAMPLE, icon: ICON }, lang)
      expect(svg).not.toContain('font-weight="bold"')
      expect(svg).not.toContain('<tspan')
      expect(svg).not.toContain('text-anchor')
      expect(svg).not.toContain('file://')
      expect(svg).not.toContain('PingFangSC-')
      expect(svg).not.toContain('Menlo-')
      expect(svg).toMatch(/<image [^>]*href="data:image\/png;base64,/)
      // No text starts with a space sips would drop
      expect(svg).not.toMatch(/<text [^>]*> /)
    }
  })

  test('light whatever the theme, GitHub’s mark in black', () => {
    const svg = cardSvg(EXAMPLE, 'en')
    expect(svg).toContain(`fill="${CARD_INK.bg}"`)
    expect(svg).toContain(`fill="${CARD_INK.foot}"`)
    expect(svg).not.toContain('prefers-color-scheme')
    expect(svg).toMatch(new RegExp(`<path transform="[^"]*" fill="${CARD_INK.ink}" d="M6\\.766`))
  })

  test('no plugin name on the card, only the repository', () => {
    for (const lang of ['en', 'zh'] as const) {
      expect(cardSvg(EXAMPLE, lang)).not.toContain('work-with-english')
    }
  })
})
