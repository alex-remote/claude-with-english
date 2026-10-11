import type { RenderSurface } from 'claude-code'

import type { LangId } from '../../core/copy/lang'
import { cardSvg } from '../../core/share/card'
import type { CardIcon, CardStats } from '../../core/share/card'
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

/** Which step of an export failed, so the pane can say why in words (copy/share › EXPORT_REASONS) */
export type ExportStep = 'png' | 'clipboard' | 'open'

export class ExportError extends Error {
  constructor(
    readonly step: ExportStep,
    message: string,
  ) {
    super(message)
  }
}

/** The icon as a data URI, read once per session: the desktop's fs is slow (P26) */
const icons = new WeakMap<Host, Promise<CardIcon | null>>()

function iconOf(host: Host): Promise<CardIcon | null> {
  const known = icons.get(host)
  if (known) {
    return known
  }
  const read = host.fs
    .readBytes(`${host.plugin.root}/${ICON}`)
    .then(({ base64 }): CardIcon => ({ href: `data:image/png;base64,${base64}`, ...ICON_SIZE }))
    .catch(error => {
      // Not kept: the next card tries again
      icons.delete(host)
      host.ui.debug(`card icon: ${String(error)}`)
      return null
    })
  icons.set(host, read)
  return read
}

/** The card's SVG, as the desktop's pane draws it and sips renders it */
export async function cardOf(host: Host, stats: CardStats, lang: LangId): Promise<string> {
  return cardSvg({ ...stats, icon: await iconOf(host) }, lang)
}

/** The card as a PNG file, out of the plugin's folder so a write never reloads it (P06) */
export async function exportPng(host: Host, stats: CardStats, lang: LangId): Promise<string> {
  try {
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
  } catch (error) {
    throw error instanceof ExportError ? error : new ExportError('png', String(error))
  }
}

/** 复制图片: the PNG on the clipboard, in place of what was there */
export async function copyImage(host: Host, png: string): Promise<void> {
  const script = `set the clipboard to (read (POSIX file ${JSON.stringify(png)}) as «class PNGf»)`
  const done = await host.proc.run(['osascript', '-e', script]).catch(error => {
    throw new ExportError('clipboard', `osascript: ${String(error)}`)
  })
  if (done.exitCode !== 0) {
    throw new ExportError('clipboard', `osascript: ${done.stderr.trim() || done.exitCode}`)
  }
}

/** 复制文字: the share text, links included; pbcopy where the surface took nothing */
export async function copyText(host: Host, lang: LangId, surface?: RenderSurface): Promise<void> {
  const text = shareText(lang)
  const copied = await host.ui
    .copy(surface === undefined ? { text } : { text, surface })
    .catch(() => ({ isCopied: false as const }))
  if (copied.isCopied) {
    return
  }
  const done = await host.proc.run(['pbcopy'], { stdin: text }).catch(error => {
    throw new ExportError('clipboard', `pbcopy: ${String(error)}`)
  })
  if (done.exitCode !== 0) {
    throw new ExportError('clipboard', `pbcopy: ${done.stderr.trim() || done.exitCode}`)
  }
}

/** 发到 X: the image on the clipboard, then X's post page with the text filled in */
export async function postToX(host: Host, png: string, lang: LangId): Promise<void> {
  await copyImage(host, png)
  const opened = await host.proc.run(['open', composeUrl(shareText(lang))]).catch(error => {
    throw new ExportError('open', `open: ${String(error)}`)
  })
  if (opened.exitCode !== 0) {
    throw new ExportError('open', `open: ${opened.stderr.trim() || opened.exitCode}`)
  }
}
