// How long X counts a post, so the number beside 分享文字 is the one X's
// compose page shows (https://docs.x.com/fundamentals/counting-characters.md):
// most Latin text and punctuation weighs 1, CJK and everything else 2, an
// emoji 2 however many code points it takes, and a link 23 whatever its
// length. The compose page adds a space after the text it is given, and
// that space counts too (tried in Chrome on 2026-10-06).

const LINK = /https?:\/\/\S+/g
const LINK_WEIGHT = 23
const ADDED_SPACE = 1

/** The ranges that weigh 1 (twitter-text's v3 configuration); the rest weigh 2 */
const LIGHT: readonly (readonly [number, number])[] = [
  [0x0000, 0x10ff],
  [0x2000, 0x200d],
  [0x2010, 0x201f],
  [0x2032, 0x2037],
]

const EMOJI =
  /\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*/gu

export function xLength(text: string): number {
  const normal = text.normalize('NFC')
  const links = normal.match(LINK) ?? []
  let length = links.length * LINK_WEIGHT + ADDED_SPACE
  const rest = normal.replace(LINK, '').replace(EMOJI, () => {
    length += 2
    return ''
  })
  for (const ch of rest) {
    const cp = ch.codePointAt(0) ?? 0
    length += LIGHT.some(([from, to]) => cp >= from && cp <= to) ? 1 : 2
  }
  return length
}
