import { INSTALL_COMMAND, REPO_URL, SHARE_COPY } from '../copy/share'
import type { LangId } from '../copy/lang'

// The post that goes with the card is about working with Claude in the
// target language, not the card's numbers (F14 › 分享文字): the opening
// line; the install command under its heading, on a line of its own, since a
// post is plain text and backticks would be copied with it; the ask for a
// star, ending on the repository's address. A blank line between the parts.

export function shareText(lang: LangId): string {
  const copy = SHARE_COPY[lang]
  return [copy.opening(), `${copy.installTitle()}\n${INSTALL_COMMAND}`, `${copy.star()}\n${REPO_URL}`].join('\n\n')
}

/**
 * X's compose page with the post filled in. The link is part of `text`
 * rather than X's `url` parameter, which always lands at the end of the text
 * and can't keep the blank line before it; newlines go as %0A
 * (https://docs.x.com/x-for-websites/post-button/guides/web-intent.md).
 */
export const composeUrl = (text: string) => `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`
