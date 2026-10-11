import type { Elements, RenderChildren, RenderElement } from 'claude-code'

import type { WweBook, WweSettingsView, WweSpeaking } from '../../../types'
import { speakButton } from '../../core/copy/band'
import {
  ADD,
  ADDED,
  ADDING,
  ADD_SENTENCE,
  EMPTY_SENTENCES,
  EMPTY_WORDS,
  SOURCE_LABELS,
  THIS_SENTENCE,
  ZH_IS_TRANSLATION,
  ankiStatus,
  rowSyncState,
  sentencesHeading,
  wordsHeading,
} from '../../core/copy/wordbook'
import { boldParts } from '../../core/text/wordform'
import type { SavedStatus } from './controller'

// F12 as drawn: the 加入单词本 control in its four states, the buttons on a
// message you sent, and the 单词本 page's lists and its line on Anki.

export type BookUi = Pick<Elements['terminal'] | Elements['desktop'], 'Box' | 'Text' | 'Button'>

/**
 * 加入单词本, 补上这一句, 加入中… or 已加入单词本 (which can't be pressed);
 * nothing until the state is known, so the label never flips on the way in.
 */
export function addControl(ui: BookUi, key: string, status: SavedStatus, onPress: () => void, plain = true) {
  const { Text, Button } = ui
  switch (status) {
    case 'none':
      return <Button key={key} label={ADD} plain={plain || undefined} onPress={onPress} />
    case 'sentenceMissing':
      return <Button key={key} label={ADD_SENTENCE} plain={plain || undefined} onPress={onPress} />
    case 'adding':
      return <Text key={key} dimColor>{ADDING}</Text>
    case 'added':
      return <Text key={key} dimColor>{ADDED}</Text>
    case 'unknown':
      return null
  }
}

/**
 * A message you sent with 朗读 and 加入单词本 at its bottom right under the
 * pointer, laid over its last line as the reply's buttons are (P23).
 */
export function mineView(
  ui: BookUi,
  drawn: RenderElement,
  vm: { key: string; status: SavedStatus; speaking: WweSpeaking },
  actions: { speak: () => void; add: () => void },
) {
  const { Box, Button } = ui
  const speakKey = `mine-${vm.key}`
  const isReading = vm.speaking?.key === speakKey
  return (
    <Box key={`mine-${vm.key}`} flexDirection="column">
      {drawn}
      <Box position="absolute" right={0} bottom={0} display="none" hover={{ display: 'flex' }} columnGap={1}>
        <Button
          key="mine-speak"
          label={speakButton(isReading ? (vm.speaking?.via ?? null) : null)}
          dimColor={vm.speaking !== null && vm.speaking.via === 'system' && !isReading}
          onPress={() => actions.speak()}
        />
        {addControl(ui, 'mine-add', vm.status, () => actions.add(), false)}
      </Box>
    </Box>
  )
}

/** What is shown of a long sentence; the book keeps it whole (F12 › 正文太长时只在显示时截断) */
const SHOWN_MAX = 300
const shown = (text: string) => (text.length > SHOWN_MAX ? `${text.slice(0, SHOWN_MAX)}…` : text)

/** The sentence with the word as it stood there in bold, a whole word as on the Anki card (use, never the one in because) */
function bolded(ui: BookUi, sentence: string, form: string) {
  const { Text } = ui
  const text = shown(sentence)
  const parts = boldParts(text, form)
  if (!parts) {
    return text
  }
  return [
    parts.before,
    <Text key="bold" bold>
      {parts.word}
    </Text>,
    parts.after,
  ]
}

export type BookActions = { remove: (kind: 'word' | 'sentence', key: string) => void }

/** The 单词本 page's lists: words, then sentences, the newest first in each */
export function bookLists(ui: BookUi, vm: { book: WweBook; settings: WweSettingsView }, actions: BookActions): RenderChildren {
  const { Box, Text, Button } = ui
  const { book, settings } = vm
  const anki = { isSyncOn: settings.ankiSync, hasEverConnected: book.anki.hasEverConnected }
  const head = (key: string, left: RenderChildren, isSynced: boolean, onDelete: () => void) => {
    const state = rowSyncState({ isSynced }, anki)
    return (
      <Box key={key} flexDirection="row" columnGap={2}>
        <Box flexGrow={1} flexShrink={1} flexDirection="row" columnGap={2}>
          {left}
        </Box>
        {state !== '' && <Text dimColor>{state}</Text>}
        <Button key={`${key}-delete`} label="✕" plain onPress={onDelete} />
      </Box>
    )
  }
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        <Text bold>{wordsHeading(book.words.length)}</Text>
        {book.status === 'done' && book.words.length === 0 && <Text dimColor>{EMPTY_WORDS}</Text>}
        {book.words.map(word => (
          <Box key={`word-${word.lemma}`} flexDirection="column">
            {head(
              `word-${word.lemma}`,
              [
                <Text key="lemma" bold>
                  {word.lemma}
                </Text>,
                word.ipa !== '' ? (
                  <Text key="ipa" dimColor>
                    {word.ipa}
                  </Text>
                ) : null,
              ],
              word.isSynced,
              () => actions.remove('word', word.lemma),
            )}
            {word.sentences.map((sentence, i) => (
              <Box key={`word-${word.lemma}-${i}`} flexDirection="column" paddingLeft={2}>
                {sentence.sense !== '' && (
                  <Text>
                    <Text inverse>{` ${THIS_SENTENCE} `}</Text>
                    {` ${sentence.sense}`}
                  </Text>
                )}
                <Text>{bolded(ui, sentence.en, sentence.form)}</Text>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
      <Box flexDirection="column">
        <Text bold>{sentencesHeading(book.sentences.length)}</Text>
        {book.status === 'done' && book.sentences.length === 0 && <Text dimColor>{EMPTY_SENTENCES}</Text>}
        {book.sentences.map((sentence, i) => (
          <Box key={`sentence-${i}-${sentence.en.slice(0, 40)}`} flexDirection="column">
            {head(
              `sentence-${i}`,
              <Text dimColor>{SOURCE_LABELS[sentence.source]}</Text>,
              sentence.isSynced,
              () => actions.remove('sentence', sentence.en),
            )}
            <Box flexDirection="column" paddingLeft={2}>
              <Text>{shown(sentence.en)}</Text>
              <Text dimColor>
                {shown(sentence.zh)}
                {sentence.zhIsTranslation ? `（${ZH_IS_TRANSLATION}）` : ''}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/** The line under 同步到 Anki; null with syncing off or before this page's check answered */
export function ankiLine(ui: BookUi, vm: { book: WweBook; settings: WweSettingsView }): RenderElement | null {
  const { Text } = ui
  const { book, settings } = vm
  const line = ankiStatus({
    isSyncOn: settings.ankiSync,
    link: book.anki.link,
    deck: settings.ankiDeck,
    pendingWords: book.anki.pendingWords,
    pendingSentences: book.anki.pendingSentences,
    ...(book.anki.reason === null ? {} : { brokenReason: book.anki.reason }),
  })
  if (line === null) {
    return null
  }
  return <Text color={book.anki.link === 'broken' ? 'yellow' : book.anki.link === 'ok' ? 'green' : undefined}>{line}</Text>
}
