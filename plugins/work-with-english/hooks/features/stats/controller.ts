import type { RenderSurface } from 'claude-code'

import type { WwePane, WweSettings, WweShare, WweShareAction, WweStats } from '../../../types'
import { REQUEST_TIMEOUT_MS, raceTimeout } from '../../core/async/slot'
import {
  EXPORT_REASONS,
  cardLangOf,
  imageCopiedToast,
  postedToast,
  textCopiedToast,
} from '../../core/copy/share'
import { loadFailed } from '../../core/copy/stats'
import type { CardStats } from '../../core/share/card'
import { cardStatsOf } from '../../core/share/week'
import { localDate } from '../../core/time'
import type { Host } from '../../host'
import { saveSetting } from '../../services/settings'
import { ExportError, cardOf, copyImage, copyText, exportPng, postToX } from '../share/export'
import { loadDays, mergePastDays } from './store'

// The 统计 page (F13) and the share card it opens (F14): what reads the
// stats files and makes the card's pictures, so the drawings only draw what
// `$.state.stats` holds. register.tsx calls `load` when the page comes into
// view, and hands the rest to the two views as their actions.

export type StatsPage = ReturnType<typeof createStatsPage>

const NO_STATS: WweStats = { status: 'loading', today: '', days: {}, error: null, share: null }

const CARD_LANGUAGES: readonly WweSettings['cardLanguage'][] = ['target', 'source']

export function createStatsPage(host: Host) {
  /** Counts up with each read, so an older one answering late changes nothing */
  let generation = 0
  /** An export is running: the three buttons wait for it (通用状态 › 进行中不能再点) */
  let isExporting = false

  async function todayOf(): Promise<string> {
    const ms = await host.clock.now()
    return localDate(ms, -new Date(ms).getTimezoneOffset())
  }

  /** The card as it stands, changed; nothing once the card has gone */
  const updateShare = (fn: (share: WweShare) => WweShare) =>
    host.state.stats.update(stats => (stats?.share ? { ...stats, share: fn(stats.share) } : stats))

  /** Counts up with each card drawn, so a picture made for a card since replaced is dropped */
  let drawing = 0

  /** The SVG of the card in `lang`, for the desktop's preview */
  async function drawCard(card: CardStats, lang: WweShare['lang']) {
    const mine = ++drawing
    const svg = await cardOf(host, card, lang)
    if (mine === drawing) {
      await updateShare(share => (share.lang === lang ? { ...share, svg } : share))
    }
  }

  /** One export at a time, its progress and its failure under its button, its toast once done */
  async function exportAs(action: WweShareAction, task: (share: WweShare) => Promise<void>, toast: string) {
    // Taken before any await, so two quick presses can't both start
    if (isExporting) {
      return
    }
    isExporting = true
    try {
      const share = (await host.state.stats.get())?.share
      if (!share) {
        return
      }
      await updateShare(current => ({ ...current, busy: action, error: null }))
      const done = await raceTimeout(task(share), REQUEST_TIMEOUT_MS, host.clock.after)
      if (done.timedOut) {
        host.ui.debug(`share ${action}: no result in ${REQUEST_TIMEOUT_MS} ms`)
        await updateShare(current => ({ ...current, busy: null, error: { action, reason: EXPORT_REASONS.timeout } }))
        return
      }
      host.ui.toast(toast)
      await updateShare(current => ({ ...current, busy: null }))
    } catch (error) {
      host.ui.debug(`share ${action}: ${error instanceof Error ? error.message : String(error)}`)
      const step = error instanceof ExportError ? error.step : action === 'text' ? 'clipboard' : 'png'
      await updateShare(current => ({ ...current, busy: null, error: { action, reason: EXPORT_REASONS[step] } }))
    } finally {
      isExporting = false
    }
  }

  return {
    /**
     * Reads the stats files again: the days before today merged into their
     * day.json first (dev-plan › 状态和存储), today by this machine's calendar.
     * The figures shown stay until the new ones are in.
     */
    async load(): Promise<void> {
      const mine = ++generation
      await host.state.stats.update(stats => stats ?? NO_STATS)
      try {
        const today = await todayOf()
        await mergePastDays(host, today).catch(error => host.ui.debug(`stats merge: ${String(error)}`))
        const days = await loadDays(host)
        if (mine === generation) {
          await host.state.stats.update(stats => ({
            status: 'done',
            today,
            days,
            error: null,
            share: stats?.share ?? null,
          }))
        }
      } catch (error) {
        host.ui.debug(`stats load: ${String(error)}`)
        if (mine === generation) {
          await host.state.stats.update(stats => ({ ...(stats ?? NO_STATS), status: 'failed', error: loadFailed() }))
        }
      }
    },

    /** 本周, 上周, 全部: only what shows changes, nothing is saved (设置 › 保存) */
    async setRange(range: WwePane['statsRange']): Promise<void> {
      await host.state.pane.update(pane => ({ ...pane, statsRange: range }))
    },

    /**
     * 生成分享卡: the pane turns to the card of the seven days up to the day the
     * page was read, whichever range shows. Nothing when they have no English
     * message, as the button can't be pressed then.
     */
    async openShare(): Promise<void> {
      const stats = await host.state.stats.get()
      const card = stats && stats.status === 'done' ? cardStatsOf(stats.days, stats.today) : null
      if (!card) {
        return
      }
      const lang = cardLangOf((await host.state.settings.get()).cardLanguage)
      await host.state.stats.update(current =>
        current ? { ...current, share: { card, lang, svg: null, busy: null, error: null } } : current,
      )
      await host.state.pane.update(pane => ({ ...pane, view: 'share', tab: 'stats' }))
      await drawCard(card, lang)
    },

    /** ← 返回统计: back to the 统计 page as it was */
    async back(): Promise<void> {
      await host.state.pane.update(pane => ({ ...pane, view: 'settings', tab: 'stats' }))
      await host.state.stats.update(stats => (stats ? { ...stats, share: null } : stats))
    },

    /**
     * 卡片语言: saved the moment it is picked, with its toast; the same choice
     * again saves nothing. The card and the post then change language.
     */
    async setCardLanguage(value: string): Promise<void> {
      const setting = CARD_LANGUAGES.find(choice => choice === value)
      if (!setting || (await host.state.settings.get()).cardLanguage === setting) {
        return
      }
      await saveSetting(host, 'cardLanguage', setting)
      const lang = cardLangOf(setting)
      const share = (await host.state.stats.get())?.share
      if (share && share.lang !== lang) {
        await updateShare(current => ({ ...current, lang, svg: null }))
        await drawCard(share.card, lang)
      }
    },

    /** 发到 X: the card copied as a picture, then X's post page with the text filled in; the plugin never posts */
    postToX(): Promise<void> {
      return exportAs(
        'post',
        async share => postToX(host, await exportPng(host, share.card, share.lang), share.lang),
        postedToast(),
      )
    },

    /** 复制图片: the card on the clipboard as a picture, for anywhere but X */
    copyImage(): Promise<void> {
      return exportAs(
        'image',
        async share => copyImage(host, await exportPng(host, share.card, share.lang)),
        imageCopiedToast(),
      )
    },

    /** 复制文字: the post and its links on the clipboard */
    copyText(surface?: RenderSurface): Promise<void> {
      return exportAs('text', share => copyText(host, share.lang, surface), textCopiedToast())
    },
  }
}
