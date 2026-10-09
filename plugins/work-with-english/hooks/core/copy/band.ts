import type { WweBand, WweSpeaking } from '../../../types'
import { failure, progressInline } from './common'
import { SOURCE_LANG, TARGET_LANG, codeOf, uiNameOf } from './lang'

// Every word the band above the prompt shows: F1's rows, F2 and F3's
// buttons and tip, F4's hint line, F15's ✓ and F8's 朗读. Taken from the
// feature map, then the prototype; the lines neither had are drafts the
// plan lists under 要新拟的文案, to be read over at the demo.

type Mode = Exclude<WweBand['mode'], 'none'>

/** The first row's code: EN */
export const targetCode = () => codeOf(TARGET_LANG)

/** The second row's code: ZH */
export const sourceCode = () => codeOf(SOURCE_LANG)

/** The first row's text while a message's first request runs, after its code: `EN …` */
export const firstPending = () => '…'

/** F15: between the code and a sentence with nothing to fix */
export const nothingToFix = () => '✓'

/** The first row when the request failed: 翻译失败：<原因>, 纠错失败：<原因> */
export const rowFailure = (mode: Mode, reason: string) =>
  failure(mode === 'translate' ? '翻译' : '纠错', reason)

/**
 * F2, F15 › 替换前核对: the code, paths, addresses or placeholders still
 * differ from the original after one more try, so nothing was put in.
 */
export const verifyFailure = (mode: Mode) =>
  mode === 'translate'
    ? '译文里的代码、路径、网址或占位和原文不一致，未替换。'
    : '纠错结果里的代码、路径、网址或占位和原句不一致，未替换。'

/** F2 and F15's button */
export const useButton = (mode: Mode) => (mode === 'translate' ? '替换为译文' : '替换为纠错')

/** F3's button */
export const clearButton = () => '清空输入框'

/**
 * F8, at the right of the first row: 朗读, or while it reads this row,
 * 朗读中… with the system voice (it can't be stopped) and 停止 online.
 */
export const speakButton = (reading: NonNullable<WweSpeaking>['via'] | null = null) =>
  reading === 'system' ? progressInline('朗读') : reading === 'online' ? '停止' : '朗读'

/** After the buttons, once a day */
export const tip = () => '小技巧：按 Control+A 替换为译文，按住 Control 连按两下 A 清空输入框。'

/** F4: why Enter was held back */
export const strictBlocked = () =>
  `您输入了${uiNameOf(SOURCE_LANG)}，严格模式下仅接受${uiNameOf(TARGET_LANG)}。`

/** F4: when the translation failed too, in place of `strictBlocked` */
export const serviceDown = () => '翻译服务出错，暂时无法替换。请输入 /wwe 检查服务，或点击“仍然发送”。'

/** F4: the Prompt was emptied and the text went to the history */
export const recallHint = () => '按 ↑ 找回原文。'

/** F4: an image does not come back with ↑ */
export const imageHint = () => '图片需要重新粘贴。'

/**
 * F4's hint line as `WweBand.blocked` describes it. Where the Prompt kept the
 * text (the terminal), nothing needs getting back; where it came back empty,
 * ↑ brings it back, without its images.
 */
export const blockedHint = (blocked: NonNullable<WweBand['blocked']>) =>
  blocked.isLetThrough
    ? letThrough()
    : (blocked.serviceDown ? serviceDown() : strictBlocked()) +
      (blocked.isCleared ? recallHint() + (blocked.hasImage ? imageHint() : '') : '')

/** F4: at the right of the hint line */
export const sendAnywayButton = () => '仍然发送'

/** F4 (D3): 仍然发送 pressed with text in the Prompt lets this one message through */
export const letThrough = () => '已放行这一条，按回车发送。'
