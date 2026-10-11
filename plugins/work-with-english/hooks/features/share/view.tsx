import type { Elements, RenderChildren, RenderElement, RenderSurface } from 'claude-code'

import type { WweShare, WweShareAction } from '../../../types'
import { TARGET_LANG } from '../../core/copy/lang'
import * as copy from '../../core/copy/share'
import { CARD_INK, cardWords } from '../../core/share/card'
import { shareText } from '../../core/share/text'
import { xLength } from '../../core/share/xlength'
import { TERMINAL_INK, heatKeyRaster, heatRaster } from '../../core/stats/charts'

// The share card's page (F14), in the pane in place of the settings: ← 返回统计
// and the two picture buttons, the card, 卡片语言, the post with its length
// as X counts it and 复制文字, then how 发到 X goes. The desktop shows the
// card as the very SVG the PNG is made from; the terminal has no Svg, so it
// lays the card's words out in boxes, the product icon and GitHub's mark left
// out with their places blank (dev-plan D8). Nothing is read or written here.

/** The tables that draw a dropdown; mobile's has none */
export type ShareUi = Elements['terminal'] | Elements['desktop'] | Elements['vscode']

/** The table `$.ui.resolve(e)` handed out, when it can draw the page */
export function shareUiOf(table: Elements[keyof Elements]): ShareUi | null {
  return 'Select' in table ? table : null
}

export type ShareVm = { share: WweShare }

export type ShareActions = {
  back: () => void
  setCardLanguage: (value: string) => void
  postToX: () => void
  copyImage: () => void
  /** With the surface the press came from, which `$.ui.copy` copies on */
  copyText: (surface: RenderSurface) => void
}

export function shareView(ui: ShareUi, vm: ShareVm, actions: ShareActions): RenderElement {
  const { Box, Text, Button, Select } = ui
  const { share } = vm
  const text = shareText(share.lang)

  /** An export's button; its progress while it runs, and the others not pressable meanwhile */
  const exportButton = (action: WweShareAction, label: string, onPress: (surface: RenderSurface) => void) => {
    const key = `share-${action}`
    if (share.busy === action) {
      return (
        <Text key={key} dimColor>
          {copy.exportProgress(action)}
        </Text>
      )
    }
    if (share.busy !== null) {
      return (
        <Text key={key} dimColor>
          {label}
        </Text>
      )
    }
    return <Button key={key} label={label} onPress={press => onPress(press.surface)} />
  }

  /** Under the buttons whose export failed: why, until another export starts */
  const failure = (shown: readonly WweShareAction[]) =>
    share.error && shown.includes(share.error.action) ? (
      <Text color="red">{copy.exportFailed(share.error.action, share.error.reason)}</Text>
    ) : null

  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" columnGap={2} flexWrap="wrap">
          <Button key="share-back" label={copy.backToStats()} plain onPress={() => actions.back()} />
          <Box flexDirection="row" columnGap={2}>
            {exportButton('post', copy.postToX(), () => actions.postToX())}
            {exportButton('image', copy.copyImage(), () => actions.copyImage())}
          </Box>
        </Box>
        {failure(['post', 'image'])}
      </Box>
      {cardPreview(ui, share)}
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Select
            key="card-language"
            label={copy.cardLangName()}
            value={share.lang === TARGET_LANG ? 'target' : 'source'}
            options={copy.cardLangOptions()}
            onSelect={value => actions.setCardLanguage(value)}
          />
        </Box>
        <Text dimColor>{copy.cardLangDescription()}</Text>
      </Box>
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" columnGap={2} flexWrap="wrap">
            <Text bold>{copy.shareTextTitle(xLength(text))}</Text>
            {exportButton('text', copy.copyText(), surface => actions.copyText(surface))}
          </Box>
          {failure(['text'])}
        </Box>
        <Box flexDirection="column" paddingLeft={2} rowGap={1}>
          {text.split('\n\n').map((part, i) => (
            <Box key={`post-${i}`} flexDirection="column">
              {part.split('\n').map((line, j) => (
                <Text key={`post-${i}-${j}`}>{line}</Text>
              ))}
            </Box>
          ))}
        </Box>
      </Box>
      <Text dimColor>{copy.shareHelp()}</Text>
    </Box>
  )
}

/**
 * The card: the terminal's boxes, or the desktop's picture of it. The
 * terminal's table has an Svg too, which it draws as nothing, so Raster
 * (the terminal's alone) decides.
 */
function cardPreview(ui: ShareUi, share: WweShare): RenderChildren {
  if ('Raster' in ui) {
    return terminalCard(ui, share)
  }
  if ('Svg' in ui) {
    return share.svg === null ? (
      <ui.Text dimColor>{copy.cardMaking()}</ui.Text>
    ) : (
      <ui.Svg source={share.svg} alt={copy.cardAlt()} />
    )
  }
  return terminalCard(ui, share)
}

/** Terminal columns a string takes: CJK and fullwidth characters take two */
const columnsOf = (text: string) => [...text].reduce((n, ch) => n + ((ch.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1), 0)

/** Long enough for any pane; a one-row box with its overflow hidden cuts it to the card's width */
const RULE_LENGTH = 256

/**
 * The card in the terminal, in the theme's own colours with the card's
 * accents in tones that read on a light or a dark terminal: the title and
 * the date (the icon's place to their right left empty), the five numbers
 * right-aligned beside their labels, the grid with its legend to its right,
 * a dashed line, the pitch after its large quote, the repository (the mark's
 * place before it left empty), and the footer under a hairline.
 */
function terminalCard(ui: Elements['terminal'], share: WweShare): RenderChildren {
  const { Box, Text, Raster } = ui
  const words = cardWords(share.card, share.lang)
  const numberColumns = Math.max(...words.numbers.map(columnsOf))
  const slash = words.repo.lastIndexOf('/') + 1
  const rule = (key: string, glyph: string) => (
    <Box key={key} height={1} overflow="hidden">
      <Text color={CARD_INK.line}>{glyph.repeat(RULE_LENGTH)}</Text>
    </Box>
  )
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={CARD_INK.line} paddingX={1} rowGap={1}>
      <Box flexDirection="column" paddingX={1}>
        {words.title.map((line, i) => (
          <Text key={`card-title-${i}`} bold>
            {line}
          </Text>
        ))}
        <Text dimColor>{words.date}</Text>
      </Box>
      <Box flexDirection="column" paddingX={1}>
        {words.numbers.map((n, i) => (
          <Box key={`card-number-${i}`} flexDirection="row" columnGap={2}>
            <Box width={numberColumns} flexShrink={0} justifyContent="flex-end">
              <Text bold color={TERMINAL_INK.heat}>
                {n}
              </Text>
            </Box>
            <Box flexShrink={1}>
              <Text>{words.labels[i] ?? ''}</Text>
            </Box>
          </Box>
        ))}
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} alignItems="flex-end" paddingX={1}>
        <Raster key="card-heat" {...heatRaster(share.card.heat)} />
        <Box flexDirection="column">
          <Text bold>{words.heat.title}</Text>
          <Text dimColor>{words.heat.note}</Text>
          <Box flexDirection="row" columnGap={1}>
            <Text dimColor>{words.heat.less}</Text>
            <Raster key="card-heat-key" {...heatKeyRaster()} />
            <Text dimColor>{words.heat.more}</Text>
          </Box>
        </Box>
      </Box>
      <Box flexDirection="column" paddingX={1}>
        {rule('card-dashes', '╌')}
        <Box flexDirection="row" columnGap={2}>
          <Text bold color={CARD_INK.line}>
            “
          </Text>
          <Box flexDirection="column" flexShrink={1}>
            {words.pitch.map((line, i) => (
              <Text key={`card-pitch-${i}`} bold>
                {line}
              </Text>
            ))}
          </Box>
        </Box>
      </Box>
      <Box flexDirection="row" paddingX={1}>
        <Box width={2} flexShrink={0} />
        <Box flexDirection="row" flexWrap="wrap" flexShrink={1}>
          <Text bold color={TERMINAL_INK.heat}>
            {words.repo.slice(0, slash)}
          </Text>
          <Text bold color={TERMINAL_INK.heat}>
            {words.repo.slice(slash)}
          </Text>
        </Box>
      </Box>
      <Box flexDirection="column">
        {rule('card-hairline', '─')}
        <Box flexDirection="row" justifyContent="center">
          <Text dimColor>{words.footer}</Text>
        </Box>
      </Box>
    </Box>
  )
}
