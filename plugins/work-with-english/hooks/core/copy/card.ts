// The desktop app's summary card, translated at the end of the reply above it.

/** The title over the card's translation, under a rule that sets it apart from the reply's */
export const CARD_TITLE = '下方卡片的译文'

/** Before the question's translation */
export const CARD_ASK = '问题：'

/** Before a question's translation when the dialog asks several: 问题 1/2： */
export const askNumbered = (n: number, total: number) => `问题 ${n}/${total}：`

/** Between a button's label and what a click on it sends */
export const CARD_SENDS = '，点击后发送：'
