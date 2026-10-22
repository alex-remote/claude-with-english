// The desktop app's summary card, translated at the end of the reply above it.

/** Before the question's translation */
export const CARD_ASK = '问题：'

/** A several-question dialog's tab: 问题 1 */
export const askTabLabel = (n: number) => `问题 ${n}`

/** Before a question's translation when the dialog asks several: 问题 1/2： */
export const askNumbered = (n: number, total: number) => `问题 ${n}/${total}：`

/** Between a button's label and what a click on it sends */
export const CARD_SENDS = '，点击后发送：'
