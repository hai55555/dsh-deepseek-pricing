/**
 * Pure peak/off-peak logic for DeepSeek API pricing.
 *
 * Official rule (https://api-docs.deepseek.com/zh-cn/quick_start/pricing):
 *   北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；
 *   其余时段，包括周末及中国法定节假日全天均为空闲时段。
 *   空闲时段价格为高峰时段价格的一半。
 *
 * Everything here is computed in Asia/Shanghai; the host machine time zone and
 * the browser time zone never take part in the decision.
 */

export const BEIJING_TIME_ZONE = 'Asia/Shanghai'

/** Peak windows as [startHour, endHour) in Beijing time. */
export const PEAK_WINDOWS = Object.freeze([
  Object.freeze({ start: 9, end: 12 }),
  Object.freeze({ start: 14, end: 18 }),
])

/** ISO weekday numbers (Mon=1 .. Sun=7) that can be peak days. */
export const PEAK_WEEKDAYS = Object.freeze([1, 2, 3, 4, 5])

const HOUR_MS = 3600000
const DAY_MS = 86400000

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BEIJING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function pad2(value) {
  return String(value).padStart(2, '0')
}

/**
 * Split one instant into Beijing calendar fields.
 * @param {Date | number} input
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number, second: number, dateKey: string, isoWeekday: number }}
 */
export function beijingParts(input) {
  const date = input instanceof Date ? input : new Date(input)
  const parts = formatter.formatToParts(date)
  const pick = (type) => {
    const found = parts.find((part) => part.type === type)
    return found ? found.value : ''
  }
  const year = Number(pick('year'))
  const month = Number(pick('month'))
  const day = Number(pick('day'))
  const hour = Number(pick('hour')) % 24
  const minute = Number(pick('minute'))
  const second = Number(pick('second'))
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dateKey: `${year}-${pad2(month)}-${pad2(day)}`,
    isoWeekday: utcDay === 0 ? 7 : utcDay,
  }
}

/**
 * @typedef {{ name?: string }} HolidayEntry
 * @typedef {Record<string, HolidayEntry>} HolidayMap
 */

/**
 * Classify one instant.
 * @param {ReturnType<typeof beijingParts>} parts
 * @param {HolidayMap} [holidays]
 */
export function evaluatePeak(parts, holidays) {
  const holiday = holidays && holidays[parts.dateKey]
  const holidayName = holiday ? holiday.name || '' : null
  const workday = PEAK_WEEKDAYS.includes(parts.isoWeekday)
  const inWindow = PEAK_WINDOWS.some(
    (window) => parts.hour >= window.start && parts.hour < window.end,
  )
  const peak = workday && !holidayName && inWindow
  return {
    peak,
    period: peak ? 'peak' : 'off-peak',
    holidayName,
    workday,
    inWindow,
  }
}

/**
 * Find the first hour boundary after `now` whose period differs from the
 * current one. Windows are hour aligned, so scanning boundaries is exact.
 * @param {Date | number} now
 * @param {HolidayMap} [holidays]
 * @param {number} [maxDays]
 * @returns {{ atMs: number, to: 'peak' | 'off-peak' } | null}
 */
export function nextTransition(now, holidays, maxDays = 14) {
  const currentMs = now instanceof Date ? now.getTime() : now
  const current = evaluatePeak(beijingParts(currentMs), holidays)
  const firstBoundary = Math.floor(currentMs / HOUR_MS) * HOUR_MS + HOUR_MS
  const limit = currentMs + maxDays * DAY_MS
  for (let at = firstBoundary; at <= limit; at += HOUR_MS) {
    const candidate = evaluatePeak(beijingParts(at), holidays)
    if (candidate.peak !== current.peak) {
      return { atMs: at, to: candidate.period }
    }
  }
  return null
}

/**
 * Merge per-year holiday maps into one lookup.
 * @param {Array<{ map: HolidayMap }>} years
 * @returns {HolidayMap}
 */
export function mergeHolidays(years) {
  const merged = {}
  for (const year of years) {
    if (!year || !year.map) continue
    for (const [dateKey, entry] of Object.entries(year.map)) {
      merged[dateKey] = entry
    }
  }
  return merged
}

/** ISO timestamp for a Beijing wall-clock time, used by tests and snapshots. */
export function beijingIso(year, month, day, hour = 0, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, 0)).toISOString()
}
