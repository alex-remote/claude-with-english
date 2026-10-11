import { failure, progressInPane, quoted } from './common'

// The words of the pane's analyses: F11's sentences and hard words, F10's
// word card (feature map F10, F11), and how they wait and fail (通用状态).

export const STRUCTURE = '结构'
export const POINTS = '要点'
export const HARD_WORDS_PARAGRAPH = '这段的难词'
export const HARD_WORDS_SENTENCE = '这句的难词'
export const SENSES = '常用释义'
export const IN_SENTENCE = '在这句里'
export const SENTENCE = '原句'
export const USAGES = '常见用法'
export const EXAMPLES = '例句'
/** The tag before the sense the sentence uses */
export const THIS_SENTENCE = '本句'
export const BACK_TO_TEXT = '← 返回语法分析'
export const SPEAK = '朗读'

/** 正在解析“cause”… for a word; a paragraph is too long to quote */
export const analysing = (word: string | null) => progressInPane(word ? `解析${quoted(word)}` : '解析')

/** 解析失败：<原因> */
export const analysisFailed = (reason: string) => failure('解析', reason)
