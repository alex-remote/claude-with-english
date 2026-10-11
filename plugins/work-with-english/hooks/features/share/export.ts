import type { LangId } from '../../core/copy/lang'
import { cardSvg } from '../../core/share/card'
import type { CardStats } from '../../core/share/card'
import { composeUrl, shareText } from '../../core/share/text'
import { dataDirOf } from '../../services/datadir'
import type { Host } from '../../host'

// F14's card as a PNG, and the three ways it leaves: 发到 X, 复制图片,
// 复制文字. The card is an SVG that macOS's own sips turns into a PNG
// (P06), which osascript puts on the clipboard; X's post page takes only
// text in its address, so the image goes by the clipboard (⌘V).

const ICON = 'assets/card-icon.png'
/** The icon's pixel size, cropped to its artwork */
const ICON_SIZE = { width: 329, height: 240 }

async function iconOf(host: Host) {
  try {
    const { base64 } = await host.fs.readBytes(`${host.plugin.root}/${ICON}`)
    return { href: `data:image/png;base64,${base64}`, ...ICON_SIZE }
  } catch {
    return null
  }
}

/** The card's SVG, as the desktop's pane draws it and sips renders it */
export async function cardOf(host: Host, stats: CardStats, lang: LangId): Promise<string> {
  return cardSvg({ ...stats, icon: await iconOf(host) }, lang)
}

/** The card as a PNG file, out of the plugin's folder so a write never reloads it (P06) */
export async function exportPng(host: Host, stats: CardStats, lang: LangId): Promise<string> {
  const dir = `${await dataDirOf(host)}/share`
  const svg = `${dir}/card-${lang}.svg`
  const png = `${dir}/card-${lang}.png`
  // fs.write makes the folder; sips would otherwise write a file named after it (P06)
  await host.fs.write(svg, await cardOf(host, stats, lang))
  const made = await host.proc.run(['sips', '-s', 'format', 'png', svg, '--out', png])
  if (made.exitCode !== 0) {
    throw new Error(`sips: ${made.stderr.trim() || made.exitCode}`)
  }
  return png
}

/** 复制图片: the PNG on the clipboard, in place of what was there */
export async function copyImage(host: Host, png: string): Promise<void> {
  const script = `set the clipboard to (read (POSIX file ${JSON.stringify(png)}) as «class PNGf»)`
  const done = await host.proc.run(['osascript', '-e', script])
  if (done.exitCode !== 0) {
    throw new Error(`osascript: ${done.stderr.trim() || done.exitCode}`)
  }
}

/** 复制文字: the share text, links included */
export async function copyText(host: Host, lang: LangId): Promise<void> {
  const text = shareText(lang)
  const copied = await host.ui.copy({ text }).catch(() => ({ isCopied: false }))
  if (!copied.isCopied) {
    await host.proc.run(['pbcopy'], { stdin: text })
  }
}

/** 发到 X: the image on the clipboard, then X's post page with the text filled in */
export async function postToX(host: Host, png: string, lang: LangId): Promise<void> {
  await copyImage(host, png)
  await host.proc.run(['open', composeUrl(shareText(lang))])
}
