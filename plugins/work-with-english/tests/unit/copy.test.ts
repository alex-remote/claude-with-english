import { describe, expect, test } from 'claude-code/testing'

import * as band from '../../hooks/core/copy/band'
import * as common from '../../hooks/core/copy/common'
import { LANGS, SOURCE_LANG, TARGET_LANG, codeOf, settingNameOf, uiNameOf } from '../../hooks/core/copy/lang'

// Each sentence as docs/feature-map.md writes it, so an edit that changes one
// shows up here. Where the map quotes a sentence inside its own “”, a ‘’ in it
// is the nested form of “” and the interface writes “”, as the prototype does.

describe('lang', () => {
  test('the first version translates Simplified Chinese into English', () => {
    expect(SOURCE_LANG).toBe('zh')
    expect(TARGET_LANG).toBe('en')
  })

  test('the band starts its rows with EN and ZH (F1 › 语言)', () => {
    expect(codeOf('en')).toBe('EN')
    expect(codeOf('zh')).toBe('ZH')
  })

  test('a sentence of the interface names a language in Chinese (界面语言 › 语言名称)', () => {
    expect(uiNameOf('zh')).toBe('简体中文')
    expect(uiNameOf('en')).toBe('英语')
  })

  test('F5 writes the standard English name', () => {
    expect(settingNameOf('en')).toBe('English')
    expect(settingNameOf('zh')).toBe('Simplified Chinese')
  })

  test('every language has a name in every language', () => {
    for (const lang of Object.values(LANGS)) {
      expect(Object.keys(lang.names).sort()).toEqual(['en', 'zh'])
    }
  })
})

describe('band', () => {
  test('F1: the rows start with the codes, and the first request shows `EN …`', () => {
    expect(band.targetCode()).toBe('EN')
    expect(band.sourceCode()).toBe('ZH')
    expect(`${band.targetCode()} ${band.firstPending()}`).toBe('EN …')
  })

  test('F1, F15: a failed request says why on the first row', () => {
    expect(band.rowFailure('translate', 'API Key 不对或已过期')).toBe('翻译失败：API Key 不对或已过期')
    expect(band.rowFailure('correct', '请求太多或额度用完')).toBe('纠错失败：请求太多或额度用完')
  })

  test('F15: a sentence with nothing to fix is marked ✓', () => {
    expect(band.nothingToFix()).toBe('✓')
  })

  test('F2, F3, F15: the buttons on the third row', () => {
    expect(band.useButton('translate')).toBe('替换为译文')
    expect(band.useButton('correct')).toBe('替换为纠错')
    expect(band.clearButton()).toBe('清空输入框')
  })

  test('F8: 朗读, 朗读中… with the system voice, 停止 online', () => {
    expect(band.speakButton()).toBe('朗读')
    expect(band.speakButton(null)).toBe('朗读')
    expect(band.speakButton('system')).toBe('朗读中…')
    expect(band.speakButton('online')).toBe('停止')
  })

  test('快捷键和按钮 › 小技巧', () => {
    expect(band.tip()).toBe('小技巧：按 Control+A 替换为译文，按住 Control 连按两下 A 清空输入框。')
  })

  test('F2, F15 › 替换前核对 (a draft from 要新拟的文案)', () => {
    expect(band.verifyFailure('translate')).toBe('译文里的代码、路径、网址或占位和原文不一致，未替换。')
    expect(band.verifyFailure('correct')).toBe('纠错结果里的代码、路径、网址或占位和原句不一致，未替换。')
  })

  test('F4: the hint line after Enter was held back', () => {
    expect(band.strictBlocked()).toBe('您输入了简体中文，严格模式下仅接受英语。')
    expect(band.recallHint()).toBe('按 ↑ 找回原文。')
    expect(band.imageHint()).toBe('图片需要重新粘贴。')
    expect(band.sendAnywayButton()).toBe('仍然发送')
    // The terminal keeps the text in the Prompt: nothing to get back
    expect(band.blockedHint({ hasImage: true, serviceDown: false, isCleared: false, isLetThrough: false })).toBe(
      '您输入了简体中文，严格模式下仅接受英语。',
    )
    // Where the Prompt came back empty, ↑ has the text, without its images
    expect(band.blockedHint({ hasImage: false, serviceDown: false, isCleared: true, isLetThrough: false })).toBe(
      '您输入了简体中文，严格模式下仅接受英语。按 ↑ 找回原文。',
    )
    expect(band.blockedHint({ hasImage: true, serviceDown: false, isCleared: true, isLetThrough: false })).toBe(
      '您输入了简体中文，严格模式下仅接受英语。按 ↑ 找回原文。图片需要重新粘贴。',
    )
  })

  test('F4: when the translation failed too', () => {
    expect(band.serviceDown()).toBe('翻译服务出错，暂时无法替换。请输入 /wwe 检查服务，或点击“仍然发送”。')
    expect(band.blockedHint({ hasImage: false, serviceDown: true, isCleared: false, isLetThrough: false })).toBe(
      '翻译服务出错，暂时无法替换。请输入 /wwe 检查服务，或点击“仍然发送”。',
    )
    expect(band.blockedHint({ hasImage: true, serviceDown: true, isCleared: true, isLetThrough: false })).toBe(
      '翻译服务出错，暂时无法替换。请输入 /wwe 检查服务，或点击“仍然发送”。按 ↑ 找回原文。图片需要重新粘贴。',
    )
  })

  test('F4: 仍然发送 with the text still in the Prompt', () => {
    expect(band.letThrough()).toBe('已放行这一条，按回车发送。')
    expect(band.blockedHint({ hasImage: false, serviceDown: false, isCleared: false, isLetThrough: true })).toBe(
      '已放行这一条，按回车发送。',
    )
  })
})

describe('common', () => {
  test('通用状态 › 进行中', () => {
    expect(common.progressInPane('获取模型列表')).toBe('正在获取模型列表…')
    expect(common.progressInPane(`解析${common.quoted('cause')}`)).toBe('正在解析“cause”…')
    expect(common.progressInline('翻译')).toBe('翻译中…')
    expect(common.progressInline('查询')).toBe('查询中…')
    // F8: “试听”读的时候写“试听中…”
    expect(common.progressInline('试听')).toBe('试听中…')
  })

  test('通用状态 › 失败', () => {
    expect(common.failure('翻译', 'API Key 不对或已过期')).toBe('翻译失败：API Key 不对或已过期')
    expect(common.failure('获取模型和声音', '401 Unauthorized。检查 API Key。')).toBe(
      '获取模型和声音失败：401 Unauthorized。检查 API Key。',
    )
  })

  test('命令 › 第一次使用的提示', () => {
    expect(common.firstRunToast()).toBe('输入 /wwe 打开设置。')
  })

  test('运行环境 › 启动时的提示', () => {
    expect(common.notFullscreenToast()).toBe(
      '未开启全屏渲染，段落上的按钮和查词暂时无法使用，横条上的按钮不能用鼠标点。输入 /tui fullscreen 即可开启。',
    )
    expect(common.notMacLocalToast()).toBe(
      'claude-with-english 第一版仅支持在 macOS 本机上运行，部分功能可能无法使用。',
    )
  })

  test('设置 › 保存: 已保存：<设置项> <新值>', () => {
    expect(common.savedToast('翻译延迟', '1.5 s')).toBe('已保存：翻译延迟 1.5 s')
    expect(common.savedToast('严格模式', '关')).toBe('已保存：严格模式 关')
    expect(common.savedToast('阅读方式', '划选模式')).toBe('已保存：阅读方式 划选模式')
    expect(common.savedToast('卡片语言', '简体中文')).toBe('已保存：卡片语言 简体中文')
    expect(common.savedToast('API Key', '')).toBe('已保存：API Key')
  })
})

test('no sentence uses “·” as a separator', () => {
  const sentences = [
    band.tip(),
    band.strictBlocked(),
    band.serviceDown(),
    band.recallHint(),
    band.imageHint(),
    band.letThrough(),
    band.verifyFailure('translate'),
    band.verifyFailure('correct'),
    common.firstRunToast(),
    common.notFullscreenToast(),
    common.notMacLocalToast(),
  ]
  for (const sentence of sentences) {
    expect(sentence).not.toContain('·')
  }
})
