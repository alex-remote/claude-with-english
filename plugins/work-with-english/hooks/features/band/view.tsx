import type { Elements } from 'claude-code'

import type { WweBand, WweMark, WweSpeaking } from '../../../types'
import {
  blockedHint,
  clearButton,
  firstPending,
  nothingToFix,
  sendAnywayButton,
  sourceCode,
  speakButton,
  targetCode,
  tip,
  useButton,
} from '../../core/copy/band'

// The band above the prompt as F1 draws it: the target-language row with
// 朗读 at its right, the source row under it, the buttons of F2 and F3 with
// the day's tip, and F4's hint line with 仍然发送 at its right.

export type BandUi = Pick<Elements['terminal'] | Elements['desktop'], 'Box' | 'Text' | 'Button'>

export type BandActions = {
  replace: () => void
  clear: () => void
  speak: () => void
  sendAnyway: () => void
}

export type BandVm = {
  band: WweBand
  speaking: WweSpeaking
}

/**
 * F15: the corrected sentence with the words the correction changed or added
 * in the accent color, underlined; deleted words are not shown (Text draws
 * no strike-through we use).
 */
function marked(Text: BandUi['Text'], text: string, marks: readonly WweMark[]) {
  if (marks.length === 0) {
    return text
  }
  const parts = []
  let at = 0
  for (const [i, mark] of marks.entries()) {
    if (mark.start > at) {
      parts.push(text.slice(at, mark.start))
    }
    parts.push(
      <Text key={`mark-${i}`} color="yellow" underline>
        {text.slice(mark.start, mark.end)}
      </Text>,
    )
    at = mark.end
  }
  if (at < text.length) {
    parts.push(text.slice(at))
  }
  return parts
}

/** Whether the band shows anything: otherwise the hook leaves the site to Claude Code. */
export const isShown = (band: WweBand) => band.mode !== 'none' || band.blocked !== null

export function bandView(ui: BandUi, vm: BandVm, actions: BandActions) {
  const { Box, Text, Button } = ui
  const { band, speaking } = vm
  const mode = band.mode === 'none' ? 'translate' : band.mode
  const hasTarget = band.mode !== 'none' && band.error === null && band.target !== ''
  const readingHere = speaking?.key === 'band' ? speaking.via : null
  const isSpeakDisabled = speaking !== null && speaking.via === 'system' && speaking.key !== 'band'

  const rows = []
  if (band.mode !== 'none') {
    const first =
      band.error !== null ? (
        <Text color="red">{band.error}</Text>
      ) : band.target === '' ? (
        <Text dimColor>{firstPending()}</Text>
      ) : (
        <Text bold={!band.isPending} dimColor={band.isPending}>
          {band.isOk ? `${nothingToFix()} ` : ''}
          {marked(Text, band.target, band.marks)}
        </Text>
      )
    rows.push(
      <Box key="target" flexDirection="row" columnGap={2}>
        <Text bold color="blue">
          {targetCode()}
        </Text>
        <Box flexGrow={1}>{first}</Box>
        {hasTarget && (
          <Button key="speak" label={speakButton(readingHere)} plain dimColor={isSpeakDisabled} onPress={() => actions.speak()} />
        )}
      </Box>,
      <Box key="source" flexDirection="row" columnGap={2}>
        <Text dimColor>{sourceCode()}</Text>
        <Text dimColor>{band.source}</Text>
      </Box>,
    )
    if (hasTarget) {
      rows.push(
        <Box key="actions" flexDirection="row" columnGap={2}>
          {!band.isOk && <Button key="replace" label={useButton(mode)} onPress={() => actions.replace()} />}
          <Button key="clear" label={clearButton()} onPress={() => actions.clear()} />
          {band.showTip && <Text dimColor>{tip()}</Text>}
        </Box>,
      )
    }
  }
  if (band.blocked) {
    rows.push(
      <Box key="blocked" flexDirection="row" columnGap={2}>
        <Box flexGrow={1}>
          <Text color="yellow">{blockedHint(band.blocked)}</Text>
        </Box>
        <Button key="send-anyway" label={sendAnywayButton()} onPress={() => actions.sendAnyway()} />
      </Box>,
    )
  }
  return <Box flexDirection="column">{rows}</Box>
}
