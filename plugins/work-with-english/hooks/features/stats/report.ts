import { reportToast } from '../../core/copy/stats'
import { sumRange } from '../../core/stats/aggregate'
import { rangeOf } from '../../core/stats/range'
import { mondayOf } from '../../core/time'
import type { Host } from '../../host'
import { loadDays, mergePastDays } from './store'

// F13 › 周报提醒: once a week, at the first start of a new week, a toast
// points at last week's report, and /wwe opens on it until it was seen.
// Only at start-up; not when last week had no English message.

const REPORT_WEEK = 'flag/reportWeek'
const REPORT_UNSEEN = 'flag/reportUnseen'

export async function weeklyReminder(host: Host, today: string): Promise<void> {
  await mergePastDays(host, today)
  const settings = await host.state.settings.get()
  const week = mondayOf(today)
  if ((await host.store.get(REPORT_WEEK)) === week) {
    return
  }
  await host.store.set(REPORT_WEEK, week)
  const lastWeek = sumRange(await loadDays(host), rangeOf('last', today))
  if (!settings.weeklyReminder || lastWeek.sent === 0) {
    return
  }
  await host.store.set(REPORT_UNSEEN, true)
  host.ui.toast(reportToast())
}

/** Whether /wwe opens on last week's report: once, after the reminder */
export async function takeUnseenReport(host: Host): Promise<boolean> {
  if ((await host.store.get(REPORT_UNSEEN)) !== true) {
    return false
  }
  await host.store.delete(REPORT_UNSEEN)
  return true
}
