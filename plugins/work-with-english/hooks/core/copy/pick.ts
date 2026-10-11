import { failure, progressInline } from './common'

// F9's selection line: what it is called, how it waits and fails.

export const SELECTED = '已选中'
export const COPIED = '已复制'
export const TOO_LONG = '选中的文字太长'
export const TRANSLATE = '翻译'
export const HIDE_TRANSLATION = '收起译文'
export const ANALYSE = '解析'
export const TRANSLATION = '译文：'
export const looking = () => progressInline('查询')
export const lookupFailed = (reason: string) => failure('查询', reason)
export const translating = () => progressInline('翻译')
export const translateFailed = (reason: string) => failure('翻译', reason)
