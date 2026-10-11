import type { Elements } from 'claude-code'

import type { WweBand, WweMark, WwePick, WweSpeaking } from '../../../types'
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
import {
  ANALYSE,
  COPIED,
  HIDE_TRANSLATION,
  SELECTED,
  TOO_LONG,
  TRANSLATE,
  TRANSLATION,
  looking,
  translating,
} from '../../core/copy/pick'
import { THIS_SENTENCE } from '../../core/copy/analysis'

// The band above the prompt as F1 draws it: the target-language row with
// 朗读 at its right, the source row under it, the buttons of F2 and F3 with
// the day's tip, and F4's hint line with 仍然发送 at its right.

export type BandUi = Pick<Elements['terminal'] | Elements['desktop'], 'Box' | 'Text' | 'Button'>

export type BandActions = {
  replace: () => void
  clear: () => void
  speak: () => void
  sendAnyway: () => void
  /** F9's selection line */
  pickClose: () => void
  pickSpeak: () => void
  pickAnalyse: () => void
  pickTranslate: () => void
}

export type BandVm = {
  band: WweBand
  speaking: WweSpeaking
  pick: WwePick | null
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
export const isShown = (band: WweBand, pick: WwePick | null = null) => band.mode !== 'none' || band.blocked !== null || pick !== null

const PICK_PREVIEW = 60

/**
 * F9's selection line, always the band's last: 已选中 (or 已复制) and what
 * was selected, its buttons and ✕ at the right; under it, a word's senses
 * (本句 first, the others lighter) or a passage's translation.
 */
function pickRows(ui: BandUi, pick: WwePick, speaking: WweSpeaking, actions: BandActions, isFirst: boolean) {
  const { Box, Text, Button } = ui
  const label = pick.via === 'copy' ? COPIED : SELECTED
  const shown = pick.text.length > PICK_PREVIEW ? `${pick.text.slice(0, PICK_PREVIEW)}…` : pick.text
  const isReading = speaking?.key === 'pick'
  let more = null
  if (pick.kind === 'word' && pick.lookup) {
    const { lookup } = pick
    more =
      lookup.status === 'pending' ? (
        <Text dimColor>{looking()}</Text>
      ) : lookup.status === 'failed' || !lookup.value ? (
        <Text dimColor>{lookup.error ?? ''}</Text>
      ) : (
        <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
          {orderedSenses(lookup.value.senses, lookup.value.cur).map(({ sense, isCurrent }, i) => (
            <Text key={`sense-${i}`} dimColor={!isCurrent && lookup.value?.cur !== null}>
              {isCurrent ? <Text inverse>{` ${THIS_SENTENCE} `}</Text> : null}
              {isCurrent ? ' ' : ''}
              {sense}
            </Text>
          ))}
        </Box>
      )
  } else if (pick.kind === 'text' && pick.tr.shown && pick.tr.status !== 'none') {
    more =
      pick.tr.status === 'pending' ? (
        <Text dimColor>{translating()}</Text>
      ) : (
        <Text dimColor>{pick.tr.status === 'done' ? `${TRANSLATION}${pick.tr.zh ?? ''}` : (pick.tr.error ?? '')}</Text>
      )
  }
  const meta =
    pick.kind === 'word' && pick.lookup?.value
      ? [pick.lookup.value.ipa, pick.lookup.value.formNote].filter(Boolean).join('  ')
      : ''
  return (
    <Box key="pick" flexDirection="column" marginTop={isFirst ? 0 : 1}>
      <Box flexDirection="row" columnGap={2}>
        <Text dimColor>{label}</Text>
        <Box flexGrow={1} flexShrink={1} flexDirection="row" columnGap={2}>
          <Text bold>{pick.kind === 'long' ? TOO_LONG : shown}</Text>
          {meta !== '' && <Text dimColor>{meta}</Text>}
        </Box>
        {pick.kind === 'text' && (
          <Button
            key="pick-translate"
            label={pick.tr.status === 'pending' ? translating() : pick.tr.status === 'done' && pick.tr.shown ? HIDE_TRANSLATION : TRANSLATE}
            plain
            onPress={() => actions.pickTranslate()}
          />
        )}
        {pick.kind !== 'long' && (
          <Button
            key="pick-speak"
            label={speakButton(isReading ? (speaking?.via ?? null) : null)}
            plain
            dimColor={speaking !== null && speaking.via === 'system' && !isReading}
            onPress={() => actions.pickSpeak()}
          />
        )}
        {pick.kind !== 'long' && <Button key="pick-analyse" label={ANALYSE} plain onPress={() => actions.pickAnalyse()} />}
        <Button key="pick-close" label="✕" plain role="dismiss" onPress={() => actions.pickClose()} />
      </Box>
      {more && (
        <Box paddingLeft={label.length * 2 + 2} flexDirection="column">
          {more}
        </Box>
      )}
    </Box>
  )
}

/** The sense the sentence uses first (F9 › 标出这句里的意思) */
function orderedSenses(senses: readonly string[], cur: number | null) {
  const all = senses.map((sense, i) => ({ sense, isCurrent: i === cur }))
  return cur === null ? all : [...all.filter(s => s.isCurrent), ...all.filter(s => !s.isCurrent)]
}

export function bandView(ui: BandUi, vm: BandVm, actions: BandActions) {
  const { Box, Text, Button } = ui
  const { band, speaking, pick } = vm
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
  if (pick) {
    rows.push(pickRows(ui, pick, speaking, actions, rows.length === 0))
  }
  return <Box flexDirection="column">{rows}</Box>
}
