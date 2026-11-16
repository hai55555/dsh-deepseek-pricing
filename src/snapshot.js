/**
 * Offline snapshot used when the official pages cannot be reached or parsed.
 * Captured on 2026-11-04 from:
 *   https://api-docs.deepseek.com/zh-cn/quick_start/pricing.md  (CNY)
 *   https://api-docs.deepseek.com/quick_start/pricing.md        (USD)
 * and the Chinese public holiday calendar
 *   https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/2026.json
 *
 * Keep this file boring: it is the last-resort answer, so it must stay valid
 * JSON-shaped data with no imports and no network access.
 */

export const SNAPSHOT_CAPTURED_AT = '2026-11-04T17:20:00+08:00'

const SCHEDULE_NOTE_ZH =
  '空闲时段价格为高峰时段价格的一半。北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。'
const SCHEDULE_NOTE_EN =
  'Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays. All other hours are off-peak, including weekends and Chinese public holidays in full.'

/** @typedef {{ cacheHit: number, cacheMiss: number, output: number }} ModelPrices */

export const SNAPSHOT_PRICES = Object.freeze({
  CNY: {
    currency: 'CNY',
    models: [
      {
        id: 'deepseek-flash',
        name: 'DeepSeek-V4.1-Flash-1017',
        peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
        offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
      },
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek-V4-Pro-0813',
        peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
        offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
      },
    ],
    searchFetch: 5,
    scheduleNote: { text: SCHEDULE_NOTE_ZH, known: true },
  },
  USD: {
    currency: 'USD',
    models: [
      {
        id: 'deepseek-flash',
        name: 'DeepSeek-V4.1-Flash-1017',
        peak: { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 },
        offPeak: { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 },
      },
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek-V4-Pro-0813',
        peak: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
        offPeak: { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
      },
    ],
    searchFetch: 0.75,
    scheduleNote: { text: SCHEDULE_NOTE_EN, known: true },
  },
})

/** Only statuary holidays (isOffDay === true); make-up workdays stay weekends. */
export const SNAPSHOT_HOLIDAYS = Object.freeze({
  2026: {
    '2026-01-01': { name: '元旦' },
    '2026-01-02': { name: '元旦' },
    '2026-01-03': { name: '元旦' },
    '2026-02-15': { name: '春节' },
    '2026-02-16': { name: '春节' },
    '2026-02-17': { name: '春节' },
    '2026-02-18': { name: '春节' },
    '2026-02-19': { name: '春节' },
    '2026-02-20': { name: '春节' },
    '2026-02-21': { name: '春节' },
    '2026-02-22': { name: '春节' },
    '2026-02-23': { name: '春节' },
    '2026-04-04': { name: '清明节' },
    '2026-04-05': { name: '清明节' },
    '2026-04-06': { name: '清明节' },
    '2026-05-01': { name: '劳动节' },
    '2026-05-02': { name: '劳动节' },
    '2026-05-03': { name: '劳动节' },
    '2026-05-04': { name: '劳动节' },
    '2026-05-05': { name: '劳动节' },
    '2026-06-19': { name: '端午节' },
    '2026-06-20': { name: '端午节' },
    '2026-06-21': { name: '端午节' },
    '2026-09-25': { name: '中秋节' },
    '2026-09-26': { name: '中秋节' },
    '2026-09-27': { name: '中秋节' },
    '2026-10-01': { name: '国庆节' },
    '2026-10-02': { name: '国庆节' },
    '2026-10-03': { name: '国庆节' },
    '2026-10-04': { name: '国庆节' },
    '2026-10-05': { name: '国庆节' },
    '2026-10-06': { name: '国庆节' },
    '2026-10-07': { name: '国庆节' },
  },
})

export function snapshotFor(currency) {
  const record = SNAPSHOT_PRICES[currency] || SNAPSHOT_PRICES.CNY
  return {
    ...record,
    models: record.models.map((model) => ({
      ...model,
      peak: { ...model.peak },
      offPeak: { ...model.offPeak },
    })),
    scheduleNote: record.scheduleNote ? { ...record.scheduleNote } : null,
    fetchedAtMs: Date.parse(SNAPSHOT_CAPTURED_AT),
    source: '内置快照',
    stale: true,
  }
}

export function snapshotHolidays(year) {
  return SNAPSHOT_HOLIDAYS[year] || null
}
