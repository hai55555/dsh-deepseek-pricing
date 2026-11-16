/**
 * Chinese statutory holiday calendars (only days that are public holidays).
 *
 * Two public, key-less sources are tried in order (the faster-reachable one
 * first; GitHub raw can be slow or blocked from some networks):
 *   https://timor.tech/api/holiday/year/{year}
 *   https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json
 *
 * Make-up workdays (`isOffDay === false` / `holiday === false`) are ignored on
 * purpose: the DeepSeek rule already makes every weekend off-peak, so a
 * Saturday or Sunday make-up workday stays off-peak.
 */

export function holidayCnUrl(year) {
  return `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`
}

export function timorUrl(year) {
  return `https://timor.tech/api/holiday/year/${year}`
}

/**
 * @param {string} text
 * @param {number} year
 * @returns {{ year: number, status: 'ok' | 'unpublished', map: Record<string, { name: string }> }}
 */
export function parseHolidayCn(text, year) {
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('节假日数据不是合法 JSON')
  }
  if (json && json.year !== undefined && Number(json.year) !== Number(year)) {
    throw new Error('节假日数据的年份与请求不一致')
  }
  const days = Array.isArray(json && json.days) ? json.days : []
  const map = {}
  for (const day of days) {
    if (!day || day.isOffDay !== true) continue
    if (typeof day.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) continue
    map[day.date] = { name: typeof day.name === 'string' && day.name ? day.name : '法定节假日' }
  }
  if (Object.keys(map).length === 0) {
    return { year: Number(year), status: 'unpublished', map: {} }
  }
  return { year: Number(year), status: 'ok', map }
}

/**
 * @param {string} text
 * @param {number} year
 * @returns {{ year: number, status: 'ok' | 'unpublished', map: Record<string, { name: string }> }}
 */
export function parseTimor(text, year) {
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('节假日数据不是合法 JSON')
  }
  if (!json || json.code !== 0 || typeof json.holiday !== 'object' || json.holiday === null) {
    throw new Error('节假日数据缺少 holiday 字段')
  }
  const map = {}
  for (const [key, entry] of Object.entries(json.holiday)) {
    if (!entry || entry.holiday !== true) continue
    const mmdd = /^(\d{2})-(\d{2})$/.exec(key)
    const date = typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date)
      ? entry.date
      : mmdd
        ? `${year}-${mmdd[1]}-${mmdd[2]}`
        : null
    if (!date || !date.startsWith(`${year}-`)) continue
    map[date] = { name: typeof entry.name === 'string' && entry.name ? entry.name : '法定节假日' }
  }
  if (Object.keys(map).length === 0) {
    return { year: Number(year), status: 'unpublished', map: {} }
  }
  return { year: Number(year), status: 'ok', map }
}
