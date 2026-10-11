import type { Elements, RenderChildren } from 'claude-code'

import type { WwePane, WweStats } from '../../../types'
import { noMessagesInPastWeek } from '../../core/copy/share'
import * as copy from '../../core/copy/stats'
import { canShare, splitWays, summarize } from '../../core/stats/aggregate'
import type { StatsTotals } from '../../core/stats/aggregate'
import {
  CHART_COLUMNS,
  TERMINAL_INK,
  WAYS,
  heatKeyRaster,
  heatRaster,
  heatSvg,
  trendRaster,
  trendSvg,
  waysRaster,
  waysSvg,
} from '../../core/stats/charts'
import { heatWeeks, trend } from '../../core/stats/heat'
import type { HeatDay, Trend } from '../../core/stats/heat'
import { rangeLabel } from '../../core/stats/range'
import type { RangeKind } from '../../core/stats/range'

// The 统计 page's figures (F13), drawn into the page's slot above 每周提醒:
// the range buttons, the numbers, the three ways, the two charts of the
// last 12 weeks and 生成分享卡. The surface is told by the element table
// `$.ui.resolve(e)` handed out: the terminal's has Raster, the desktop's
// Svg. Everything shown is counted here from the days `$.state.stats` holds,
// by core/stats; nothing is read or written.

/** Any surface's element table, as `$.ui.resolve(e)` returns it */
export type StatsUi = Elements[keyof Elements]

export type StatsVm = {
  stats: WweStats | null
  range: WwePane['statsRange']
  /**
   * The page's last line, 统计只存在本机…, drawn at the slot's end unless false:
   * the feature map has it under 每周提醒, which the settings page draws after the slot
   */
  privacy?: boolean
}

export type StatsActions = {
  setRange: (range: WwePane['statsRange']) => void
  openShare: () => void
}

const RANGES: readonly WwePane['statsRange'][] = ['week', 'lastWeek', 'all']

/** The page's range as core/stats names it */
export const kindOf = (range: WwePane['statsRange']): Exclude<RangeKind, '7d'> =>
  range === 'lastWeek' ? 'last' : range

/** The width of the names before the numbers, in terminal columns: 单词本新增 and a gap */
const LABEL_WIDTH = 12

export function statsSlot(ui: StatsUi, vm: StatsVm, actions: StatsActions): RenderChildren {
  const { Box, Text, Button } = ui
  const kind = kindOf(vm.range)
  const stats = vm.stats
  const privacy = vm.privacy === false ? null : <Text dimColor>{copy.privacyNote()}</Text>

  const tabs = (
    <Box key="stats-ranges" flexDirection="row" columnGap={2}>
      {RANGES.map(range => (
        <Button
          key={`range-${range}`}
          label={copy.rangeTab(kindOf(range))}
          plain
          dimColor={range !== vm.range}
          onPress={() => actions.setRange(range)}
        />
      ))}
    </Box>
  )

  if (!stats || stats.status !== 'done') {
    return (
      <Box flexDirection="column" rowGap={1}>
        {tabs}
        {stats?.status === 'failed' ? <Text color="red">{stats.error ?? copy.loadFailed()}</Text> : <Text dimColor>{copy.loading()}</Text>}
        {privacy}
      </Box>
    )
  }

  const { days, today } = stats
  const summary = summarize(days, kind, today)
  const hasData = summary.status !== 'noData'

  const row = (key: string, name: string, value: RenderChildren) => (
    <Box key={key} flexDirection="row">
      <Box width={LABEL_WIDTH} flexShrink={0}>
        <Text dimColor>{name}</Text>
      </Box>
      <Box flexDirection="row" columnGap={2} flexWrap="wrap" flexShrink={1}>
        {value}
      </Box>
    </Box>
  )

  const numbers =
    summary.status === 'noData' ? (
      <Text dimColor>{copy.noData()}</Text>
    ) : summary.status === 'empty' ? (
      <Text dimColor>{copy.noMessagesInRange()}</Text>
    ) : (
      <Box flexDirection="column">
        {row('sent', copy.sentName(), <Text bold>{copy.sentValue(summary.totals.sent)}</Text>)}
        {row('own', copy.ownName(), [
          <Text key="pct" bold>
            {copy.ownValue(summary.ownPct ?? 0)}
          </Text>,
          summary.delta === null ? null : summary.delta === 0 ? (
            <Text key="delta" dimColor>
              {copy.delta(0, kind)}
            </Text>
          ) : (
            <Text key="delta" color={summary.delta > 0 ? 'green' : 'red'}>
              {copy.delta(summary.delta, kind)}
            </Text>
          ),
        ])}
        <Box key="ways" flexDirection="row">
          <Box width={LABEL_WIDTH} flexShrink={0} />
          {waysChart(ui, summary.totals)}
        </Box>
        {row('words', copy.wordsName(), <Text bold>{copy.wordsValue(summary.totals.words)}</Text>)}
        {row('book', copy.bookName(), <Text bold>{copy.bookValue(summary.totals.newWords, summary.totals.newSents)}</Text>)}
        {row('streak', copy.streakName(), <Text bold>{copy.streakValue(summary.streak, kind)}</Text>)}
      </Box>
    )

  const charts = hasData
    ? [
        <Box key="trend" flexDirection="column">
          <Text bold>{copy.trendTitle()}</Text>
          {trendChart(ui, trend(days, today, kind))}
        </Box>,
        <Box key="heat" flexDirection="column">
          <Text bold>{copy.heatTitle()}</Text>
          {heatChart(ui, heatWeeks(days, today))}
        </Box>,
      ]
    : null

  // The card is always the last seven days, so 全部 has no button and the button goes by those days (F14)
  const share =
    kind === 'all' ? null : canShare(days, today) ? (
      <Box key="share" flexDirection="row">
        <Button key="share-open" label={copy.shareButton()} onPress={() => actions.openShare()} />
      </Box>
    ) : (
      <Box key="share" flexDirection="row" columnGap={2} flexWrap="wrap">
        <Text dimColor>{copy.shareButton()}</Text>
        <Text dimColor>{noMessagesInPastWeek()}</Text>
      </Box>
    )

  return (
    <Box flexDirection="column" rowGap={1}>
      {tabs}
      <Box flexDirection="column">
        <Text dimColor>{rangeLabel(summary.range, today)}</Text>
        {numbers}
      </Box>
      {charts}
      {share}
      {privacy}
    </Box>
  )
}

/** The three ways: a bar in three colours, and each way's share under it */
function waysChart(ui: StatsUi, totals: StatsTotals): RenderChildren {
  const { Box, Text } = ui
  const shares = splitWays(totals)
  if (shares === null) {
    return null
  }
  if ('Raster' in ui) {
    const { Raster } = ui
    const cells = splitWays(totals, CHART_COLUMNS)
    return (
      <Box flexDirection="column" flexShrink={1}>
        {cells && <Raster key="stats-ways" {...waysRaster(cells)} />}
        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
          {WAYS.map(way => (
            <Box key={`way-${way}`} flexDirection="row" columnGap={1}>
              <Text color={TERMINAL_INK.ways[way]}>█</Text>
              <Text dimColor>{copy.wayValue(way, shares[way])}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  }
  if ('Svg' in ui) {
    const chart = waysSvg(shares)
    return <ui.Svg source={chart.source} alt={chart.alt} width={chart.width} height={chart.height} />
  }
  return <Text dimColor>{WAYS.map(way => copy.wayValue(way, shares[way])).join('  ')}</Text>
}

/** 自己写的比例: a bar a week, the two ends under it */
function trendChart(ui: StatsUi, chart: Trend): RenderChildren {
  const { Box, Text } = ui
  if ('Raster' in ui) {
    const { Raster } = ui
    const cells = trendRaster(chart.bars)
    return (
      <Box flexDirection="column">
        <Raster key="stats-trend" {...cells} />
        <Box flexDirection="row" justifyContent="space-between" width={cells.columns} columnGap={1}>
          <Text dimColor>{chart.start}</Text>
          <Text dimColor>{chart.end}</Text>
        </Box>
      </Box>
    )
  }
  if ('Svg' in ui) {
    const svg = trendSvg(chart)
    return <ui.Svg source={svg.source} alt={svg.alt} width={svg.width} height={svg.height} isInteractive />
  }
  return <Text dimColor>{`${chart.start}  ${chart.end}`}</Text>
}

/** 每天的英文消息: a square a day, then 少, the five levels, 多 */
function heatChart(ui: StatsUi, weeks: readonly (readonly HeatDay[])[]): RenderChildren {
  const { Box, Text } = ui
  if ('Raster' in ui) {
    const { Raster } = ui
    return (
      <Box flexDirection="column">
        <Raster key="stats-heat" {...heatRaster(weeks.flatMap(week => week.map(day => day.level)))} />
        <Box flexDirection="row" columnGap={1}>
          <Text dimColor>{copy.heatLess()}</Text>
          <Raster key="stats-heat-key" {...heatKeyRaster()} />
          <Text dimColor>{copy.heatMore()}</Text>
        </Box>
      </Box>
    )
  }
  if ('Svg' in ui) {
    const svg = heatSvg(weeks)
    return <ui.Svg source={svg.source} alt={svg.alt} width={svg.width} height={svg.height} isInteractive />
  }
  return <Text dimColor>{copy.heatAlt()}</Text>
}
