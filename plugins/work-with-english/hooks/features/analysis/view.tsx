import type { Elements, RenderChildren } from 'claude-code'

import type { WweAnalysis, WweSpeaking, WweWordResult } from '../../../types'
import {
  BACK_TO_TEXT,
  EXAMPLES,
  HARD_WORDS_PARAGRAPH,
  HARD_WORDS_SENTENCE,
  IN_SENTENCE,
  POINTS,
  SENSES,
  SENTENCE,
  STRUCTURE,
  THIS_SENTENCE,
  USAGES,
  analysing,
} from '../../core/copy/analysis'
import { speakButton } from '../../core/copy/band'
import { boldParts } from '../../core/text/wordform'
import type { SavedStatus } from '../wordbook/controller'
import { addControl } from '../wordbook/view'

// The pane's analyses as F10 and F11 draw them: each sentence with its
// translation, parts and points, then the hard words to open as word cards;
// a word card with its senses, the one the sentence uses tagged 本句.

export type AnalysisUi = Pick<Elements['terminal'] | Elements['desktop'], 'Box' | 'Text' | 'Button'>

export type AnalysisActions = {
  speak: (key: string, text: string) => void
  openWord: (word: string) => void
  back: () => void
  /** F12: 加入单词本 beside a sentence or a word */
  addSentence: (index: number) => void
  addWord: () => void
}

/** F12: the state of each 加入单词本, the word card's or each sentence's */
export type AnalysisSaved = { word: SavedStatus; sentences: readonly SavedStatus[] }

const NOTHING_SAVED: AnalysisSaved = { word: 'unknown', sentences: [] }

const LABEL_WIDTH = 10

export function analysisView(
  ui: AnalysisUi,
  analysis: WweAnalysis,
  speaking: WweSpeaking,
  actions: AnalysisActions,
  saved: AnalysisSaved = NOTHING_SAVED,
) {
  const { Box, Text, Button } = ui
  const speakLabel = (key: string) => speakButton(speaking?.key === key ? speaking.via : null)
  const isSpeakDimmed = (key: string) => speaking !== null && speaking.via === 'system' && speaking.key !== key

  const row = (label: string, body: RenderChildren, key: string) => (
    <Box key={key} flexDirection="row">
      <Box width={LABEL_WIDTH} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {body}
      </Box>
    </Box>
  )

  const top = analysis.back ? (
    <Box key="back">
      <Button key="back" label={BACK_TO_TEXT} plain onPress={() => actions.back()} />
    </Box>
  ) : null

  if (analysis.status !== 'done') {
    return (
      <Box flexDirection="column" rowGap={1}>
        {top}
        {analysis.status === 'pending' ? (
          <Text dimColor>{analysing(analysis.kind === 'word' ? analysis.subject : null)}</Text>
        ) : (
          <Text color="red">{analysis.error ?? ''}</Text>
        )}
      </Box>
    )
  }

  if (analysis.kind === 'text' && analysis.text) {
    const { sentences, hard } = analysis.text
    return (
      <Box flexDirection="column" rowGap={1}>
        {sentences.map((sentence, i) => (
          <Box key={`s-${i}`} flexDirection="column">
            <Box flexDirection="row" columnGap={1}>
              <Box flexGrow={1} flexShrink={1}>
                <Text bold>{sentence.en}</Text>
              </Box>
              <Button
                key={`speak-s-${i}`}
                label={speakLabel(`s-${i}`)}
                plain
                dimColor={isSpeakDimmed(`s-${i}`)}
                onPress={() => actions.speak(`s-${i}`, sentence.en)}
              />
              <Box flexShrink={0}>
                {addControl(ui, `add-s-${i}`, saved.sentences[i] ?? 'unknown', () => actions.addSentence(i))}
              </Box>
            </Box>
            <Text dimColor>{sentence.zh}</Text>
            {sentence.parts.length > 0 &&
              row(
                STRUCTURE,
                <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
                  {sentence.parts.map((part, j) => (
                    <Text key={`p-${i}-${j}`}>
                      <Text bold>{`[${part.text}]`}</Text>
                      <Text dimColor>{` ${part.role}`}</Text>
                    </Text>
                  ))}
                </Box>,
                `structure-${i}`,
              )}
            {sentence.points.length > 0 &&
              row(
                POINTS,
                sentence.points.map((point, j) => <Text key={`pt-${i}-${j}`}>{`• ${point}`}</Text>),
                `points-${i}`,
              )}
          </Box>
        ))}
        {hard.length > 0 &&
          row(
            analysis.isSentence ? HARD_WORDS_SENTENCE : HARD_WORDS_PARAGRAPH,
            <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
              {hard.map(word => (
                <Button key={`hard-${word}`} label={word} onPress={() => actions.openWord(word)} />
              ))}
            </Box>,
            'hard',
          )}
      </Box>
    )
  }

  if (analysis.kind === 'word' && analysis.word) {
    return wordCard(ui, analysis, analysis.word, top, speakLabel, isSpeakDimmed, actions, row, saved.word)
  }
  return <Box />
}

function wordCard(
  ui: AnalysisUi,
  analysis: WweAnalysis,
  word: WweWordResult,
  top: RenderChildren,
  speakLabel: (key: string) => string,
  isSpeakDimmed: (key: string) => boolean,
  actions: AnalysisActions,
  row: (label: string, body: RenderChildren, key: string) => RenderChildren,
  status: SavedStatus,
) {
  const { Box, Text, Button } = ui
  // 本句 first, the other senses lighter (F9 › 标出这句里的意思)
  const order = word.cur === null ? word.senses.map((_, i) => i) : [word.cur, ...word.senses.map((_, i) => i).filter(i => i !== word.cur)]
  return (
    <Box flexDirection="column" rowGap={1}>
      {top}
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          <Box flexGrow={1}>
            <Text bold>{word.lemma}</Text>
          </Box>
          <Button
            key="speak-word"
            label={speakLabel('word')}
            plain
            dimColor={isSpeakDimmed('word')}
            onPress={() => actions.speak('word', word.lemma)}
          />
          <Box flexShrink={0}>{addControl(ui, 'add-word', status, () => actions.addWord())}</Box>
        </Box>
        {word.ipa !== '' && <Text dimColor>{word.ipa}</Text>}
        {word.formNote && <Text dimColor>{word.formNote}</Text>}
      </Box>
      {row(
        SENSES,
        order.map((i, n) => (
          <Text key={`sense-${i}`} dimColor={n > 0 && word.cur !== null}>
            {n === 0 && word.cur !== null ? <Text inverse>{` ${THIS_SENTENCE} `}</Text> : null}
            {n === 0 && word.cur !== null ? ' ' : ''}
            {word.senses[i] ?? ''}
          </Text>
        )),
        'senses',
      )}
      {word.inSentence && row(IN_SENTENCE, <Text>{word.inSentence}</Text>, 'in-sentence')}
      {analysis.sentence &&
        row(
          SENTENCE,
          [<Text key="sentence-en">{bolded(ui, analysis.sentence, analysis.subject)}</Text>, word.sentenceZh ? <Text key="sentence-zh" dimColor>{word.sentenceZh}</Text> : null],
          'sentence',
        )}
      {word.usages.length > 0 &&
        row(
          USAGES,
          word.usages.map((usage, i) => <Text key={`usage-${i}`}>{`${usage.en}：${usage.zh}`}</Text>),
          'usages',
        )}
      {word.examples.length > 0 &&
        row(
          EXAMPLES,
          word.examples.map((example, i) => (
            <Box key={`example-${i}`} flexDirection="column">
              <Box flexDirection="row" columnGap={1}>
                <Box flexGrow={1} flexShrink={1}>
                  <Text>{example.en}</Text>
                </Box>
                <Button
                  key={`speak-ex-${i}`}
                  label={speakLabel(`ex-${i}`)}
                  plain
                  dimColor={isSpeakDimmed(`ex-${i}`)}
                  onPress={() => actions.speak(`ex-${i}`, example.en)}
                />
              </Box>
              <Text dimColor>{example.zh}</Text>
            </Box>
          )),
          'examples',
        )}
    </Box>
  )
}

/** The sentence with the selected form in bold, a whole word: cause, never the one in because (F10 › 原句) */
function bolded(ui: AnalysisUi, sentence: string, form: string) {
  const { Text } = ui
  const parts = boldParts(sentence, form)
  if (!parts) {
    return sentence
  }
  return [
    parts.before,
    <Text key="bold" bold>
      {parts.word}
    </Text>,
    parts.after,
  ]
}
